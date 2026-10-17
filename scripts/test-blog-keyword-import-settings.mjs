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
const parser = load("lib/blog-keywords/import.ts", { "./shared": shared });
const sheet = parser.keywordSheet([["번호", "키워드", "", "PC 검색량", "모바일 검색량", "총검색량", "PC 클릭", "모바일 클릭", "PC CTR", "모바일 CTR", "경쟁도", "광고수"], [1, "raw 유지", "팔자주름", 100, 200, 300, 4, 5, 0.1, 0.2, "높음", 6]]);
const mapping = { keyword: 2, pc_search_volume: 3, mobile_search_volume: 4, search_volume: 5, pc_clicks: 6, mobile_clicks: 7, pc_ctr: 8, mobile_ctr: 9, competition: 10 };
const signature = parser.keywordHeaderSignature(sheet);
assert.equal(signature.length, 64);
assert.equal(signature, parser.keywordHeaderSignature({ ...sheet, rows: [["different"]], columns: sheet.columns.map(column => ({ ...column, samples: ["other"] })) }));
assert.notEqual(signature, parser.keywordHeaderSignature(parser.keywordSheet([["番号", "キーワード", ""], [1, 2, 3]])));
assert.notEqual(signature, parser.keywordHeaderSignature({ ...sheet, columns: [...sheet.columns].reverse() }));
assert.notEqual(signature, parser.keywordHeaderSignature({ ...sheet, columns: sheet.columns.map(column => column.index === 2 ? { ...column, header: "実際 keyword" } : column) }));
assert.equal(sheet.columns[2].header, "");
const presets = new Map(), runs = [];
let failPreset = false, failHistory = false;
const db = { from(table) {
  let key, value;
  return {
    select() { return this; }, eq(_key, target) { key = target; return this; }, order() { return this; },
    limit(count) { assert.equal(count, 5); return this; }, returns() { return this; },
    upsert(input, options) { assert.equal(options.onConflict, "header_signature"); value = input; return this; },
    async single() { if (failPreset) return { error: {} }; const row = { id: "preset-id", ...value }; presets.set(value.header_signature, row); return { data: row }; },
    async maybeSingle() { return { data: presets.get(key) ?? null, error: failPreset ? {} : null }; },
    async insert(input) { if (failHistory) return { error: {} }; runs.push({ id: String(runs.length + 1), created_at: "2026-10-17T04:20:00Z", ...input }); return { error: null }; },
    then(resolve) { assert.equal(table, "blog_keyword_import_runs"); return Promise.resolve({ data: runs.slice(-5).reverse(), error: failHistory ? {} : null }).then(resolve); },
  };
} };
const settings = load("lib/blog-keywords/import-settings.ts", { "@/lib/supabase": { supabase: db }, "./import": parser });
assert.equal((await settings.inspectKeywordMapping(sheet)).presetApplied, false);
assert.equal((await settings.inspectKeywordMapping(sheet)).mapping.keyword, 1);
const summary = { totalRows: 1, validRows: 1, skippedRows: 0, fileDuplicateRows: 0, existingRows: 999, inserts: 0, updates: 999, invalidMetricCells: 0 };
assert.equal(await settings.recordKeywordImport(1, sheet, mapping, "키워드사운드", "주름키워드.xlsx", summary, { imported: 1, inserted: 1, updated: 0 }), undefined);
presets.get(signature).mapping = { ...mapping, ad_count: 11 };
let restored = await settings.inspectKeywordMapping(sheet);
assert.equal(restored.presetApplied, true); assert.deepEqual(restored.mapping, mapping); assert.equal(restored.sourceLabel, "키워드사운드");
assert.equal(presets.size, 1); assert.equal("product_id" in [...presets.values()][0], false);
assert.equal(runs[0].inserted_count, 1); assert.equal(runs[0].updated_count, 0); assert.equal(runs[0].source_filename, "주름키워드.xlsx");
assert.equal(runs[0].total_rows, 1); assert.equal(runs[0].product_id, 1);
const changed = { keyword: 2, search_volume: 5 };
await settings.recordKeywordImport(2, sheet, changed, "새 출처", "파일명다름.xlsx", summary, { imported: 1, inserted: 0, updated: 1 });
assert.equal(presets.size, 1); assert.deepEqual((await settings.inspectKeywordMapping(sheet)).mapping, changed);
assert.equal(runs[1].updated_count, 1); assert.equal(runs[1].product_id, 2);
assert.ok(!JSON.stringify([...presets.values(), ...runs]).includes("raw 유지"));
for (const record of runs) for (const key of ["rows", "samples", "file", "binary", "raw_data", "existing_duplicate_count"]) assert.equal(key in record, false);
failHistory = true;
assert.match(await settings.recordKeywordImport(1, sheet, mapping, null, "success.xlsx", summary, { imported: 1, inserted: 0, updated: 1 }), /이력/);
failHistory = false; failPreset = true;
assert.equal((await settings.inspectKeywordMapping(sheet)).presetApplied, false);
assert.match(await settings.recordKeywordImport(1, sheet, mapping, null, "success.xlsx", summary, { imported: 1, inserted: 0, updated: 1 }), /매핑/);
assert.equal(runs.at(-1).preset_id, null);
failPreset = false;
assert.ok((await settings.recentKeywordImports()).length <= 5);
let failImport = false, actualImports = 0;
const route = load("app/api/blog/keywords/import/route.ts", {
  "@/lib/blog-keywords/import": parser, "@/lib/blog-keywords/import-settings": settings,
  "@/lib/blog-keywords/store": {
    async previewKeywordImport(_id, sheet, mapping) { return { prepared: parser.prepareKeywordRows(sheet, mapping), summary: { ...summary, inserts: 999, updates: 999, samples: [] } }; },
    async importKeywordRows() { if (failImport) throw new shared.KeywordError("Import 실패", 500); actualImports++; return { imported: 1, inserted: actualImports === 1 ? 1 : 0, updated: actualImports === 1 ? 0 : 1 }; },
  },
});
const contents = sheet.columns.map(column => column.header).join(",") + "\n" + sheet.rows[0].join(",") + "\n";
const csv = new File([contents], "주름키워드.csv"), renamed = new File([contents], "새이름.csv");
async function request(action, file = csv, selectedMapping = mapping) {
  const body = new FormData(); body.set("file", file); body.set("productId", "1"); body.set("source", "키워드사운드"); body.set("mapping", JSON.stringify(selectedMapping)); body.set("action", action);
  return route.POST(new Request("http://fixture/import", { method: "POST", body }));
}
for (const file of [csv, renamed]) {
  const response = await request("inspect", file); assert.equal(response.status, 200);
  const data = await response.json(); assert.equal(data.presetApplied, true); assert.deepEqual(data.mapping, mapping);
}
let before = JSON.stringify([...presets.values(), ...runs]);
await request("preview"); assert.equal(JSON.stringify([...presets.values(), ...runs]), before); assert.equal(actualImports, 0);
failImport = true; assert.equal((await request("import")).status, 500); assert.equal(JSON.stringify([...presets.values(), ...runs]), before); failImport = false;
let response = await request("import", csv, { ...mapping, ad_count: 11 }); assert.equal(response.status, 200);
assert.equal(Object.hasOwn(presets.get(signature).mapping, "ad_count"), false);
assert.equal(runs.at(-1).inserted_count, 1); assert.equal(runs.at(-1).updated_count, 0);
await request("import", renamed, changed); assert.deepEqual((await settings.inspectKeywordMapping(sheet)).mapping, changed);
assert.equal(runs.at(-1).updated_count, 1); assert.equal(runs.at(-1).source_filename, "새이름.csv");
failHistory = true; response = await request("import"); assert.equal(response.status, 200); assert.match((await response.json()).warning, /이력/); failHistory = false;
assert.ok((await (await route.GET()).json()).runs.length <= 5);
assert.deepEqual(shared.keywordImportPreference('{"productId":"1","source":"키워드사운드"}', [{ id: 1 }]), { productId: "1", source: "키워드사운드" });
assert.equal(shared.keywordImportPreference('{"productId":"999"}', [{ id: 1 }]).productId, "");
assert.deepEqual(shared.keywordImportPreference("bad JSON", [{ id: 1 }]), { productId: "", source: "" });
let state = [], cursor = 0, effects = [], refreshes = 0;
const flight = { current: false }, preferences = new Map();
const ui = load("app/content/blog/keywords/KeywordImport.tsx", {
  react: { useEffect(callback) { effects.push(callback); }, useRef: () => flight, useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value; }]; } },
  "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) }, "@/lib/blog-keywords/shared": shared,
}).default;
const walk = node => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
const render = () => { cursor = 0; return ui({ products: [{ id: 1, name: "윗잠베개" }] }); };
const find = label => walk(render()).find(node => node.props?.["aria-label"] === label);
async function drain() { for (let i = 0; i < 20; i++) { await new Promise(resolve => setImmediate(resolve)); if (!flight.current) return; } assert.fail("UI request did not settle"); }
async function mount() { state = []; effects = []; flight.current = false; render(); const callbacks = effects; effects = []; callbacks.forEach(effect => effect()); await drain(); }
async function click(label) { walk(render()).find(node => node.type === "button" && node.props.children === label).props.onClick(); await drain(); }
const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
globalThis.window = { localStorage: { getItem: key => preferences.get(key) ?? null, setItem: (key, value) => preferences.set(key, value) } };
globalThis.fetch = async (_url, options) => options?.method === "POST" ? route.POST(new Request("http://fixture/import", options)) : route.GET();
try {
  preferences.set(shared.KEYWORD_IMPORT_PREFERENCE, JSON.stringify({ productId: "1", source: "최근 출처" }));
  await mount();
  assert.equal(find("Import Product").props.value, "1"); assert.equal(find("Import 출처").props.value, "최근 출처");
  assert.equal(state[2], null); assert.equal(state[5], null); assert.deepEqual(state[4], {});
  assert.equal(find("Import 파일").props.value, undefined);
  find("Import 파일").props.onChange({ target: { files: [csv] } });
  await click("파일 읽기 / 자동 매핑");
  assert.equal(state[4].keyword, 2); assert.ok(renderToStaticMarkup(render()).includes("이전에 저장한 매핑"));
  const selected = walk(render()).find(node => node.props?.["aria-label"] === `${sheet.columns[3].label} 매핑`);
  selected.props.onChange({ target: { value: "search_volume" } }); assert.equal(state[4].search_volume, 3);
  find("Import 출처").props.onChange({ target: { value: "수정 출처" } });
  await click("Preview"); assert.ok(state[5]);
  assert.ok(!walk(render()).some(node => node.type === "th" && node.props.children === "광고수"));
  assert.ok(!walk(render()).some(node => node.type === "option" && node.props.value === "ad_count"));
  assert.deepEqual(Object.keys(JSON.parse(preferences.get(shared.KEYWORD_IMPORT_PREFERENCE))).sort(), ["productId", "source"]);
  await click("Import"); assert.equal(refreshes, 1); assert.equal(state[5], null);
  assert.equal((await settings.inspectKeywordMapping(sheet)).mapping.search_volume, 3);
  assert.ok(renderToStaticMarkup(render()).includes("새이름.csv"));
  await mount(); assert.equal(state[2], null); assert.equal(state[5], null); assert.equal(state[3].length, 0);
  assert.equal(find("Import 파일").props.value, undefined);
  find("Import 파일").props.onChange({ target: { files: [renamed] } });
  await click("파일 읽기 / 자동 매핑"); assert.equal(state[4].keyword, 2); assert.equal(state[4].search_volume, 3);
  assert.equal(find("Import 출처").props.value, "수정 출처");
  preferences.set(shared.KEYWORD_IMPORT_PREFERENCE, JSON.stringify({ productId: "999", source: "선택 가능" }));
  await mount(); assert.equal(find("Import Product").props.value, ""); assert.equal(find("Import 출처").props.value, "선택 가능");
} finally { globalThis.fetch = oldFetch; globalThis.window = oldWindow; }
const sql = readFileSync("supabase/migrations/202610170004_blog_keyword_import_settings.sql", "utf8");
assert.match(sql, /blog_keyword_import_presets/); assert.match(sql, /blog_keyword_import_runs/);
assert.match(sql, /RETURNING \(xmax = 0\)/); assert.match(sql, /CREATE OR REPLACE FUNCTION public.import_blog_keywords/);
assert.equal(sql.match(/INSERT INTO public.blog_keywords/g).length, 1, "Legacy wrapper shares the single UPSERT implementation");
assert.doesNotMatch(sql.split("ON CONFLICT")[1].split("RETURNING")[0], /\b(?:status|keyword|normalized_keyword|product_relevance_\w+)\s*=/);
assert.doesNotMatch(sql, /ALTER TABLE public.blog_keywords|DROP TABLE|SET\s+status|SECURITY DEFINER/i);
const removalSql = readFileSync("supabase/migrations/202610170006_remove_blog_keyword_ad_count.sql", "utf8");
assert.match(removalSql, /ALTER TABLE public.blog_keywords DROP COLUMN ad_count;/);
assert.doesNotMatch(removalSql.split("CREATE OR REPLACE FUNCTION")[1], /\bad_count\b/);
assert.ok(removalSql.indexOf("CREATE OR REPLACE FUNCTION public.import_blog_keywords_counted") < removalSql.indexOf("DROP COLUMN"));
assert.match(removalSql, /RETURNING \(xmax = 0\)/); assert.match(removalSql, /competition = coalesce/); assert.match(removalSql, /search_volume = coalesce/);
assert.doesNotMatch(removalSql, /CASCADE|DELETE FROM|DROP TABLE|SET\s+status|product_relevance_\w+\s*=/i);
console.log("PASS: deterministic header signature including empty C, sample/filename independence, preset precedence/update/Product separation, actual history counts, metadata failures preserve import, bounded history; no DB or real import.");
