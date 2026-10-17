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
const sql = readFileSync("supabase/migrations/202610170007_blog_keyword_ai_settings.sql", "utf8");
const seeds = [...sql.matchAll(/\$criteria\$([\s\S]*?)\$criteria\$/g)].map(match => match[1]);
assert.equal(seeds.length, 2);
for (const term of ["bait-and-switch", "90~100", "75~89", "50~74", "25~49", "0~24", "아이크림", "레티놀", "보톡스", "리쥬란", "broader intent"]) assert.ok(seeds[0].includes(term), term);
for (const term of ["Product 관련성", "검색량", "검색 의도", "중복", "다양성", "대표 하나"]) assert.ok(seeds[1].includes(term), term);
for (const term of ["id boolean PRIMARY KEY DEFAULT true CHECK (id = true)", "relevance_version integer NOT NULL DEFAULT 1", "product_relevance_criteria_version integer", "ENABLE ROW LEVEL SECURITY", "OLD.relevance_version + CASE", "IS DISTINCT FROM", "updated_at = p_expected_updated_at", "FOR SHARE", "p_criteria_version IS DISTINCT FROM current_version", "set_config('angel.versioned_relevance', 'off', true)", "product_relevance_criteria_version = p_criteria_version", "k.product_id = p_product_id", "BETWEEN 1 AND 50", "Duplicate keyword ID", "NOT p_reevaluate", "k.product_relevance_criteria_version IS DISTINCT FROM current_version", "k.product_relevance_criteria_version = current_version"]) assert.ok(sql.includes(term), term);
assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE|SET\s+status|SECURITY DEFINER/i);
for (const file of ["relevance", "recommendation"]) {
  const source = readFileSync(`lib/blog-keywords/${file}.ts`, "utf8");
  assert.ok(source.includes("await readKeywordAISettings()"));
  assert.doesNotMatch(source, /bait-and-switch|90~100|아이크림|대표 하나|검색량은 중요한 signal/);
}
let row = { id: true, relevance_criteria: seeds[0], recommendation_criteria: seeds[1], relevance_version: 1, created_at: "2026-10-17T00:00:00Z", updated_at: "2026-10-17T00:00:00Z" };
let missing = false, dbFailure = false, writes = 0;
const normalize = text => text.replace(/\s+/g, " ").trim();
const db = {
  from(table) {
    assert.equal(table, "blog_keyword_ai_settings");
    return { select() { return this; }, eq(key, value) { assert.equal(key, "id"); assert.equal(value, true); return this; }, async maybeSingle() { return { data: missing ? null : { ...row }, error: dbFailure ? {} : null }; } };
  },
  async rpc(name, args) {
    assert.equal(name, "save_blog_keyword_ai_settings");
    if (dbFailure) return { error: {} };
    if (args.p_expected_updated_at !== row.updated_at) return { data: [] };
    writes++;
    const relevance = normalize(args.p_relevance_criteria);
    row = { ...row, relevance_criteria: relevance, recommendation_criteria: normalize(args.p_recommendation_criteria), relevance_version: row.relevance_version + Number(relevance !== normalize(row.relevance_criteria)), updated_at: new Date(Date.UTC(2026, 9, 17) + writes).toISOString() };
    return { data: [{ ...row }] };
  },
};
const settings = load("lib/blog-keywords/ai-settings.ts", { "@/lib/supabase": { supabase: db }, "./shared": shared });
const route = load("app/api/blog/keywords/ai-settings/route.ts", { "@/lib/supabase": { supabase: db }, "@/lib/blog-keywords/ai-settings": settings, "@/lib/blog-keywords/shared": shared });
let response = await route.GET(); assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
assert.equal((await response.json()).settings.relevance_version, 1);
const patch = value => route.PATCH(new Request("http://fixture", { method: "PATCH", body: JSON.stringify(value) }));
response = await patch(row); assert.equal(response.status, 200); assert.equal(row.relevance_version, 1, "Seed whitespace normalization does not increment version");
response = await patch({ ...row, relevance_criteria: ` \n${row.relevance_criteria.replaceAll(" ", "  ")}\t` });
assert.equal(response.status, 200); assert.equal(row.relevance_version, 1);
response = await patch({ ...row, recommendation_criteria: "  검색량을\n우선한다. " });
assert.equal(response.status, 200); assert.equal(row.relevance_version, 1); assert.equal(row.recommendation_criteria, "검색량을 우선한다.");
const before = { ...row };
response = await patch({ ...row, relevance_criteria: "제품 관련성을 최우선으로 판단한다." });
assert.equal(response.status, 200); assert.equal(row.relevance_version, 2);
assert.equal((await patch(before)).status, 409, "Concurrent stale save cannot overwrite new criteria");
assert.equal(row.relevance_version, 2);
for (const value of [null, [], {}, { ...row, relevance_criteria: " \t\n" }, { ...row, recommendation_criteria: "" }, { ...row, relevance_criteria: "x".repeat(30001) }, { ...row, recommendation_criteria: 1 }, { ...row, updated_at: "invalid" }]) assert.equal((await patch(value)).status, 400);
assert.equal((await route.PATCH(new Request("http://fixture", { method: "PATCH", body: "bad json" }))).status, 400);
missing = true; assert.equal((await route.GET()).status, 500); await assert.rejects(settings.readKeywordAISettings, /migration/); missing = false;
dbFailure = true; assert.equal((await route.GET()).status, 500); assert.equal((await patch(row)).status, 500); dbFailure = false;
const filters = load("lib/blog-keywords/relevance-filter.ts");
assert.equal(filters.isStaleRelevance(null, null, 2), false);
assert.equal(filters.isStaleRelevance(90, null, 2), true);
assert.equal(filters.isStaleRelevance(90, 1, 2), true);
assert.equal(filters.isStaleRelevance(90, 2, 2), false);
assert.equal(filters.pendingRelevanceFilter(2), "product_relevance_score.is.null,product_relevance_criteria_version.is.null,product_relevance_criteria_version.neq.2");

