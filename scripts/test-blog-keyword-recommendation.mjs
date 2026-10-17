import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

function load(path, mocks = {}) {
  const filename = resolve(path), compiled = new Module(filename), original = createRequire(filename);
  compiled.filename = filename;
  compiled.require = name => name in mocks ? mocks[name] : original(name);
  compiled._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return compiled.exports;
}
const shared = load("lib/blog-keywords/shared.ts");
let recommendationCriteria = "DB 추천 기준", recommendationModel = "gpt-6.1-sol";
let settingsReads = 0, criteriaVersion = 2;
const rows = Array.from({ length: 4753 }, (_, i) => ({
  id: `${String(i + 1).padStart(8, "0")}-0000-4000-8000-000000000001`, product_id: 1,
  keyword: `키워드 ${i}`, status: i === 0 ? "used" : i === 1 ? "excluded" : "unused",
  search_volume: i % 4 === 3 ? 1000000 + i : i > 4700 ? null : 5000 - i, competition: "높음",
  product_relevance_score: i % 29 === 0 ? null : [95, 85, 65, 20][i % 4],
  product_relevance_reason: `저장된 평가 이유 ${i}`,
  product_relevance_criteria_version: i % 31 === 0 ? 1 : i % 37 === 0 ? null : 2,
  created_at: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
}));
rows.push({ ...rows[2], id: "99999999-0000-4000-8000-000000000001", product_id: 2 });
const history = Array.from({ length: 40 }, (_, i) => ({ id: i, product_id: 1, keyword: `최근 글 ${i}`, topic: "주제".repeat(500), created_at: String(i).padStart(2, "0") }));
history.push({ id: 999, product_id: 2, keyword: "다른 Product", topic: "전달 금지", created_at: "99" });
const queries = [], writes = [];
let databaseFailure = false, productExists = true;
const db = { from(table) {
  const filters = [], orders = []; let head = false, start = 0, end = Infinity;
  const query = {
    select(fields, options) { assert.ok(!fields.includes("ad_count")); head = options?.head; queries.push({ table, fields, filters, orders, head }); return this; },
    eq(key, value) { filters.push(row => row[key] === value); return this; },
    not(key, operator, value) { assert.equal(operator, "is"); assert.equal(value, null); filters.push(row => row[key] !== null); return this; },
    gte(key, value) { filters.push(row => row[key] !== null && row[key] >= value); return this; },
    lt(key, value) { filters.push(row => row[key] !== null && row[key] < value); return this; },
    order(key, options = {}) { orders.push([key, options]); return this; },
    range(first, last) { start = first; end = last; assert.ok(last - first + 1 <= 50); return this; },
    limit(count) { end = count - 1; assert.ok(count <= 50); return this; },
    returns() { return this; },
    update(value) { writes.push(value); return this; }, insert(value) { writes.push(value); return this; },
    async maybeSingle() { return { data: productExists ? { id: 1, name: "윗잠베개", usp: "수면 자세", notes: "x".repeat(20000) } : null, error: databaseFailure ? {} : null }; },
    then(resolve) {
      let data = (table === "blog_keywords" ? rows : history).filter(row => filters.every(filter => filter(row)));
      data = [...data].sort((a, b) => {
        for (const [key, options] of orders) {
          if (a[key] === b[key]) continue;
          if (a[key] == null) return options.nullsFirst ? -1 : 1;
          if (b[key] == null) return options.nullsFirst ? 1 : -1;
          return (a[key] < b[key] ? -1 : 1) * (options.ascending === false ? -1 : 1);
        }
        return 0;
      });
      const count = data.length;
      if (!head) assert.ok(Number.isFinite(end), "Every data query must be bounded");
      return Promise.resolve({ data: head ? null : data.slice(start, end + 1), count, error: databaseFailure ? {} : null }).then(resolve);
    },
  };
  return query;
} };
let aiCalls = 0, mode = "valid", lastPrompt;
const provider = {
  missingProviderKey: () => null,
  async generateStructuredWithProvider(input) {
    assert.equal(input.model, recommendationModel);
    aiCalls++; lastPrompt = input; assert.ok(input.systemInstructions.includes(recommendationCriteria));
    if (mode === "failure") throw new Error("private upstream error");
    const context = JSON.parse(input.input);
    assert.ok(context.candidates.length <= 200 && context.candidates.length > 0);
    assert.ok(context.candidates.every(row => rows.some(source => source.id === row.id && source.product_id === 1 && source.status === "unused")));
    assert.ok(!input.input.includes("raw_data"));
    assert.ok(!input.input.includes("ad_count"));
    assert.ok(!input.systemInstructions.includes("ad_count") && !input.systemInstructions.includes("광고수"));
    assert.ok(context.candidates.every(row => Object.hasOwn(row, "competition") && Object.hasOwn(row, "searchVolume")));
    assert.ok(!Object.hasOwn(input.schema.properties.recommendations.items.properties, "relevanceScore"));
    assert.ok(!input.schema.properties.recommendations.items.required.includes("relevanceScore"));
    assert.ok(input.systemInstructions.includes("이 점수를 다시 평가하거나 수정하지 않는다"));
    for (const candidate of context.candidates) {
      const stored = rows.find(row => row.id === candidate.id);
      assert.equal(stored.product_relevance_criteria_version, criteriaVersion);
      assert.notEqual(stored.product_relevance_score, null);
      assert.equal(candidate.productRelevanceScore, stored.product_relevance_score);
      assert.equal(candidate.productRelevanceReason, stored.product_relevance_reason);
      assert.equal(candidate.searchVolume, stored.search_volume);
    }
    assert.equal(context.previousTasks.length, 30);
    assert.ok(context.previousTasks.every(task => task.keyword.startsWith("최근 글") && task.topic.length <= 500));
    const recommendations = context.candidates.slice(0, context.count).map(row => ({ keywordId: row.id, keyword: row.keyword, score: 85, opportunityScore: 75, searchIntent: "수면 습관이 궁금함", reason: "제품과 연결 가능", suggestedTopic: "옆잠과 얼굴 압박을 줄이는 수면 습관", suggestedAngle: "수면 자세 관점" }));
    if (mode === "unknown") recommendations[0].keywordId = rows[0].id;
    if (mode === "duplicate") recommendations[1] = recommendations[0];
    if (mode === "fabricated") recommendations[0].keyword = "임의 생성";
    if (mode === "score") recommendations[0].score = 101;
    if (mode === "missing") delete recommendations[0].reason;
    if (mode === "extra") recommendations[0].extra = true;
    if (mode === "relevance") recommendations[0].relevanceScore = 100;
    if (mode === "count") recommendations.pop();
    return { outputText: mode === "json" ? "invalid" : JSON.stringify({ recommendations }) };
  },
};
const recommendation = load("lib/blog-keywords/recommendation.ts", {
  "./ai-settings": { async readKeywordAISettings() { settingsReads++; return { relevance_version: criteriaVersion, recommendationModel, recommendation_criteria: recommendationCriteria }; } },
  "@/lib/supabase": { supabase: db }, "@/lib/ai/provider": provider,
  "@/lib/blog-generation/models": { BLOG_DEFAULT_MODELS: { openai: "existing-blog-default" } }, "./shared": shared,
});
const candidates = await recommendation.selectKeywordCandidates(1, criteriaVersion);
assert.ok(candidates.length >= 100 && candidates.length <= 200);
assert.ok(candidates.every(row => row.product_id === 1 && row.status === "unused"));
assert.ok(candidates.some(row => row.search_volume > 4900));
assert.ok(candidates.some(row => row.search_volume < 1000));
assert.ok(candidates.every(row => row.product_relevance_score >= 50 && row.product_relevance_criteria_version === criteriaVersion));
assert.ok(candidates.some(row => row.product_relevance_score >= 90));
assert.ok(candidates.some(row => row.product_relevance_score < 75));
assert.ok(!candidates.some(row => row.search_volume >= 1000000), "High volume must not promote very low relevance");
assert.deepEqual((await recommendation.selectKeywordCandidates(1, criteriaVersion)).map(row => row.id), candidates.map(row => row.id), "Prefilter is deterministic");
const initial = JSON.stringify(rows);
let validResult;
for (const count of [5, 10]) {
  const result = await recommendation.recommendKeywords(1, count);
  validResult ??= result;
  assert.equal(result.recommendations.length, count);
  assert.equal(result.candidateCount, candidates.length);
  for (const item of result.recommendations) assert.equal(item.relevanceScore, rows.find(row => row.id === item.keywordId).product_relevance_score);
  assert.ok(JSON.parse(lastPrompt.input).product.notes.length <= 2000);
  assert.ok(lastPrompt.systemInstructions.includes("SEO"));
}
for (mode of ["unknown", "duplicate", "fabricated", "score", "missing", "extra", "relevance", "count", "json", "failure"]) {
  await assert.rejects(() => recommendation.recommendKeywords(1, 5));
  assert.equal(JSON.stringify(rows), initial);
  assert.equal(writes.length, 0);
}
mode = "valid";
const route = load("app/api/blog/keywords/recommend/route.ts", { "@/lib/blog-keywords/recommendation": recommendation, "@/lib/blog-keywords/shared": shared });
const request = body => route.POST(new Request("http://fixture/api/blog/keywords/recommend", { method: "POST", body: JSON.stringify(body) }));
for (const body of [null, [], {}, { productId: 0 }, { productId: "1" }, { productId: 1, count: 20 }]) assert.equal((await request(body)).status, 400);
assert.equal((await request({ productId: 1, count: 5 })).status, 200);
productExists = false; assert.equal((await request({ productId: 1 })).status, 404); productExists = true;
databaseFailure = true; assert.equal((await request({ productId: 1 })).status, 500); databaseFailure = false;
mode = "failure"; const failed = await request({ productId: 1 }); assert.equal(failed.status, 502); assert.ok(!(await failed.text()).includes("private upstream")); mode = "valid";

