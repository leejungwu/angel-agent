import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

let source = await readFile("extension/content.ts", "utf8");
source = source.replace("  chrome.runtime.onMessage.addListener", "  globalThis.blockRequest = blockRequest;\n  chrome.runtime.onMessage.addListener");
let paragraphs = [], images = [], selection, clock = 0;
function paragraph(value, order) {
  const node = { nodeType: 3, textContent: value };
  const p = { nodeType: 1, order, innerText: value, textContent: value, tagName: "P", node,
    getClientRects: () => [{ width: 100, height: 20 }],
    getBoundingClientRect: () => { throw new Error("Block caret must not query screen coordinates"); },
    getAttribute: () => "se-text-paragraph", scrollIntoView() {},
    focus() {},
    contains: (other) => other === p || other === node,
    closest: (selector) => selector === ".se-text-paragraph" ? p : null,
  };
  node.parentElement = p;
  return p;
}
const title = { ...paragraph("", 0), tagName: "DIV" };
const document = {
  querySelectorAll(selector) {
    if (selector === ".se-title-text") return [title];
    if (selector === ".se-component.se-image") return images;
    if (selector.includes(".se-text-paragraph")) return paragraphs;
    return [];
  },
  querySelector: () => images[0] ?? null,
  elementFromPoint: () => {
    const p = paragraphs[paragraphs.length - 1], image = images[images.length - 1];
    return image && (!p || image.order > p.order) ? image : p;
  },
  createTreeWalker(root) { let done = false; return { nextNode: () => done ? null : (done = true, root.node) }; },
  createRange: () => ({
    selectNodeContents(p) { this.paragraph = p; },
    setStartAfter(image) { this.afterImage = image; },
    collapse(toStart) { this.toStart = toStart; },
    setStart(node, offset) { this.node = node; this.offset = offset; },
    toString() { return this.node.nodeType === 3 ? this.node.textContent.slice(this.offset) : this.paragraph.textContent; },
  }),
};
const window = { innerWidth: 1000, innerHeight: 800, getSelection: () => selection };
const selectionMethods = {
  removeAllRanges() {},
  addRange(range) {
    selection.anchorNode = range.paragraph?.node ?? range.afterImage;
    selection.anchorOffset = range.toStart ? 0 : range.paragraph.node.textContent.length;
    selection.isCollapsed = true;
  },
};
window.top = window;
const context = { document, window, location: { href: "https://blog.naver.com/postwrite", origin: "https://blog.naver.com", pathname: "/postwrite" },
  NodeFilter: { SHOW_TEXT: 4 }, Node: { DOCUMENT_POSITION_FOLLOWING: 4 },
  getComputedStyle: () => ({ visibility: "visible" }),
  Date: { now: () => clock }, setTimeout: (resolve) => { clock += 5000; resolve(); },
  chrome: { runtime: { onMessage: { addListener() {} } } },
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
paragraphs = [paragraph("", 1)];
await context.blockRequest({ type: "EDITOR_BLOCK_START" });
paragraphs = [paragraph("text1", 1)];
await context.blockRequest({ type: "EDITOR_BLOCK_TEXT_VERIFY", task: { bodyText: "text1" } });
selection = { ...selectionMethods, isCollapsed: true, anchorNode: paragraphs[0].node, anchorOffset: 5 };
await context.blockRequest({ type: "EDITOR_BLOCK_TEXT_END" });
await context.blockRequest({ type: "EDITOR_BLOCK_CARET" });
selection.anchorOffset = 2;
await assert.rejects(context.blockRequest({ type: "EDITOR_BLOCK_CARET" }), /끝 caret/);
const image = { ...paragraph("", 2), compareDocumentPosition: (p) => p.order > 2 ? 4 : 2 };
images = [image];
assert.equal((await context.blockRequest({ type: "EDITOR_BLOCK_NEXT_TEXT" })).needsParagraph, true);
const tail = paragraph("", 3);
paragraphs.push(tail);
assert.equal((await context.blockRequest({ type: "EDITOR_BLOCK_NEXT_TEXT" })).position, undefined);
assert.equal(selection.anchorNode, tail.node);
assert.equal(selection.anchorOffset, 0);
selection = { ...selectionMethods, isCollapsed: true, anchorNode: tail.node, anchorOffset: 0 };
await context.blockRequest({ type: "EDITOR_BLOCK_CARET" });
tail.node.parentElement = { closest: () => ({}) };
await assert.rejects(context.blockRequest({ type: "EDITOR_BLOCK_CARET" }), /caret 없음/);
tail.node.parentElement = tail;
tail.innerText = tail.textContent = tail.node.textContent = "text2";
await context.blockRequest({ type: "EDITOR_BLOCK_TEXT_VERIFY", task: { bodyText: "text1\n\ntext2" } });
await context.blockRequest({ type: "EDITOR_BLOCK_VERIFY", task: { bodyText: "text1text2", images: [{}] } });
await assert.rejects(context.blockRequest({ type: "EDITOR_BLOCK_VERIFY", task: { bodyText: "text1text2", images: [{}, {}] } }), /사진 수 불일치/);
await assert.rejects(context.blockRequest({ type: "EDITOR_BLOCK_TEXT_VERIFY", task: { bodyText: "text2text1" } }), /문자\/순서 불일치/);
console.log("Block DOM checks passed: append order, tail caret, helper rejection, missing/created paragraph after image, final text and image counts.");