let state = [], cursor = 0, failUI = false, finish;
const ui = load("app/content/blog/keywords/settings/SettingsForm.tsx", {
  react: { useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; } },
}).default;
const walk = node => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
const render = () => { cursor = 0; return ui({ initial: { ...row } }); };
const oldFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(url, "/api/blog/keywords/ai-settings"); assert.equal(options.method, "PATCH");
  await new Promise(resolve => { finish = resolve; });
  return failUI ? Response.json({ error: "저장 실패" }, { status: 500 }) : patch(JSON.parse(options.body));
};
try {
  let tree = render(); assert.equal(walk(tree).filter(node => node.type === "textarea").length, 2);
  assert.ok(renderToStaticMarkup(tree).includes("이전 기준으로 표시"));
  walk(tree).find(node => node.props?.id === "relevance-criteria").props.onChange({ target: { value: "새 연관도 기준" } });
  const pending = render().props.onSubmit({ preventDefault() {} });
  assert.equal(walk(render()).find(node => node.type === "button").props.disabled, true);
  assert.ok(renderToStaticMarkup(render()).includes("저장 중")); finish(); await pending;
  assert.ok(renderToStaticMarkup(render()).includes("저장 완료"));
  assert.equal(row.relevance_criteria, "새 연관도 기준"); assert.equal(row.relevance_version, 3);
  failUI = true; const failed = render().props.onSubmit({ preventDefault() {} }); finish(); await failed;
  assert.ok(walk(render()).some(node => node.props?.role === "alert"));
} finally { globalThis.fetch = oldFetch; }
console.log("PASS: settings seed/contracts, GET/PATCH validation, normalized version changes, recommendation-only/no-op saves, concurrent conflict, missing config, stale predicates, settings UI saving/success/failure (mock DB; no remote SQL or AI).");
