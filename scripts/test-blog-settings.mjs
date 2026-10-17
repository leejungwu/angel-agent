import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

function load(path, mocks = {}) {
  const filename = resolve(path), compiled = new Module(filename), original = createRequire(filename);
  compiled.filename = filename; compiled.require = name => name in mocks ? mocks[name] : original(name);
  compiled._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return compiled.exports;
}
const models = load("lib/blog-generation/models.ts");
const sql = readFileSync("supabase/migrations/202610170009_blog_topic_and_title_settings.sql", "utf8");
assert.match(sql, /topic_model text NOT NULL DEFAULT 'gpt-6-luna'/);
assert.match(sql, /title_prompt text NOT NULL DEFAULT ''/);
assert.match(sql, /WHERE title_prompt = ''/); assert.match(sql, /updated_at = p_expected_updated_at/);
assert.doesNotMatch(sql, /CHECK\s*\([^)]*topic_model|UPDATE public.blog_tasks|DROP\s|DELETE\s|SET system_prompt|SET article_prompt/i);
const seededTopic = sql.match(/\$prompt\$([\s\S]*?)\$prompt\$/)[1];
for (const term of ["10~50", "내부 콘텐츠 기획", "주된 검색 의도", "콜론", "후킹", "비틀지"]) assert.ok(seededTopic.includes(term));
const seededTitle = sql.match(/\$title\$([\s\S]*?)\$title\$/)[1];
for (const term of ["Topic", "제목 하나", "클릭베이트", "Product 이름"]) assert.ok(seededTitle.includes(term));
let row = { id: true, topic_model: "gpt-6-luna", topic_prompt: seededTopic, created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z" };
let missing = false, fail = false, revision = 0;
const settingsDb = {
  from(table) { assert.equal(table, "blog_generation_settings"); return { select() { return this; }, eq(key, value) { assert.equal(key, "id"); assert.equal(value, true); return this; }, async maybeSingle() { return { data: missing ? null : row, error: fail ? {} : null }; } }; },
  async rpc(name, args) {
    assert.equal(name, "save_blog_generation_settings");
    if (fail) return { error: {} };
    if (args.p_expected_updated_at !== row.updated_at) return { data: [] };
    row = { ...row, topic_model: args.p_topic_model, topic_prompt: args.p_topic_prompt, updated_at: new Date(Date.UTC(2026, 9, 17) + ++revision).toISOString() };
    return { data: [row] };
  },
};
const settings = load("lib/blog-generation/settings.ts", { "@/lib/supabase": { supabase: settingsDb }, "./models": models });
const api = load("app/api/blog/settings/route.ts", { "@/lib/supabase": { supabase: settingsDb }, "@/lib/blog-generation/settings": settings });
const put = body => api.PUT(new Request("http://fixture", { method: "PUT", body: JSON.stringify(body) }));
assert.equal((await (await api.GET()).json()).settings.topic_model, "gpt-6-luna");
for (const option of models.BLOG_MODEL_OPTIONS.openai) {
  const before = { ...row };
  assert.equal((await put({ ...row, topic_model: option.value, topic_prompt: " 새 내부 주제 기준 " })).status, 200);
  assert.equal(row.topic_model, option.value); assert.equal(row.topic_prompt, "새 내부 주제 기준");
  assert.equal((await put(before)).status, 409);
}
for (const patch of [{ topic_model: "invalid" }, { topic_model: "claude-sonnet-5-5" }, { topic_prompt: " " }, { topic_prompt: "x".repeat(30001) }, { updated_at: "invalid" }]) assert.equal((await put({ ...row, ...patch })).status, 400);
missing = true; assert.equal((await api.GET()).status, 500); missing = false;
fail = true; assert.equal((await api.GET()).status, 500); assert.equal((await put(row)).status, 500); fail = false;

const presets = load("lib/blog-generation/presets.ts");
const original = { ...presets.parseBlogPreset({ name: "정보형", system_prompt: "고정", title_prompt: "제목 기준", article_prompt: "본문 기준", target_chars: 1500, min_chars: 1200, max_chars: 1800 }), id: "12345678-1234-1234-1234-123456789abc" };
let stored = [{ ...original }];
const presetDb = { from(table) { assert.equal(table, "blog_prompt_presets"); let operation = "read", changes, id; return {
  select(fields) { assert.ok(fields === "id" || fields.includes("title_prompt")); return this; }, order() { return this; }, eq(key, value) { assert.equal(key, "id"); id = value; return this; },
  insert(value) { operation = "insert"; changes = value; return this; }, update(value) { operation = "update"; changes = value; return this; }, delete() { operation = "delete"; return this; },
  async single() { const item = { ...changes, id: "22345678-1234-1234-1234-123456789abc" }; stored.push(item); return { data: item }; },
  async maybeSingle() {
    const item = stored.find(row => row.id === id);
    if (!item) return { data: null };
    if (operation === "update") Object.assign(item, changes);
    if (operation === "delete") stored = stored.filter(row => row.id !== id);
    return { data: { ...item } };
  }, then(resolve) { return Promise.resolve({ data: stored }).then(resolve); },
}; } };
const mocks = { "@/lib/supabase": { supabase: presetDb }, "@/lib/blog-generation/presets": presets };
const list = load("app/api/blog/presets/route.ts", mocks), edit = load("app/api/blog/presets/[id]/route.ts", mocks), duplicate = load("app/api/blog/presets/[id]/duplicate/route.ts", mocks);
const context = { params: Promise.resolve({ id: original.id }) };
assert.equal((await (await list.GET()).json()).presets[0].title_prompt, "제목 기준");
assert.equal((await list.POST(new Request("http://fixture", { method: "POST", body: JSON.stringify({ ...original, title_prompt: "새 제목 기준" }) }))).status, 201);
assert.equal(stored.at(-1).title_prompt, "새 제목 기준");
assert.equal((await edit.PATCH(new Request("http://fixture", { method: "PATCH", body: JSON.stringify({ ...original, title_prompt: "수정한 제목" }) }), context)).status, 200);
assert.equal(stored[0].title_prompt, "수정한 제목");
const legacy = { ...original }; delete legacy.title_prompt;
assert.equal((await edit.PATCH(new Request("http://fixture", { method: "PATCH", body: JSON.stringify(legacy) }), context)).status, 200);
assert.equal(stored[0].title_prompt, "수정한 제목", "Old clients must not clear title_prompt");
assert.equal((await duplicate.POST(new Request("http://fixture"), context)).status, 201); assert.equal(stored.at(-1).title_prompt, "수정한 제목");
assert.equal((await edit.DELETE(new Request("http://fixture"), context)).status, 200);

let state = [], cursor = 0, finish, uiFail = false;
const hooks = { useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; } };
const form = load("app/content/blog/settings/SettingsForm.tsx", { react: hooks, "@/lib/blog-generation/models": models }).default;
const walk = node => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
const render = () => { cursor = 0; return form({ initial: row }); };
const oldFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => { assert.equal(url, "/api/blog/settings"); assert.equal(options.method, "PUT"); await new Promise(resolve => { finish = resolve; }); return uiFail ? Response.json({ error: "저장 실패" }, { status: 500 }) : put(JSON.parse(options.body)); };
try {
  const tree = render(), select = walk(tree).find(node => node.type === "select");
  assert.deepEqual(React.Children.toArray(select.props.children).map(node => ({ value: node.props.value, label: node.props.children })), models.BLOG_MODEL_OPTIONS.openai);
  select.props.onChange({ target: { value: "gpt-6-luna" } });
  walk(render()).find(node => node.type === "textarea").props.onChange({ target: { value: "UI의 짧은 주제 기준" } });
  const save = render().props.onSubmit({ preventDefault() {} }); assert.ok(renderToStaticMarkup(render()).includes("저장 중")); finish(); await save;
  assert.equal(row.topic_prompt, "UI의 짧은 주제 기준"); assert.ok(renderToStaticMarkup(render()).includes("저장 완료"));
  uiFail = true; const failed = render().props.onSubmit({ preventDefault() {} }); finish(); await failed; assert.ok(walk(render()).some(node => node.props?.role === "alert"));
} finally { globalThis.fetch = oldFetch; }
const presetHooks = { useRef: value => ({ current: value }), useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; } };
state = []; cursor = 0;
const presetForm = load("app/content/blog/[id]/BlogPresetControl.tsx", { react: presetHooks, "@/lib/blog-generation/presets": presets }).default;
const renderPreset = () => { cursor = 0; return presetForm({ initialPresets: [original], selectedId: original.id, disabled: false, onSelect() {}, onBusy() {} }); };
walk(renderPreset()).find(node => node.type === "button" && node.props.children === "편집").props.onClick();
const presetTree = renderPreset();
const textareas = walk(presetTree).filter(node => node.type === "textarea");
assert.equal(textareas.length, 5);
assert.equal(textareas[3].props.value, original.title_prompt);
assert.ok(renderToStaticMarkup(presetTree).includes("Topic은 글의 내부 기획 방향"));
textareas[3].props.onChange({ target: { value: "UI 제목 변경" } });
assert.equal(walk(renderPreset()).filter(node => node.type === "textarea")[3].props.value, "UI 제목 변경");
console.log("PASS: global Topic settings defaults/GET/PUT/shared models/validation/conflicts/UI, title_prompt create/read/update/duplicate/delete, old-client preservation, additive migration contracts; mock DB only.");
