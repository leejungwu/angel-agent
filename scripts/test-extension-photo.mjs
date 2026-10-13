import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
const code = ts.transpileModule(await readFile("extension/background.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const task = { id: 1, title: "제목", bodyText: "abcdefghij", images: [2, 6, 8, 9].map((insertOffset, index) => ({ id: index, index, insertOffset, insertPrefix: "abcdefghij".slice(0, insertOffset), signedUrl: `https://fixture.test/${index}.png` })) };
async function scenario(input = task, failure = "") {
  let listener, intercepted = false, sequence = 0, uploadVerified = 0;
  const deleteAttempts = new Map(), cleanupDelays = [], cleanupUploadCounts = [];
  const handlers = new Set(), commands = [], messages = [], downloads = [], removed = [], erased = [];

  const chrome = {
    storage: { local: { setAccessLevel: async () => {}, get: async () => ({ appUrl: "http://localhost:3000", extensionToken: "fixture-secret" }) } }, sidePanel: { setPanelBehavior: async () => {} },
    tabs: { query: async () => [{ id: 1, url: "https://blog.naver.com/postwrite" }], sendMessage: async (_tab, message) => {
      messages.push(message);
      if (message.type === failure) return { error: "fixture failure" };
      if (message.type === "EDITOR_DIAGNOSE") return { diagnostic: { frameReady: true, ready: true, titleFound: true, bodyFound: true } };
      if (message.type === "EDITOR_PHOTO_VERIFY") uploadVerified++;
      if (message.type === "EDITOR_VERIFY") return { verification: { titleMatches: true, bodyMatches: true } };
      return { position: { x: message.type === "EDITOR_PHOTO_BUTTON" ? 99 : 10, y: 20 }, imageReady: true };
    } },
    webNavigation: { getAllFrames: async () => [{ frameId: 2, url: "https://blog.naver.com/PostWriteForm.naver" }] },
    debugger: { attach: async () => {}, detach: async () => {}, onDetach: { addListener() {}, removeListener() {} },
      onEvent: { addListener: (handler) => handlers.add(handler), removeListener: (handler) => handlers.delete(handler) },
      sendCommand: async (_target, method, params) => {
        commands.push({ method, params });
        if (method === "Page.setInterceptFileChooserDialog") intercepted = params.enabled;
        if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased" && params.x === 99 && failure !== "timeout") {
          assert.equal(intercepted, true);
          for (const handler of handlers) handler({ tabId: 1 }, "Page.fileChooserOpened", { backendNodeId: failure === "chooser" ? undefined : 123, frameId: "main", mode: "selectMultiple" });
        }
        if (method === "DOM.setFileInputFiles" && failure === "upload") throw new Error("fixture error");
      },
    }, runtime: { id: "fixture", onMessage: { addListener: (handler) => { listener = handler; } } },
  };
  vm.runInNewContext(code, { chrome, URL, AbortSignal, fetch: async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer fixture-secret");
    assert.equal(url.origin, "http://localhost:3000");
    if (options.method === "POST") {
      const body = JSON.parse(options.body); downloads.push(body);
      if (failure === "create") return { ok: false, status: 500, json: async () => ({ error: "fixture create failure" }) };
      const tempId = `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
      return { ok: true, json: async () => ({ tempId, absolutePath: `C:\\Temp\\angel-agent\\naver-upload\\${tempId}.png` }) };
    }
    assert.equal(options.method, "DELETE");
    cleanupUploadCounts.push(uploadVerified);
    if (["", "cleanup", "cleanupRetry", "cleanupOne"].includes(failure)) assert.equal(uploadVerified, 3, "cleanup must follow all uploads");
    const tempId = url.pathname.split("/").at(-1);
    deleteAttempts.set(tempId, (deleteAttempts.get(tempId) ?? 0) + 1);
    erased.push(tempId);
    if (failure === "cleanup" || (failure === "cleanupOne" && tempId.endsWith("001")) || (failure === "cleanupRetry" && tempId.endsWith("001") && deleteAttempts.get(tempId) < 4)) return { ok: false, status: 500, json: async () => ({ error: "fixture cleanup failure" }) };
    removed.push(url.pathname.split("/").at(-1));
    return { ok: true, json: async () => ({ ok: true }) };
  }, setTimeout: (fn, ms) => { if ([500, 1500, 3000].includes(ms)) { cleanupDelays.push(ms); return setTimeout(fn, 0); } return setTimeout(fn, failure === "timeout" && ms === 15000 ? 5 : ms); }, clearTimeout, Date });
  const reply = await new Promise((resolve) => listener({ type: "INSERT", task: input }, { id: "fixture" }, resolve));
  assert.equal(handlers.size, 0); assert.equal(intercepted, false);
  if (["", "cleanup", "cleanupRetry", "cleanupOne"].includes(failure)) assert.ok(cleanupUploadCounts.every((count) => count === 3));
  return { reply, commands, messages, downloads, removed, erased, cleanupDelays };
}
const success = await scenario();
assert.equal(success.reply.error, undefined);
assert.deepEqual(success.downloads.map((d) => d.signedUrl), [task.images[2].signedUrl, task.images[1].signedUrl, task.images[0].signedUrl]);
assert.equal(code.includes("chrome.downloads"), false);
assert.equal(success.commands.filter((c) => c.method === "DOM.setFileInputFiles").length, 3);
assert.ok(success.commands.filter((c) => c.method === "DOM.setFileInputFiles").every((c) => c.params.backendNodeId === 123 && c.params.files.length === 1 && c.params.files[0].startsWith("C:\\")));
assert.equal(success.messages.filter((m) => m.type === "EDITOR_PHOTO_BODY_VERIFY").length, 1);
assert.deepEqual(success.messages.filter((m) => m.type === "EDITOR_PHOTO_TARGET").map((m) => m.task.images[0].index), [2, 1, 0]);
assert.equal(success.removed.length, 3); assert.equal(success.erased.length, 3);
assert.equal(success.commands.some((c) => c.params?.key === "v"), false);
assert.deepEqual(success.commands.filter((c) => c.method === "Input.insertText").map((c) => c.params.text), [task.title, task.bodyText]);
for (const failure of ["create", "chooser", "timeout", "upload", "EDITOR_PHOTO_VERIFY", "EDITOR_PHOTO_CARET", "EDITOR_PHOTO_EMPTY"]) {
  const failed = await scenario(task, failure);
  assert.ok(failed.reply.error);
  assert.match(failed.reply.error, /PHOTO_(TEMP_CREATE|FILE_CHOOSER|UPLOAD|POSITION|EMPTY_PARAGRAPH)/);
  assert.equal(failed.downloads.length, 1); assert.equal(failed.erased.length, failure === "create" ? 0 : 1);
  if (failure !== "create") assert.equal(failed.removed.length, 1);
}
const cleanupFailed = await scenario(task, "cleanup");
assert.equal(cleanupFailed.reply.error, undefined);
assert.match(cleanupFailed.reply.message, /PHOTO_TEMP_CLEANUP/);
assert.equal(cleanupFailed.commands.filter((c) => c.method === "DOM.setFileInputFiles").length, 3);
assert.equal(cleanupFailed.erased.length, 12);
assert.deepEqual(cleanupFailed.cleanupDelays, [500, 1500, 3000]);
const cleanupRecovered = await scenario(task, "cleanupRetry");
assert.equal(cleanupRecovered.reply.error, undefined);
assert.equal(cleanupRecovered.reply.message.includes("PHOTO_TEMP_CLEANUP"), false);
assert.equal(cleanupRecovered.erased.length, 6);
assert.deepEqual(cleanupRecovered.cleanupDelays, [500, 1500, 3000]);
const cleanupOne = await scenario(task, "cleanupOne");
assert.match(cleanupOne.reply.message, /임시 사진 1개 정리 실패/);
assert.equal(cleanupOne.reply.error, undefined);
assert.equal(cleanupOne.erased.length, 6);
const plain = await scenario({ ...task, images: [] });
assert.equal(plain.reply.error, undefined); assert.equal(plain.downloads.length, 0);
console.log("Multi-photo checks passed: 3-image cap, reverse offsets, intercepted chooser, absolute paths, server temp cleanup/warning, failure gating, final body verify, unchanged V1.");
