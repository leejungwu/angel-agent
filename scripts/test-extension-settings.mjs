import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compile = async (path) => ts.transpileModule(await readFile(path, "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
const panelCode = await compile("extension/sidepanel/index.ts");
const backgroundCode = await compile("extension/background.ts");
const saved = {};
const storage = {
  local: { get: async () => ({ ...saved }), set: async (values) => { Object.assign(saved, values); }, setAccessLevel: async () => {} },
  session: { get: async () => ({}), set: async () => {} },
};
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function openPanel(fail = false, selectionTask) {
  const elements = new Map();
  const requests = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: "", textContent: "", hidden: true, listeners: {},
      addEventListener(event, handler) { this.listeners[event] = handler; }, replaceChildren() {}, add() {} });
    return elements.get(id);
  };
  vm.runInNewContext(panelCode, { URL, Option: class {}, document: { getElementById: element }, chrome: {
    storage, permissions: { request: async () => true },
    runtime: { sendMessage: async (message) => { requests.push(message); if (message.type === "TASK" && selectionTask) return { task: selectionTask };
      if (message.type === "DIAGNOSE") return { diagnostic: { ready: true, existing: false } };
      return fail ? { error: "fixture failure" } : { tasks: selectionTask ? [{ id: 1, draftId: 2, title: "제목", status: "approved" }] : [] }; } },
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
assert.equal(reopened.requests[0].type, "TASKS");
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
  return { ok: true, json: async () => ({ tasks: [] }) };
} });
const multiPanel = await openPanel(false, { title: "제목", bodyText: "본문", images: [0, 1, 2].map((index) => ({ signedUrl: `https://fixture.test/${index}.png` })) });
multiPanel.element("tasks").value = "1";
multiPanel.element("tasks").listeners.change(); await settle();
multiPanel.element("insert").listeners.click(); await settle();
const inserted = multiPanel.requests.find((message) => message.type === "INSERT");
assert.ok(inserted);
assert.equal("clipboardReady" in inserted, false);
assert.equal(inserted.task.images.length, 3);
assert.equal(multiPanel.requests.find((message) => message.type === "TASK").draftId, "2");
const reply = await new Promise((resolve) => listener({ type: "TASKS" }, { id: "fixture" }, resolve));
assert.equal(reply.error, undefined);
assert.equal(authenticated, true);
await new Promise((resolve) => listener({ type: "TASK", id: "1", draftId: "2" }, { id: "fixture" }, resolve));
assert.equal(fetchedPath, "/api/extension/blog-tasks/1?draftId=2");
console.log("Settings checks passed: first setup, automatic reconnect, collapse, edit/cancel/save, refresh without save, failure opens form, authentication.");
