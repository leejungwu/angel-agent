import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

function component(file, props = {}) {
  const values = [], refs = []; let cursor = 0, refCursor = 0;
  const jsx = (type, props) => ({ type, props });
  const filename = resolve(file), compiled = new Module(filename);
  compiled.filename = filename;
  compiled.require = name => name === "react/jsx-runtime" ? { jsx, jsxs: jsx } : {
    useState(initial) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
      return [values[index], value => { values[index] = typeof value === "function" ? value(values[index]) : value; }];
    },
    useRef(initial) { const index = refCursor++; return refs[index] ??= { current: initial }; },
  };
  compiled._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  return () => { cursor = 0; refCursor = 0; return compiled.exports.default(props); };
}
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const settle = () => new Promise(resolve => setImmediate(resolve));
const originalFetch = globalThis.fetch, navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
let settings = { system_prompt: "공통 시스템", common_style_prompt: "공통 스타일" }, saved, fetched = 0, copied;
const drafts = [
  { id: "new", answer: "새 답변", question_intent: "질문 의도", provider: "xai", model: "grok-4.7", created_at: "2026-10-15T00:00:00Z" },
  { id: "old", answer: "이전 답변", question_intent: null, provider: null, model: "old", created_at: "2026-10-14T00:00:00Z" },
];
try {
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async text => { copied = text; } } } });
  globalThis.fetch = async (url, options) => {
    if (url === "/api/kin/prompt-settings") {
      if (options?.method === "PATCH") { saved = JSON.parse(options.body); settings = saved; }
      return Response.json({ settings });
    }
    assert.equal(url, "/api/kin/tasks/task-id/drafts"); fetched++;
    return Response.json({ drafts });
  };
  const renderSettings = component("app/content/kin/KinPromptSettings.tsx");
  let tree = renderSettings();
  assert.equal(tree.type, "details"); assert.equal(tree.props.open, undefined);
  assert.equal(nodes(tree).some(node => node.type === "textarea"), false);
  tree.props.onToggle({ currentTarget: { open: true } }); await settle(); tree = renderSettings();
  assert.equal(nodes(tree).filter(node => node.type === "textarea").length, 2);
  nodes(tree).find(node => node.type === "textarea" && node.props.value === "공통 시스템").props.onChange({ target: { value: "수정 시스템" } });
  tree = renderSettings(); nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(saved.system_prompt, "수정 시스템");
  const renderHistory = component("app/content/kin/KinTaskHistory.tsx", { taskId: "task-id", question: "이전 질문" });
  tree = renderHistory(); assert.equal(fetched, 0);
  await nodes(tree).find(node => node.type === "button").props.onClick(); await settle(); tree = renderHistory();
  assert.equal(nodes(tree).find(node => node.type === "textarea").props.value, "새 답변");
  assert.match(JSON.stringify(tree), /질문 의도/); assert.match(JSON.stringify(tree), /grok-4.7/);
  nodes(tree).find(node => node.type === "select").props.onChange({ target: { value: "old" } }); tree = renderHistory();
  assert.equal(nodes(tree).find(node => node.type === "textarea").props.readOnly, true);
  assert.match(JSON.stringify(tree), /기록 없음/);
  nodes(tree).find(node => node.type === "button" && node.props.children === "답변 복사").props.onClick(); await settle();
  assert.equal(copied, "이전 답변");
  nodes(tree).find(node => node.type === "button").props.onClick(); tree = renderHistory();
  nodes(tree).find(node => node.type === "button").props.onClick(); await settle();
  assert.equal(fetched, 2, "Reopening history reloads newly generated Drafts");
} finally {
  globalThis.fetch = originalFetch;
  if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
  else delete globalThis.navigator;
}
console.log("PASS: collapsed common editor/read/save, lazy history load/select/copy, missing metadata, refresh on reopen");
