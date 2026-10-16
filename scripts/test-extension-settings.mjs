import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compile = async (path) => ts.transpileModule(await readFile(path, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
const panelCode = (await compile("extension/schedule.ts")) + "\n" + (await compile("extension/sidepanel/index.ts"));
const backgroundCode = await compile("extension/background.ts");
const saved = {};
const storage = {
  local: { get: async () => ({ ...saved }), set: async (values) => { Object.assign(saved, values); }, setAccessLevel: async () => {} },
  session: { get: async () => ({}), set: async () => {} },
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function openPanel(fail = false, selectionTask, options = {}) {
  const elements = new Map();
  const requests = [];
  let taskRequests = 0, completed = false;
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: "", textContent: "", hidden: true, listeners: {},
      options: [], addEventListener(event, handler) { this.listeners[event] = handler; }, replaceChildren() { this.options = []; }, add(option) { this.options.push(option); } });
    return elements.get(id);
  };
  vm.runInNewContext(panelCode, { URL, Option: class { constructor(text, value) { this.text = text; this.value = value; } }, document: { getElementById: element }, chrome: {
    storage, permissions: { request: async () => true },
    runtime: { sendMessage: async (message) => { requests.push(message); if (message.type === "JOB" && options.onTask) return options.onTask(message);
    if (message.type === "JOB" && selectionTask) {
      taskRequests++;
      return options.revoke && taskRequests > 1 ? { error: "초안 승인이 취소되었습니다." } : { task: selectionTask };
    }
      if (message.type === "DIAGNOSE") {
        const diagnostic = options.diagnostic ?? { ready: true, existing: false };
        return { diagnostic, diagnostics: [{ frameId: 2, diagnostic }] };
      }
      if (message.type === "INSERT" && options.refreshAfterInsert) { completed = true; return { message: "예약 등록 요청을 완료했고 다음 글쓰기 화면을 준비했습니다." }; }
      if (message.type === "JOBS" && completed && options.refreshAfterInsert) return { jobs: options.tasks.slice(1) };
      return fail ? { error: "fixture failure" } : { jobs: options.tasks ?? (selectionTask ? [{ id: 1, draftId: 2, title: "제목", status: "queued" }] : []) }; } },
  } });
  await settle();
  return { element, requests };
}
const first = await openPanel();
assert.equal(first.element("baseUrl").value, "http://localhost:3000");
assert.equal(first.element("connectionSettings").hidden, false);
assert.equal(first.requests.length, 0);
first.element("baseUrl").value = "https://app.example.test";
first.element("token").value = "fixture-token-012345678901234567890123456789";
first.element("baseUrl").listeners.input();
first.element("token").listeners.input();
assert.equal(saved.extensionToken, undefined);
first.element("connect").listeners.click();
await settle();
assert.equal(saved.appUrl, first.element("baseUrl").value);
assert.equal(saved.extensionToken, first.element("token").value);
assert.equal(first.element("connectionSettings").hidden, true);
assert.equal(first.element("connectionActions").hidden, false);

const reopened = await openPanel();
assert.equal(reopened.element("baseUrl").value, saved.appUrl);
assert.equal(reopened.element("token").value, saved.extensionToken);
assert.equal(reopened.requests[0].type, "JOBS");
assert.equal(reopened.element("connectionSettings").hidden, true);
reopened.element("changeSettings").listeners.click();
assert.equal(reopened.element("connectionSettings").hidden, false);
const previousToken = saved.extensionToken;
reopened.element("token").value = "unsaved change";
reopened.element("token").listeners.input();
assert.equal(saved.extensionToken, previousToken);
reopened.element("cancelSettings").listeners.click();
assert.equal(reopened.element("connectionSettings").hidden, true);
assert.equal(reopened.element("token").value, previousToken);
reopened.element("changeSettings").listeners.click();
reopened.element("token").value = "fixture-new-token-012345678901234567890123456789";
reopened.element("connect").listeners.click();
await settle();
assert.equal(saved.extensionToken, reopened.element("token").value);
assert.equal(reopened.element("connectionSettings").hidden, true);
const beforeRefresh = JSON.stringify(saved);
reopened.element("refreshTasks").listeners.click();
await settle();
assert.equal(JSON.stringify(saved), beforeRefresh);
const failed = await openPanel(true);
assert.equal(failed.element("connectionSettings").hidden, false);
assert.equal(failed.element("connectionActions").hidden, true);

