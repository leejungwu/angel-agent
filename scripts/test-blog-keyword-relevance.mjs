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
const shared = load("lib/blog-keywords/shared.ts");
const filtersModule = load("lib/blog-keywords/relevance-filter.ts");
let settingsVersion = 1, settingsReads = 0;
const settingsMock = { async readKeywordAISettings() { settingsReads++; return { relevance_version: settingsVersion, relevance_criteria: "DB 연관도 기준" }; } };
const rows = Array.from({ length: 4753 }, (_, i) => ({
  id: `${String(i + 1).padStart(8, "0")}-0000-4000-8000-000000000001`, product_id: i === 0 ? 2 : 1,
  keyword: `키워드 ${i}`, status: ["unused", "used", "excluded"][i % 3], search_volume: i === 2 ? null : 10000 - i,
  product_relevance_score: i === 1 ? 95 : null, product_relevance_criteria_version: i === 1 ? 1 : null,
}));
let productExists = true, failSave = false, failAiAt = 0, invalidMode = "", missingKey = false;
const requests = [], saves = [], limits = [];
let saveTime = 0, changeCriteriaOnAI = false;
const db = {
  from(table) {
    const filters = []; let ordering = [], limit;
    return {
      select() { return this; }, eq(key, value) { filters.push(row => row[key] === value); return this; },
      is(key, value) { filters.push(row => row[key] === value); return this; },
      not(key, operator, value) { assert.equal(operator, "is"); assert.equal(value, null); filters.push(row => row[key] !== null); return this; },
      or(expression) { assert.ok([filtersModule.pendingRelevanceFilter(settingsVersion), filtersModule.staleRelevanceFilter(settingsVersion)].includes(expression)); filters.push(row => (expression === filtersModule.pendingRelevanceFilter(settingsVersion) && row.product_relevance_score === null) || row.product_relevance_criteria_version !== settingsVersion); return this; },
      order(key, options) { ordering.push([key, options]); return this; },
      limit(value) { limit = value; limits.push(value); assert.ok([50, 100, 200].includes(value)); return this; }, returns() { return this; },
      async maybeSingle() { assert.equal(table, "products"); return { data: productExists ? { id: 1, name: "윗잠베개", usp: "수면 습관" } : null }; },
      then(resolve) {
        assert.ok([50, 100, 200].includes(limit));
        if (ordering[0][0] === "product_relevance_evaluated_at") assert.deepEqual(ordering[0], ["product_relevance_evaluated_at", { ascending: true, nullsFirst: true }]);
        else assert.deepEqual(ordering[0], ["search_volume", { ascending: false, nullsFirst: false }]);
        const data = rows.filter(row => filters.every(filter => filter(row))).sort((a, b) => {
          for (const [key, options = {}] of ordering) {
            if (a[key] === b[key]) continue;
            if (a[key] == null) return options.nullsFirst ? -1 : 1;
            if (b[key] == null) return options.nullsFirst ? 1 : -1;
            return (a[key] < b[key] ? -1 : 1) * (options.ascending === false ? -1 : 1);
          }
          return 0;
        }).slice(0, limit);
        return Promise.resolve({ data }).then(resolve);
      },
    };
  },
  async rpc(name, args) {
    assert.equal(name, "save_versioned_blog_keyword_relevance"); assert.equal(args.p_criteria_version, settingsVersion); assert.equal(args.p_product_id, 1);
    assert.ok(args.p_rows.length <= 50); assert.equal(args.p_model, "openai:mock-model");
    if (failSave) return { error: {} };
    saves.push(args);
    let affected = 0;
    for (const result of args.p_rows) {
      const row = rows.find(row => row.id === result.keywordId && row.product_id === 1 && (args.p_reevaluate ? row.product_relevance_score !== null && row.product_relevance_criteria_version === settingsVersion : row.product_relevance_score === null || row.product_relevance_criteria_version !== settingsVersion));
      if (row) { Object.assign(row, { product_relevance_score: result.score, product_relevance_criteria_version: args.p_criteria_version, product_relevance_reason: result.reason, product_relevance_model: args.p_model, product_relevance_evaluated_at: new Date(Date.UTC(2026, 9, 17) + saveTime++).toISOString() }); affected++; }
    }
    return { data: affected };
  },
};
const provider = {
  missingProviderKey: () => missingKey ? "OPENAI_API_KEY" : null,
  async generateStructuredWithProvider(input) {
    requests.push(input);
    if (changeCriteriaOnAI) { settingsVersion++; changeCriteriaOnAI = false; }
    if (failAiAt === requests.length) throw new Error("private upstream text");
    const context = JSON.parse(input.input);
    assert.ok(input.systemInstructions.includes("DB 연관도 기준"));
    assert.ok(!input.systemInstructions.includes("90~100"), "Configurable rubric is not duplicated in code");
    assert.ok(context.keywords.length <= 50);
    assert.ok(!input.input.includes("search_volume") && !input.input.includes("ad_count") && !input.input.includes("competition"));
    assert.ok(context.keywords.every(row => Object.keys(row).sort().join(",") === "id,keyword"));
    const evaluations = context.keywords.map(row => ({ keywordId: row.id, score: 80, reason: "수면 습관 관점에서 자연스럽게 연결 가능" }));
    if (invalidMode === "missing") evaluations.pop();
    if (invalidMode === "duplicate") evaluations[1] = evaluations[0];
    if (invalidMode === "unknown") evaluations[0].keywordId = rows[0].id;
    if (invalidMode === "score") evaluations[0].score = 101;
    if (invalidMode === "fraction") evaluations[0].score = 80.5;
    if (invalidMode === "extra") evaluations[0].keyword = "생성 금지";
    return { outputText: invalidMode === "json" ? "bad" : JSON.stringify({ evaluations }), model: "mock-model" };
  },
};
const relevance = load("lib/blog-keywords/relevance.ts", { "@/lib/supabase": { supabase: db }, "@/lib/ai/provider": provider, "@/lib/blog-generation/models": { BLOG_DEFAULT_MODELS: { openai: "existing-default" } }, "./shared": shared, "./ai-settings": settingsMock, "./relevance-filter": filtersModule });
for (const score of [0, 100]) assert.equal(relevance.validateRelevanceOutput({ evaluations: [{ keywordId: rows[3].id, score, reason: "설명" }] }, [rows[3]])[0].score, score);
for (const score of [-1, 101, NaN, null, "80", 80.5]) assert.throws(() => relevance.validateRelevanceOutput({ evaluations: [{ keywordId: rows[3].id, score, reason: "설명" }] }, [rows[3]]));
for (const reason of [" ", "x".repeat(501), null]) assert.throws(() => relevance.validateRelevanceOutput({ evaluations: [{ keywordId: rows[3].id, score: 80, reason }] }, [rows[3]]));
const selectionSnapshot = rows.map(row => ({ ...row }));
settingsVersion = 2;
rows.forEach(row => { row.product_relevance_score = 90; row.product_relevance_criteria_version = 2; });
rows[3].product_relevance_score = null;
rows[4].product_relevance_criteria_version = 1;
rows[5].product_relevance_criteria_version = null;
for (const [target, expectedIds] of [[undefined, [rows[3].id]], ["unevaluated", [rows[3].id]], ["stale", [rows[4].id, rows[5].id]], ["pending", [rows[3].id, rows[4].id, rows[5].id]]]) {
  requests.length = 0; saves.length = 0;
  const beforeSelection = rows.map(row => ({ ...row }));
  const selected = await relevance.evaluateProductRelevance(1, 50, false, target);
  assert.equal(selected.selected, expectedIds.length, String(target));
  assert.deepEqual(saves.flatMap(save => save.p_rows.map(row => row.keywordId)).sort(), [...expectedIds].sort());
  rows.forEach((row, i) => Object.assign(row, beforeSelection[i]));
}
for (const target of ["all", "", null, 1]) await assert.rejects(() => relevance.evaluateProductRelevance(1, 50, false, target));
rows.forEach((row, i) => Object.assign(row, selectionSnapshot[i]));
settingsVersion = 1;
requests.length = 0; saves.length = 0;
const statuses = rows.map(row => row.status);
const beforeSettingsReads = settingsReads;
const first = await relevance.evaluateProductRelevance(1, 200);
assert.equal(settingsReads - beforeSettingsReads, 1, "All four batches share one criteria snapshot");
assert.equal(first.evaluated, 200); assert.equal(first.selected, 200); assert.equal(requests.length, 4); assert.equal(saves.length, 4);
assert.ok(!saves.flatMap(batch => batch.p_rows).some(row => [rows[0].id, rows[1].id, rows[2].id].includes(row.keywordId)));
assert.equal(rows[0].product_relevance_score, null); assert.equal(rows[1].product_relevance_score, 95);
assert.deepEqual(rows.map(row => row.status), statuses);
const firstIds = new Set(saves.flatMap(batch => batch.p_rows.map(row => row.keywordId)));
requests.length = 0; saves.length = 0;
await relevance.evaluateProductRelevance(1, 200);
assert.ok(saves.flatMap(batch => batch.p_rows).every(row => !firstIds.has(row.keywordId)));
for (const size of [undefined, 50, 100, 200]) {
  requests.length = 0; saves.length = 0;
  const expected = size ?? 50;
  const result = await relevance.evaluateProductRelevance(1, size);
  assert.equal(result.selected, expected); assert.equal(result.evaluated, expected);
  assert.equal(limits.at(-1), expected); assert.equal(requests.length, expected / 50);
  assert.equal(saves.length, expected / 50);
}
for (const size of [0, 25, 51, 201, 500, "50", null, NaN, 50.5]) {
  const count = requests.length;
  await assert.rejects(() => relevance.evaluateProductRelevance(1, size));
  assert.equal(requests.length, count);
}
for (invalidMode of ["missing", "duplicate", "unknown", "score", "fraction", "extra", "json"]) {
  const before = JSON.stringify(rows), saved = saves.length;
  const result = await relevance.evaluateProductRelevance(1, 200);
  assert.ok(result.error); assert.equal(result.evaluated, 0); assert.equal(saves.length, saved); assert.equal(JSON.stringify(rows), before);
}
invalidMode = ""; requests.length = 0; saves.length = 0; failAiAt = 2;
const partial = await relevance.evaluateProductRelevance(1, 200);
assert.equal(partial.evaluated, 50); assert.ok(partial.error); assert.equal(requests.length, 2); assert.equal(saves.length, 1);
assert.ok(!partial.error.includes("private upstream"));
failAiAt = 0; failSave = true;
assert.ok((await relevance.evaluateProductRelevance(1, 200)).error); failSave = false;
missingKey = true; await assert.rejects(() => relevance.evaluateProductRelevance(1, 200)); missingKey = false;
productExists = false; await assert.rejects(() => relevance.evaluateProductRelevance(1, 200)); productExists = true;
const api = load("app/api/blog/keywords/relevance/route.ts", { "@/lib/blog-keywords/relevance-filter": filtersModule, "@/lib/blog-keywords/relevance": relevance, "@/lib/blog-keywords/shared": shared });
const forwarded = [];
const forwardingApi = load("app/api/blog/keywords/relevance/route.ts", { "@/lib/blog-keywords/relevance-filter": filtersModule, "@/lib/blog-keywords/shared": shared, "@/lib/blog-keywords/relevance": { async evaluateProductRelevance(...args) { forwarded.push(args); return { selected: 0, evaluated: 0, skipped: 0 }; } } });
for (const target of [undefined, "unevaluated", "stale", "pending"]) {
  assert.equal((await forwardingApi.POST(new Request("http://fixture", { method: "POST", body: JSON.stringify({ productId: 1, ...(target ? { target } : {}) }) }))).status, 200);
  assert.deepEqual(forwarded.at(-1), [1, 50, false, target ?? "unevaluated"]);
}
const post = body => api.POST(new Request("http://fixture/relevance", { method: "POST", body: JSON.stringify(body) }));
for (const body of [null, [], {}, { productId: 0 }, { productId: "1" }, { productId: 1, limit: 4753 }, ...[0, 25, 201, 500, "50", null, 50.5].map(batchSize => ({ productId: 1, batchSize }))]) assert.equal((await post(body)).status, 400);
for (const batchSize of [undefined, 50, 100, 200]) {
  requests.length = 0;
  const response = await post({ productId: 1, ...(batchSize === undefined ? {} : { batchSize }) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).evaluated, batchSize ?? 50);
  assert.equal(requests.length, (batchSize ?? 50) / 50);
}
requests.length = 0; failAiAt = 2;
const partialResponse = await post({ productId: 1, batchSize: 200 }); assert.equal(partialResponse.status, 502); assert.equal((await partialResponse.json()).evaluated, 50); failAiAt = 0;
rows.filter(row => row.product_id === 1).forEach(row => { row.product_relevance_score = 80; row.product_relevance_criteria_version = settingsVersion; });
const calls = requests.length;
assert.equal((await relevance.evaluateProductRelevance(1, 200)).selected, 0); assert.equal(requests.length, calls);
const reevaluationBefore = rows.map(row => ({ ...row }));
invalidMode = "missing";
const invalidReevaluation = await relevance.evaluateProductRelevance(1, 50, true);
assert.ok(invalidReevaluation.error); assert.deepEqual(rows, reevaluationBefore);
invalidMode = ""; requests.length = 0;
rows[0].product_relevance_score = 95;
rows[1].product_relevance_score = 95;
rows[2].product_relevance_score = null;
const reevaluated = await relevance.evaluateProductRelevance(1, 50, true);
assert.equal(reevaluated.evaluated, 50); assert.equal(requests.length, 1);
assert.equal(rows[0].product_relevance_score, 95, "Other Product is not reevaluated");
assert.equal(rows[1].product_relevance_score, 80, "Explicit reevaluation replaces existing score");
assert.equal(rows[2].product_relevance_score, null, "Reevaluation excludes unevaluated keywords");
assert.deepEqual(rows.map(row => row.status), statuses);
assert.ok(!requests[0].input.includes("product_relevance_score"), "Old score does not anchor new evaluation");
const firstReevaluated = new Set(saves.at(-1).p_rows.map(row => row.keywordId));
await relevance.evaluateProductRelevance(1, 50, true);
assert.ok(saves.at(-1).p_rows.every(row => !firstReevaluated.has(row.keywordId)), "Oldest first advances past the previous batch");
await assert.rejects(() => relevance.evaluateProductRelevance(1, 50, "true"));
assert.equal((await post({ productId: 1, batchSize: 50, reevaluate: true })).status, 200);
for (const target of [null, "", "all", 1]) assert.equal((await post({ productId: 1, target })).status, 400);
for (const reevaluate of [null, "true", 1]) assert.equal((await post({ productId: 1, reevaluate })).status, 400);
requests.length = 0; failAiAt = 2;
const beforePartialReevaluation = rows.map(row => JSON.stringify(row));
const partialReevaluation = await relevance.evaluateProductRelevance(1, 100, true);
assert.equal(partialReevaluation.evaluated, 50); assert.ok(partialReevaluation.error);
assert.equal(rows.filter((row, i) => JSON.stringify(row) !== beforePartialReevaluation[i]).length, 50, "Failed batch preserves old scores and metadata");
failAiAt = 0;
settingsVersion = 2;
rows[1].product_relevance_criteria_version = null;
const staleIds = rows.filter(row => row.product_id === 1 && row.product_relevance_score !== null && row.product_relevance_criteria_version !== 2).map(row => row.id);
assert.ok(staleIds.length > 200);
requests.length = 0; saves.length = 0;
const refreshed = await relevance.evaluateProductRelevance(1, 200, false, "pending");
assert.equal(refreshed.evaluated, 200);
assert.ok(saves.every(save => save.p_criteria_version === 2 && !save.p_reevaluate));
assert.ok(saves.flatMap(save => save.p_rows).every(row => staleIds.includes(row.keywordId)));
const currentIds = new Set(saves.flatMap(save => save.p_rows).map(row => row.keywordId));
await relevance.evaluateProductRelevance(1, 50, false, "stale");
assert.ok(saves.at(-1).p_rows.every(row => !currentIds.has(row.keywordId)));
await relevance.evaluateProductRelevance(1, 50, true);
assert.ok(saves.at(-1).p_rows.every(result => rows.find(row => row.id === result.keywordId).product_relevance_criteria_version === 2));
assert.ok(settingsReads > 1, "Settings read for each evaluation");
changeCriteriaOnAI = true;
const beforeChangedCriteria = rows.map(row => ({ ...row }));
const invalidated = await relevance.evaluateProductRelevance(1, 50, false, "pending");
assert.ok(invalidated.error); assert.equal(invalidated.evaluated, 0); assert.deepEqual(rows, beforeChangedCriteria);
const sql = readFileSync("supabase/migrations/202610170003_blog_keyword_relevance.sql", "utf8");
assert.match(sql, /product_relevance_score integer/); assert.match(sql, /BETWEEN 0 AND 100/);
assert.match(sql, /product_relevance_score IS NULL/); assert.match(sql, /product_relevance_evaluated_at = now\(\)/);
assert.doesNotMatch(sql, /SET\s+status|DROP\s|DELETE\s|ALTER POLICY|SECURITY DEFINER/i);
assert.match(sql, /SECURITY INVOKER/);
assert.match(sql, /k.product_id = p_product_id/);
const reevaluationSql = readFileSync("supabase/migrations/202610170005_blog_keyword_relevance_reevaluation.sql", "utf8");
assert.match(reevaluationSql, /NOT p_reevaluate AND k.product_relevance_score IS NULL/);
assert.match(reevaluationSql, /p_reevaluate AND k.product_relevance_score IS NOT NULL/);
assert.match(reevaluationSql, /p_product_id, p_rows, p_model, false/); assert.match(reevaluationSql, /p_product_id, p_rows, p_model, true/);
assert.match(reevaluationSql, /k.product_id = p_product_id/); assert.match(reevaluationSql, /product_relevance_evaluated_at = now\(\)/);
assert.equal(reevaluationSql.match(/UPDATE public.blog_keywords/g).length, 1);
assert.doesNotMatch(reevaluationSql, /SET\s+status|ALTER TABLE|DROP\s|SECURITY DEFINER/i);
let state = [], cursor = 0, refreshes = 0, fetchCalls = 0, uiFailure = false, expectedSize = 50, expectedProduct = 2, expectReevaluation = false, expectedTarget = "unevaluated";
let effects = [], previousProduct, cleanup;
const countQueries = [];
const countValues = new Map([["1", { evaluated: 200, pending: 4553 }], ["2", { evaluated: 50, pending: 10 }]]);
const countDb = { from() { let id, evaluated = false, current = false; return {
  select(_fields, options) { assert.equal(options.head, true); return this; },
  eq(key, value) { if (key === "product_relevance_criteria_version") { assert.equal(value, settingsVersion); current = true; } else { assert.equal(key, "product_id"); id = value; } return this; },
  not(key, operator, value) { assert.equal(key, "product_relevance_score"); assert.equal(operator, "is"); assert.equal(value, null); evaluated = true; return this; },
  is(key, value) { assert.equal(key, "product_relevance_score"); assert.equal(value, null); return this; },
  then(resolve) { countQueries.push(id); const values = countValues.get(id); return Promise.resolve({ count: evaluated ? (values?.evaluated ?? 0) + (current ? 0 : values?.stale ?? 0) : values?.pending ?? 0 }).then(resolve); },
}; } };
const ui = load("app/content/blog/keywords/RelevanceEvaluation.tsx", {
  react: { useEffect(callback, dependencies) { if (previousProduct !== dependencies[0]) { previousProduct = dependencies[0]; effects.push(callback); } }, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; } },
  "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) }, "@/lib/supabase": { supabase: countDb }, "@/lib/blog-keywords/ai-settings": settingsMock, "@/lib/blog-keywords/relevance-filter": filtersModule,
}).default;
const walk = node => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
const render = () => { cursor = 0; return ui({ products: [{ id: 1, name: "Pool 상품" }, { id: 2, name: "평가 상품" }] }); };
const control = label => walk(render()).find(node => node.props?.["aria-label"] === label);
async function settle() {
  const callbacks = effects; effects = [];
  for (const callback of callbacks) { cleanup?.(); cleanup = callback(); }
  await new Promise(resolve => setImmediate(resolve));
}
async function chooseProduct(value) { control("연관도 평가 Product").props.onChange({ target: { value } }); render(); await settle(); }
const oldFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  fetchCalls++; assert.equal(url, "/api/blog/keywords/relevance"); assert.deepEqual(JSON.parse(options.body), { productId: expectedProduct, batchSize: expectedSize, ...(expectReevaluation ? { reevaluate: true } : { target: expectedTarget }) });
  return Response.json({ selected: expectedSize, evaluated: uiFailure ? 50 : expectedSize, skipped: 0, ...(uiFailure ? { error: "두 번째 batch 실패" } : {}) }, { status: uiFailure ? 502 : 200 });
};
try {
  let tree = render(); await settle(); assert.equal(fetchCalls, 0); assert.equal(countQueries.length, 0);
  assert.equal(control("연관도 평가 Product").props.value, "");
  assert.equal(walk(tree).find(node => node.type === "button").props.disabled, true);
  assert.equal(control("연관도 평가 개수").props.value, 50);
  assert.equal(control("연관도 평가 대상").props.value, "unevaluated");
  assert.deepEqual(React.Children.toArray(control("연관도 평가 대상").props.children).map(node => node.props.value), ["unevaluated", "stale", "pending"]);
  assert.deepEqual(React.Children.toArray(control("연관도 평가 개수").props.children).map(node => node.props.value), [50, 100, 200]);
  await chooseProduct("2");
  assert.equal(control("연관도 평가 Product").props.value, "2");
  assert.ok(countQueries.every(id => id === "2"), "Independent Product controls counts");
  assert.ok(renderToStaticMarkup(render()).includes("미평가 10개"));
  assert.equal(control("연관도 평가 Product").props.value, "2", "Parent rerenders do not reset selection");
  assert.equal(walk(render()).find(node => node.type === "button").props.children, "현재 기준으로 키워드 평가");
  walk(render()).find(node => node.type === "button").props.onClick();
  assert.equal(walk(render()).find(node => node.type === "button").props.disabled, true);
  assert.equal(control("연관도 평가 Product").props.disabled, true);
  assert.equal(control("연관도 평가 대상").props.disabled, true);
  await settle();
  assert.equal(fetchCalls, 1); assert.equal(refreshes, 1); assert.ok(renderToStaticMarkup(render()).includes("저장 완료 50개"));
  expectedSize = 100; control("연관도 평가 개수").props.onChange({ target: { value: "100" } });
  uiFailure = true; walk(render()).find(node => node.type === "button").props.onClick(); await settle();
  assert.equal(fetchCalls, 2); assert.equal(refreshes, 2); assert.ok(walk(render()).some(node => node.props?.role === "alert"));
  expectedProduct = 1; await chooseProduct("1");
  assert.ok(renderToStaticMarkup(render()).includes("4,553"));
  assert.ok(!walk(render()).some(node => node.props?.role === "alert"));
  countValues.set("1", { evaluated: 4753, pending: 0 });
  await chooseProduct(""); await chooseProduct("1");
  assert.equal(walk(render()).find(node => node.type === "button").props.disabled, true);
  walk(render()).find(node => node.type === "button").props.onClick(); assert.equal(fetchCalls, 2);
  const repeatButton = () => walk(render()).find(node => node.type === "button" && node.props.children === "평가된 키워드 재평가");
  assert.equal(repeatButton().props.disabled, false, "Reevaluation is available even when there are no unevaluated rows");
  expectReevaluation = true; uiFailure = false;
  repeatButton().props.onClick();
  assert.ok(walk(render()).filter(node => node.type === "button").every(node => node.props.disabled));
  await settle(); assert.equal(fetchCalls, 3); assert.equal(refreshes, 3);
  assert.ok(renderToStaticMarkup(render()).includes("평가된 점수·이유"));
  countValues.set("1", { evaluated: 0, pending: 0, stale: 4753 });
  await chooseProduct(""); await chooseProduct("1");
  assert.ok(renderToStaticMarkup(render()).includes("이전 기준 4,753개"));
  assert.equal(walk(render()).find(node => node.type === "button").props.disabled, true, "Default unevaluated-only excludes stale rows");
  control("연관도 평가 대상").props.onChange({ target: { value: "stale" } });
  assert.equal(walk(render()).find(node => node.type === "button").props.disabled, false);
  expectReevaluation = false; expectedTarget = "stale";
  walk(render()).find(node => node.type === "button").props.onClick(); await settle();
  control("연관도 평가 대상").props.onChange({ target: { value: "pending" } });
  expectedTarget = "pending";
  walk(render()).find(node => node.type === "button").props.onClick(); await settle();
  assert.equal(repeatButton().props.disabled, true);
  await chooseProduct(""); assert.equal(repeatButton().props.disabled, true);
} finally { cleanup?.(); globalThis.fetch = oldFetch; }
console.log("PASS: unevaluated default / stale / combined targets and counts, API target validation, strict intent rubric contract, explicit reevaluation/oldest-first/partial failure preservation, Product isolation, default 50 and selectable 50/100/200 limits / 1/2/4 calls, volume priority without metric scoring, complete strict validation, partial failure/save safety, retry skips evaluated, status preservation, API/migration contracts; no real AI or DB calls.");
