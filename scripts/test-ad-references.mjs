import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

function load(path, mocks = {}) {
  const file = resolve(path), compiled = new Module(file), original = createRequire(file);
  compiled.filename = file;
  compiled.require = name => name in mocks ? mocks[name] : original(name);
  compiled._compile(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, file);
  return compiled.exports;
}
const validation = load("lib/ads/references.ts");
const input = { title: "참고 광고", brand_name: "브랜드", product_id: null, platform: "meta", media_type: "image", source_url: "https://example.test/ad", landing_url: null, tags: ["hook", "hook"], notes: "메모" };
assert.deepEqual(validation.parseAdReference(input).tags, ["hook"]);
for (const change of [{ title: " " }, { brand_name: "" }, { platform: "__proto__" }, { media_type: "audio" }, { source_url: "javascript:alert(1)" }, { landing_url: "https://user:pass@example.test" }, { product_id: -1 }, { tags: ["x".repeat(51)] }, { tags: Array(31).fill("x") }]) {
  assert.throws(() => validation.parseAdReference({ ...input, ...change }));
}
assert.equal(validation.parseAdReference({ ...input, source_url: "", landing_url: "", product_id: 2 }).product_id, 2);
for (const [type, mediaType] of [["image/png", "image"], ["image/jpeg", "image"], ["image/webp", "image"], ["video/mp4", "video"], ["video/webm", "video"]]) {
  assert.ok(validation.validateAdFile({ name: "test", size: 1, type }, mediaType));
}
for (const file of [{ type: "image/svg+xml", size: 1 }, { type: "image/png", size: 0 }, { type: "image/png", size: 10 * 1024 * 1024 + 1 }, { type: "video/mp4", size: 1 }]) {
  assert.throws(() => validation.validateAdFile({ name: "test", ...file }, "image"));
}
assert.throws(() => validation.validateAdFile({ name: "test", type: "video/mp4", size: 50 * 1024 * 1024 + 1 }, "video"));

const rows = [], objects = new Set(), events = [];
let writeFailure = false, uploadFailure = false, removeFailure = false, tick = 0;
const supabase = {
  from(table) {
    assert.equal(table, "ad_references");
    const filters = [];
    let operation = "select", values;
    return {
      select() { return this; }, eq(key, value) { filters.push(row => row[key] === value); return this; },
      insert(data) { operation = "insert"; values = data; return this; },
      update(data) { operation = "update"; values = data; return this; }, delete() { operation = "delete"; return this; },
      async maybeSingle() {
        const row = rows.find(row => filters.every(filter => filter(row)));
        if (operation !== "select" && writeFailure) return { data: null, error: { message: "DB unavailable" } };
        if (operation === "insert") {
          const created = { ...values, created_at: "2026-10-16T00:00:00Z", updated_at: String(++tick) };
          rows.push(created); events.push("insert"); return { data: structuredClone(created), error: null };
        }
        if (operation === "update" && row) { Object.assign(row, values, { updated_at: String(++tick) }); events.push("update"); }
        if (operation === "delete" && row) { rows.splice(rows.indexOf(row), 1); events.push("delete"); }
        return { data: row ? structuredClone(row) : null, error: null };
      },
    };
  },
  storage: { from(bucket) {
    assert.equal(bucket, "ad-reference-assets", "Product/Blog buckets must remain untouched");
    return {
      async upload(path, file, options) { assert.equal(options.upsert, false); events.push("upload"); if (uploadFailure) return { error: {} }; objects.add(path); return { error: null }; },
      async remove(paths) { events.push("remove"); if (removeFailure) return { error: {} }; paths.forEach(path => objects.delete(path)); return { error: null }; },
    };
  } },
};
const store = load("lib/ads/reference-store.ts", { "@/lib/supabase": { supabase }, "./references": validation });
const png = new File(["fixture"], "광고.png", { type: "image/png" });
const created = await store.saveAdReference(input, null);
assert.equal(rows.length, 1); assert.equal(objects.size, 0);
assert.equal((await store.getAdReference(created.id)).title, input.title);
const beforeUpload = rows[0].updated_at;
await store.saveAdReference({ ...input, title: "수정", product_id: 1 }, png, { id: created.id, updatedAt: beforeUpload });
assert.equal(rows[0].title, "수정"); assert.equal(rows[0].product_id, 1); assert.equal(objects.size, 1);
assert.equal(rows[0].original_file_name, "광고.png");
const originalPath = rows[0].asset_storage_path;
await assert.rejects(() => store.saveAdReference(input, png, { id: created.id, updatedAt: beforeUpload }), /변경/);
await assert.rejects(() => store.saveAdReference({ ...input, media_type: "video" }, null, { id: created.id, updatedAt: rows[0].updated_at }), /유형 변경/);
uploadFailure = true;
await assert.rejects(() => store.saveAdReference(input, png, { id: created.id, updatedAt: rows[0].updated_at }), /업로드/);
uploadFailure = false;
assert.ok(objects.has(originalPath));
writeFailure = true;
await assert.rejects(() => store.saveAdReference(input, png, { id: created.id, updatedAt: rows[0].updated_at }), /보존/);
assert.ok(objects.has(originalPath)); assert.equal(rows[0].asset_storage_path, originalPath);
writeFailure = false;
events.length = 0;
await store.saveAdReference(input, png, { id: created.id, updatedAt: rows[0].updated_at });
assert.deepEqual(events, ["upload", "update", "remove"]);
assert.equal(objects.has(originalPath), false);
await store.saveAdReference({ ...input, media_type: "other" }, null, { id: created.id, updatedAt: rows[0].updated_at, removeAsset: true });
assert.equal(rows[0].asset_storage_path, null); assert.equal(rows[0].original_file_name, null);
await assert.rejects(() => store.deleteAdReference(created.id, "stale"), /변경/);
await store.deleteAdReference(created.id, rows[0].updated_at); assert.equal(rows.length, 0);
const withFile = await store.saveAdReference(input, png);
removeFailure = true;
const deletion = await store.deleteAdReference(withFile.id, rows[0].updated_at);
assert.match(deletion.warning, /정리/); assert.equal(rows.length, 0);
await assert.rejects(() => store.getAdReference(withFile.id), error => error.status === 404);
await assert.rejects(() => store.getAdReference("../../products"), error => error.status === 400);
removeFailure = false;
const video = await store.saveAdReference({ ...input, media_type: "video" }, new File(["fixture"], "ad.mp4", { type: "video/mp4" }));
assert.match(rows[0].asset_storage_path, /\.mp4$/);
await store.deleteAdReference(video.id, rows[0].updated_at);

