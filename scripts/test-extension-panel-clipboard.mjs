import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
const compile = async (path) => ts.transpileModule(await readFile(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const code = await compile("extension/sidepanel/index.ts");
const task = { title: "제목", bodyText: "본문", images: [{ signedUrl: "https://fixture.test/first" }, { signedUrl: "https://fixture.test/second" }] };
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function scenario(failure = false, noImages = false) {
  const events = [], elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, { value: "", listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, replaceChildren() {}, add() {} });
    return elements.get(id);
  };
  let release;
  const clipboardWait = new Promise((resolve) => { release = resolve; });
  vm.runInNewContext(code, {
    URL, Option: class {}, document: { getElementById: element }, window: { confirm: () => true,
    prepareImageClipboard: async (signedUrl) => {
      assert.equal(signedUrl, task.images[0].signedUrl);
      events.push("clipboard-start");
      await clipboardWait;
      events.push("clipboard-end");
      return failure ? { clipboardStage: "PHOTO_CLIPBOARD_FOCUS", error: "focus false" } : { clipboardWritten: true };
    },
    },
    chrome: { storage: { local: { get: async () => ({}) } }, permissions: { request: async () => true }, runtime: { sendMessage: async (message) => {
      events.push(message);
      if (message.type === "TASK") return { task: noImages ? { ...task, images: [] } : task };
      if (message.type === "DIAGNOSE") return { diagnostic: { ready: true, existing: false } };
      return { message: "완료" };
    } } },
  });
  await settle();
  element("tasks").value = "1"; element("tasks").listeners.change(); await settle();
  events.length = 0;
  element("insert").listeners.click(); await settle();
  if (!noImages) assert.deepEqual(events, ["clipboard-start"]);
  release(); await settle();
  if (failure) {
    assert.equal(events.some((e) => e?.type === "INSERT" || e?.type === "DIAGNOSE"), false);
    assert.match(element("result").textContent, /PHOTO_CLIPBOARD_FOCUS/);
  } else {
    const insert = events.find((e) => e?.type === "INSERT");
    assert.equal(insert.clipboardReady, !noImages);
    if (!noImages) assert.deepEqual(events.slice(0, 2), ["clipboard-start", "clipboard-end"]);
  }
}
await scenario(); await scenario(true); await scenario(false, true);
console.log("Side Panel clipboard checks passed: first image only, write before diagnose/INSERT, failure blocks automation, no-image V1 preserved.");
