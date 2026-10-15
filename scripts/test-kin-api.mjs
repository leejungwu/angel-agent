import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

function load(file, mocks = {}) {
  const filename = resolve(file), compiled = new Module(filename);
  compiled.filename = filename;
  const require = compiled.require.bind(compiled);
  compiled.require = name => name in mocks ? mocks[name] : require(name);
  compiled._compile(ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  return compiled.exports;
}
const generate = load("lib/kin/generate.ts");
const presets = load("lib/kin/presets.ts", { "./generate": generate });
const prompts = load("lib/kin/prompts.ts");
const mention = load("lib/kin/mention-validation.ts");
const quality = load("lib/kin/quality-check.ts");
const id = n => `${String(n).padStart(8, "0")}-1234-1234-1234-123456789abc`;
const data = { kin_prompt_settings: [{ id: true, system_prompt: "편집 가능한 시스템", common_style_prompt: "편집 가능한 스타일" }],
  products: [{ id: 1, name: "윗잠베개", brand: "Angel", usp: "확인된 특징" }], voc_analysis_runs: [],
  kin_prompt_presets: [], kin_tasks: [{ id: id(1), question: "이전 질문" }, { id: id(2), question: "다른 질문" }],
  kin_drafts: [
    { id: id(3), kin_task_id: id(1), answer: "이전 답변", question_intent: null, provider: null, model: "old-model", created_at: "2026-10-14T00:00:00Z" },
    { id: id(4), kin_task_id: id(2), answer: "다른 Task 답변", created_at: "2026-10-15T00:00:00Z" },
  ] };
let sequence = 100;
const writes = [], calls = [];
const db = { from(table) {
  let operation = "read", changes, limit = Infinity;
  const filters = [], order = [];
  function run(single) {
    let rows = data[table].filter(row => filters.every(([key, value]) => row[key] === value));
    if (operation === "insert") {
      const row = { ...structuredClone(changes), id: id(sequence++), created_at: new Date().toISOString() };
      data[table].push(row); rows = [row];
    }
    if (operation === "update") rows.forEach(row => Object.assign(row, structuredClone(changes)));
    if (operation === "delete") rows.forEach(row => data[table].splice(data[table].indexOf(row), 1));
    if (operation !== "read") writes.push({ table, operation, changes });
    rows = [...rows].sort((a, b) => {
      for (const [key, ascending] of order) { const comparison = String(a[key]).localeCompare(String(b[key])); if (comparison) return ascending ? comparison : -comparison; }
      return 0;
    }).slice(0, limit);
    return { data: structuredClone(single ? rows[0] ?? null : rows), error: null };
  }
  return { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
    order(key, options) { order.push([key, options?.ascending !== false]); return this; }, limit(value) { limit = value; return this; },
    insert(value) { operation = "insert"; changes = value; return this; }, update(value) { operation = "update"; changes = value; return this; },
    delete() { operation = "delete"; return this; }, async single() { return run(true); }, async maybeSingle() { return run(true); }, then(resolve) { resolve(run(false)); } };
} };
const mocks = { "@/lib/supabase": { supabase: db }, "@/lib/kin/generate": generate, "@/lib/kin/presets": presets,
  "@/lib/kin/prompts": prompts, "@/lib/kin/mention-validation": mention, "@/lib/kin/quality-check": quality };
const settings = load("app/api/kin/prompt-settings/route.ts", mocks);
const history = load("app/api/kin/tasks/[id]/drafts/route.ts", mocks);
const presetList = load("app/api/kin/presets/route.ts", mocks);
const presetItem = load("app/api/kin/presets/[id]/route.ts", mocks);
const presetCopy = load("app/api/kin/presets/[id]/duplicate/route.ts", mocks);
let answer = { answer: "일반적인 정보를 설명합니다. ".repeat(25), questionIntent: "관리 방법에 관한 질문입니다.", productMentioned: false };
class APIError extends Error {}
class OutputError extends Error {}
const route = load("app/api/kin/generate/route.ts", { ...mocks,
  openai: { APIError }, "@anthropic-ai/sdk": { APIError },
  "@/lib/kin/provider": { isKinProvider: value => ["openai", "anthropic", "xai"].includes(value), missingKinProviderKey: () => null,
    KinProviderOutputError: OutputError, generateKinWithProvider: async input => { calls.push(input); return { outputText: JSON.stringify(answer), provider: input.provider, model: "returned-model" }; } },
});
const request = value => new Request("http://localhost/api/kin", { method: "POST", body: JSON.stringify(value) });
const context = value => ({ params: Promise.resolve({ id: value }) });
assert.equal((await settings.GET()).status, 200);
assert.equal((await settings.PATCH(request({ system_prompt: " ", common_style_prompt: "" }))).status, 400);
assert.equal((await settings.PATCH(request({ system_prompt: "새 시스템", common_style_prompt: "새 스타일" }))).status, 200);
assert.equal((await (await settings.GET()).json()).settings.system_prompt, "새 시스템");
const config = { name: "스타일", instructions: "프리셋 문체", min_chars: 500, max_chars: 900, paragraph_count: 3, default_product_mention_level: "relevant" };
assert.equal((await presetList.POST(request({ ...config, min_chars: 199 }))).status, 400);
assert.equal((await presetList.POST(request({ ...config, max_chars: 1501 }))).status, 400);
const preset = (await (await presetList.POST(request(config))).json()).preset;
assert.equal((await presetItem.PATCH(request({ ...config, instructions: "변경한 문체" }), context(preset.id))).status, 200);
assert.equal((await presetList.GET()).status, 200);
const copied = (await (await presetCopy.POST(request({ instructions: "무시" }), context(preset.id))).json()).preset;
assert.equal(copied.instructions, "변경한 문체"); assert.equal(copied.is_default, false);
const response = await route.POST(request({ question: "관리 방법 질문", presetId: preset.id, instructions: "이번 질문 지시" }));
assert.equal(response.status, 200);
const result = await response.json(), input = JSON.parse(calls.at(-1).input);
assert.equal(input.commonPrompt.systemPrompt, "새 시스템");
assert.equal(input.commonPrompt.commonStylePrompt, "새 스타일");
assert.equal(input.preset.instructions, "변경한 문체");
assert.equal(input.additionalInstructions, "이번 질문 지시");
assert.deepEqual(JSON.parse(calls.at(-1).systemInstructions).instructionPriority, ["output_schema", "additionalInstructions", "preset", "commonPrompt"]);
const saved = data.kin_drafts.find(draft => draft.id === result.draftId);
assert.equal(saved.question_intent, answer.questionIntent); assert.equal(saved.provider, "openai");
const snapshot = structuredClone(data.kin_tasks.find(task => task.id === result.taskId).preset_config_snapshot);
await presetItem.DELETE(request({}), context(preset.id));
assert.deepEqual(data.kin_tasks.find(task => task.id === result.taskId).preset_config_snapshot, snapshot);
assert.equal((await route.POST(request({ taskId: result.taskId }))).status, 200, "Preset deletion does not break Task snapshot regeneration");
assert.equal(JSON.parse(calls.at(-1).input).preset.instructions, "변경한 문체");
const existingTask = data.kin_tasks.find(task => task.id === result.taskId);
existingTask.preset_config_snapshot.min_chars = 199;
assert.equal((await route.POST(request({ taskId: result.taskId }))).status, 409);
existingTask.preset_config_snapshot = snapshot;
const commonRows = data.kin_prompt_settings;
data.kin_prompt_settings = [];
const beforeMissingCommon = calls.length;
assert.equal((await settings.GET()).status, 500);
assert.equal((await route.POST(request({ question: "질문" }))).status, 500);
assert.equal(calls.length, beforeMissingCommon, "Missing common prompts must not fall back to hidden constants");
data.kin_prompt_settings = commonRows;
const failure = async (productMentionLevel, text, flag, productId = 1) => {
  const count = data.kin_drafts.length;
  answer = { ...answer, answer: text + " 정보를 설명합니다.".repeat(30), productMentioned: flag };
  const response = await route.POST(request({ question: "질문", productId, productMentionLevel }));
  assert.equal(response.status, 500); assert.equal(data.kin_drafts.length, count);
  assert.match((await response.json()).error, /제품 언급 정책/);
};
await failure("direct", "일반 정보", false);
await failure("none", "윗잠베개", false);
await failure("none", "Angel", true);
await failure("relevant", "윗잠베개", false);
await failure("relevant", "일반 정보", true, null);
answer = { ...answer, answer: "윗잠베개 " + " 정보를 설명합니다.".repeat(30), productMentioned: true };
assert.equal((await route.POST(request({ question: "질문", productId: 1, productMentionLevel: "direct" }))).status, 200);
assert.equal((await history.GET(request({}), context("bad"))).status, 400);
assert.equal((await history.GET(request({}), context(id(999)))).status, 404);
const historical = await (await history.GET(request({}), context(id(1)))).json();
assert.equal(historical.drafts.length, 1); assert.equal(historical.drafts[0].answer, "이전 답변");
assert.equal(historical.drafts[0].question_intent, null);
const current = await (await history.GET(request({}), context(result.taskId))).json();
assert.equal(current.drafts.length, 2); assert.equal(current.drafts[0].model, "returned-model");
assert.ok(writes.every(write => !["blog_tasks", "blog_drafts"].includes(write.table)));
console.log("PASS: common prompt read/save/generation, priority, preset CRUD/duplicate and snapshot regeneration, mention hard failure/no save, Task-scoped draft history/old fallback");