const mocks = { "@/lib/ads/reference-store": store, "@/lib/ads/references": validation };
const createRoute = load("app/api/ads/references/route.ts", mocks);
const route = load("app/api/ads/references/[id]/route.ts", mocks);
const form = new FormData(); form.set("data", JSON.stringify(input));
const response = await createRoute.POST(new Request("http://fixture.test", { method: "POST", body: form }));
assert.equal(response.status, 201);
const saved = await response.json();
const updateForm = new FormData(); updateForm.set("data", JSON.stringify({ ...input, title: "API 수정" })); updateForm.set("updatedAt", rows[0].updated_at);
assert.equal((await route.PATCH(new Request("http://fixture.test", { method: "PATCH", body: updateForm }), { params: Promise.resolve({ id: saved.id }) })).status, 200);
assert.equal(rows[0].title, "API 수정");
assert.equal((await route.DELETE(new Request("http://fixture.test", { method: "DELETE", body: JSON.stringify({ updatedAt: rows[0].updated_at }) }), { params: Promise.resolve({ id: saved.id }) })).status, 200);
assert.equal((await createRoute.POST(new Request("http://fixture.test", { method: "POST", body: new FormData() }))).status, 400);

const formComponent = load("app/ads/references/AdReferenceForm.tsx", { "@/lib/ads/references": validation, "next/navigation": { useRouter: () => ({}) }, "next/link": { default: "a", __esModule: true } }).default;
const markup = renderToStaticMarkup(React.createElement(formComponent, { products: [{ id: 1, name: "연결 상품" }] }));
for (const label of ["광고명", "브랜드", "Product", "플랫폼", "소재 유형", "광고 원본 URL", "랜딩 URL", "파일", "태그", "메모"]) assert.ok(markup.includes(label));
assert.ok(markup.includes('name="file"')); assert.ok(markup.includes("연결 상품"));
assert.match(readFileSync("app/ads/references/[id]/DeleteAdReference.tsx", "utf8"), /window.confirm/);
assert.match(readFileSync("app/layout.tsx", "utf8"), /href="\/ads\/references">Ads/);
const reference = { ...input, id: created.id, product_id: 1, asset_storage_path: "fixture.png", original_file_name: "광고.png", created_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T01:00:00Z" };
const readClient = {
  from(table) {
    const result = { data: table === "products" ? [{ id: 1, name: "연결 상품" }] : [reference], error: null };
    return { select() { return this; }, order() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: result.data[0], error: null }), then: resolve => Promise.resolve(result).then(resolve) };
  },
  storage: { from(bucket) { assert.equal(bucket, validation.AD_ASSET_BUCKET); return { createSignedUrl: async () => ({ data: { signedUrl: "https://fixture.test/private-asset" }, error: null }) }; } },
};
const viewMocks = { "@/lib/supabase": { supabase: readClient }, "@/lib/ads/references": validation,
  "@/lib/ads/reference-store": { getAdReference: async () => reference }, "next/link": { default: "a", __esModule: true },
  "next/navigation": { notFound: () => { throw new Error("404"); } }, "./DeleteAdReference": { default: () => null, __esModule: true } };
const listPage = load("app/ads/references/page.tsx", viewMocks).default;
const listHtml = renderToStaticMarkup(await listPage());
for (const content of [input.title, input.brand_name, "Meta", "이미지", "연결 상품", "hook", "등록"]) assert.ok(listHtml.includes(content));
const detailPage = load("app/ads/references/[id]/page.tsx", viewMocks).default;
const detailHtml = renderToStaticMarkup(await detailPage({ params: Promise.resolve({ id: created.id }) }));
for (const content of [input.title, input.notes, "첨부 파일 열기", "https://fixture.test/private-asset", "수정"]) assert.ok(detailHtml.includes(content));
const migration = readFileSync("supabase/migrations/202610160003_ad_references.sql", "utf8");
assert.match(migration, /ON DELETE SET NULL/); assert.match(migration, /false, 52428800/); assert.doesNotMatch(migration, /hook|roas|analysis_result/i);
console.log("PASS: reference validation, URL-only CRUD, optional Product, image/video types and limits, file replacement/removal, stale edits, DB/upload/cleanup failures, CRUD API, form fields, delete confirmation and independent Storage.");