let listener;
let authenticated = false;
let fetchedPath;
vm.runInNewContext(backgroundCode, { URL, chrome: {
  storage, sidePanel: { setPanelBehavior: async () => {} },
  runtime: { id: "fixture", onMessage: { addListener: (handler) => { listener = handler; } } },
}, fetch: async (url, options) => {
  fetchedPath = `${url.pathname}${url.search}`;
  authenticated = url.origin === saved.appUrl && options.headers.Authorization === `Bearer ${saved.extensionToken}`;
  return { ok: true, json: async () => ({ jobs: [] }) };
} });
const approvedTask = { jobId: "1", id: 1, draftId: 2, status: "queued", title: "제목", bodyText: "본문", images: [0, 1, 2].map((index) => ({ signedUrl: `https://fixture.test/${index}.png` })) };
const multiPanel = await openPanel(false, approvedTask);
multiPanel.element("tasks").value = "1";
multiPanel.element("tasks").listeners.change(); await settle();
multiPanel.element("insert").listeners.click(); await settle();
const inserted = multiPanel.requests.find((message) => message.type === "INSERT");
assert.ok(inserted);
assert.equal("clipboardReady" in inserted, false);
assert.equal(inserted.jobId, "1"); assert.equal("task" in inserted, false);
assert.equal(multiPanel.requests.find((message) => message.type === "JOB").id, "1");
assert.equal(multiPanel.requests.filter((message) => message.type === "JOB").length, 2, "Approval must be rechecked on input click");
for (const status of ["draft", "rejected"]) {
  const denied = await openPanel(false, { ...approvedTask, status }, { tasks: [{ id: 1, status }, { id: 2, draftId: 4, title: "승인", status: "queued" }] });
  assert.deepEqual(denied.element("tasks").options.map((option) => option.value), ["2"]);
  denied.element("tasks").value = "1";
  denied.element("tasks").listeners.change(); await settle();
  assert.equal(denied.element("insert").disabled, true);
  assert.match(denied.element("result").textContent, /발행 Job/);
}
const empty = await openPanel(false);
assert.match(empty.element("result").textContent, /발행 Job이 없습니다/);
assert.equal(empty.element("insert").disabled, true);
const failedJob = await openPanel(false, { ...approvedTask, status: "failed" }, { tasks: [{ id: 1, draftId: 2, title: "제목", status: "failed" }] });
failedJob.element("tasks").value = "1"; failedJob.element("tasks").listeners.change(); await settle();
assert.equal(failedJob.element("insert").disabled, true);
assert.match(failedJob.element("result").textContent, /재시도를 제공하지 않습니다/);
const legacyLarge = await openPanel(false, { ...approvedTask, images: Array.from({ length: 4 }, () => ({})) });
legacyLarge.element("tasks").value = "1"; legacyLarge.element("tasks").listeners.change(); await settle();
legacyLarge.element("publisher").value = "legacy";
legacyLarge.element("insert").listeners.click(); await settle();
assert.equal(legacyLarge.requests.some(message => message.type === "INSERT"), false);
assert.match(legacyLarge.element("result").textContent, /3장 초과/);
const revoked = await openPanel(false, approvedTask, { revoke: true });
revoked.element("tasks").value = "1"; revoked.element("tasks").listeners.change(); await settle();
revoked.element("insert").listeners.click(); await settle();
assert.equal(revoked.requests.some((message) => ["DIAGNOSE", "INSERT"].includes(message.type)), false);
assert.equal(revoked.element("insert").disabled, true);
assert.match(revoked.element("result").textContent, /취소/);
const reply = await new Promise((resolve) => listener({ type: "JOBS" }, { id: "fixture" }, resolve));
assert.equal(reply.error, undefined);
assert.equal(authenticated, true);
await new Promise((resolve) => listener({ type: "JOB", id: "00000000-0000-4000-8000-000000000001" }, { id: "fixture" }, resolve));
assert.equal(fetchedPath, "/api/extension/publication-jobs/00000000-0000-4000-8000-000000000001");
const listed = [1, 2, 3].map((id) => ({ id, draftId: id * 10, title: `task${id}`, status: "queued" }));
const taskFor = (id) => ({ ...approvedTask, jobId: String(id), id, draftId: id * 10, title: `task${id}` });
async function racePanel() {
  const pending = []; let defer = true;
  const panel = await openPanel(false, undefined, { tasks: listed, onTask: (message) => defer
    ? new Promise((resolve) => pending.push({ message, resolve })) : { task: taskFor(Number(message.id)) } });
  const choose = (id) => { panel.element("tasks").value = String(id); panel.element("tasks").listeners.change(); };
  return { ...panel, pending, choose, immediate: () => { defer = false; } };
}
for (const order of [[0, 1], [1, 0]]) {
  const panel = await racePanel(); panel.choose(1); panel.choose(2);
  assert.equal(panel.pending.length, 2, "Second selection must not be dropped while first request is pending");
  assert.equal(panel.element("insert").disabled, true);
  for (const index of order) { panel.pending[index].resolve({ task: taskFor(index + 1) }); await settle(); }
  assert.equal(panel.element("tasks").value, "2"); assert.equal(panel.element("title").textContent, "task2");
  assert.equal(panel.element("insert").disabled, false);
  panel.immediate(); panel.element("insert").listeners.click(); await settle();
  const execution = panel.requests.find((message) => message.type === "INSERT");
  assert.equal(execution.jobId, "2"); assert.equal("task" in execution, false);
  assert.equal(panel.requests.filter((m) => m.type === "JOB").at(-1).id, "2");
}
const many = await racePanel();
for (const id of [1, 2, 3, 1, 3]) many.choose(id);
for (const index of [4, 1, 0, 3, 2]) { many.pending[index].resolve({ task: taskFor(Number(many.pending[index].message.id)) }); await settle(); }
assert.equal(many.element("title").textContent, "task3");
const cleared = await racePanel(); cleared.choose(1); cleared.choose("");
cleared.pending[0].resolve({ task: taskFor(1) }); await settle();
assert.equal(cleared.element("title").textContent, "선택한 글 없음"); assert.equal(cleared.element("insert").disabled, true);
const staleFailure = await racePanel(); staleFailure.choose(1); staleFailure.choose(2);
staleFailure.pending[1].resolve({ task: taskFor(2) }); await settle();
staleFailure.pending[0].resolve({ error: "old failure" }); await settle();
assert.equal(staleFailure.element("title").textContent, "task2"); assert.equal(staleFailure.element("result").textContent.includes("old failure"), false);
const mismatch = await racePanel(); mismatch.choose(2);
mismatch.pending[0].resolve({ task: { ...taskFor(2), draftId: 999 } }); await settle();
assert.equal(mismatch.element("insert").disabled, true);
const executing = await racePanel(); executing.choose(1);
executing.pending[0].resolve({ task: taskFor(1) }); await settle();
executing.element("insert").listeners.click();
assert.equal(executing.element("tasks").disabled, true);
assert.equal(executing.element("publisher").disabled, true);
assert.equal(executing.pending[1].message.id, "1");
executing.choose(2); // Forced change despite disabled UI must also cancel execution.
executing.pending[1].resolve({ task: taskFor(1) }); await settle();
assert.equal(executing.requests.some((message) => ["DIAGNOSE", "INSERT"].includes(message.type)), false);
assert.equal(executing.element("insert").disabled, true);
const loading = await racePanel(); loading.choose(1);
loading.element("insert").listeners.click();
assert.equal(loading.requests.some((message) => message.type === "INSERT"), false);
loading.element("refreshTasks").listeners.click(); await settle();
loading.pending[0].resolve({ task: taskFor(1) }); await settle();
assert.equal(loading.element("title").textContent, "선택한 글 없음");
assert.equal(loading.element("insert").disabled, true);
console.log("Selection race checks passed: overlapping requests, reverse responses, rapid changes, stale errors, clear/refresh, task/draft identity, execution lock/cancellation.");
console.log("Settings checks passed: first setup, automatic reconnect, collapse, edit/cancel/save, refresh without save, failure opens form, authentication.");

