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
    const found: { frameId: number; url: string; diagnostic: EditorDiagnostic }[] = [];
    const diagnostics: NonNullable<ExtensionReply["diagnostics"]> = [];
    for (const frame of frames ?? []) {
      if (!frame.url.startsWith("https://blog.naver.com/")) continue;
      try {
        const reply = await chrome.tabs.sendMessage(tab.id, { type: "EDITOR_DIAGNOSE" }, { frameId: frame.frameId });
        const ready = reply.diagnostic && reply.diagnostic.ready === true && reply.diagnostic.writing === true && reply.diagnostic.frameReady === true &&
            reply.diagnostic.titleFound === true && reply.diagnostic.bodyFound === true &&
            reply.diagnostic.visibleEditor === true && reply.diagnostic.activeEditor === true && reply.diagnostic.writableEditor === true && !reply.diagnostic.publishPanelOpen;
        diagnostics.push({ frameId: frame.frameId, diagnostic: reply.diagnostic, reason: reply.diagnostic ? undefined : reply.error ?? "frame 진단 응답 없음" });
        if (ready && reply.diagnostic) found.push({ frameId: frame.frameId, url: frame.url, diagnostic: reply.diagnostic });
      } catch { diagnostics.push({ frameId: frame.frameId, reason: "content script 접근 불가: 탭 새로고침 또는 프레임 URL을 확인하세요." }); }
    }
    return { tabId: tab.id, found, diagnostics };
  }

  let inputRunning = false;
  let freshEditorRequired = false;

  async function stableEditor(requireEmpty = false, attempts = 20, expectedTabId?: number) {
    let lastKey = "", consecutive = 0;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const editor = await scanEditorFrames();
        expectedTabId ??= editor.tabId;
        if (editor.tabId !== expectedTabId) throw new Error("현재 탭이 변경되었습니다.");
        const target = editor.found.length === 1 ? editor.found[0] : undefined;
        const key = target?.diagnostic.editorId ? `${editor.tabId}:${target.frameId}:${target.url}:${target.diagnostic.editorId}` : "";
        if (key && target && (!requireEmpty || !target.diagnostic.existing)) {
          consecutive = key === lastKey ? consecutive + 1 : 1;
          lastKey = key;
          if (consecutive >= 3) {
            target.diagnostic.stableEditor = true;
            return editor;
          }
        } else { lastKey = ""; consecutive = 0; }
      } catch { lastKey = ""; consecutive = 0; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error("새 글쓰기 화면이 아직 준비되지 않았습니다. 잠시 후 다시 실행하세요.");
  }

  async function assertCurrentTab(tabId: number) {
    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (current?.id !== tabId || !current.url || new URL(current.url).origin !== "https://blog.naver.com") {
      throw new Error("현재 탭이 변경되어 입력을 중단했습니다. Naver 글쓰기 탭에서 다시 시도하세요.");
    }
  }

  async function waitForScheduleTransition(tabId: number, previous: { frameId: number; url: string }) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    let transitioned = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      await assertCurrentTab(tabId);
      const frames = await chrome.webNavigation.getAllFrames({ tabId });
      const old = frames?.find(frame => frame.frameId === previous.frameId && frame.url === previous.url);
      if (!old) { transitioned = true; break; }
      try {
        const reply = await chrome.tabs.sendMessage(tabId, { type: "EDITOR_DIAGNOSE" }, { frameId: previous.frameId });
        if (reply.diagnostic && (!reply.diagnostic.activeEditor || !reply.diagnostic.publishPanelOpen)) { transitioned = true; break; }
      } catch { /* Navigation may temporarily remove the content script; wait for observable state. */ }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!transitioned) throw new Error("예약 화면 전환 대기 timeout");
  }

  function isNaverUrl(value: string) {
    try { const url = new URL(value); return url.protocol === "https:" && (url.hostname === "naver.com" || url.hostname.endsWith(".naver.com")); }
    catch { return false; }
  }
  function reservationDiagnostic(task: ExtensionTask, stage: string, reason: string, frame?: { frameId: number; url: string }): ReservationDiagnostic {
    const url = frame ? new URL(frame.url) : null;
    return { stage, reason, listAlreadyVisible: false, listTriggerFound: false, listTriggerCount: 0, listTriggerClicked: false,
      listVisibleAfterClick: false, listHeadingFound: false, entryCount: 0, matchingEntryCount: 0,
      expectedTitle: task.title, expectedDateTime: task.scheduledAt ? NaverSchedule.reservationTime(task.scheduledAt) : "",
      clickMode: "trusted-cdp", triggerX: null, triggerY: null, framesBeforeClick: [], framesAfterClick: [],
      frameId: frame?.frameId ?? null, frameUrl: url ? `${url.origin}${url.pathname}` : null };
  }
  async function confirmReservation(tabId: number, task: ExtensionTask) {
    let diagnostics: ReservationDiagnostic[] = [];
    let clickedFrame: number | undefined;
    let triggerAttempted = false;
    let triggerError: ReservationDiagnostic | undefined;
    let triggerPosition: EditorTargetPosition | undefined;
    let triggerBefore: ReservationDiagnostic | undefined;
    let triggerAfter: ReservationDiagnostic | undefined;
    let framesBeforeClick: { frameId: number; url: string }[] = [];
    const frameSummary = (frames: { frameId: number; url: string }[]) => frames.map(frame => ({ frameId: frame.frameId, url: new URL(frame.url).origin + new URL(frame.url).pathname }));
    const initialVisibility = new Map<number, boolean>();
    const deadline = Date.now() + 10000;
    for (let poll = 0; poll < 20 && Date.now() < deadline; poll++) {
      let active: { id?: number; url?: string } | undefined;
      let frames: { frameId: number; url: string }[];
      try {
        [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        frames = (await chrome.webNavigation.getAllFrames({ tabId }) ?? []).filter(frame => isNaverUrl(frame.url));
      } catch { return { outcome: "unconfirmed", diagnostics: [reservationDiagnostic(task, "FRAME_SCAN_FAILED", "현재 Naver 탭/frame 조회에 실패했습니다.")] }; }
      if (active?.id !== tabId || !active.url || !isNaverUrl(active.url)) return { outcome: "unconfirmed",
        diagnostics: [reservationDiagnostic(task, "NAVER_TAB", "예약 목록을 확인할 Naver 탭으로 전환해 주세요.")] };
      const observations: { frame: { frameId: number; url: string }; state?: ExtensionReply["reservation"]; diagnostic: ReservationDiagnostic }[] = [];
      for (const frame of frames) {
        try {
          const reply = await chrome.tabs.sendMessage(tabId, { type: "EDITOR_RESERVATION_CONFIRMATION", task, openList: false }, { frameId: frame.frameId });
          const diagnostic = { ...reservationDiagnostic(task, "FRAME_RESPONSE", reply.error ?? "예약 목록 진단 응답 없음", frame), ...reply.reservation?.diagnostic,
            frameId: frame.frameId, frameUrl: new URL(frame.url).origin + new URL(frame.url).pathname };
          observations.push({ frame, state: reply.reservation, diagnostic });
        } catch { observations.push({ frame, diagnostic: reservationDiagnostic(task, "FRAME_UNAVAILABLE", "frame의 content script에 접근하지 못했습니다. 확장과 Naver 탭을 새로고침하세요.", frame) }); }
      }
      const triggerCount = observations.reduce((sum, observation) => sum + observation.diagnostic.listTriggerCount, 0);
      const alreadyVisible = observations.some(observation => observation.state?.listFound);
      for (const observation of observations) if (!initialVisibility.has(observation.frame.frameId)) initialVisibility.set(observation.frame.frameId, clickedFrame === undefined && !!observation.state?.listFound);
      if (!alreadyVisible && !triggerAttempted && triggerCount === 1) {
        const target = observations.find(observation => observation.diagnostic.listTriggerCount === 1)!;
        triggerAttempted = true;
        framesBeforeClick = frameSummary(frames);
        let attached = false;
        try {
          await chrome.debugger.attach({ tabId }, "1.3");
          attached = true;
          const reply = await chrome.tabs.sendMessage(tabId, { type: "EDITOR_RESERVATION_CONFIRMATION", task, openList: true }, { frameId: target.frame.frameId });
          triggerBefore = reply.reservation?.diagnostic;
          if (triggerBefore?.stage === "LIST_TRIGGER_HIT_TEST_FAILED") {
            triggerError = { ...target.diagnostic, stage: triggerBefore.stage, reason: triggerBefore.reason };
            throw new Error();
          }
          if (!reply.reservation?.triggerPosition || reply.reservation.diagnostic.listTriggerCount !== 1 || reply.reservation.listFound) throw new Error();
          triggerPosition = reply.reservation.triggerPosition;
          const { x, y } = triggerPosition;
          if (!triggerBefore?.triggerHitTest?.hitClosestButtonMatchesTrigger) {
            triggerError = { ...target.diagnostic, stage: "LIST_TRIGGER_HIT_TEST_FAILED", reason: "예약 목록 조회 버튼의 hit-test를 확인하지 못했습니다." };
            throw new Error();
          }
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) throw new Error();
          const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (current?.id !== tabId || !current.url || !isNaverUrl(current.url)) throw new Error();
          await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
          await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
          await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
          clickedFrame = target.frame.frameId;
          await new Promise(resolve => setTimeout(resolve, 200));
          try {
            const after = await chrome.tabs.sendMessage(tabId, { type: "EDITOR_RESERVATION_CONFIRMATION", task, openList: false }, { frameId: target.frame.frameId });
            triggerAfter = after.reservation?.diagnostic;
          } catch { /* Frame replacement is handled by the next all-frame scan. */ }
        } catch { triggerError ??= { ...target.diagnostic, stage: "LIST_TRIGGER_CLICK_FAILED", reason: "예약 목록 조회 버튼의 trusted CDP 클릭에 실패했습니다. 재클릭하지 않았습니다." }; }
        finally {
          if (attached) try { await chrome.debugger.detach({ tabId }); }
          catch { triggerError = { ...target.diagnostic, stage: "LIST_TRIGGER_CLICK_FAILED", reason: "예약 목록 조회 후 debugger 연결 해제를 확인하지 못했습니다." }; }
        }
      }
      diagnostics = observations.map(observation => {
        return { ...observation.diagnostic, listAlreadyVisible: initialVisibility.get(observation.frame.frameId)!,
          listTriggerFound: observation.diagnostic.listTriggerFound || clickedFrame !== undefined,
          listTriggerCount: clickedFrame !== undefined ? Math.max(1, observation.diagnostic.listTriggerCount) : observation.diagnostic.listTriggerCount,
          listTriggerClicked: clickedFrame !== undefined, listVisibleAfterClick: clickedFrame !== undefined && !!observation.state?.listFound,
          triggerHitTest: triggerBefore?.triggerHitTest,
          ariaExpandedBefore: triggerBefore?.ariaExpanded ?? null, ariaExpandedAfter: triggerAfter?.ariaExpanded ?? null,
          ariaPressedBefore: triggerBefore?.ariaPressed ?? null, ariaPressedAfter: triggerAfter?.ariaPressed ?? null,
          triggerClassBefore: triggerBefore?.triggerClass ?? null, triggerClassAfter: triggerAfter?.triggerClass ?? null,
          triggerFocusedAfterClick: triggerAfter?.triggerFocused ?? null,
          clickMode: "trusted-cdp" as const, triggerX: triggerPosition?.x ?? null, triggerY: triggerPosition?.y ?? null,
          framesBeforeClick, framesAfterClick: clickedFrame !== undefined ? frameSummary(frames) : [] };
      });
      if (triggerError && !observations.some(observation => observation.state?.listFound)) diagnostics = diagnostics.map(diagnostic =>
        diagnostic.frameId === triggerError!.frameId ? { ...diagnostic, stage: triggerError!.stage, reason: triggerError!.reason } : diagnostic);
      if (!diagnostics.length) diagnostics = [reservationDiagnostic(task, "FRAMES_MISSING", "현재 탭에서 Naver frame을 찾지 못했습니다.")];
      const matches = observations.reduce((sum, observation) => sum + (observation.state?.listFound ? observation.state.matchingEntries : 0), 0);
      if (matches > 1) return { outcome: "unconfirmed", diagnostics: diagnostics.map(diagnostic => ({ ...diagnostic,
        stage: "MATCH_AMBIGUOUS", reason: `Naver frame 전체에서 동일 제목·예약시간 entry ${matches}개를 찾아 확정하지 않았습니다.` })) };
      if (!alreadyVisible && triggerCount > 1 && clickedFrame === undefined) return { outcome: "unconfirmed", diagnostics: diagnostics.map(diagnostic => ({ ...diagnostic,
        stage: "LIST_TRIGGER_AMBIGUOUS", reason: `Naver frame 전체에서 조회 버튼 후보 ${triggerCount}개를 찾아 클릭하지 않았습니다.` })) };
      if (matches === 1) {
        try {
          const result = await api(`/api/extension/publication-jobs/${task.jobId}/reservation-confirmation`, "POST", { attemptNo: task.attemptNo });
          if (typeof result.confirmedAt !== "string" || !Number.isFinite(Date.parse(result.confirmedAt))) throw new Error();
          return { outcome: "confirmed", diagnostics };
        } catch { return { outcome: "record_failed", diagnostics: diagnostics.map(diagnostic => ({ ...diagnostic, stage: "CONFIRMATION_API", reason: "예약 목록은 확인했지만 서버 기록에 실패했습니다." })) }; }
      }
      if (poll < 19) await new Promise(resolve => setTimeout(resolve, 500));
    }
    return { outcome: "unconfirmed", diagnostics: diagnostics.map(diagnostic => diagnostic.listTriggerClicked && !diagnostic.listVisibleAfterClick
      ? { ...diagnostic, stage: "LIST_OPEN_TIMEOUT", reason: "조회 버튼 클릭 후 예약 목록이 표시되지 않았습니다." } : diagnostic) };
  }

  async function prepareFreshEditor(tabId: number, previous: { frameId: number; url: string }, transitionObserved = false) {
    const url = new URL(previous.url);
    const blogId = url.searchParams.get("blogId");
    if (url.origin !== "https://blog.naver.com" || !/^\/(?:PostWriteForm\.naver|postwrite\/?$)/i.test(url.pathname) ||
      !blogId || !/^[A-Za-z0-9_-]{1,100}$/.test(blogId)) throw new Error("새 글쓰기 URL 확인 실패");
    // Reuse the known write route, but never carry draft/post identifiers into a fresh editor.
    const fresh = new URL(url.pathname, url.origin);
    fresh.searchParams.set("blogId", blogId);
    if (!transitionObserved) await waitForScheduleTransition(tabId, previous);
    await assertCurrentTab(tabId);
    await chrome.tabs.update(tabId, { url: fresh.href });
    await stableEditor(true, 120, tabId);
  }

  function reservationFailure(diagnostics: ReservationDiagnostic[]) {
    return (diagnostics.find(diagnostic => diagnostic.listHeadingFound || diagnostic.listTriggerClicked || diagnostic.listTriggerFound)
      ?? diagnostics.find(diagnostic => diagnostic.stage !== "FRAME_UNAVAILABLE") ?? diagnostics[0])?.reason ?? "예약 목록 frame을 확인하지 못했습니다.";
  }

  async function insertWithDebugger(tabId: number, frameId: number, task: ExtensionTask, overwrite: boolean, publisher: "blocks" | "legacy" = "legacy") {
    if (task.finalizeMode !== undefined) NaverSchedule.finalizeMode(task);
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
      if (field === "title") {
        stage = "title focus";
        await frameRequest({ type: "EDITOR_TITLE_FOCUS" });
      }
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
        if (task.finalizeMode === "auto") {
          stage = "SCHEDULE_FINAL_PUBLISH";
          const final = await frameRequest({ type: "EDITOR_SCHEDULE_FINAL_TARGET", task });
          if (!final.position) throw new Error("최종 발행 버튼 검증 좌표가 없습니다.");
          const { x, y } = final.position;
          // Exactly one trusted click; no retries and no synthetic final publication.
          await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
          await chrome.debugger.sendCommand(debuggee, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
        }
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
    return { cleanupWarning, message: task.publishMode === "scheduled"
      ? task.finalizeMode === "auto" ? `네이버 예약 발행 등록을 요청했습니다. 예약 목록에서 최종 상태를 확인해 주세요.${cleanupWarning}`
        : `네이버 입력 및 예약 설정이 완료되었습니다. 최종 발행 버튼을 확인 후 눌러주세요.${cleanupWarning}`
      : `입력 완료 - 네이버에서 직접 확인 후 발행하세요${cleanupWarning}` };
  }

  let jobRunning = false;
  const jobIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return;
    void (async (): Promise<ExtensionReply> => {
      switch (message.type) {
        case "JOBS": return { jobs: (await api("/api/extension/publication-jobs")).jobs };
        case "RECHECK_JOBS": return { jobs: (await api("/api/extension/publication-jobs?confirmation=needed")).jobs };
        case "RESERVATION_RECHECK": {
          if (!message.jobId || !jobIdPattern.test(message.jobId)) throw new Error("재확인할 Job을 선택하세요.");
          if (jobRunning) throw new Error("Job 작업이 이미 진행 중입니다.");
          jobRunning = true;
          try {
            // Read-only snapshot refresh. Never claim, attach debugger, insert, navigate or publish in this path.
            const task: ExtensionTask = await api(`/api/extension/publication-jobs/${message.jobId}`);
            if (task.jobId !== message.jobId || task.status !== "inserted" || task.publishMode !== "scheduled" || task.finalizeMode !== "auto" ||
              !task.scheduledAt || task.reservationConfirmedAt != null || !Number.isSafeInteger(task.attemptNo) || (task.attemptNo ?? 0) < 1) throw new Error("예약 확인이 필요한 입력 완료 자동 예약 Job만 재확인할 수 있습니다.");
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.id || !tab.url || !isNaverUrl(tab.url)) return { message: "예약 목록을 볼 Naver 탭을 열어 주세요.",
              reservationDiagnostics: [reservationDiagnostic(task, "NAVER_TAB", "현재 활성 탭이 Naver가 아닙니다.")] };
            const checked = await confirmReservation(tab.id, task);
            return { message: checked.outcome === "confirmed" ? "예약 등록을 확인하고 기록했습니다." : `예약 등록 자동 확인 실패: ${reservationFailure(checked.diagnostics)}`,
              reservationDiagnostics: checked.diagnostics };
          } finally { jobRunning = false; }
        }
        case "JOB":
          if (!message.id || !jobIdPattern.test(message.id)) throw new Error("Job ID를 확인해 주세요.");
          return { task: await api(`/api/extension/publication-jobs/${message.id}`) };
        case "DIAGNOSE": {
          // Diagnostics must survive every failed execution gate. Observe stability, never require it.
          let editor: Awaited<ReturnType<typeof scanEditorFrames>> | undefined;
          let previous = new Map<string, number>();
          for (let poll = 0; poll < 3; poll++) {
            try {
              editor = await scanEditorFrames();
              const next = new Map<string, number>();
              for (const frame of editor.diagnostics) {
                const diagnostic = frame.diagnostic;
                if (!diagnostic) continue;
                const key = `${editor.tabId}:${frame.frameId}:${diagnostic.editorId}`;
                const count = diagnostic.baseReady === true && diagnostic.activeEditor && diagnostic.editorId ? (previous.get(key) ?? 0) + 1 : 0;
                next.set(key, count);
                diagnostic.stableEditor = count >= 3;
              }
              previous = next;
            } catch (error) {
              previous.clear();
              editor = { tabId: -1, found: [], diagnostics: [{ frameId: 0, reason: error instanceof Error ? error.message : "frame 진단 실패" }] };
            }
            if (poll < 2) await new Promise(resolve => setTimeout(resolve, 250));
          }
          if (!editor) return { diagnostics: [] };
          const writingFrames = editor.diagnostics.filter((frame) => frame.diagnostic?.writing);
          return { diagnostics: editor.diagnostics, diagnostic: editor.found.length === 1 ? editor.found[0].diagnostic
            : editor.found.length === 0 && writingFrames.length === 1 ? writingFrames[0].diagnostic : undefined };
        }
        case "INSERT": {
          if (!message.jobId || !jobIdPattern.test(message.jobId)) throw new Error("선택된 Job이 없습니다.");
          if (jobRunning) throw new Error("Job 입력 작업이 이미 진행 중입니다.");
          jobRunning = true;
          try {
          const editor = await stableEditor(freshEditorRequired);
          if (editor.found.length !== 1) throw new Error("새 글쓰기 화면을 준비한 뒤 다시 실행하세요.");
          const target = editor.found[0];
          if (freshEditorRequired && (target.diagnostic.existing || target.diagnostic.publishPanelOpen)) throw new Error("새 글쓰기 화면을 준비한 뒤 다시 실행하세요.");
          freshEditorRequired = false;
          if (target.diagnostic.existing && !message.overwrite) throw new Error("기존 글이 있습니다. 덮어쓰기 확인이 필요합니다.");
          await assertCurrentTab(editor.tabId);
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
          if (task.publishMode === "scheduled" && task.finalizeMode === "auto") freshEditorRequired = true;
          try { await record("inserted"); }
          catch { return { message: `${reply.message} JOB_RESULT: 입력은 완료됐지만 상태 기록을 확인하지 못했습니다. 재입력하지 말고 대기열과 네이버를 직접 확인하세요.` }; }
          if (task.publishMode === "scheduled" && task.finalizeMode === "auto") {
            let transitionObserved = false;
            let confirmation = { outcome: "unconfirmed", diagnostics: [reservationDiagnostic(task, "NAVER_TRANSITION", "최종 클릭 후 Naver 전환을 확인하지 못했습니다.")] };
            try {
              await waitForScheduleTransition(editor.tabId, target);
              transitionObserved = true;
              confirmation = await confirmReservation(editor.tabId, task);
            } catch { /* Final click already completed; keep inserted and still try fresh-editor preparation. */ }
            const confirmationMessage = confirmation.outcome === "confirmed" ? "예약 등록을 확인했습니다." : confirmation.outcome === "record_failed"
              ? "예약 목록에서는 확인했지만 서버 확인 기록에 실패했습니다. 대기열에서 확인해 주세요."
              : `예약 등록 요청은 완료했지만 자동 확인하지 못했습니다. 예약 등록 자동 확인 실패: ${reservationFailure(confirmation.diagnostics)}`;
            try {
              await prepareFreshEditor(editor.tabId, target, transitionObserved);
              freshEditorRequired = false;
              return { message: `${confirmationMessage} 다음 글쓰기 화면을 준비했습니다.${reply.cleanupWarning ?? ""}`, reservationDiagnostics: confirmation.diagnostics };
            } catch {
              return { message: `${confirmationMessage} 다음 글쓰기 화면을 자동으로 준비하지 못했습니다. 새 글쓰기를 직접 열어 주세요. 이 Job을 재실행하지 마세요.${reply.cleanupWarning ?? ""}`, reservationDiagnostics: confirmation.diagnostics };
            }
          }
          return reply;
          } finally { jobRunning = false; }
        }
        default: throw new Error("지원하지 않는 요청입니다.");
      }
    })().then(respond, (error: unknown) => respond({ error: error instanceof Error ? error.message : "Extension 처리 실패" }));
    return true;
  });
})();
