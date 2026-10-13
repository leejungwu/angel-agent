import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

let source = await readFile("extension/content.ts", "utf8");
source = source.replace("  function inspect() {", "  function inspect() { return globalThis.currentInspect; }\n  function originalInspect() {");
source = source.replace("  chrome.runtime.onMessage.addListener", "  globalThis.photoLocation = photoLocation; globalThis.actualPhotoOffset = actualPhotoOffset; globalThis.photoRequest = photoRequest;\n  chrome.runtime.onMessage.addListener");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const parent = { getClientRects: () => [{}], scrollIntoView() {}, getBoundingClientRect: () => ({ x: 10, y: 20, left: 10, top: 20, width: 30, height: 10 }), closest: (selector) => selector === ".se-text-paragraph" ? parent : null,
  contains: (node) => nodes.includes(node) || node === parent };
let nodes = [];
let selection;
let imageCount = 0;
const componentUI = { getClientRects: () => [{}], closest: () => null };
const componentUIText = { textContent: "추가할 컴포넌트를 선택하세요.", parentElement: componentUI };
const diagnostics = [];
const context = { NodeFilter: { SHOW_TEXT: 4 }, getComputedStyle: () => ({ visibility: "visible" }),
  console: { info: (...values) => diagnostics.push(values) },
  chrome: { runtime: { onMessage: { addListener() {} } } }, window: { getSelection: () => selection, innerWidth: 800, innerHeight: 600 },
  document: { querySelector: () => null, elementFromPoint: () => parent,
    querySelectorAll: (selector) => selector === ".se-component.se-text .se-text-paragraph" ? [parent] : selector === ".se-content" ? [componentUI] : selector === ".se-component.se-image" ? Array(imageCount).fill({}) : [],
    createRange: () => ({ setStart(node, offset) { this.startContainer = node; this.startOffset = offset; }, collapse() {}, getClientRects: () => [{ x: 50, y: 30, left: 50, top: 30, width: 0, height: 20 }] }),
    createTreeWalker(root) { let i = 0; const candidates = root === componentUI ? [...nodes, componentUIText] : nodes;
      return { nextNode: () => candidates[i++] ?? null }; } } };
