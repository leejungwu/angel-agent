import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

function load(file, mocks = {}) {
  const filename = resolve(file), compiled = new Module(filename);
  compiled.filename = filename;
  const require = compiled.require.bind(compiled);
  compiled.require = (name) => name in mocks ? mocks[name] : require(name);
  compiled._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  return compiled.exports;
}
const presets = load("lib/blog-generation/presets.ts");
const rows = [], writes = [];
let nextId = 0, dbError = false;
const db = { from(table) {
  assert.equal(table, "blog_prompt_presets", "CRUD must not mutate Tasks or Drafts");
  let operation = "read", value, id;
  function run(single) {
    if (dbError) return { data: null, error: { code: "fixture" } };
    let matches = rows.filter(row => id === undefined || row.id === id);
    if (operation === "insert") {
      const row = { ...structuredClone(value), id: `${String(++nextId).padStart(8, "0")}-1234-1234-1234-123456789abc`, created_at: "2026-10-15T00:00:00Z", updated_at: "2026-10-15T00:00:00Z" };
      rows.push(row); matches = [row]; writes.push({ table, operation, value });
    }
    if (operation === "update") { matches.forEach(row => Object.assign(row, structuredClone(value))); writes.push({ table, operation, value }); }
    if (operation === "delete") { matches.forEach(row => rows.splice(rows.indexOf(row), 1)); writes.push({ table, operation }); }
    return { data: single ? matches[0] ?? null : matches, error: null };
  }
  return { select() { return this; }, order() { return this; }, eq(_key, candidate) { id = candidate; return this; },
    insert(candidate) { operation = "insert"; value = candidate; return this; },
    update(candidate) { operation = "update"; value = candidate; return this; },
    delete() { operation = "delete"; return this; },
    async single() { return run(true); }, async maybeSingle() { return run(true); },
    then(resolve) { resolve(run(false)); },
  };
} };
const mocks = { "@/lib/supabase": { supabase: db }, "@/lib/blog-generation/presets": presets };
const list = load("app/api/blog/presets/route.ts", mocks);
const item = load("app/api/blog/presets/[id]/route.ts", mocks);
const duplicate = load("app/api/blog/presets/[id]/duplicate/route.ts", mocks);
const request = (body) => new Request("http://localhost/api/blog/presets", { method: "POST", body: JSON.stringify(body) });
const context = (id) => ({ params: Promise.resolve({ id }) });
const input = { name: "원본", description: "설명", system_prompt: "시스템", strategy_prompt: "전략", style_prompt: "문체", title_prompt: "제목 기준", article_prompt: "전개",
  target_chars: 1500, min_chars: 1200, max_chars: 1800, section_count: 3, keyword_min: 0, keyword_max: 3, is_default: true };
assert.equal((await list.POST(request({ ...input, min_chars: 1700 }))).status, 400);
const original = (await (await list.POST(request(input))).json()).preset;
assert.equal((await (await list.GET()).json()).presets.length, 1);
assert.equal((await item.PATCH(request({ ...input, name: "편집" }), context(original.id))).status, 200);
const copy = (await (await duplicate.POST(request({ name: "무시할 클라이언트 값" }), context(original.id))).json()).preset;
assert.equal(copy.name, "편집 복사본"); assert.equal(copy.is_default, false);
for (const key of ["system_prompt", "strategy_prompt", "style_prompt", "title_prompt", "article_prompt", "min_chars", "max_chars", "target_chars", "section_count", "keyword_min", "keyword_max"]) assert.equal(copy[key], input[key]);
assert.equal((await item.DELETE(request({}), context(original.id))).status, 200);
assert.equal((await item.DELETE(request({}), context(original.id))).status, 404);
assert.equal((await duplicate.POST(request({}), context(original.id))).status, 404);
assert.equal((await item.PATCH(request(input), context(original.id))).status, 404);
assert.equal((await item.DELETE(request({}), context("bad"))).status, 400);
dbError = true; assert.equal((await list.GET()).status, 500); dbError = false;

const values = []; let cursor = 0, selectedId = copy.id, busy = false;
const jsx = (type, props) => ({ type, props });
const Control = load("app/content/blog/[id]/BlogPresetControl.tsx", { ...mocks,
  "react/jsx-runtime": { jsx, jsxs: jsx },
  react: { useRef: (value) => ({ current: value }), useState: (initial) => {
    const index = cursor++;
    if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
    return [values[index], value => { values[index] = typeof value === "function" ? value(values[index]) : value; }];
  } },
}).default;
const nodes = tree => !tree || typeof tree !== "object" ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const render = () => { cursor = 0; return Control({ initialPresets: [copy], selectedId, disabled: busy,
  onSelect: preset => { selectedId = preset?.id ?? ""; }, onBusy: value => { busy = value; } }); };
const button = (tree, text) => nodes(tree).find(node => node.type === "button" && node.props.children === text);
const previousFetch = globalThis.fetch, previousConfirm = globalThis.confirm;
try {
  globalThis.confirm = () => true;
  globalThis.fetch = async (url, options) => {
    const id = url.split("/")[4];
    return url.endsWith("/duplicate") ? duplicate.POST(request({}), context(id))
      : options.method === "DELETE" ? item.DELETE(request({}), context(id))
      : options.method === "PATCH" ? item.PATCH(request(JSON.parse(options.body)), context(id))
      : list.POST(request(JSON.parse(options.body)));
  };
  let tree = render();
  assert.equal(nodes(tree).some(node => node.type === "textarea"), false);
  button(tree, "편집").props.onClick(); tree = render();
  assert.equal(nodes(tree).filter(node => node.type === "textarea").length, 5);
  assert.ok(nodes(tree).filter(node => node.type === "textarea").every(node => node.props.rows >= 16));
  nodes(tree).find(node => node.type === "textarea" && node.props.value === "문체").props.onChange({ target: { value: "새 문체" } });
  tree = render(); nodes(tree).find(node => node.type === "textarea" && node.props.value === "제목 기준").props.onChange({ target: { value: "새 제목 기준" } });
  tree = render(); nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rows.find(row => row.id === selectedId).style_prompt, "새 문체");
  assert.equal(rows.find(row => row.id === selectedId).title_prompt, "새 제목 기준");
  tree = render(); button(tree, "복제").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(rows.find(row => row.id === selectedId).is_default, false);
  tree = render(); button(tree, "새 프리셋").props.onClick(); tree = render();
  button(tree, "취소").props.onClick(); assert.equal(busy, false);
  tree = render(); button(tree, "삭제").props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(selectedId, ""); assert.equal(busy, false);
} finally { globalThis.fetch = previousFetch; globalThis.confirm = previousConfirm; }
assert.ok(writes.every(write => write.table === "blog_prompt_presets"));
console.log("PASS: Blog preset CRUD/duplicate, validation/errors, editor expand/save/cancel/delete, full prompt fields, no Task/Draft writes");
