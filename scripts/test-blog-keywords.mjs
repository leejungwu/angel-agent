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
  compiled._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
  return compiled.exports;
}
const shared = load("lib/blog-keywords/shared.ts");
const parser = load("lib/blog-keywords/import.ts", { "./shared": shared });
const sheet = parser.keywordSheet([[null, "키워드", null, "월간 총 검색량", "경쟁정도"], [1, "팔자주름 시술", "팔자주름시술", "1,200", "높음"], [2, null, "눈가주름", "잘못된 값", "낮음"], [3, null, null, "", ""], [4, "다른 단어", "팔자주름시술", 1500, "중간"]]);
assert.equal(parser.suggestKeywordMapping(sheet).keyword, 1);
assert.match(sheet.columns[2].label, /열 C.*헤더 없음/);
assert.deepEqual(sheet.columns[2].samples, ["팔자주름시술", "눈가주름", "팔자주름시술"]);
const mapping = parser.parseKeywordMapping({ keyword: 2, search_volume: 3, competition: 4 }, sheet.columns.length);
const prepared = parser.prepareKeywordRows(sheet, mapping);
assert.deepEqual([prepared.totalRows, prepared.validRows, prepared.skippedRows, prepared.fileDuplicateRows, prepared.invalidMetricCells], [4, 3, 1, 1, 1]);
assert.deepEqual(prepared.rows.map(row => row.keyword), ["팔자주름시술", "눈가주름"]);
assert.equal(prepared.rows[0].search_volume, 1500); assert.equal(prepared.rows[1].search_volume, null);
assert.equal(prepared.rows[0].raw_data["열 B · 키워드"], "다른 단어");
assert.equal(shared.normalizeKeyword("  A\tB\u00a0C  "), "a b c");
for (const [value, expected] of [["1,200", 1200], ["0.35%", 0.35], ["", null], [null, null], ["<10", null], ["oops", null], ["-1", null]]) assert.equal(parser.keywordNumber(value), expected);
assert.throws(() => parser.parseKeywordMapping({ search_volume: 3 }, 5));
assert.throws(() => parser.parseKeywordMapping({ keyword: 2, search_volume: 2 }, 5));
assert.throws(() => parser.parseKeywordMapping({ keyword: 999 }, 5));
assert.equal("ad_count" in shared.KEYWORD_FIELDS, false);
assert.deepEqual(parser.parseKeywordMapping({ keyword: 2, search_volume: 3, ad_count: 999 }, 5), { keyword: 2, search_volume: 3 });
assert.throws(() => parser.parseKeywordMapping({ keyword: 2, unknown_metric: 3 }, 5));
const shuffled = parser.keywordSheet([["경쟁도", "keyword", "총검색량"], ["중간", "테스트", "3,000"]]);
assert.deepEqual(parser.suggestKeywordMapping(shuffled), { keyword: 1, search_volume: 2, competition: 0 });
const csv = new File(["\uFEFF,키워드,,총검색량\n1,,실제 키워드,3000\n"], "keywords.csv");
assert.equal((await parser.parseKeywordFile(csv)).rows[0][2], "실제 키워드");
await assert.rejects(() => parser.parseKeywordFile(new File(["bad"], "keywords.xls")), /XLSX/);

