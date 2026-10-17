import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import React from "react";

function load(path, mocks = {}) {
  const filename = resolve(path), compiled = new Module(filename), original = createRequire(filename);
  compiled.filename = filename; compiled.require = name => name in mocks ? mocks[name] : original(name);
  compiled._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return compiled.exports;
}
const product = { id: 2, name: "상품", brand: "브랜드", usp: "USP", target_customer: "대상", customer_problem: "고민", notes: "메모" };
const draft = { title: "제목", intro: "도입", sections: [{ heading: "소제목", body: "본문", imageAssetId: null }], closing: "마무리" };
const generatedTopic = "팔자주름이 생기는 주요 원인과 일상에서 관리할 수 있는 생활습관";
let topicOutput = { topic: generatedTopic }, providerFailure = false, missingKey = false;
const calls = [];
let topicSettings = { topic_model: "gpt-6-luna", topic_prompt: "DB 기준: 주된 검색 의도를 바탕으로 짧은 내부 주제를 정한다." }, settingReads = 0;
const settingsMock = { readBlogSettings: async () => { settingReads++; return { ...topicSettings }; }, BlogSettingsError: class extends Error {} };
const provider = {
  isAIProvider: value => ["openai", "anthropic", "xai"].includes(value),
  ProviderOutputError: class extends Error {}, missingProviderKey: () => missingKey ? "OPENAI_API_KEY" : null,
  async generateStructuredWithProvider(input) {
    calls.push(input);
    if (providerFailure) throw new Error("private upstream failure");
    if (input.schemaName === "blog_topic") {
      assert.equal(input.provider, "openai"); assert.equal(input.model, topicSettings.topic_model);
      assert.deepEqual(input.schema.required, ["topic"]); assert.equal(input.schema.additionalProperties, false);
      const context = JSON.parse(input.input);
      assert.ok(!Object.hasOwn(context.product, "id")); assert.ok(!Object.hasOwn(context, "productId"));
      assert.ok(input.systemInstructions.includes(topicSettings.topic_prompt));
      assert.ok(!input.systemInstructions.includes("10~50"), "Writing preference belongs only in DB prompt");
      return { outputText: topicOutput === "invalid-json" ? "bad" : JSON.stringify(topicOutput), model: "returned-luna", provider: "openai" };
    }
    return { outputText: JSON.stringify(draft), model: "returned-body", provider: input.provider };
  },
};
const topic = load("lib/blog-generation/topic.ts", { "@/lib/ai/provider": provider, "./settings": settingsMock });
for (const text of ["한 글 주제", "x".repeat(60), "x".repeat(300)]) assert.equal(topic.parseTopicOutput({ topic: ` ${text} ` }), text);
for (const value of [null, [], {}, { topic: " " }, { topic: "x".repeat(301) }, { topic: 1 }, { topic: "주제", id: "ignored" }]) assert.throws(() => topic.parseTopicOutput(value));
assert.deepEqual(await topic.generateBlogTopic(product, " 팔자주름원인 ", " 이번 글 지시 "), { topic: generatedTopic, model: "returned-luna" });
assert.equal(JSON.parse(calls.at(-1).input).instructions, "이번 글 지시");
topicSettings = { topic_model: "gpt-6-astra", topic_prompt: "바뀐 DB Topic 기준" };
await topic.generateBlogTopic(product, "keyword");
assert.equal(calls.at(-1).model, "gpt-6-astra"); assert.ok(settingReads >= 2);
for (topicOutput of [{ topic: " " }, { topic: "x".repeat(301) }, { topic: "주제", extra: true }, "invalid-json"]) await assert.rejects(() => topic.generateBlogTopic(product, "keyword"));
topicOutput = { topic: generatedTopic };
missingKey = true; await assert.rejects(() => topic.generateBlogTopic(product, "keyword"), /OPENAI_API_KEY/); missingKey = false;

