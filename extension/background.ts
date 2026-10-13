(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const settingsReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

  async function api(path: string, method = "GET", body?: object) {
    await settingsReady;
    const { appUrl, extensionToken } = await chrome.storage.local.get(["appUrl", "extensionToken"]);
    if (!appUrl || !extensionToken) throw new Error("Angel Agent 주소와 연결 토큰을 설정해 주세요.");
    const response = await fetch(new URL(path, appUrl), { method,
      headers: { Authorization: `Bearer ${extensionToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store",
      ...(method !== "GET" ? { signal: AbortSignal.timeout(method === "DELETE" ? 10000 : 45000) } : {}) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error ?? `API 오류 (${response.status})`);
    return value;
  }

  async function scanEditorFrames() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || new URL(tab.url).origin !== "https://blog.naver.com") throw new Error("현재 탭을 네이버 블로그 글쓰기 화면으로 전환해 주세요.");
    const frames = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
    const found: { frameId: number; diagnostic: EditorDiagnostic }[] = [];
    const diagnostics: NonNullable<ExtensionReply["diagnostics"]> = [];
    for (const frame of frames ?? []) {
      if (!frame.url.startsWith("https://blog.naver.com/")) continue;
      try {
        const reply = await chrome.tabs.sendMessage(tab.id, { type: "EDITOR_DIAGNOSE" }, { frameId: frame.frameId });
        if (reply.diagnostic) {
          const ready = reply.diagnostic.frameReady === true && reply.diagnostic.titleFound === true && reply.diagnostic.bodyFound === true;
          reply.diagnostic = { ...reply.diagnostic, ready,
            reason: ready ? "SmartEditor 글쓰기 화면 확인 완료" : "SmartEditor 글쓰기 frame/제목/본문을 모두 확인하지 못했습니다.",
          };
        }
        diagnostics.push({ frameId: frame.frameId, diagnostic: reply.diagnostic });
        if (reply.diagnostic?.ready === true) found.push({ frameId: frame.frameId, diagnostic: reply.diagnostic });
      } catch { diagnostics.push({ frameId: frame.frameId, reason: "content script 접근 불가: 탭 새로고침 또는 프레임 URL을 확인하세요." }); }
    }
    return { tabId: tab.id, found, diagnostics };
  }

  let inputRunning = false;

  async function assertCurrentTab(tabId: number) {
    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (current?.id !== tabId || !current.url || new URL(current.url).origin !== "https://blog.naver.com") {
      throw new Error("현재 탭이 변경되어 입력을 중단했습니다. Naver 글쓰기 탭에서 다시 시도하세요.");
    }
  }

  async function insertWithDebugger(tabId: number, frameId: number, task: ExtensionTask, overwrite: boolean) {
    if (inputRunning) throw new Error("입력 작업이 이미 진행 중입니다.");
    if (!task.title?.trim() || !task.bodyText?.trim()) throw new Error("제목 또는 본문이 비어 있습니다.");
    inputRunning = true;
    const debuggee = { tabId };
    let attached = false;
    let stage = "attach";
    let failure: unknown;
    let detachFailure: unknown;
    const temporaryImages = new Set<string>();
    const cleanupWarnings = new Set<string>();
    async function removeTempImage(tempId: string) {
      try {
        await api(`/api/extension/temp-image/${tempId}`, "DELETE");
        temporaryImages.delete(tempId);
        cleanupWarnings.delete(tempId);
      } catch { cleanupWarnings.add(tempId); }
    }
    async function createPhotoTemp(image: ExtensionTask["images"][number]) {
      try {
        const result = await api("/api/extension/temp-image", "POST", { signedUrl: image.signedUrl });
        if (typeof result.tempId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(result.tempId)) throw new Error("tempId 없음");
        temporaryImages.add(result.tempId);
        if (typeof result.absolutePath !== "string" || !/^(?:[A-Za-z]:[\\/]|\/)/.test(result.absolutePath)) throw new Error("임시 파일 경로 없음");
        return { tempId: result.tempId, filename: result.absolutePath };
      } catch { throw new Error("서버 임시 사진 생성 실패: URL 만료·서버 상태를 확인하세요."); }
    }
    const onDetach = (source: { tabId?: number }) => { if (source.tabId === tabId) attached = false; };
    chrome.debugger.onDetach.addListener(onDetach);
    const send = async (method: string, params: object) => {
      await assertCurrentTab(tabId);
      if (!attached) throw new Error("Naver debugger 연결이 해제되어 입력을 중단했습니다.");
      await chrome.debugger.sendCommand(debuggee, method, params);
    };
    const frameRequest = async (message: ExtensionMessage) => {
      await assertCurrentTab(tabId);
      const reply = await chrome.tabs.sendMessage(tabId, message, { frameId });
      if (reply.error) throw new Error(reply.error);
      return reply;
    };
    const insertField = async (field: "title" | "body", text: string) => {
      stage = `${field} target`;
      const reply = await frameRequest({ type: "EDITOR_TARGET", field, overwrite });
      if (!reply.position) throw new Error("입력 좌표를 조회하지 못했습니다.");
      const { x, y } = reply.position;
      stage = `${field} click`;
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      // 눌림 상태가 남지 않도록 같은 탭의 mouse release는 active-tab 검사 없이 즉시 보냅니다.
      await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
      if (reply.existing) {
        stage = `${field} select existing text`;
        await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
        await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
      }
      stage = `${field} insert text`;
      await send("Input.insertText", { text });
      stage = `${field} DOM verification`;
      const checked = await frameRequest({ type: "EDITOR_VERIFY", field, task });
      if (!checked.verification?.titleMatches || (field === "body" && !checked.verification.bodyMatches)) throw new Error("DOM 검증 결과가 없습니다.");
    };
    try {
      stage = "PHOTO_POSITION";
      const images = task.images.slice(0, 3).sort((a, b) => b.insertOffset - a.insertOffset || b.index - a.index);
      if (images.some((image) => !Number.isSafeInteger(image.insertOffset) || image.insertOffset < 0 || image.insertOffset > task.bodyText.length)) throw new Error("사진 insertOffset을 확인해 주세요.");
      await assertCurrentTab(tabId);
      const check = await frameRequest({ type: "EDITOR_DIAGNOSE" });
      if (check.diagnostic?.ready !== true || !check.diagnostic.titleFound || !check.diagnostic.bodyFound) throw new Error("Naver 글쓰기 frame/제목/본문을 다시 확인해 주세요.");
      if (check.diagnostic.existing && !overwrite) throw new Error("기존 글 덮어쓰기 확인이 필요합니다.");
      await chrome.debugger.attach(debuggee, "1.3");
      attached = true;
      await insertField("title", task.title);
      await insertField("body", task.bodyText);
      for (const image of images) {
        stage = "PHOTO_TEMP_CREATE";
        const downloaded = await createPhotoTemp(image);
        const photoTask = { ...task, images: [image] };
        const clickPhotoTarget = async (type: string) => {
          const reply = await frameRequest({ type, task: photoTask });
          if (!reply.position) throw new Error("사진 입력 좌표 없음");
          const { x, y } = reply.position;
          await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
          await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
        };
        const key = async (name: string, code: number, modifiers = 0) => {
          await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, windowsVirtualKeyCode: code, modifiers });
          await chrome.debugger.sendCommand(debuggee, "Input.dispatchKeyEvent", { type: "keyUp", key: name, windowsVirtualKeyCode: code, modifiers });
        };
        stage = "PHOTO_POSITION";
        await clickPhotoTarget("EDITOR_PHOTO_TARGET");
        await frameRequest({ type: "EDITOR_PHOTO_CARET" });
        stage = "PHOTO_EMPTY_PARAGRAPH";
        await key("Enter", 13);
        await key("Enter", 13);
        await clickPhotoTarget("EDITOR_PHOTO_EMPTY");
        await frameRequest({ type: "EDITOR_PHOTO_UPLOAD_CARET" });
        stage = "PHOTO_FILE_CHOOSER";
        let timer: ReturnType<typeof setTimeout> | undefined;
        let rejectChooser: (error: Error) => void = () => {};
        let onChooser: Parameters<typeof chrome.debugger.onEvent.addListener>[0] = () => {};
        const chooser = new Promise<{ source: { tabId?: number; sessionId?: string }; backendNodeId: number }>((resolve, reject) => {
          rejectChooser = reject;
          onChooser = (source, method, params) => {
            if (source.tabId !== tabId || method !== "Page.fileChooserOpened") return;
            const nodeId = params?.backendNodeId;
            if (typeof nodeId !== "number" || !Number.isSafeInteger(nodeId) || nodeId <= 0) reject(new Error("file input backendNodeId 없음"));
            else resolve({ source, backendNodeId: nodeId });
          };
          chrome.debugger.onEvent.addListener(onChooser);
          timer = setTimeout(() => reject(new Error("사진 파일 선택 이벤트 시간 초과")), 15000);
        });
        // 클릭/프로토콜 실패로 이벤트 대기가 종료되기 전에도 rejection을 처리합니다.
        void chooser.catch(() => {});
        try {
          await send("Page.enable", {});
          await send("Page.setInterceptFileChooserDialog", { enabled: true });
          await clickPhotoTarget("EDITOR_PHOTO_BUTTON");
          const opened = await chooser;
          stage = "PHOTO_UPLOAD";
          await assertCurrentTab(tabId);
          await chrome.debugger.sendCommand(opened.source, "DOM.setFileInputFiles", { files: [downloaded.filename], backendNodeId: opened.backendNodeId });
        } catch (error) {
          rejectChooser(new Error("사진 파일 선택 중단"));
          if (error instanceof Error && error.message.includes("backendNodeId")) throw error;
          throw new Error(stage === "PHOTO_UPLOAD" ? "사진 파일 지정 실패" : "사진 파일 선택 interception 실패");
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          chrome.debugger.onEvent.removeListener(onChooser);
          if (attached) await chrome.debugger.sendCommand(debuggee, "Page.setInterceptFileChooserDialog", { enabled: false });
        }
        stage = "PHOTO_UPLOAD";
        const finished = await frameRequest({ type: "EDITOR_PHOTO_VERIFY" });
        if (!finished.imageReady) throw new Error("사진 업로드 검증 결과 없음");
      }
      if (images.length) {
        stage = "PHOTO_VERIFY";
        await frameRequest({ type: "EDITOR_PHOTO_BODY_VERIFY", task });
      }
    } catch (error) { failure = error; }
    finally {
      for (const delay of [0, 500, 1500, 3000]) {
        if (!temporaryImages.size) break;
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        await Promise.all([...temporaryImages].map(removeTempImage));
      }
      try { if (attached) await chrome.debugger.detach(debuggee); }
      catch (error) { detachFailure = error; }
      finally { chrome.debugger.onDetach.removeListener(onDetach); inputRunning = false; }
    }
    const cleanupWarning = cleanupWarnings.size ? ` PHOTO_TEMP_CLEANUP: 임시 사진 ${cleanupWarnings.size}개 정리 실패. 입력한 사진은 유지됩니다.` : "";
    if (failure || detachFailure) {
      const reason = failure instanceof Error ? failure.message : failure ? "입력 실패" : "";
      const detachReason = detachFailure ? " debugger detach 실패: Chrome에서 연결 상태를 확인해 주세요." : "";
      throw new Error(`${stage}: ${reason}${detachReason}${cleanupWarning} 일부 입력되었을 수 있으니 직접 확인하세요.`);
    }
    return { message: `입력 완료 - 네이버에서 직접 확인 후 발행하세요${cleanupWarning}` };
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    void (async (): Promise<ExtensionReply> => {
      switch (message.type) {
        case "TASKS": return { tasks: (await api("/api/extension/blog-tasks")).tasks };
        case "TASK":
          if (!message.id || !/^[1-9]\d*$/.test(message.id)) throw new Error("Task ID를 확인해 주세요.");
          return { task: await api(`/api/extension/blog-tasks/${message.id}`) };
        case "DIAGNOSE": {
          const editor = await scanEditorFrames();
          const writingFrames = editor.diagnostics.filter((frame) => frame.diagnostic?.writing);
          return { diagnostics: editor.diagnostics, diagnostic: editor.found.length === 1 ? editor.found[0].diagnostic
            : editor.found.length === 0 && writingFrames.length === 1 ? writingFrames[0].diagnostic : undefined };
        }
        case "INSERT": {
          if (!message.task) throw new Error("선택된 초안이 없습니다.");
          const editor = await scanEditorFrames();
          if (editor.found.length !== 1) throw new Error(`SmartEditor 입력 프레임을 확정하지 못했습니다 (${editor.found.length}개). DOM 진단을 확인해 주세요.`);
          const target = editor.found[0];
          if (target.diagnostic.existing && !message.overwrite) throw new Error("기존 글이 있습니다. 덮어쓰기 확인이 필요합니다.");
          return insertWithDebugger(editor.tabId, target.frameId, message.task, !!message.overwrite);
        }
        default: throw new Error("지원하지 않는 요청입니다.");
      }
    })().then(respond, (error: unknown) => respond({ error: error instanceof Error ? error.message : "Extension 처리 실패" }));
    return true;
  });
})();
