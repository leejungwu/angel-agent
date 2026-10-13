import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
const code = ts.transpileModule(await readFile("extension/clipboard.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
async function scenario(mime = "image/png", failure = "") {
  let canvasCount = 0, writes = 0;
  const context = { window: {} };
  const navigator = failure === "api" ? {} : { clipboard: { write: async () => {
    if (failure === "write") throw new DOMException("Document is not focused.", "NotAllowedError");
    writes++;
  } } };
  Object.assign(context, {
    Blob, URL, AbortSignal, navigator,
    fetch: async (url) => {
      assert.equal(url, "https://fixture.test/image?token=secret");
      if (failure === "network") throw new Error(`Failed https://fixture.test/image?token=secret`);
      return { ok: failure !== "fetch", status: failure === "fetch" ? 403 : 200,
        headers: { get: () => mime }, blob: async () => new Blob(failure === "empty" ? [] : ["image"], { type: mime }) };
    },
    createImageBitmap: async () => {
      if (failure === "convert") throw new Error("Cannot decode image");
      return { width: 10, height: 10, close() {} };
    },
    document: { hasFocus: () => failure !== "focus", createElement: () => {
      canvasCount++;
      return { getContext: () => ({ drawImage() {} }), toBlob: (callback) => callback(new Blob(["png"], { type: "image/png" })) };
    } },
    ClipboardItem: class { constructor(values) { assert.equal(values["image/png"].type, "image/png"); } },
  });
  vm.runInNewContext(code, context);
  const reply = await context.window.prepareImageClipboard("https://fixture.test/image?token=secret");
  assert.equal(JSON.stringify(reply).includes("secret"), false);
  return { reply, canvasCount, writes };
}
for (const mime of ["image/png", "image/jpeg", "image/webp"]) {
  const result = await scenario(mime);
  assert.equal(result.reply.clipboardWritten, true);
  assert.equal(result.writes, 1);
  assert.equal(result.canvasCount, mime === "image/png" ? 0 : 1);
}
for (const [failure, stage] of [["fetch", "PHOTO_FETCH"], ["network", "PHOTO_FETCH"], ["empty", "PHOTO_FETCH"], ["convert", "PHOTO_CONVERT"], ["api", "PHOTO_CLIPBOARD_API"], ["focus", "PHOTO_CLIPBOARD_FOCUS"], ["write", "PHOTO_CLIPBOARD_WRITE"]]) {
  const result = await scenario("image/jpeg", failure);
  assert.equal(result.reply.clipboardStage, stage);
  assert.equal(result.writes, 0);
  assert.ok(result.reply.error);
  if (failure === "write") assert.match(result.reply.error, /NotAllowedError/);
  if (failure === "fetch") assert.equal(JSON.parse(result.reply.error).status, 403);
}
console.log("Clipboard pipeline checks passed: PNG, JPEG/WebP, fetch/convert/API/write failures, success, safe diagnostics.");