let productMissing = false;
const api = load("app/api/blog/topics/generate/route.ts", { "@/lib/blog-generation/topic": topic, "@/lib/supabase": { supabase: {
  from(table) { assert.equal(table, "products"); return { select(fields) { assert.equal(fields, "name,brand,usp,target_customer,customer_problem,notes"); return this; }, eq(key, value) { assert.equal(key, "id"); assert.equal(value, 2); return this; }, async maybeSingle() { return { data: productMissing ? null : product }; } }; },
} } });
const postTopic = body => api.POST(new Request("http://fixture", { method: "POST", body: JSON.stringify(body) }));
assert.deepEqual(await (await postTopic({ productId: 2, keyword: "원인", instructions: "지시" })).json(), { topic: generatedTopic, model: "returned-luna" });
for (const body of [null, [], {}, { productId: "2", keyword: "k" }, { productId: 2, keyword: " " }, { productId: 2, keyword: "k", instructions: null }, { productId: 2, keyword: "k", product: { name: "위조" } }]) assert.equal((await postTopic(body)).status, 400);
productMissing = true; assert.equal((await postTopic({ productId: 2, keyword: "k" })).status, 404); productMissing = false;
providerFailure = true;
const failedTopic = await postTopic({ productId: 2, keyword: "k" }); assert.equal(failedTopic.status, 502); assert.ok(!(await failedTopic.text()).includes("private upstream")); providerFailure = false;

