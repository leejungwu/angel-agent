import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

let source = await readFile("extension/content.ts", "utf8");
source = source.replace("  chrome.runtime.onMessage.addListener", "  globalThis.inspectEditor = inspect; globalThis.verifyEditor = verifyInput;\n  chrome.runtime.onMessage.addListener");
let clock = 0, ticks = 0, listener, tick = () => {}, selection = null, panel = null, modal = null;
const field = () => {
  const element = { innerText: "", tagName: "P", isContentEditable: true,
    getAttribute: () => null, querySelectorAll: () => [], getClientRects: () => [{ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20 }], closest: () => null,
    contains: node => node === element };
  return element;
};
let title = field();
const body = field();
const document = {
  visibilityState: "visible", readyState: "complete", activeElement: null,
  querySelectorAll(selector) {
    if (selector === ".se-title-text") return [title];
    if (selector === ".se-component.se-text .se-text-paragraph") return [body];
    if (selector === '[data-focus-lock="publishLayer"]') return panel ? [panel] : [];
    if (selector === '[role="dialog"]') return [body]; // Normal editor-related dialog DOM is not a publish panel.
    if (selector === '[aria-modal="true"],dialog[open]') return modal ? [modal] : [];
    return [];
  },
  createTreeWalker(root) { let done = false; return { nextNode: () => done ? null : (done = true, { textContent: root.innerText, parentElement: root }) }; },
};
const window = { innerWidth: 1000, innerHeight: 800, getSelection: () => selection }; window.top = window;
const context = { document, window, location: { href: "https://blog.naver.com/PostWriteForm.naver", origin: "https://blog.naver.com", pathname: "/PostWriteForm.naver" },
  NodeFilter: { SHOW_TEXT: 4 }, getComputedStyle: node => ({ display: "block", visibility: "visible", ...node.style }),
  Date: { now: () => clock }, setTimeout: resolve => { clock += 100; ticks++; tick(); resolve(); },
  chrome: { runtime: { id: "fixture", onMessage: { addListener(handler) { listener = handler; } } } },
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
document.readyState = "interactive";
assert.equal(context.inspectEditor().diagnostic.ready, false);
document.readyState = "complete"; title.isContentEditable = false;
body.isContentEditable = false;
assert.equal(context.inspectEditor().diagnostic.writableEditor, true, "Measured SmartEditor wrappers need no contenteditable attribute");
assert.equal(context.inspectEditor().diagnostic.baseReady, true);
assert.equal(context.inspectEditor().diagnostic.titleState.contenteditable, null);
assert.equal(context.inspectEditor().diagnostic.titleState.editableHostTag, null);
assert.equal(context.inspectEditor().diagnostic.publishPanelCandidates.find(candidate => candidate.selector === '[role="dialog"]').isPublishPanel, false);
title.closest = selector => selector.includes("disabled") ? title : null;
assert.equal(context.inspectEditor().diagnostic.writableEditor, false, "Explicitly disabled targets still blocked");
title.closest = () => null;
panel = { ...field(), hidden: true };
assert.equal(context.inspectEditor().diagnostic.publishPanelOpen, false);
panel = { ...field(), style: { display: "none" } };
assert.equal(context.inspectEditor().diagnostic.publishPanelOpen, false);
panel = { ...field(), getAttribute: name => name === "aria-hidden" ? "true" : null };
assert.equal(context.inspectEditor().diagnostic.publishPanelOpen, false);
panel = { ...field(), getClientRects: () => [{ x: 0, y: 1000, left: 0, top: 1000, right: 100, bottom: 1020, width: 100, height: 20 }] };
assert.equal(context.inspectEditor().diagnostic.publishPanelOpen, false, "Offscreen retained publish panel must not block");
panel = field();
assert.equal(context.inspectEditor().diagnostic.publishPanelOpen, false, "Visible publishLayer root alone is not an open panel");
assert.equal(context.inspectEditor().diagnostic.baseReady, true);
assert.equal(context.inspectEditor().diagnostic.publishPanelCandidates[0].selector, '[data-focus-lock="publishLayer"]');
const controls = new Map();
panel.querySelectorAll = selector => controls.get(selector) ?? [];
controls.set('[data-testid="seOnePublishBtn"]', [{ ...field(), hidden: true }]);
assert.equal(context.inspectEditor().diagnostic.publishPanelOpen, false);
controls.set('[data-testid="seOnePublishBtn"]', [field()]);
assert.equal(context.inspectEditor().diagnostic.publishPanelOpen, true);
assert.equal(context.inspectEditor().diagnostic.publishPanelState.finalButtonVisible, true);
assert.equal(context.inspectEditor().diagnostic.baseReady, false);
controls.clear();
controls.set('[data-testid="preTimeRadioBtn"]', [field()]);
assert.equal(context.inspectEditor().diagnostic.publishPanelOpen, true);
controls.clear();
controls.set('[data-testid="nowTimeRadioBtn"]', [field()]);
assert.equal(context.inspectEditor().diagnostic.publishPanelOpen, true);
controls.clear();
controls.set('[data-click-area="tpb.publish"]', [field()]);
assert.equal(context.inspectEditor().diagnostic.publishPanelOpen, false, "Publish trigger alone never means an open panel");
assert.equal(context.inspectEditor().diagnostic.publishPanelState.rootDisplayed, true);
// Keep the normally rendered root present during the real three-poll stability check below.
const blankRoot = panel;
panel = null;
modal = field();
assert.equal(context.inspectEditor().diagnostic.blockingDialogOpen, true);
assert.equal(context.inspectEditor().diagnostic.baseReady, false);
modal = null;
panel = blankRoot;
const backgroundSource = (await readFile("extension/background.ts", "utf8")).replace("  let inputRunning", "  globalThis.checkStable = stableEditor;\n  let inputRunning");
let polls = 0, stableWaits = 0;
const background = { URL, setTimeout: resolve => { stableWaits++; resolve(); }, chrome: {
  sidePanel: { setPanelBehavior: async () => {} }, storage: { local: { setAccessLevel: async () => {} } },
  tabs: { query: async () => [{ id: 1, url: "https://blog.naver.com/PostWriteForm.naver?blogId=fixture" }],
    sendMessage: async () => { polls++; return { diagnostic: context.inspectEditor().diagnostic }; } },
  webNavigation: { getAllFrames: async () => [{ frameId: 2, url: "https://blog.naver.com/PostWriteForm.naver?blogId=fixture" }] },
  runtime: { onMessage: { addListener() {} } },
} };
vm.runInNewContext(ts.transpileModule(backgroundSource, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, background);
assert.equal((await background.checkStable(true)).found[0].diagnostic.stableEditor, true);
assert.equal(polls, 3, "Measured non-contenteditable wrappers reach stable only after three polls");
assert.equal(stableWaits, 2);
panel = null;
title.isContentEditable = true;
const initialId = context.inspectEditor().diagnostic.editorId;
assert.equal(context.inspectEditor().diagnostic.editorId, initialId);
title = field();
assert.notEqual(context.inspectEditor().diagnostic.editorId, initialId, "Replaced title must reset background stability streak");
const request = message => new Promise(resolve => listener(message, { id: "fixture" }, resolve));
tick = () => { if (ticks === 2) document.activeElement = title; };
assert.equal((await request({ type: "EDITOR_TITLE_FOCUS" })).error, undefined);
assert.equal(ticks, 2, "Wait for actual title focus before insertion");
document.activeElement = body; tick = () => {};
assert.match((await request({ type: "EDITOR_TITLE_FOCUS" })).error, /focus/);
document.activeElement = null;
selection = { rangeCount: 1, anchorNode: title, focusNode: title };
assert.equal((await request({ type: "EDITOR_TITLE_FOCUS" })).error, undefined);
selection = null;
const before = ticks;
tick = () => { if (ticks - before === 3) title.innerText = "지연된 제목"; };
const result = await context.verifyEditor({ title: "지연된 제목", bodyText: "본문" }, "title");
assert.equal(result.titleMatches, true);
assert.equal(ticks - before, 3, "Title DOM verification must poll delayed rendering without reinsertion");
tick = () => {};
await assert.rejects(context.verifyEditor({ title: "다른 제목", bodyText: "본문" }, "title"), /titleMatch=false/);
console.log("PASS: document complete, editable state, editor identity replacement, delayed title focus, selection containment, delayed title DOM verification and timeout.");
