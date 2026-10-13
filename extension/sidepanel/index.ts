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
  let busy = false;
  const request = async (message: ExtensionMessage) => {
    const reply = await chrome.runtime.sendMessage(message);
    if (reply.error) throw new Error(reply.error);
    return reply;
  };
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true; insert.disabled = true; result.textContent = "처리 중…";
    connectionButtons.forEach((button) => { button.disabled = true; });
    baseUrl.disabled = true; token.disabled = true;
    try { await action(); } catch (error) { result.textContent = error instanceof Error ? error.message : "처리 실패"; }
    finally {
      busy = false; insert.disabled = !selected;
      connectionButtons.forEach((button) => { button.disabled = false; });
      baseUrl.disabled = false; token.disabled = false;
    }
  }
  async function loadTasks() {
    selected = undefined; tasks.replaceChildren(new Option("작업을 선택하세요", ""));
    element("title").textContent = "선택한 글 없음"; element("images").textContent = "이미지 0개";
    connection.textContent = "연결 확인 중…";
    try {
      const reply = await request({ type: "TASKS" });
      for (const task of reply.tasks ?? []) tasks.add(new Option(`#${task.id} · ${task.title} (${task.status})`, String(task.id)));
      connected = true; connection.textContent = "Angel Agent 연결됨";
      result.textContent = "작업을 선택해 주세요."; showSettings(false);
    } catch {
      connected = false; connection.textContent = "Angel Agent 연결 실패"; showSettings(true);
      throw new Error("연결에 실패했습니다. 주소·토큰·서버 상태를 확인해 주세요.");
    }
  }
  element("refreshTasks").addEventListener("click", () => { void run(loadTasks); });
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
        await loadTasks();
      } catch { showSettings(true); throw new Error("연결 설정 저장 또는 연결에 실패했습니다. 주소·토큰·서버 상태를 확인해 주세요."); }
    });
  });
  tasks.addEventListener("change", () => { void run(async () => {
    selected = undefined;
    element("title").textContent = "선택한 글 없음"; element("images").textContent = "이미지 0개";
    if (!tasks.value) { result.textContent = "작업을 선택해 주세요."; return; }
    const reply = await request({ type: "TASK", id: tasks.value }); selected = reply.task;
    element("title").textContent = selected?.title ?? "초안 없음";
    element("images").textContent = `이미지 ${selected?.images.length ?? 0}개`;
    result.textContent = "네이버 글쓰기 탭에서 DOM 진단 후 입력하세요.";
  }); });
  async function diagnose() {
    const reply = await request({ type: "DIAGNOSE" });
    element("diagnostic").textContent = JSON.stringify(reply.diagnostics, null, 2);
    return reply.diagnostic;
  }
  element("diagnose").addEventListener("click", () => { void run(async () => {
    const diagnostic = await diagnose();
    result.textContent = diagnostic?.ready === true ? "네이버 글쓰기 화면을 확인했습니다." : diagnostic?.reason ?? "입력 영역을 확정하지 못했습니다. 프레임별 DOM 진단을 확인해 주세요.";
  }); });
  insert.addEventListener("click", () => {
    if (busy) return;
    void run(async () => {
    const diagnostic = await diagnose();
    if (diagnostic?.ready !== true) throw new Error(diagnostic?.reason ?? "입력 영역을 확정하지 못했습니다. 프레임별 DOM 진단을 확인해 주세요.");
    const overwrite = !!diagnostic?.existing;
    if (overwrite && !window.confirm("현재 글에 제목 또는 본문이 있습니다. 선택한 초안으로 덮어쓰시겠습니까?")) { result.textContent = "입력을 취소했습니다."; return; }
    const publisher = element<HTMLSelectElement>("publisher").value === "legacy" ? "legacy" : "blocks";
    const reply = await request({ type: "INSERT", task: selected, overwrite, publisher }); result.textContent = reply.message ?? "입력 결과를 확인해 주세요.";
  }); });
  void chrome.storage.local.get(["appUrl", "extensionToken", "baseUrl"]).then((saved) => {
    savedSettings = { appUrl: saved.appUrl ?? saved.baseUrl ?? "http://localhost:3000", extensionToken: saved.extensionToken ?? "" };
    if (!editedSettings.has("appUrl")) baseUrl.value = savedSettings.appUrl;
    if (!editedSettings.has("extensionToken")) token.value = savedSettings.extensionToken;
    if (saved.appUrl && saved.extensionToken && editedSettings.size === 0) void run(loadTasks);
    else showSettings(true);
  }).catch(() => { showSettings(true); result.textContent = "저장된 설정을 읽지 못했습니다. 주소와 토큰을 입력해 주세요."; });
})();
