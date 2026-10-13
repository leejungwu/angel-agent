import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile("extension/background.ts", "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const task = {
  id: 1, draftId: 1, title: "제목", bodyText: "첫 문단\n\n다음 문단",
  images: [0, 1].map((index) => ({ id: index + 1, index, insertOffset: 4, insertPrefix: "첫 문단", signedUrl: `https://images.example.test/${index}`, expiresIn: 600 })),
};
async function scenario(input, failure = "") {
  let listener;
  const commands = [], messages = [], downloads = [];
  let detached = 0;
  const diagnostic = { ready: true, frameReady: true, titleFound: true, bodyFound: true, existing: false };
  const chrome = {
    storage: { local: { setAccessLevel: async () => {} } },
    sidePanel: { setPanelBehavior: async () => {} },
    tabs: {
      query: async () => [{ id: 1, url: "https://blog.naver.com/postwrite" }],
      sendMessage: async (_tab, message) => {
        messages.push(message);
        if (message.type === failure) return { error: "fixture failure" };
        if (message.type === "EDITOR_DIAGNOSE") return { diagnostic };
        if (message.type === "EDITOR_VERIFY") return { verification: { titleMatches: true, bodyMatches: true } };
        return { position: { x: 10, y: 20 }, imageReady: true };
      },
    },
    webNavigation: { getAllFrames: async () => [{ frameId: 2, url: "https://blog.naver.com/PostWriteForm.naver" }] },
    debugger: {
      attach: async () => {}, detach: async () => { detached++; },
      sendCommand: async (_target, method, params) => { commands.push({ method, params }); },
      onDetach: { addListener: () => {}, removeListener: () => {} },
    },
    runtime: { id: "fixture", onMessage: { addListener: (fn) => { listener = fn; } } },
  };
  vm.runInNewContext(code, { chrome, URL, Response, AbortSignal, Uint8Array, btoa, fetch: async (url) => {
    throw new Error("Background must not fetch image bytes: " + new URL(url).origin);
  } });
  const reply = await new Promise((resolve) => listener({ type: "INSERT", task: input, clipboardReady: failure !== "clipboard" }, { id: "fixture" }, resolve));
  return { reply, commands, messages, downloads, detached };
}
const plain = await scenario({ ...task, images: [] });
assert.equal(plain.reply.error, undefined);
assert.deepEqual(plain.commands.filter((c) => c.method === "Input.insertText").map((c) => c.params.text), [task.title, task.bodyText]);
assert.equal(plain.messages.some((m) => m.type.startsWith("EDITOR_PHOTO_")), false);
assert.equal(plain.detached, 1);

const photo = await scenario(task);
assert.equal(photo.reply.error, undefined);
assert.deepEqual(photo.downloads, []);
assert.equal(photo.commands.some((c) => c.method === "Page.setInterceptFileChooserDialog"), false);
assert.deepEqual(photo.messages.filter((m) => m.type.startsWith("EDITOR_PHOTO_")).map((m) => m.type),
  ["EDITOR_PHOTO_TARGET", "EDITOR_PHOTO_CARET", "EDITOR_PHOTO_EMPTY", "EDITOR_PHOTO_PASTE_TARGET", "EDITOR_PHOTO_PASTE_CARET", "EDITOR_PHOTO_VERIFY"]);
assert.deepEqual(photo.commands.filter((c) => c.method === "Input.dispatchKeyEvent" && c.params.type === "rawKeyDown").map((c) => c.params.key), ["Enter", "Enter", "v"]);
assert.equal(photo.commands.find((c) => c.params?.key === "v").params.modifiers, 2);
assert.deepEqual(photo.commands.filter((c) => c.method === "Input.insertText").map((c) => c.params.text), [task.title, task.bodyText]);
assert.equal(photo.commands.some((c) => c.method === "Input.dispatchKeyEvent" && c.params.key === "Backspace"), false);
assert.equal(photo.detached, 1);

const failed = await scenario(task, "EDITOR_PHOTO_VERIFY");
assert.match(failed.reply.error, /PHOTO_VERIFY/);
assert.equal(failed.commands.some((c) => c.params?.key === "Backspace"), false);
assert.equal(failed.detached, 1);
const wrongCaret = await scenario(task, "EDITOR_PHOTO_CARET");
assert.match(wrongCaret.reply.error, /PHOTO_CARET/);
assert.equal(wrongCaret.commands.some((c) => c.params?.key === "Enter"), false);
const firstEnterFailed = await scenario(task, "EDITOR_PHOTO_EMPTY");
assert.equal(firstEnterFailed.commands.filter((c) => c.method === "Input.dispatchKeyEvent" && c.params.type === "rawKeyDown" && c.params.key === "Enter").length, 2);
assert.equal(firstEnterFailed.messages.some((m) => m.type === "EDITOR_PHOTO_PASTE_TARGET"), false);
const clipFailed = await scenario(task, "clipboard");
assert.match(clipFailed.reply.error, /PHOTO_CLIPBOARD/);
assert.equal(clipFailed.commands.some((c) => c.params?.key === "v"), false);
console.log("Extension photo checks passed: clean V1 input, first image only, Enter/Enter, caret gating, failure cleanup.");