// Minimal ZIP/OOXML fixture; no writer dependency or disk files required.
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const bytes = Buffer.from(text), nameBytes = Buffer.from(name); let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, bytes); centrals.push(central, nameBytes); offset += local.length + nameBytes.length + bytes.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const xlsx = zip({
  "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  "xl/workbook.xml": '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  "xl/worksheets/sheet1.xml": '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="B1" t="inlineStr"><is><t>키워드</t></is></c><c r="D1" t="inlineStr"><is><t>총검색량</t></is></c><c r="L1" t="inlineStr"><is><t>월평균 노출 광고수</t></is></c></row><row r="2"><c r="C2" t="inlineStr"><is><t>눈가주름</t></is></c><c r="D2"><v>1234</v></c><c r="L2"><v>6</v></c></row></sheetData></worksheet>',
});
const excel = await parser.parseKeywordFile(new File([xlsx], "주름키워드.xlsx"));
assert.match(excel.columns[2].label, /열 C/); assert.equal(excel.rows[0][2], "눈가주름");
const legacyExcelMapping = parser.parseKeywordMapping({ keyword: 2, search_volume: 3, ad_count: 11 }, excel.columns.length);
const legacyExcelRow = parser.prepareKeywordRows(excel, legacyExcelMapping).rows[0];
assert.equal(legacyExcelRow.search_volume, 1234);
assert.equal(Object.hasOwn(legacyExcelRow, "ad_count"), false);
assert.equal(Object.hasOwn(parser.suggestKeywordMapping(excel), "ad_count"), false);
assert.equal(legacyExcelRow.raw_data["열 L · 월평균 노출 광고수"], 6);

