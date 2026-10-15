import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const contentCode = compile(await readFile("extension/content.ts", "utf8"));
const panelCode = compile(await readFile("extension/sidepanel/index.ts", "utf8"));
function editorDiagnostic({ title = "", body = [""], helper = "", image = false, emptyImage = false, uiIcon = false }) {
  const field = value => {
    const root = { innerText: value + helper, getClientRects: () => [{}], getAttribute: () => "", tagName: "P" };
    const parent = { closest: () => null };
    root.nodes = [{ textContent: value, parentElement: parent }, { textContent: helper, parentElement: { closest: () => ({ tagName: "SPAN", className: "se-placeholder" }) } }];
    return root;
  };
  const titleNode = field(title), paragraphs = body.map(field);
  const img = { currentSrc: "https://fixture.test/photo.jpg", getAttribute: () => "https://fixture.test/photo.jpg", closest: () => null };
  const components = image || emptyImage ? [{ querySelectorAll: () => image ? [img] : [] }] : [];
  let listener;
  vm.runInNewContext(contentCode, {
    document: {
      querySelectorAll(selector) {
        if (selector === ".se-title-text") return [titleNode];
        if (selector === ".se-component.se-text .se-text-paragraph") return paragraphs;
        if (selector === ".se-component.se-image") return components;
        if (selector === "iframe") return [];
        if (selector === "img") return uiIcon ? [img] : [];
        return [];
      },
      querySelector: selector => selector === ".se-component.se-image" ? components[0] ?? null : null,
      createTreeWalker(root) { let index = 0; return { nextNode: () => root.nodes[index++] ?? null }; },
    },
    NodeFilter: { SHOW_TEXT: 4 }, getComputedStyle: () => ({ visibility: "visible" }),
    location: { href: "https://blog.naver.com/PostWriteForm.naver", origin: "https://blog.naver.com", pathname: "/PostWriteForm.naver" },
    chrome: { runtime: { id: "fixture", onMessage: { addListener(handler) { listener = handler; } } } },
  });
  return new Promise(resolve => listener({ type: "EDITOR_DIAGNOSE" }, { id: "fixture" }, reply => resolve(reply.diagnostic)));
}

async function confirmFlow(diagnostic) {
  const elements = new Map(), requests = [];
  let confirms = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: "", textContent: "", listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; }, replaceChildren() {}, add() {} });
    return elements.get(id);
  };
  const task = { jobId: "job", id: 1, draftId: 2, status: "queued", title: "새 제목", bodyText: "새 본문", images: [] };
  vm.runInNewContext(panelCode, { document: { getElementById: element }, URL,
    Option: class {}, window: { confirm() { confirms++; return false; } },
    chrome: { storage: { local: { get: async () => ({ appUrl: "http://localhost:3000", extensionToken: "fixture" }) } }, runtime: { sendMessage: async message => {
      requests.push(message.type);
      if (message.type === "JOBS") return { jobs: [{ id: "job", draftId: 2, status: "queued", title: "제목", imageCount: 0 }] };
      if (message.type === "JOB") return { task };
      if (message.type === "DIAGNOSE") return { diagnostic };
      return { message: "입력 완료" };
    } } },
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  element("tasks").value = "job"; element("tasks").listeners.change(); await settle();
  element("insert").listeners.click(); await settle();
  return { confirms, inserted: requests.includes("INSERT") };
}
for (const [name, input, expected] of [
  ["empty editor", { body: [] }, false],
  ["default paragraph", {}, false],
  ["spaces and NBSP", { body: [" \t\u00a0 "] }, false],
  ["newlines", { body: ["\r\n\n"] }, false],
  ["zero width helpers", { title: "\u200b\u200c\u200d\ufeff", body: ["\u200c\u200d\u2060"] }, false],
  ["placeholder text", { helper: "제목을 입력하세요" }, false],
  ["empty image template", { emptyImage: true }, false],
  ["toolbar image icon", { uiIcon: true }, false],
  ["actual title", { title: "제목" }, true],
  ["one body character", { body: ["가"] }, true],
  ["actual body image", { image: true }, true],
]) {
  const diagnostic = await editorDiagnostic(input);
  assert.equal(diagnostic.existing, expected, name);
  // A truly absent paragraph is not a ready editor; other cases exercise the actual confirm handler.
  if (diagnostic.ready) {
    const flow = await confirmFlow(diagnostic);
    assert.equal(flow.confirms, expected ? 1 : 0, name);
    assert.equal(flow.inserted, !expected, name);
  }
}
console.log("PASS: blank/whitespace/zero-width/placeholder/template/icon no confirm; actual title/body/image retains confirm and cancellation.");
