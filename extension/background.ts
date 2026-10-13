(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const settingsReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

  async function api(path: string) {
    await settingsReady;
    const { appUrl, extensionToken } = await chrome.storage.local.get(["appUrl", "extensionToken"]);
    if (!appUrl || !extensionToken) throw new Error("Angel Agent 주소와 연결 토큰을 설정해 주세요.");
    const response = await fetch(new URL(path, appUrl), { headers: { Authorization: `Bearer ${extensionToken}` }, cache: "no-store" });
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
      stage = "PHOTO_FETCH";
      const image = task.images[0];
      if (image && (image.index !== 0 || !Number.isSafeInteger(image.insertOffset) || image.insertOffset < 0 || image.insertOffset > task.bodyText.length)) throw new Error("첫 사진 insertOffset을 확인해 주세요.");
      await assertCurrentTab(tabId);
      const check = await frameRequest({ type: "EDITOR_DIAGNOSE" });
      if (check.diagnostic?.ready !== true || !check.diagnostic.titleFound || !check.diagnostic.bodyFound) throw new Error("Naver 글쓰기 frame/제목/본문을 다시 확인해 주세요.");
      if (check.diagnostic.existing && !overwrite) throw new Error("기존 글 덮어쓰기 확인이 필요합니다.");
      await chrome.debugger.attach(debuggee, "1.3");
      attached = true;
      await insertField("title", task.title);
      await insertField("body", task.bodyText);
      if (image) {
        const clickPhotoTarget = async (type: string) => {
          const reply = await frameRequest({ type, task });
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
        stage = "PHOTO_CARET";
        await frameRequest({ type: "EDITOR_PHOTO_CARET" });
        stage = "PHOTO_EMPTY_PARAGRAPH";
        await key("Enter", 13);
        await key("Enter", 13);
        await clickPhotoTarget("EDITOR_PHOTO_EMPTY");
        stage = "PHOTO_PASTE_TARGET";
        await clickPhotoTarget("EDITOR_PHOTO_PASTE_TARGET");
        await frameRequest({ type: "EDITOR_PHOTO_PASTE_CARET" });
        stage = "PHOTO_UPLOAD";
        await key("v", 86, 2);
        stage = "PHOTO_VERIFY";
        const finished = await frameRequest({ type: "EDITOR_PHOTO_VERIFY", task });
        if (!finished.imageReady) throw new Error("첫 사진 최종 검증 결과 없음");
      }
    } catch (error) { failure = error; }
    finally {
      try { if (attached) await chrome.debugger.detach(debuggee); }
      catch (error) { detachFailure = error; }
      finally { chrome.debugger.onDetach.removeListener(onDetach); inputRunning = false; }
    }
    if (failure || detachFailure) {
      const reason = failure instanceof Error ? failure.message : failure ? "입력 실패" : "";
      const detachReason = detachFailure ? " debugger detach 실패: Chrome에서 연결 상태를 확인해 주세요." : "";
      throw new Error(`${stage}: ${reason}${detachReason} 일부 입력되었을 수 있으니 직접 확인하세요.`);
    }
    return { message: "입력 완료 - 네이버에서 직접 확인 후 발행하세요" };
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
          if (message.task.images.length && message.clipboardReady !== true) throw new Error("PHOTO_CLIPBOARD_WRITE: Side Panel에서 첫 사진 clipboard 준비가 필요합니다.");
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