const pool = new Map(); let calls = 0, failBatch = false;
const lookupSizes = [];
const db = {
  from(table) {
    const filters = []; let operation = "select", changes;
    const query = { select() { return this; }, eq(key, value) { filters.push(row => String(row[key]) === String(value)); return this; }, in(key, values) { lookupSizes.push(values.length); assert.ok(values.length <= 100, "PostgREST lookup URL must use small batches"); assert.ok(values.reduce((sum, value) => sum + encodeURIComponent(value).length + 6, 0) <= 5500, "Encoded Korean filter must stay below gateway limits"); filters.push(row => values.includes(row[key])); return this; },
      update(value) { operation = "update"; changes = value; return this; },
      async maybeSingle() { if (table === "products") return { data: { id: 1 } }; const row = [...pool.values()].find(row => filters.every(filter => filter(row))); if (row && operation === "update") Object.assign(row, changes); return { data: row ?? null }; },
      then(resolve) { return Promise.resolve({ data: [...pool.values()].filter(row => filters.every(filter => filter(row))) }).then(resolve); } };
    return query;
  },
  async rpc(name, args) {
    assert.equal(name, "import_blog_keywords_counted"); assert.ok(args.p_rows.length <= 500); calls++;
    if (failBatch) return { error: { message: "fixture" } };
    let inserted_count = 0, updated_count = 0;
    for (const row of args.p_rows) {
      assert.equal(row.status, undefined);
      const key = args.p_product_id + ":" + row.normalized_keyword, existing = pool.get(key);
      if (existing) { updated_count++; for (const [field, value] of Object.entries(row)) if (value != null && !["keyword", "normalized_keyword"].includes(field)) existing[field] = value; }
      else { inserted_count++; pool.set(key, { ...row, id: `${String(pool.size + 1).padStart(8, "0")}-0000-4000-8000-000000000001`, product_id: args.p_product_id, status: "unused" }); }
    }
    return { data: { inserted_count, updated_count } };
  },
};
const store = load("lib/blog-keywords/store.ts", { "@/lib/supabase": { supabase: db }, "./import": parser });
let preview = await store.previewKeywordImport(1, sheet, mapping);
assert.equal(preview.summary.inserts, 2); assert.equal(preview.summary.updates, 0);
assert.deepEqual(await store.importKeywordRows(1, prepared.rows, "외부 수집", "test.xlsx"), { imported: 2, inserted: 2, updated: 0 });
pool.get("1:팔자주름시술").status = "used"; pool.get("1:눈가주름").status = "excluded";
pool.get("1:팔자주름시술").product_relevance_score = 92;
assert.deepEqual(await store.importKeywordRows(1, prepared.rows.map(row => ({ ...row, search_volume: 5000 })), null, "test2.xlsx"), { imported: 2, inserted: 0, updated: 2 });
assert.equal(pool.size, 2); assert.equal(pool.get("1:팔자주름시술").status, "used"); assert.equal(pool.get("1:눈가주름").status, "excluded"); assert.equal(pool.get("1:눈가주름").search_volume, 5000);
await store.importKeywordRows(1, prepared.rows.map(row => ({ ...row, search_volume: null })), null, "test3.xlsx");
assert.equal(pool.get("1:눈가주름").search_volume, 5000, "Empty metrics retain previously stored data");
assert.equal(pool.get("1:팔자주름시술").product_relevance_score, 92, "Reimport preserves relevance");
await store.importKeywordRows(2, prepared.rows, null, "test.xlsx"); assert.equal(pool.size, 4);
preview = await store.previewKeywordImport(1, sheet, mapping); assert.equal(preview.summary.inserts, 0); assert.equal(preview.summary.updates, 2);
const big = parser.prepareKeywordRows(parser.keywordSheet([["키워드"], ...Array.from({ length: 4753 }, (_, i) => ["키워드 " + i])]), { keyword: 0 });
lookupSizes.length = 0;
await store.previewKeywordImport(1, parser.keywordSheet([["키워드"], ...big.rows.map(row => [row.keyword])]), { keyword: 0 });
assert.equal(lookupSizes.length, 48);
assert.equal(lookupSizes.reduce((sum, size) => sum + size, 0), 4753);
lookupSizes.length = 0;
await store.previewKeywordImport(1, parser.keywordSheet([["키워드"], ...Array.from({ length: 101 }, (_, i) => ["긴한글키워드".repeat(20) + i])]), { keyword: 0 });
assert.ok(lookupSizes.length > 2, "Long Korean keywords split by encoded length, not count alone");
calls = 0; assert.deepEqual(await store.importKeywordRows(1, big.rows, null, "large.xlsx"), { imported: 4753, inserted: 4753, updated: 0 }); assert.equal(calls, 10);
failBatch = true; await assert.rejects(() => store.importKeywordRows(1, prepared.rows, null, "test.xlsx"), /0\/2/); failBatch = false;
const stateRoute = load("app/api/blog/keywords/[id]/route.ts", { "@/lib/supabase": { supabase: db }, "@/lib/blog-keywords/shared": shared });
const target = pool.get("1:팔자주름시술");
const patch = status => stateRoute.PATCH(new Request("http://fixture", { method: "PATCH", body: JSON.stringify({ status }) }), { params: Promise.resolve({ id: target.id }) });
assert.equal((await patch("unused")).status, 409); target.status = "unused";
assert.equal((await patch("excluded")).status, 200); assert.equal(target.status, "excluded");
assert.equal((await patch("unused")).status, 200); assert.equal(target.status, "unused");
assert.equal((await patch("used")).status, 400);
const importRoute = load("app/api/blog/keywords/import/route.ts", { "@/lib/blog-keywords/import": parser, "@/lib/blog-keywords/store": store, "@/lib/blog-keywords/import-settings": { inspectKeywordMapping: async sheet => ({ mapping: parser.suggestKeywordMapping(sheet), presetApplied: false }), recordKeywordImport: async () => undefined, recentKeywordImports: async () => [] } });
async function requestImport(action, map = { keyword: 2, search_volume: 3 }, product = "1") {
  const form = new FormData(); form.set("file", csv); form.set("action", action); form.set("productId", product); form.set("mapping", JSON.stringify(map));
  return importRoute.POST(new Request("http://fixture/import", { method: "POST", body: form }));
}
const inspection = await requestImport("inspect"); assert.equal(inspection.status, 200); assert.match((await inspection.json()).columns[2].label, /헤더 없음/);
assert.equal((await requestImport("preview")).status, 200);
assert.equal((await requestImport("preview", {})).status, 400);
assert.equal((await requestImport("import", { keyword: 2, search_volume: 3 }, "0")).status, 400);
assert.equal((await requestImport("import")).status, 200);