mode = "valid"; recommendationCriteria = "변경한 DB 추천 기준"; recommendationModel = "gpt-6-astra";
await recommendation.recommendKeywords(1, 5);
assert.ok(lastPrompt.systemInstructions.includes(recommendationCriteria)); assert.ok(settingsReads > 1);

rows.forEach(row => { row.status = "used"; });
const beforeEmpty = aiCalls;
await assert.rejects(() => recommendation.recommendKeywords(1, 5), /현재 기준/);
assert.equal((await request({ productId: 1 })).status, 400);
rows.forEach(row => { row.product_relevance_score = 95; row.product_relevance_criteria_version = criteriaVersion - 1; });
await assert.rejects(() => recommendation.recommendKeywords(1, 10), /현재 기준/);
rows.forEach(row => { row.product_relevance_score = 95; row.product_relevance_criteria_version = null; });
await assert.rejects(() => recommendation.recommendKeywords(1, 5), /현재 기준/);
rows.forEach(row => { row.product_relevance_score = 20; row.product_relevance_criteria_version = criteriaVersion; });
await assert.rejects(() => recommendation.recommendKeywords(1, 5), /50점/);
rows.forEach(row => { row.product_relevance_score = 95; row.status = "used"; });
await assert.rejects(() => recommendation.recommendKeywords(1, 5));
assert.equal(aiCalls, beforeEmpty);
assert.equal(writes.length, 0);
let state = [], cursor = 0, fetchCalls = 0, failUi = false, uiResult = validResult;
const ui = load("app/content/blog/keywords/recommend/RecommendationForm.tsx", {
  react: { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; } },
  "next/link": { default: "a", __esModule: true }, "@/lib/blog-keywords/shared": shared,
}).default;
const walk = node => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
const render = () => { cursor = 0; return ui({ products: [{ id: 1, name: "윗잠베개" }, { id: 2, name: "다른 Product" }], initialProductId: "1" }); };
const oldFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  fetchCalls++; assert.equal(url, "/api/blog/keywords/recommend");
  assert.deepEqual(JSON.parse(options.body), { productId: 1, count: 5 });
  return failUi ? Response.json({ error: "추천 실패" }, { status: 502 }) : Response.json(uiResult);
};
try {
  let tree = render();
  assert.equal(fetchCalls, 0, "Rendering never triggers paid AI");
  assert.equal(walk(tree).find(node => node.props?.["aria-label"] === "추천 개수").props.value, "5");
  await walk(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  tree = render();
  const html = renderToStaticMarkup(tree);
  for (const label of ["검색량", "AI 종합 추천점수", "저장된 연관도(현재 기준)", "검색 의도", "추천 이유", "추천 주제", "추천 각도", "작업 생성"]) assert.ok(html.includes(label));
  const link = walk(tree).find(node => node.props?.href?.startsWith("/content/blog/new?"));
  const params = new URL(link.props.href, "http://fixture").searchParams;
  assert.equal(params.get("blogKeywordId"), validResult.recommendations[0].keywordId);
  assert.equal(params.get("topic"), validResult.recommendations[0].suggestedTopic);
  assert.equal(params.get("productId"), "1"); assert.equal(params.has("instructions"), false);
  failUi = true;
  await walk(tree).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  tree = render(); assert.ok(walk(tree).some(node => node.props?.role === "alert"));
  assert.ok(!walk(tree).some(node => node.props?.href?.startsWith("/content/blog/new?")), "Failure clears old results");
  walk(tree).find(node => node.props?.["aria-label"] === "추천 Product").props.onChange({ target: { value: "2" } });
  assert.ok(!walk(render()).some(node => node.props?.role === "alert"));
} finally { globalThis.fetch = oldFetch; }
console.log("PASS: current-only evaluated candidates, deterministic relevance/volume mix, DB score/reason input, server-owned relevanceScore and spoof rejection, zero/few candidates, stored recommendation model and display, bounded mixed-volume candidates, Product/status isolation, strict recommendation validation, read-only success/failure, API validation, no paid AI requests.");

const models = load("lib/blog-generation/models.ts");
const recommendationPage = load("app/content/blog/keywords/recommend/page.tsx", {
  "next/link": { default: "a", __esModule: true }, "./RecommendationForm": { default: () => null, __esModule: true },
  "@/lib/blog-generation/models": models,
  "@/lib/blog-keywords/ai-settings": { async readKeywordAISettings() { return { recommendationModel }; } },
  "@/lib/supabase": { supabase: { from() { return { select() { return this; }, async order() { return { data: [{ id: 1, name: "상품" }] }; } }; } } },
}).default;
for (const option of models.BLOG_MODEL_OPTIONS.openai) {
  recommendationModel = option.value;
  const tree = await recommendationPage({ searchParams: Promise.resolve({ productId: "1" }) });
  assert.ok(renderToStaticMarkup(tree).includes("현재 추천 모델: " + option.label));
  assert.equal(walk(tree).filter(node => node.type === "select").length, 0, "Execution page has no model picker");
}
