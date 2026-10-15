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

  async function insertWithDebugger(tabId: number, frameId: number, task: ExtensionTask, overwrite: boolean, publisher: "blocks" | "legacy" = "legacy") {
    if (task.publishMode === "scheduled") NaverSchedule.target(task);
    if (inputRunning) throw new Error("입력 작업이 이미 진행 중입니다.");
    if (!task.title?.trim() || !task.bodyText?.trim()) throw new Error("제목 또는 본문이 비어 있습니다.");
    inputRunning = true;
    const debuggee = { tabId };
    let attached = false;
    let stage = "attach";
    let failure: unknown;
    let detachFailure: unknown;
    let blockInterception = false;
    let imageBlockNumber = 0;
    let blockNumber = 0;
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
    const clickPhotoTarget = async (type: string, photoTask = task) => {
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
    type FileInputNode = {
      nodeName: string; backendNodeId?: number; attributes?: string[]; documentURL?: string;
      children?: FileInputNode[]; contentDocument?: FileInputNode; shadowRoots?: FileInputNode[];
    };
    const findBlockFileInput = async () => {
      // Re-query every time: SmartEditor can reuse or replace its hidden file input.
      for (let attempt = 0; attempt < 60; attempt++) {
        await assertCurrentTab(tabId);
        const tree = await chrome.debugger.sendCommand(debuggee, "DOM.getDocument", { depth: -1, pierce: true }) as { root?: FileInputNode } | undefined;
        const inputs: number[] = [];
        const visit = (node: FileInputNode, documentURL = "") => {
          const url = node.documentURL || documentURL;
          const attributes = node.attributes ?? [];
          const attr = (name: string) => { const i = attributes.indexOf(name); return i < 0 ? undefined : attributes[i + 1]; };
          if (node.nodeName === "INPUT" && attr("type")?.toLowerCase() === "file" && attr("disabled") === undefined &&
            /^https:\/\/blog\.naver\.com\//.test(url) && /PostWriteForm\.naver|\/postwrite(?:\?|$|\/)/i.test(url) &&
            (!attr("accept") || /image\/|\.(?:jpe?g|png|webp|gif|bmp)(?:\s|,|$)/i.test(attr("accept")!)) &&
            Number.isSafeInteger(node.backendNodeId) && node.backendNodeId! > 0) inputs.push(node.backendNodeId!);
          for (const child of node.children ?? []) visit(child, url);
          if (node.contentDocument) visit(node.contentDocument, url);
          for (const root of node.shadowRoots ?? []) visit(root, url);
        };
        if (tree?.root) visit(tree.root);
        const unique = [...new Set(inputs)];
        if (unique.length > 1) throw new Error(`사진 file input이 여러 개입니다 (${unique.length}개).`);
        if (unique.length === 1) return unique[0];
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("사진 버튼 클릭 후 file input을 찾지 못했습니다.");
    };
    const uploadPhoto = async (filename: string) => {
      if (publisher === "blocks") {
        stage = "PHOTO_FILE_CHOOSER";
        if (!blockInterception) {
          await send("Page.enable", {});
          await send("Page.setInterceptFileChooserDialog", { enabled: true });
          blockInterception = true;
        }
        await clickPhotoTarget("EDITOR_PHOTO_BUTTON");
        stage = "PHOTO_FILE_INPUT";
        const backendNodeId = await findBlockFileInput();
        stage = "PHOTO_UPLOAD";
        await send("DOM.setFileInputFiles", { files: [filename], backendNodeId });
        const finished = await frameRequest({ type: "EDITOR_PHOTO_VERIFY" });
        if (!finished.imageReady) throw new Error("사진 업로드 검증 결과 없음");
        return;
      }
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
        await chrome.debugger.sendCommand(opened.source, "DOM.setFileInputFiles", { files: [filename], backendNodeId: opened.backendNodeId });
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
    };
    try {
      stage = "PHOTO_POSITION";
      const images = (publisher === "blocks" ? [] : task.images.slice(0, 3)).sort((a, b) => b.insertOffset - a.insertOffset || b.index - a.index);
      if (images.some((image) => !Number.isSafeInteger(image.insertOffset) || image.insertOffset < 0 || image.insertOffset > task.bodyText.length)) throw new Error("사진 insertOffset을 확인해 주세요.");
      await assertCurrentTab(tabId);
      const check = await frameRequest({ type: "EDITOR_DIAGNOSE" });
      if (check.diagnostic?.ready !== true || !check.diagnostic.titleFound || !check.diagnostic.bodyFound) throw new Error("Naver 글쓰기 frame/제목/본문을 다시 확인해 주세요.");
      if (check.diagnostic.existing && !overwrite) throw new Error("기존 글 덮어쓰기 확인이 필요합니다.");
      await chrome.debugger.attach(debuggee, "1.3");
      attached = true;
      await insertField("title", task.title);
      if (publisher === "blocks") {
        stage = "BLOCK_DATA";
        const blocks = task.blocks;
        if (!Array.isArray(blocks) || !blocks.length ||
          blocks.some((block) => block.type === "text" ? typeof block.text !== "string" :
            block.type !== "image" || !task.images.some((image) => image.index === block.index && image.signedUrl === block.signedUrl)) ||
          blocks.filter((block) => block.type === "text").map((block) => block.text).join("") !== task.bodyText ||
          blocks.filter((block) => block.type === "image").length !== task.images.length ||
          new Set(blocks.filter((block) => block.type === "image").map((block) => block.index)).size !== task.images.length) throw new Error("본문 block 데이터를 확인해 주세요.");
        stage = "BLOCK_BODY_START";
        const body = await frameRequest({ type: "EDITOR_TARGET", field: "body", overwrite });
        if (!body.position) throw new Error("본문 입력 좌표 없음");
        const { x, y } = body.position;
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
        await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
        if (body.existing) { await key("a", 65, 2); await key("Backspace", 8); }
        await frameRequest({ type: "EDITOR_BLOCK_START" });
        let appended = "";
        for (const [blockIndex, block] of blocks.entries()) {
          blockNumber = blockIndex + 1;
          if (block.type === "text") {
            stage = "BLOCK_TEXT";
            await frameRequest({ type: "EDITOR_BLOCK_CARET" });
            await send("Input.insertText", { text: block.text });
            appended += block.text;
            await frameRequest({ type: "EDITOR_BLOCK_TEXT_VERIFY", task: { ...task, bodyText: appended } });
            await frameRequest({ type: "EDITOR_BLOCK_TEXT_END" });
          } else {
            imageBlockNumber++;
            console.info("V3 image block", { blockNumber, imageBlockNumber, totalImages: task.images.length, imageIndex: block.index });
            stage = "PHOTO_TEMP_CREATE";
            const image = task.images.find((image) => image.index === block.index)!;
            const downloaded = await createPhotoTemp(image);
            stage = "PHOTO_EMPTY_PARAGRAPH";
            await frameRequest({ type: "EDITOR_BLOCK_CARET" });
            await key("Enter", 13);
            await key("Enter", 13);
            await frameRequest({ type: "EDITOR_BLOCK_IMAGE_TARGET", blockNumber: blockIndex + 1, imageNumber: imageBlockNumber });
            await frameRequest({ type: "EDITOR_BLOCK_CARET" });
            await uploadPhoto(downloaded.filename);
            stage = "BLOCK_NEXT_TEXT";
            const next = await frameRequest({ type: "EDITOR_BLOCK_NEXT_TEXT" });
            if (next.needsParagraph) {
              await key("Enter", 13);
              const created = await frameRequest({ type: "EDITOR_BLOCK_NEXT_TEXT" });
              if (created.needsParagraph) throw new Error("사진 뒤 빈 본문 문단 생성 실패");
            }
            await frameRequest({ type: "EDITOR_BLOCK_CARET" });
          }
        }
        stage = "BLOCK_VERIFY";
        await frameRequest({ type: "EDITOR_BLOCK_VERIFY", task });
      } else {
        await insertField("body", task.bodyText);
      }
      for (const image of images) {
        stage = "PHOTO_TEMP_CREATE";
        const downloaded = await createPhotoTemp(image);
        const photoTask = { ...task, images: [image] };
        stage = "PHOTO_POSITION";
        await clickPhotoTarget("EDITOR_PHOTO_TARGET", photoTask);
        await frameRequest({ type: "EDITOR_PHOTO_CARET" });
        stage = "PHOTO_EMPTY_PARAGRAPH";
        await key("Enter", 13);
        await key("Enter", 13);
        await clickPhotoTarget("EDITOR_PHOTO_EMPTY", photoTask);
        await frameRequest({ type: "EDITOR_PHOTO_UPLOAD_CARET" });
        await uploadPhoto(downloaded.filename);
      }
      if (images.length) {
        stage = "PHOTO_VERIFY";
        await frameRequest({ type: "EDITOR_PHOTO_BODY_VERIFY", task });
      }
      if (task.publishMode === "scheduled") {
        stage = "SCHEDULE_SETUP";
        const scheduled = await frameRequest({ type: "EDITOR_SCHEDULE", task });
        if (!scheduled.scheduleReady) throw new Error("예약 설정 검증 결과가 없습니다.");
      }
    } catch (error) {
      failure = error;
      if (publisher === "blocks") console.warn("V3 input failed", { stage, blockNumber, imageBlockNumber, totalImages: task.images.length,
        errorName: error instanceof Error ? error.name : "UnknownError" });
    }
    finally {
      if (blockInterception && attached) {
        try { await chrome.debugger.sendCommand(debuggee, "Page.setInterceptFileChooserDialog", { enabled: false }); }
        catch { if (!failure) { stage = "PHOTO_FILE_CHOOSER"; failure = new Error("file chooser interception 해제 실패"); } }
      }
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
      const blockDiagnostic = publisher === "blocks" && imageBlockNumber ? ` (image block ${imageBlockNumber}/${task.images.length})` : "";
      throw new Error(`${stage}${blockDiagnostic}: ${reason}${detachReason}${cleanupWarning} 일부 입력되었을 수 있으니 직접 확인하세요.`);
    }
    return { message: task.publishMode === "scheduled"
      ? `네이버 입력 및 예약 설정이 완료되었습니다. 최종 발행 버튼을 확인 후 눌러주세요.${cleanupWarning}`
      : `입력 완료 - 네이버에서 직접 확인 후 발행하세요${cleanupWarning}` };
  }

  let jobRunning = false;
  const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    void (async (): Promise<ExtensionReply> => {
      switch (message.type) {
        case "JOBS": return { jobs: (await api("/api/extension/publication-jobs")).jobs };
        case "JOB":
          if (!message.id || !jobIdPattern.test(message.id)) throw new Error("Job ID를 확인해 주세요.");
          return { task: await api(`/api/extension/publication-jobs/${message.id}`) };
        case "DIAGNOSE": {
          const editor = await scanEditorFrames();
          const writingFrames = editor.diagnostics.filter((frame) => frame.diagnostic?.writing);
          return { diagnostics: editor.diagnostics, diagnostic: editor.found.length === 1 ? editor.found[0].diagnostic
            : editor.found.length === 0 && writingFrames.length === 1 ? writingFrames[0].diagnostic : undefined };
        }
        case "INSERT": {
          if (!message.jobId || !jobIdPattern.test(message.jobId)) throw new Error("선택된 Job이 없습니다.");
          if (jobRunning) throw new Error("Job 입력 작업이 이미 진행 중입니다.");
          jobRunning = true;
          try {
          const editor = await scanEditorFrames();
          if (editor.found.length !== 1) throw new Error(`SmartEditor 입력 프레임을 확정하지 못했습니다 (${editor.found.length}개). DOM 진단을 확인해 주세요.`);
          const target = editor.found[0];
          if (target.diagnostic.existing && !message.overwrite) throw new Error("기존 글이 있습니다. 덮어쓰기 확인이 필요합니다.");
          // Only the claimed server snapshot supplies executable data; ignore client task fields.
          const task: ExtensionTask = await api(`/api/extension/publication-jobs/${message.jobId}/claim`, "POST", { publisher: message.publisher === "legacy" ? "legacy" : "blocks" });
          if (task.jobId !== message.jobId || !Number.isSafeInteger(task.attemptNo) || (task.attemptNo ?? 0) < 1) throw new Error("Job 실행 응답을 확인하지 못했습니다. 재입력 전에 대기열 상태를 확인하세요.");
          const record = async (outcome: "inserted" | "failed", errorMessage?: string) => {
            const result = await api(`/api/extension/publication-jobs/${message.jobId}/result`, "POST", { attemptNo: task.attemptNo, outcome, errorMessage });
            if (!result.applied && !result.alreadyApplied) throw new Error("현재 실행 번호/상태와 일치하지 않습니다.");
          };
          let reply: ExtensionReply;
          try { reply = await insertWithDebugger(editor.tabId, target.frameId, task, !!message.overwrite, message.publisher === "legacy" ? "legacy" : "blocks"); }
          catch (error) {
            const reason = error instanceof Error ? error.message : "네이버 입력 실패";
            try { await record("failed", reason); }
            catch { throw new Error(`${reason} JOB_RESULT: 실패 상태 기록을 확인하지 못했습니다. 재실행 전에 대기열을 확인하세요.`); }
            throw error;
          }
          try { await record("inserted"); }
          catch { return { message: `${reply.message} JOB_RESULT: 입력은 완료됐지만 상태 기록을 확인하지 못했습니다. 재입력하지 말고 대기열과 네이버를 직접 확인하세요.` }; }
          return reply;
          } finally { jobRunning = false; }
        }
        default: throw new Error("지원하지 않는 요청입니다.");
      }
    })().then(respond, (error: unknown) => respond({ error: error instanceof Error ? error.message : "Extension 처리 실패" }));
    return true;
  });
})();