vm.runInNewContext(code, context);
context.window.top = context.window;
nodes = ["도입", "첫 문단😀", "다음 문단"].map((textContent) => ({ textContent, parentElement: parent }));
const bodyText = "도입\n\n첫 문단😀\n\n다음 문단";
const task = (insertOffset) => ({ bodyText, images: [{ insertOffset, insertPrefix: bodyText.slice(0, insertOffset) }] });
const offset = bodyText.indexOf("\n\n다음");
let point = context.photoLocation(task(offset));
assert.equal(point.node, nodes[1]);
assert.equal(point.offset, nodes[1].textContent.length);
assert.equal(point.characterOffset, "도입첫문단😀".length);
assert.equal(context.photoLocation({ ...task(offset), images: [{ insertOffset: 1, insertPrefix: bodyText.slice(0, offset) }] }).offset, point.offset);
assert.throws(() => context.photoLocation({ ...task(offset), images: [{ insertOffset: offset, insertPrefix: "다음 문단" }] }), /prefix/i);
nodes[0].textContent = "도\r\n입\u00a0\u200c";
assert.equal(context.photoLocation(task(offset)).offset, point.offset);
nodes[0].textContent = "도입";
const caret = { comparePoint(node, localOffset) {
  const index = nodes.indexOf(node), caretIndex = nodes.indexOf(selection.focusNode);
  return index < caretIndex ? -1 : index > caretIndex ? 1 : Math.sign(localOffset - selection.focusOffset);
} };
selection = { isCollapsed: true, rangeCount: 1, focusNode: point.node, focusOffset: point.offset, getRangeAt: () => caret };
assert.equal(context.actualPhotoOffset(), point.characterOffset);
selection.focusOffset--;
assert.notEqual(context.actualPhotoOffset(), point.characterOffset);
selection.isCollapsed = false;
assert.throws(() => context.actualPhotoOffset(), /caret/);
point = context.photoLocation(task(0));
assert.equal(point.node, nodes[0]); assert.equal(point.offset, 0);
point = context.photoLocation(task(bodyText.length));
assert.equal(point.node, nodes[2]); assert.equal(point.offset, nodes[2].textContent.length);
assert.throws(() => context.photoLocation(task(-1)), /insertOffset/);
assert.throws(() => context.photoLocation(task(offset - 1)), /insertOffset/);
assert.throws(() => context.photoLocation(task(bodyText.length + 1)), /insertOffset/);
nodes[2].textContent = "누락";
assert.equal(context.photoLocation(task(offset)).characterOffset, "도입첫문단😀".length);
nodes[0].textContent = "입도";
assert.throws(() => context.photoLocation(task(offset)), /prefix|Prefix/);
nodes[0].textContent = "도입";
nodes[2].textContent = "다음 문단추가suffix14문자";
assert.equal(context.photoLocation(task(offset)).characterOffset, "도입첫문단😀".length);
assert.ok(diagnostics.at(-1)[1].extraSuffixLength > 0);
assert.ok(diagnostics.at(-1)[1].extraSuffixPreview.length <= 40);
nodes[2].textContent = "다음 문단";
const p = (text) => ({ textContent: text, innerText: text, ...parent });
context.currentInspect = { diagnostic: { ready: true }, paragraphs: [p("stale paragraph representation")] };
await context.photoRequest({ type: "EDITOR_PHOTO_TARGET", task: task(offset) });
context.currentInspect.paragraphs = [p("도입"), p("첫 문단😀"), p(""), p("다음 문단"), p("")];
assert.ok((await context.photoRequest({ type: "EDITOR_PHOTO_EMPTY" })).position);
const emptyTarget = { ...p(""), nodeType: 1 };
emptyTarget.closest = () => emptyTarget;
emptyTarget.contains = (node) => node === emptyTarget;
context.currentInspect.paragraphs[2] = emptyTarget;
selection = { isCollapsed: true, rangeCount: 1, focusNode: emptyTarget, focusOffset: 0,
  getRangeAt: () => ({ comparePoint: (node) => nodes.indexOf(node) < 2 ? -1 : 1 }) };
await context.photoRequest({ type: "EDITOR_PHOTO_PASTE_CARET" });
selection.getRangeAt = () => ({ comparePoint: (node) => nodes.indexOf(node) < 1 ? -1 : 1 });
await assert.rejects(() => context.photoRequest({ type: "EDITOR_PHOTO_PASTE_CARET" }), /caret/);
imageCount = 1;
assert.equal((await context.photoRequest({ type: "EDITOR_PHOTO_VERIFY", task: task(offset) })).imageReady, true);
imageCount = 0;
context.currentInspect.paragraphs = nodes.map((node) => p(node.textContent));
await context.photoRequest({ type: "EDITOR_PHOTO_TARGET", task: task(offset) });
context.currentInspect.paragraphs = [p(""), p("도입"), p("첫 문단😀"), p("다음 문단"), p("")];
await assert.rejects(() => context.photoRequest({ type: "EDITOR_PHOTO_EMPTY" }), /insertOffset/);
nodes[2].textContent = "누락";
imageCount = 1;
await assert.rejects(() => context.photoRequest({ type: "EDITOR_PHOTO_VERIFY", task: task(offset) }), /본문/);
nodes[2].textContent = "다음 문단" + "추가문자".repeat(30);
imageCount = 0;
context.currentInspect.paragraphs = nodes.map((node) => p(node.textContent));
await context.photoRequest({ type: "EDITOR_PHOTO_TARGET", task: task(offset) });
assert.equal(diagnostics.at(-1)[1].extraSuffixLength, 120);
assert.equal(diagnostics.at(-1)[1].extraSuffixPreview.length, 40);
imageCount = 1;
await assert.rejects(() => context.photoRequest({ type: "EDITOR_PHOTO_VERIFY", task: task(offset) }), /본문/);
console.log("Offset checks passed: clean body, DOM whitespace mapping, UTF-16/emoji boundary, caret position, invalid offset/body rejection.");
