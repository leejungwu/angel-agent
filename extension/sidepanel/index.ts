(() => {
  const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const baseUrl = element<HTMLInputElement>("baseUrl"), token = element<HTMLInputElement>("token");
  const tasks = element<HTMLSelectElement>("tasks"), insert = element<HTMLButtonElement>("insert");
  const result = element("result"), connection = element("connection");
  const settings = element("connectionSettings"), actions = element("connectionActions");
  const connectionButtons = ["connect", "cancelSettings", "refreshTasks", "changeSettings"].map((id) => element<HTMLButtonElement>(id));
  let connected = false;
  let savedSettings = { appUrl: "http://localhost:3000", extensionToken: "" };
  function showSettings(open: boolean) { settings.hidden = !open; actions.hidden = open || !connected; }
  const editedSettings = new Set<string>();
  for (const [input, key] of [[baseUrl, "appUrl"], [token, "extensionToken"]] as const) {
    input.addEventListener("input", () => {
      editedSettings.add(key);
    });
  }
  let selected: ExtensionTask | undefined;
  const jobDraftIds = new Map<string, string>();
  let busy = false;
  let selectionSequence = 0;
  let selectionLoading = false;
  function matchesSelection(task: ExtensionTask | undefined, jobId = tasks.value, draftId = jobDraftIds.get(jobId)): task is ExtensionTask {
    return !!task && ["queued", "failed"].includes(task.status) && !!jobId && !!draftId && task.jobId === jobId && String(task.draftId) === draftId;
  }
  function updatePublishingNote(task?: ExtensionTask) {
    element("publishingNote").textContent = task?.publishMode === "scheduled" && task.finalizeMode === "auto"
      ? "예약 등록 후 다음 글쓰기 화면을 준비합니다." : "결과 검수와 최종 발행은 직접 진행하세요.";
  }
  function updateInsertState() { insert.disabled = busy || selectionLoading || !matchesSelection(selected) || selected.status !== "queued"; }
  const request = async (message: ExtensionMessage) => {
    const reply = await chrome.runtime.sendMessage(message);
    if (reply.error) throw new Error(reply.error);
    return reply;
  };
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true; insert.disabled = true; result.textContent = "처리 중…";
    tasks.disabled = true; element<HTMLSelectElement>("publisher").disabled = true;
    connectionButtons.forEach((button) => { button.disabled = true; });
    baseUrl.disabled = true; token.disabled = true;
    try { await action(); } catch (error) { result.textContent = error instanceof Error ? error.message : "처리 실패"; }
    finally {
      busy = false; updateInsertState();
      tasks.disabled = false; element<HTMLSelectElement>("publisher").disabled = false;
      connectionButtons.forEach((button) => { button.disabled = false; });
      baseUrl.disabled = false; token.disabled = false;
    }
  }
  async function loadJobs() {
    selectionSequence++; selectionLoading = false;
    jobDraftIds.clear();
    selected = undefined; updatePublishingNote(); tasks.replaceChildren(new Option("발행 Job을 선택하세요", ""));
    tasks.value = "";
    element("title").textContent = "선택한 글 없음"; element("images").textContent = "이미지 0개"; element("schedule").textContent = "";
    connection.textContent = "연결 확인 중…";
    try {
      const reply = await request({ type: "JOBS" });
      const availableJobs = (reply.jobs ?? []).filter((task) => ["queued", "failed"].includes(task.status));
      for (const task of availableJobs) {
        tasks.add(new Option(`${task.title} · 사진 ${task.imageCount}장 · ${task.status === "queued" ? "발행 대기" : "입력 실패"} · Job ${task.id}`, String(task.id)));
        if (task.draftId !== undefined) jobDraftIds.set(String(task.id), String(task.draftId));
      }
      connected = true; connection.textContent = "Angel Agent 연결됨";
      result.textContent = availableJobs.length ? "발행 대기 Job을 선택해 주세요." : "발행 Job이 없습니다. 앱에서 승인된 초안을 대기열에 추가하세요."; showSettings(false);
    } catch {
      connected = false; connection.textContent = "Angel Agent 연결 실패"; showSettings(true);
      throw new Error("연결에 실패했습니다. 주소·토큰·서버 상태를 확인해 주세요.");
    }
  }
  element("refreshTasks").addEventListener("click", () => { void run(loadJobs); });
  element("changeSettings").addEventListener("click", () => {
    if (!busy) { baseUrl.value = savedSettings.appUrl; token.value = savedSettings.extensionToken; showSettings(true); }
  });
  element("cancelSettings").addEventListener("click", () => {
    if (busy) return;
    baseUrl.value = savedSettings.appUrl; token.value = savedSettings.extensionToken;
    editedSettings.clear(); showSettings(!connected);
  });
  element("connect").addEventListener("click", () => {
    if (busy) return;
    // 권한 요청은 사용자 클릭에 직접 연결합니다. 연결 주소 외 호스트 권한은 요청하지 않습니다.
    let address: URL;
    try {
      address = new URL(baseUrl.value);
      if (address.username || address.password || (!(["localhost", "127.0.0.1"].includes(address.hostname) && address.protocol === "http:") && address.protocol !== "https:")) throw new Error("로컬 HTTP 또는 HTTPS 주소를 사용해 주세요.");
      if (token.value.trim().length < 32) throw new Error("연결 토큰을 32자 이상 입력해 주세요.");
    } catch (error) { result.textContent = error instanceof Error ? error.message : "주소 오류"; return; }
    const permission = chrome.permissions.request({ origins: [`${address.origin}/*`] });
    void run(async () => {
      try {
        if (!await permission) throw new Error("Angel Agent 연결 권한이 필요합니다.");
        await chrome.storage.local.set({ appUrl: address.origin, extensionToken: token.value.trim() });
        savedSettings = { appUrl: address.origin, extensionToken: token.value.trim() };
        baseUrl.value = savedSettings.appUrl; token.value = savedSettings.extensionToken;
        editedSettings.clear();
        await loadJobs();
      } catch { showSettings(true); throw new Error("연결 설정 저장 또는 연결에 실패했습니다. 주소·토큰·서버 상태를 확인해 주세요."); }
    });
  });
  async function loadSelectedJob() {
    const sequence = ++selectionSequence;
    const jobId = tasks.value, draftId = jobDraftIds.get(jobId);
    selected = undefined; updatePublishingNote();
    selectionLoading = false;
    updateInsertState();
    element("title").textContent = "선택한 글 없음"; element("images").textContent = "이미지 0개"; element("schedule").textContent = "";
    if (busy) return;
    if (!jobId) { result.textContent = "Job을 선택해 주세요."; return; }
    if (!draftId) { result.textContent = "발행 Job 목록에서 선택해 주세요."; return; }
    selectionLoading = true; updateInsertState(); result.textContent = "Job 조회 중…";
    const current = () => sequence === selectionSequence && tasks.value === jobId && jobDraftIds.get(jobId) === draftId;
    try {
      const reply = await request({ type: "JOB", id: jobId });
      if (!current()) return;
      if (!matchesSelection(reply.task, jobId, draftId)) throw new Error("선택한 Job과 상태가 변경되었습니다. 목록을 새로고침하세요.");
      selected = reply.task; updatePublishingNote(selected);
      element("title").textContent = selected.title;
      element("images").textContent = `이미지 ${selected.images.length}개`;
      element("schedule").textContent = selected.publishMode === "scheduled" ? NaverSchedule.label(selected) : "";
      result.textContent = selected.status === "failed" ? "입력 실패 Job입니다. 일부 입력됐을 수 있습니다. 이번 단계에서는 재시도를 제공하지 않습니다." : "네이버 글쓰기 탭에서 DOM 진단 후 입력하세요.";
    } catch (error) {
      if (current()) result.textContent = error instanceof Error ? error.message : "초안 조회 실패";
    } finally {
      if (current()) { selectionLoading = false; updateInsertState(); }
    }
  }
  tasks.addEventListener("change", () => { void loadSelectedJob(); });
  async function diagnose() {
    try {
      const reply = await chrome.runtime.sendMessage({ type: "DIAGNOSE" });
      element("diagnostic").textContent = JSON.stringify(reply.diagnostics ?? [{ reason: reply.error ?? "frame 진단 응답 없음" }], null, 2);
      if (reply.error) throw new Error(reply.error);
      return reply.diagnostic;
    } catch (error) {
      element("diagnostic").textContent = JSON.stringify({ reason: error instanceof Error ? error.message : "진단 통신 실패" }, null, 2);
      throw error;
    }
  }
  element("diagnose").addEventListener("click", () => { void run(async () => {
    const diagnostic = await diagnose();
    result.textContent = !diagnostic?.baseReady ? "글쓰기 화면을 확인했지만 입력 가능한 상태가 아닙니다." :
      diagnostic.stableEditor ? "네이버 글쓰기 화면을 확인했습니다." : "글쓰기 화면은 확인됐지만 아직 안정화 중입니다.";
  }); });
  insert.addEventListener("click", () => {
    if (busy || selectionLoading) return;
    void run(async () => {
    const jobId = tasks.value, draftId = jobDraftIds.get(jobId), sequence = selectionSequence;
    if (!matchesSelection(selected, jobId, draftId) || selected.status !== "queued") throw new Error("화면에 선택한 발행 대기 Job을 먼저 조회해 주세요.");
    // Recheck the same immutable Job; background claims it before any CDP input.
    selected = undefined;
    const refreshed = await request({ type: "JOB", id: jobId });
    if (sequence !== selectionSequence || tasks.value !== jobId || jobDraftIds.get(jobId) !== draftId || !matchesSelection(refreshed.task, jobId, draftId) || refreshed.task.status !== "queued") throw new Error("선택한 Job 또는 상태가 변경되었습니다. 다시 선택해 주세요.");
    selected = refreshed.task;
    if (selected.finalizeMode !== undefined) NaverSchedule.finalizeMode(selected);
    if (selected.publishMode === "scheduled") NaverSchedule.target(selected);
    const diagnostic = await diagnose();
    if (diagnostic?.ready !== true) throw new Error(diagnostic?.reason ?? "입력 영역을 확정하지 못했습니다. 프레임별 DOM 진단을 확인해 주세요.");
    const overwrite = !!diagnostic?.existing;
    if (overwrite && !window.confirm("현재 글에 제목 또는 본문이 있습니다. 선택한 초안으로 덮어쓰시겠습니까?")) { result.textContent = "입력을 취소했습니다."; return; }
    if (sequence !== selectionSequence || !matchesSelection(selected, jobId, draftId) || tasks.value !== jobId || jobDraftIds.get(jobId) !== draftId) throw new Error("작업 선택이 변경되어 입력을 중단했습니다.");
    const publisher = element<HTMLSelectElement>("publisher").value === "legacy" ? "legacy" : "blocks";
    if (publisher === "legacy" && selected.images.length > 3) throw new Error("사진 3장 초과 Job은 V3 순차 입력을 사용하세요.");
    const scheduledAuto = selected.publishMode === "scheduled" && selected.finalizeMode === "auto";
    selected = undefined;
    const reply = await request({ type: "INSERT", jobId: jobId, overwrite, publisher });
    const completedMessage = scheduledAuto && !reply.message?.includes("JOB_RESULT")
      ? "예약 등록 요청을 완료했습니다. " + (reply.message?.match(/다음 글쓰기 화면[\s\S]*/)?.[0] ?? reply.cleanupWarning ?? "예약 목록에서 최종 상태를 확인해 주세요.")
      : reply.message ?? "입력 결과를 확인해 주세요.";
    try { await loadJobs(); result.textContent = completedMessage; }
    catch { result.textContent = `${completedMessage} Job 목록 갱신에 실패했습니다. 목록을 새로고침하세요.`; }
  }); });
  void chrome.storage.local.get(["appUrl", "extensionToken", "baseUrl"]).then((saved) => {
    savedSettings = { appUrl: saved.appUrl ?? saved.baseUrl ?? "http://localhost:3000", extensionToken: saved.extensionToken ?? "" };
    if (!editedSettings.has("appUrl")) baseUrl.value = savedSettings.appUrl;
    if (!editedSettings.has("extensionToken")) token.value = savedSettings.extensionToken;
    if (saved.appUrl && saved.extensionToken && editedSettings.size === 0) void run(loadJobs);
    else showSettings(true);
  }).catch(() => { showSettings(true); result.textContent = "저장된 설정을 읽지 못했습니다. 주소와 토큰을 입력해 주세요."; });
})();
