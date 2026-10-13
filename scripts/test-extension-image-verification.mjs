import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

let source = await readFile("extension/content.ts", "utf8");
source = source.replace("  chrome.runtime.onMessage.addListener", "  globalThis.checkBlockImage = checkBlockImage; globalThis.photoRequest = photoRequest; globalThis.setSnapshot = (block) => { photoState = { imageCount: block.components.length, block }; };\n  chrome.runtime.onMessage.addListener");
source = source.replace(/  function photoTextNodes\(\)[^{]*\{[\s\S]*?\n  \}/, "  function photoTextNodes() { return globalThis.nodes; }");
let images = [], clock = 0, tick = () => {};
const context = {
  nodes: [], Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
  document: { querySelectorAll: () => images },
  getComputedStyle: () => ({ visibility: "visible" }),
  Date: { now: () => clock }, setTimeout: (resolve) => { clock += 200; tick(); resolve(); },
  chrome: { runtime: { onMessage: { addListener() {} } } },
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
const bitmap = (ready) => ({ currentSrc: "https://example.test/photo.png", complete: ready,
  naturalWidth: ready ? 640 : 0, naturalHeight: ready ? 480 : 0,
  getAttribute: () => null, closest: () => null, getClientRects: () => [{}] });
const component = (order, ready = true) => ({ order, querySelectorAll: () => [bitmap(ready)],
  compareDocumentPosition: (other) => other.order > order ? 4 : 2 });
const snapshot = { components: [], textBefore: "", blockNumber: 2, imageNumber: 1 };
for (const count of [0, 1, 2, 8, 10]) {
  images = [];
  for (let i = 0; i < count; i++) {
    const before = [...images]; images.push(component(i + 1));
    assert.equal(context.checkBlockImage({ ...snapshot, components: before }).ready, true);
  }
  assert.equal(images.length, count);
}
images = []; assert.equal(context.checkBlockImage(snapshot).reason, "component_pending");
images = [component(1, false)]; assert.equal(context.checkBlockImage(snapshot).reason, "image_pending");
context.setSnapshot(snapshot);
await assert.rejects(context.photoRequest({ type: "EDITOR_PHOTO_VERIFY" }), /TIMEOUT block=2 image=1 expected=1 actual=1 reason=image_pending/);
images = []; context.setSnapshot(snapshot);
await assert.rejects(context.photoRequest({ type: "EDITOR_PHOTO_VERIFY" }), /actual=0 reason=component_pending/);
images = [{ ...component(1), querySelectorAll: () => [] }]; assert.equal(context.checkBlockImage(snapshot).ready, false);
for (const changes of [{ currentSrc: "" }, { complete: false }, { naturalWidth: 0 }, { naturalHeight: 0 }, { closest: () => ({}) }]) {
  images = [{ ...component(1), querySelectorAll: () => [{ ...bitmap(true), ...changes }] }];
  assert.equal(context.checkBlockImage(snapshot).ready, false);
}
tick = () => { images = [component(1)]; };
context.setSnapshot(snapshot);
assert.equal((await context.photoRequest({ type: "EDITOR_PHOTO_VERIFY" })).imageReady, true);
tick = () => {};
images = [component(1), component(2)]; assert.equal(context.checkBlockImage(snapshot).invalid, true);
const previous = component(2); images = [component(1), previous];
assert.equal(context.checkBlockImage({ ...snapshot, components: [previous] }).reason, "append_order");
images = [component(2)];
context.nodes = [{ textContent: "text1", compareDocumentPosition: (other) => other.order > 1 ? 4 : 2 }];
assert.equal(context.checkBlockImage({ ...snapshot, textBefore: "text1" }).ready, true);
assert.equal(context.checkBlockImage({ ...snapshot, textBefore: "other" }).reason, "text_boundary");
// Rebuilt wrappers do not require reference identity; visible text boundary remains mandatory.
images = [component(1), component(2)];
assert.equal(context.checkBlockImage({ ...snapshot, components: [component(1)], textBefore: "text1" }).ready, true);
console.log("Image checks passed: 0/1/2/8/10, readiness polling, placeholder/no-growth timeouts, extra component, append order, text boundary, rebuilt wrappers.");