// Existing Task form still performs one insert; mock transaction reproduces trigger commit/rollback.
let state = [], cursor = 0, effects = [], taskFailure = false, nextTask = 0; const tasks = [], submissions = [];
const hooks = { useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], value => { state[index] = value; }]; }, useEffect(callback) { effects.push(callback); } };
const uiDb = { from() { return {
  select() { return this; }, eq() { return this; }, order() { return this; }, returns: async () => ({ data: [{ id: 1, name: "Product" }] }),
  maybeSingle: async () => ({ data: target }),
  async insert(value) {
    submissions.push(value);
    if (taskFailure) return { error: { message: "Task 저장 실패" } };
    if (value.blog_keyword_id && target.status !== "unused") return { error: { message: "keyword unavailable" } };
    const task = { id: ++nextTask, ...value }; tasks.push(task);
    if (value.blog_keyword_id) target.status = "used";
    return { error: null };
  },
}; } };
const newTask = load("app/content/blog/new/page.tsx", { react: hooks, "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }) }, "next/link": { default: "a", __esModule: true }, "@/lib/blog-keywords/shared": shared, "@/lib/supabase": { supabase: uiDb } }).default;
const walk = node => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
const render = () => { cursor = 0; return newTask(); };
const oldWindow = globalThis.window, oldAlert = globalThis.alert; globalThis.alert = () => {};
async function ready(url) {
  state = []; effects = []; globalThis.window = { location: { href: url } }; render(); const callbacks = effects; effects = []; callbacks.forEach(effect => effect()); await new Promise(resolve => setImmediate(resolve));
}
try {
  await ready(`http://fixture/content/blog/new?keywordId=${target.id}&productId=1`);
  let tree = render(); assert.equal(walk(tree).find(node => node.props?.["aria-label"] === "키워드").props.value, target.keyword);
  assert.equal(walk(tree).find(node => node.props?.["aria-label"] === "상품 선택").props.value, "1");
  const suggestedTopic = "옆잠과 얼굴 압박을 줄이는 수면 습관";
  const recommendationUrl = shared.recommendationTaskUrl(1, { keywordId: target.id, keyword: target.keyword, suggestedTopic });
  await ready(`http://fixture${recommendationUrl}`); tree = render();
  assert.equal(walk(tree).find(node => node.props?.["aria-label"] === "주제").props.value, suggestedTopic);
  assert.equal(walk(tree).find(node => node.props?.["aria-label"] === "키워드").props.value, target.keyword);
  assert.equal(walk(tree).find(node => node.props?.["aria-label"] === "상품 선택").props.value, "1");
  assert.equal(new URL(recommendationUrl, "http://fixture").searchParams.has("instructions"), false);
  taskFailure = true; await walk(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); assert.equal(target.status, "unused"); assert.equal(tasks.length, 0);
  taskFailure = false; await walk(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); assert.equal(target.status, "used"); assert.equal(tasks[0].blog_keyword_id, target.id); assert.equal(tasks[0].keyword, target.keyword);
  assert.equal(tasks[0].topic, suggestedTopic); assert.equal(tasks[0].instructions, "");
  await ready(`http://fixture/content/blog/new?keywordId=${target.id}`);
  assert.ok(walk(render()).some(node => node.props?.role === "alert"));
  await ready("http://fixture/content/blog/new"); tree = render();
  walk(tree).find(node => node.props?.["aria-label"] === "상품 선택").props.onChange({ target: { value: "1" } });
  walk(tree).find(node => node.props?.["aria-label"] === "주제").props.onChange({ target: { value: "일반 작업" } });
  await walk(render()).find(node => node.type === "form").props.onSubmit({ preventDefault() {} }); assert.equal(submissions.at(-1).blog_keyword_id, undefined);
} finally { globalThis.window = oldWindow; globalThis.alert = oldAlert; }
const sql = readFileSync("supabase/migrations/202610170002_blog_keyword_pool.sql", "utf8");
assert.match(sql, /UNIQUE\(product_id, normalized_keyword\)/);
assert.match(sql, /BEFORE INSERT ON public.blog_tasks/); assert.match(sql, /AFTER DELETE ON public.blog_tasks/);
assert.match(sql, /NOT EXISTS \(SELECT 1 FROM public.blog_tasks WHERE blog_keyword_id = OLD.blog_keyword_id\)/);
assert.match(sql, /FOR UPDATE/); assert.doesNotMatch(sql.split("ON CONFLICT")[1].split("GET DIAGNOSTICS")[0], /status\s*=/);
assert.doesNotMatch(sql, /DELETE FROM|DROP TABLE|ALTER POLICY/);
// Reference model for SQL AFTER DELETE semantics; remote triggers are not run by this test.
const references = [{ blog_keyword_id: target.id }, { blog_keyword_id: target.id }];
const release = () => { references.pop(); if (!references.some(task => task.blog_keyword_id === target.id) && target.status === "used") target.status = "unused"; };
target.status = "used"; release(); assert.equal(target.status, "used"); release(); assert.equal(target.status, "unused");
target.status = "excluded"; release(); assert.equal(target.status, "excluded");
const importUi = load("app/content/blog/keywords/KeywordImport.tsx", { "@/lib/blog-keywords/shared": shared, "next/navigation": { useRouter: () => ({}) } }).default;
assert.ok(renderToStaticMarkup(React.createElement(importUi, { products: [{ id: 1, name: "Product" }] })).includes("Excel / CSV"));
let importState = [], importCursor = 0, refreshes = 0;
const interactiveImport = load("app/content/blog/keywords/KeywordImport.tsx", {
  "@/lib/blog-keywords/shared": shared,
  react: { useEffect() {}, useRef: () => ({ current: false }), useState(initial) { const i = importCursor++; if (!(i in importState)) importState[i] = initial; return [importState[i], value => { importState[i] = value; }]; } },
  "next/navigation": { useRouter: () => ({ refresh() { refreshes++; } }) },
}).default;
const originalFetch = globalThis.fetch;
try {
  for (const [reply, expected] of [
    [async () => { throw new TypeError("Failed to fetch"); }, /preview FETCH/],
    [async () => ({ text: async () => { throw new TypeError("terminated"); } }), /preview BODY_READ/],
    [async () => new Response("not JSON"), /preview JSON_PARSE/],
    [async () => Response.json({ error: "DB error" }, { status: 500 }), /preview HTTP 500: DB error/],
    [async () => Response.json(preview.summary), null],
  ]) {
    importState = ["1", "", csv, sheet.columns, mapping, null, false, "", ""];
    globalThis.fetch = reply; importCursor = 0;
    const tree = interactiveImport({ products: [{ id: 1, name: "Product" }] });
    await walk(tree).find(node => node.type === "button" && node.props.children === "Preview").props.onClick();
    // onClick deliberately returns void; drain the asynchronous run handler.
    await new Promise(resolve => setImmediate(resolve));
    if (expected) assert.match(importState[8], expected);
    else { assert.equal(importState[8], ""); assert.equal(importState[5].totalRows, preview.summary.totalRows); }
  }
  assert.equal(refreshes, 0, "Preview never refreshes or navigates");
} finally { globalThis.fetch = originalFetch; }
const queries = [];
let fixtureCount = 4753;
const pageDb = { from(table) {
  let start = 0, end = 49, head = false;
  const query = { select(_fields, options) { assert.ok(!_fields.includes("ad_count")); if (table === "blog_keywords") { assert.equal(options.count, "exact"); head = options.head; } return this; },
    or(expression) { queries.push(["or", expression]); return this; },
    is(key, value) { queries.push(["is", key, value]); return this; }, not(key, operator, value) { queries.push(["not", key, operator, value]); return this; }, gte(key, value) { queries.push(["gte", key, value]); return this; }, lt(key, value) { queries.push(["lt", key, value]); return this; }, eq(key, value) { queries.push([key, value]); return this; }, ilike(key, value) { queries.push([key, value]); return this; }, order(key, options) { queries.push(["order", key, options]); return this; },
    range(first, last) { start = first; end = last; queries.push(["range", start, end]); assert.ok([15, 30, 50].includes(end - start + 1)); return this; },
    then(resolve) { return Promise.resolve(table === "products" ? { data: [{ id: 1, name: "Product" }] } : { count: fixtureCount, data: head ? null : Array.from({ length: Math.max(0, Math.min(end + 1, fixtureCount) - start) }, (_, i) => ({ id: String(start + i), keyword: "keyword" + (start + i), product_id: 1, status: "unused", created_at: "2026-10-17T00:00:00Z" })) }).then(resolve); } };
  return query;
} };
const importPlaceholder = () => null, evaluationPlaceholder = () => null;
const relevanceFilters = load("lib/blog-keywords/relevance-filter.ts");
const poolPage = load("app/content/blog/keywords/page.tsx", { "@/lib/blog-keywords/ai-settings": { async readKeywordAISettings() { return { relevance_version: 2 }; } }, "@/lib/blog-keywords/relevance-filter": relevanceFilters, "next/navigation": { redirect(url) { throw new Error(`REDIRECT:${url}`); } }, "@/lib/supabase": { supabase: pageDb }, "next/link": { default: "a", __esModule: true }, "./RelevanceEvaluation": { default: evaluationPlaceholder, __esModule: true }, "./PageSizeSelect": { default: () => null, __esModule: true }, "./KeywordImport": { default: importPlaceholder, __esModule: true }, "./KeywordActions": { default: () => null, __esModule: true } }).default;
const poolHtml = renderToStaticMarkup(await poolPage({ searchParams: Promise.resolve({ product: "1", status: "unused", q: "눈가", sort: "volume", page: "2", pageSize: "50" }) }));
assert.ok(poolHtml.includes("4,753")); assert.ok(poolHtml.includes("keyword99")); assert.ok(!poolHtml.includes("keyword100"));
assert.ok(queries.some(([key, value]) => key === "order" && value === "search_volume")); assert.ok(queries.some(([key, value]) => key === "status" && value === "unused"));
const filters = { product: "1", status: "unused", q: "눈가", sort: "search_volume_desc", pageSize: "50", relevance: "80" };
const list = params => poolPage({ searchParams: Promise.resolve(params) });
for (const product of ["", "1", "2"]) {
  const tree = await list({ product });
  const children = tree.props.children;
  assert.ok(!walk(tree).some(node => node.type === "th" && node.props.children === "광고수"));
  assert.ok(!walk(tree).some(node => node.type === "option" && node.props.value === "ad_count_desc"));
  const evaluation = children.find(node => node.type === evaluationPlaceholder);
  assert.equal("productId" in evaluation.props, false, "Pool Product is not passed to evaluation");
  assert.equal(evaluation.key, null, "Changing Pool Product does not remount evaluation");
  const importIndex = children.findIndex(node => node.type === importPlaceholder);
  const evaluationIndex = children.indexOf(evaluation);
  const recommendationIndex = children.findIndex(node => node.props?.["aria-label"] === "AI 추천");
  const poolIndex = children.findIndex(node => node.props?.["aria-label"] === "Keyword Pool 직접 탐색");
  assert.ok(importIndex < evaluationIndex && evaluationIndex < recommendationIndex && recommendationIndex < poolIndex);
  assert.ok(walk(tree).some(node => node.props?.children === "AI 추천 5개 보기" && node.props.href.startsWith("/content/blog/keywords/recommend")));
}
for (const page of [1, 2, 47, 96]) {
  const tree = await list({ ...filters, page: String(page) }), html = renderToStaticMarkup(tree);
  assert.ok(html.includes(`총 4,753개 · ${page} / 96페이지`));
  const links = walk(tree).filter(node => node.props?.href?.startsWith("/content/blog/keywords?"));
  assert.ok(links.length <= 11);
  assert.equal(links.find(node => node.props["aria-current"] === "page").props.children, page);
  for (const link of links) {
    const url = new URL(link.props.href, "http://fixture");
    for (const [key, value] of Object.entries(filters)) assert.equal(url.searchParams.get(key), value);
  }
  for (const [label, target] of [["처음", 1], ["이전", page - 1], ["다음", page + 1], ["마지막", 96]]) {
    const link = links.find(node => node.props.children === label);
    if ((page === 1 && ["처음", "이전"].includes(label)) || (page === 96 && ["다음", "마지막"].includes(label))) assert.equal(link, undefined);
    else assert.equal(new URL(link.props.href, "http://fixture").searchParams.get("page"), String(target));
  }
  const rows = walk(tree).find(node => node.type === "tbody");
  assert.equal(React.Children.count(rows.props.children), page === 96 ? 3 : 50);
  if (page === 96) assert.ok(html.includes("현재 4751–4753개"));
  if (page === 47) { assert.deepEqual(links.filter(node => node.props["aria-label"]).map(node => node.props.children), [1, 45, 46, 47, 48, 49, 96]); assert.ok(html.includes("…")); }
  const form = walk(tree).find(node => node.type === "form");
  assert.equal(walk(form).find(node => node.props?.name === "page").props.value, "1");
}
for (const raw of [undefined, "15", "30", "50", "500", "all", "", "15.0", "030", ["15", "50"]]) {
  const size = ["15", "30", "50"].includes(raw) ? Number(raw) : 30;
  const last = Math.ceil(4753 / size);
  for (const page of [1, 2, last]) {
    queries.length = 0;
    const tree = await list({ ...filters, pageSize: raw, page: String(page) });
    const html = renderToStaticMarkup(tree);
    assert.ok(html.includes(page + " / " + last + "페이지"));
    assert.ok(html.includes("현재 " + ((page - 1) * size + 1) + "–" + Math.min(page * size, 4753) + "개"));
    assert.ok(queries.some(([kind, start, end]) => kind === "range" && start === (page - 1) * size && end === page * size - 1));
    assert.equal(React.Children.count(walk(tree).find(node => node.type === "tbody").props.children), Math.min(size, 4753 - (page - 1) * size));
    const form = walk(tree).find(node => node.type === "form");
    assert.equal(walk(form).find(node => node.props?.name === "page").props.value, "1");
    for (const key of ["product", "status", "q", "sort", "relevance"]) assert.equal(walk(form).find(node => node.props?.name === key).props.defaultValue, filters[key]);
    const sizeControl = walk(form).find(node => node.props?.pageSize === size);
    assert.ok(sizeControl);
    for (const link of walk(tree).filter(node => node.props?.href?.startsWith("/content/blog/keywords?"))) {
      const url = new URL(link.props.href, "http://fixture");
      assert.equal(url.searchParams.get("pageSize"), String(size));
      for (const key of ["product", "status", "q", "sort"]) assert.equal(url.searchParams.get(key), filters[key]);
    }
  }
}
let currentQuery = new URLSearchParams({ ...filters, productId: "1", pageSize: "30", page: "5" }), pushedUrl;
const pageSizeSelect = load("app/content/blog/keywords/PageSizeSelect.tsx", {
  "next/navigation": {
    useRouter: () => ({ push(url) { pushedUrl = url; } }),
    usePathname: () => "/content/blog/keywords",
    useSearchParams: () => currentQuery,
  },
}).default;
for (const [before, selected, expected] of [[30, "15", 15], [15, "50", 50], [50, "500", 30]]) {
  const select = pageSizeSelect({ pageSize: before });
  assert.equal(select.props.defaultValue, before);
  assert.deepEqual(React.Children.toArray(select.props.children).map(node => node.props.value), [15, 30, 50]);
  pushedUrl = undefined;
  select.props.onChange({ currentTarget: { value: selected, form: { requestSubmit() { assert.fail("Page size must not submit filter form"); } } } });
  assert.ok(pushedUrl, "Selection immediately navigates");
  const url = new URL(pushedUrl, "http://fixture");
  assert.equal(url.pathname, "/content/blog/keywords");
  assert.equal(url.searchParams.get("page"), "1");
  assert.equal(url.searchParams.get("pageSize"), String(expected));
  for (const key of ["product", "productId", "q", "status", "sort"]) assert.equal(url.searchParams.get(key), currentQuery.get(key));
  const tree = await list(Object.fromEntries(url.searchParams));
  assert.equal(React.Children.count(walk(tree).find(node => node.type === "tbody").props.children), expected);
  assert.ok(walk(tree).some(node => node.props?.pageSize === expected), "Reload reads size from URL");
  currentQuery = url.searchParams;
}
for (const [sort, column, ascending] of [[undefined, "search_volume", false], ["search_volume_desc", "search_volume", false], ["search_volume_asc", "search_volume", true], ["created_at_desc", "created_at", false], ["created_at_asc", "created_at", true], ["keyword_asc", "keyword", true], ["ad_count_desc", "search_volume", false], ["relevance_desc", "product_relevance_score", false], ["relevance_asc", "product_relevance_score", true], ["volume", "search_volume", false], ["recent", "created_at", false], ["invalid", "search_volume", false], ["toString", "search_volume", false]]) {
  queries.length = 0; await list({ sort });
  assert.ok(queries.some(([kind, key, options]) => kind === "order" && key === column && options?.ascending === ascending && options.nullsFirst === false));
  assert.ok(queries.some(([kind, key]) => kind === "order" && key === "id"));
}
for (const [relevance, operator, value] of [["evaluated", "not", "is"], ["unevaluated", "or", relevanceFilters.pendingRelevanceFilter(2)], ["80", "gte", 80], ["60", "gte", 60], ["under40", "lt", 40]]) {
  queries.length = 0;
  const tree = await list({ relevance, sort: "search_volume_desc", status: "unused", q: "눈가", pageSize: "15", page: "2" });
  if (relevance === "unevaluated") assert.equal(queries.filter(([op, expression]) => op === "or" && expression === value).length, 2);
  else {
    assert.equal(queries.filter(([op, key, target]) => op === operator && key === "product_relevance_score" && target === value).length, 2, "Count and row queries use identical relevance filter");
    assert.equal(queries.filter(([key, value]) => key === "product_relevance_criteria_version" && value === 2).length, 2, "Stale scores excluded from evaluated and threshold filters");
  }
  if (relevance === "evaluated") assert.equal(queries.filter(([op, key, operator, target]) => op === "not" && key === "product_relevance_score" && operator === "is" && target === null).length, 2);
  assert.ok(queries.some(([key, value]) => key === "status" && value === "unused"));
  assert.ok(queries.some(([key, value]) => key === "keyword" && value === "%눈가%"));
  assert.ok(walk(tree).some(node => node.type === "th" && node.props.children === "연관도"));
  const form = walk(tree).find(node => node.type === "form");
  assert.equal(walk(form).find(node => node.props?.name === "relevance").props.defaultValue, relevance);
  for (const link of walk(tree).filter(node => node.props?.href?.startsWith("/content/blog/keywords?"))) assert.equal(new URL(link.props.href, "http://fixture").searchParams.get("relevance"), relevance);
}
for (const [page, expected] of [["999", 96], ["0", 1], ["-3", 1], ["oops", 1], ["1.5", 1], ["999999999999999999999", 1]]) {
  await assert.rejects(() => list({ ...filters, page }), error => {
    const url = new URL(error.message.slice("REDIRECT:".length), "http://fixture");
    assert.equal(url.searchParams.get("page"), String(expected));
    for (const [key, value] of Object.entries(filters)) assert.equal(url.searchParams.get(key), value);
    return true;
  });
}
fixtureCount = 0;
assert.ok(renderToStaticMarkup(await list({})).includes("현재 0–0개"));
fixtureCount = 51;
await assert.rejects(() => list({ page: "96", q: "filtered" }), /page=2/);
console.log("PASS: pagination 4753 at 15/30/50 (default 30), navigation, page window, final 3 rows, seven sorts and relevance filters, NULLS LAST query contracts, URL preservation/reset, bounds and empty results (mock DB).");
console.log("PASS: real CSV/XLSX parser, reordered/unnamed C mapping, preview/metrics/raw data, 4753 rows in 10 batches, reimport/status preservation, Product isolation, status API, existing Task prefill/save failure/success, SQL lifecycle contracts. SQL triggers are not executed against a remote DB.");