const scheduledPanel = await openPanel(false, { ...approvedTask, publishMode: "scheduled", scheduledAt: "2099-10-20T05:30:00Z" });
scheduledPanel.element("tasks").value = "1"; scheduledPanel.element("tasks").listeners.change(); await settle();
assert.match(scheduledPanel.element("schedule").textContent, /예약 발행.*2099.10.20 14:30/);
const invalidSchedulePanel = await openPanel(false, { ...approvedTask, publishMode: "scheduled", scheduledAt: "2099-10-20T05:43:00Z" });
invalidSchedulePanel.element("tasks").value = "1"; invalidSchedulePanel.element("tasks").listeners.change(); await settle();
invalidSchedulePanel.element("insert").listeners.click(); await settle();
assert.match(invalidSchedulePanel.element("result").textContent, /10분/);
assert.equal(invalidSchedulePanel.requests.some(message => ["DIAGNOSE", "INSERT"].includes(message.type)), false);
console.log("PASS: Side Panel KST schedule label and invalid-schedule preflight.");

const refreshedJobs = await openPanel(false, approvedTask, { refreshAfterInsert: true, tasks: [
  { id: "1", draftId: 2, title: "Job A", status: "queued" },
  { id: "2", draftId: 3, title: "Job B", status: "queued" },
] });
refreshedJobs.element("tasks").value = "1"; refreshedJobs.element("tasks").listeners.change(); await settle();
assert.equal(refreshedJobs.element("tasks").options.length, 2);
refreshedJobs.element("insert").listeners.click(); await settle();
assert.deepEqual(refreshedJobs.element("tasks").options.map(option => option.value), ["2"]);
assert.match(refreshedJobs.element("result").textContent, /다음 글쓰기 화면을 준비했습니다/);
assert.equal(refreshedJobs.requests.filter(request => request.type === "JOBS").length, 2);

for (const [diagnostic, message] of [
  [{ baseReady: false, writableEditor: false, stableEditor: false, reason: "not writable" }, /입력 가능한 상태가 아닙니다/],
  [{ baseReady: true, writableEditor: true, stableEditor: false }, /아직 안정화 중/],
  [{ baseReady: true, writableEditor: true, stableEditor: true }, /화면을 확인했습니다/],
]) {
  const panel = await openPanel(false, undefined, { diagnostic });
  panel.element("diagnose").listeners.click(); await settle();
  assert.equal(JSON.parse(panel.element("diagnostic").textContent)[0].diagnostic.stableEditor, diagnostic.stableEditor);
  assert.match(panel.element("result").textContent, message);
  assert.equal(panel.requests.some(request => request.type === "INSERT"), false);
}
console.log("PASS: Side Panel always shows raw diagnostics with unavailable/stabilizing/ready messages.");