const topicRequest = load("lib/blog-generation/topic-request.ts");
const oldFetch = globalThis.fetch;
let fetches = 0, clientFailure = false;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/blog/topics/generate"); fetches++;
  return clientFailure ? Response.json({ error: "주제 생성 실패" }, { status: 502 }) : postTopic(JSON.parse(options.body));
};
try {
  for (const keyword of ["keyword", ""]) assert.equal(await topicRequest.resolveTaskTopic(2, keyword, " 직접 입력 ", ""), "직접 입력");
  assert.equal(fetches, 0);
  await assert.rejects(() => topicRequest.resolveTaskTopic(2, "keyword", "x".repeat(301), ""), /300자/);
  await assert.rejects(() => topicRequest.resolveTaskTopic(2, " ", " ", ""), /키워드 또는 주제/); assert.equal(fetches, 0);
  assert.equal(await topicRequest.resolveTaskTopic(2, "keyword", "", "지시"), generatedTopic); assert.equal(fetches, 1);
  clientFailure = true; await assert.rejects(() => topicRequest.resolveTaskTopic(2, "keyword", "", ""), /주제 생성 실패/); clientFailure = false;

  // Real edit form: generated topic enters its normal task-only update, never drafts/status.
  let state = [], cursor = 0, updates = [];
  const hooks = { useRef: value => ({ current: value }), useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => { state[i] = value; }]; } };
  const edit = load("app/content/blog/[id]/EditBlogTask.tsx", { react: hooks, "next/navigation": { useRouter: () => ({ refresh() {} }) }, "@/lib/blog-generation/topic-request": topicRequest,
    "@/lib/supabase": { supabase: { from(table) { assert.equal(table, "blog_tasks"); let value; return { update(changes) { value = changes; updates.push(changes); return this; }, eq(key, id) { assert.equal(key, "id"); assert.equal(id, 7); return this; }, select() { return this; }, single() { return this; }, async returns() { return { data: value }; } }; } } },
  }).default;
  const walk = node => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
  const render = () => { cursor = 0; return edit({ taskId: 7, productId: 2, initialFields: { keyword: "원인", topic: "", instructions: "지시" } }); };
  walk(render()).find(node => node.type === "button").props.onClick();
  await walk(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.deepEqual(updates, [{ keyword: "원인", topic: generatedTopic, instructions: "지시" }]);
  const oldAlert = globalThis.alert; globalThis.alert = () => {};
  try {
    for (const [keyword, enteredTopic, fail] of [["원인", "직접 주제", false], ["", "주제 중심", false], ["", "", false], ["원인", "", true]]) {
      state = []; updates = []; clientFailure = fail;
      walk(render()).find(node => node.type === "button").props.onClick();
      walk(render()).filter(node => node.type === "input")[0].props.onChange({ target: { value: keyword } });
      walk(render()).filter(node => node.type === "input")[1].props.onChange({ target: { value: enteredTopic } });
      const before = fetches;
      await walk(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
      assert.equal(updates.length, enteredTopic && !fail ? 1 : 0);
      if (enteredTopic) { assert.equal(updates[0].topic, enteredTopic); assert.equal(fetches, before); }
    }
  } finally { globalThis.alert = oldAlert; clientFailure = false; }

} finally { globalThis.fetch = oldFetch; }

const presets = load("lib/blog-generation/presets.ts"), models = load("lib/blog-generation/models.ts");
const preset = { ...presets.parseBlogPreset({ name: "기본", system_prompt: "시스템", strategy_prompt: "전략", style_prompt: "문체", article_prompt: "전개", target_chars: 1600, min_chars: 1400, max_chars: 1800, section_count: 3, keyword_min: 0, keyword_max: 3 }), id: "12345678-1234-1234-1234-123456789abc" };
const snapshots = load("lib/blog-generation/snapshot.ts", { "./presets": presets });
let task = { id: 7, product_id: 2, keyword: "원인", topic: "직접 입력", instructions: "추가 지시", preset_id: preset.id };
let failTopicSave = false, conflict = false;
const writes = [];
const db = { from(table) {
  let changes, operation = "read"; const filters = {};
  return {
    select() { return this; }, eq(key, value) { filters[key] = value; return this; }, is(key, value) { filters[key] = value; return this; }, order() { return this; }, limit() { return this; },
    update(value) { changes = value; operation = "update"; return this; }, insert(value) { changes = value; operation = "insert"; return this; },
    async maybeSingle() {
      if (operation === "update") {
        if (Object.hasOwn(changes, "topic") && failTopicSave) return { data: null, error: {} };
        if (conflict || !Object.entries(filters).every(([key, value]) => task[key] === value)) return { data: null };
        writes.push({ table, changes }); Object.assign(task, changes); return { data: { ...task } };
      }
      return { data: table === "blog_tasks" ? { ...task } : table === "products" ? product : preset };
    },
    async single() { writes.push({ table, changes }); return { data: { id: 9, created_at: "2026-10-17" } }; },
  };
} };
const generation = load("app/api/blog/generate/route.ts", { "@/lib/ai/provider": provider, "@/lib/blog-generation/topic": topic,
  "@/lib/blog-generation/schema": load("lib/blog-generation/schema.ts"), "@/lib/blog-generation/prompts": load("lib/blog-generation/prompts.ts"),
  "@/lib/blog-generation/body": load("lib/blog-generation/body.ts"), "@/lib/blog-generation/models": models, "@/lib/blog-generation/presets": presets,
  "@/lib/blog-generation/snapshot": snapshots, "@/lib/supabase": { supabase: db },
});
const generate = () => generation.POST(new Request("http://fixture", { method: "POST", body: JSON.stringify({ taskId: 7, provider: "anthropic" }) }));
calls.length = 0;
assert.equal((await generate()).status, 200); assert.equal(calls.filter(call => call.schemaName === "blog_topic").length, 0);
for (const blank of [null, "", "   "]) {
  task.topic = blank; calls.length = 0; writes.length = 0;
  const response = await generate(); assert.equal(response.status, 200);
  assert.equal(task.topic, generatedTopic); assert.equal(calls.filter(call => call.schemaName === "blog_topic").length, 1);
  assert.equal(JSON.parse(calls.at(-1).input).task.topic, generatedTopic);
  assert.equal((await response.json()).generationSnapshot.task.topic, generatedTopic);
  assert.equal(writes.find(write => write.table === "blog_drafts").changes.generation_snapshot.task.topic, generatedTopic);
  const beforeSettingsRead = settingReads; topicSettings = { ...topicSettings, topic_prompt: "다시 변경한 설정" };
  await generate(); assert.equal(settingReads, beforeSettingsRead); assert.equal(task.topic, generatedTopic);
  assert.equal(calls.filter(call => call.schemaName === "blog_topic").length, 1, "Regeneration reuses persisted topic even after settings change");
}
task.topic = ""; task.keyword = " "; calls.length = 0; writes.length = 0;
assert.equal((await generate()).status, 400); assert.equal(calls.length, 0); assert.equal(writes.length, 0);
task.keyword = "원인"; providerFailure = true;
assert.equal((await generate()).status, 502); assert.equal(task.topic, ""); assert.equal(writes.length, 0); providerFailure = false;
for (topicOutput of [{ topic: "" }, { topic: "x".repeat(301) }, { topic: "주제", extra: true }]) {
  calls.length = 0; assert.equal((await generate()).status, 502); assert.equal(task.topic, ""); assert.equal(writes.length, 0); assert.equal(calls.length, 1);
}
topicOutput = { topic: generatedTopic }; failTopicSave = true; calls.length = 0;
assert.equal((await generate()).status, 500); assert.equal(calls.length, 1); assert.equal(task.topic, ""); assert.equal(writes.length, 0); failTopicSave = false;
conflict = true; assert.equal((await generate()).status, 409); assert.equal(writes.length, 0);
console.log("PASS: strict topic schema/300-char validation, trusted Product API, Luna-only transport, supplied-topic bypass, edit task-only save, legacy blank-topic persistence/prompt/snapshot/reuse, empty/failure/conflict stops; no real AI or DB.");
