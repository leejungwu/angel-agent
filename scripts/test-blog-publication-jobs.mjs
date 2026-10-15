import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

async function load(path, imports = {}) {
  const testModule = { exports: {} };
  const code = ts.transpileModule(await readFile(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module: testModule, exports: testModule.exports, require(name) { assert.ok(name in imports, name); return imports[name]; } });
  return testModule.exports;
}
const assetsModule = await load("lib/blog-task-assets.ts");
const placementSettings = await load("lib/blog-publishing/image-placement-settings.ts");
const layout = await load("lib/blog-publishing/image-layout.ts", { "./image-placement-settings": placementSettings });
const preparation = await load("lib/blog-publishing/preparation.ts", { "./image-layout": layout });
const blocks = await load("lib/blog-publishing/blocks.ts");
const downloads = await load("lib/blog-publishing/downloads.ts", { "../blog-task-assets": assetsModule });
let draft, assets, jobs, sequence, taskSettings;
function reset(count = 2) {
  draft = { id: 2, blog_task_id: 1, status: "approved", title: "제목", intro: "도입입니다. 이어지는 문장입니다.", sections: [{ heading: "소제목", body: "본문입니다. 다음 설명입니다. 충분한 내용을 이어 씁니다." }], closing: "마무리입니다." };
  assets = Array.from({ length: count }, (_, i) => ({ id: i + 1, storage_path: `tasks/1/${i}.png`, file_name: `${i}.png`, sort_order: i, signedUrl: "secret" })).reverse();
  jobs = []; sequence = 0; taskSettings = null;
}
const supabase = { from(table) {
  const filters = [], contains = [];
  let insert;
  const query = {
    select() { return this; }, eq(key, value) { filters.push([key, String(value)]); return this; }, order() { return this; },
    contains(key, value) { contains.push([key, value]); return this; }, limit() { return this; },
    insert(value) { insert = value; return this; },
    async maybeSingle() {
      if (insert) {
        if (jobs.some(j => String(j.blog_draft_id) === String(insert.blog_draft_id))) return { error: { code: "23505" }, data: null };
        const job = { id: String(++sequence), ...structuredClone(insert) }; jobs.push(job); return { data: structuredClone(job), error: null };
      }
      const rows = table === "blog_tasks" ? [{ id: 1, image_placement_settings: taskSettings }] : table === "blog_drafts" ? [draft] : jobs;
      return { data: structuredClone(rows.find(row => filters.every(([k, v]) => String(row[k]) === v) && contains.every(([k, v]) => v.images.every(wanted => row[k].images.some(image => Object.entries(wanted).every(([key, value]) => image[key] === value))))) ?? null), error: null };
    },
    async then(resolve, reject) { return Promise.resolve({ data: structuredClone(assets), error: null }).then(resolve, reject); },
  };
  return query;
} };
const api = await load("lib/blog-publishing/publication-jobs.ts", {
  "@/lib/supabase": { supabase }, "../blog-task-assets": assetsModule, "./downloads": downloads, "./preparation": preparation, "./blocks": blocks,
});
for (const count of [0, 1, 2, 8, 10]) {
  reset(count);
  const job = await api.createPublicationJob({ taskId: "1", draftId: "2" });
  const snapshot = job.execution_snapshot;
  assert.equal(snapshot.images.length, count);
  assert.equal(snapshot.blocks.filter(b => b.type === "image").length, count);
  assert.deepEqual(Array.from(snapshot.images, i => i.sortOrder), Array.from({ length: count }, (_, i) => i));
  assert.deepEqual(Array.from(snapshot.blocks.filter(b => b.type === "image"), b => b.index), Array.from({ length: count }, (_, i) => i));
  assert.equal(snapshot.blocks.filter(b => b.type === "text").map(b => b.text).join(""), snapshot.bodyText);
  assert.equal(JSON.stringify(snapshot).includes("signedUrl"), false);
  const frozen = JSON.stringify(snapshot);
  draft.title = "변경"; draft.intro = "변경된 본문"; draft.status = "draft"; assets = [];
  const existing = await api.createPublicationJob({ taskId: "1", draftId: "2" });
  assert.equal(JSON.stringify(existing.execution_snapshot), frozen);
  assert.equal(jobs.length, 1);
  if (count) {
    assert.equal(await api.isAssetReferencedByPublicationJob({ assetId: 1 }), true);
    assert.equal(await api.isAssetReferencedByPublicationJob({ storagePath: "tasks/1/0.png" }), true);
  }
  assert.equal(await api.isAssetReferencedByPublicationJob({ assetId: 999 }), false);
}
reset(10);
taskSettings = { pinFirstAfterIntro: true, pinLastBeforeClosing: true, allowParagraphSplit: false };
const pinnedJob = await api.createPublicationJob({ taskId: "1", draftId: "2" });
const pinnedSnapshot = JSON.stringify(pinnedJob.execution_snapshot);
const planned = preparation.prepareBlogPost(draft, assets.length, taskSettings);
const expectedBlocks = blocks.createBlogExecutionBlocks(planned.executionBodyText, assets.map((_, index) => ({ index, insertOffset: planned.imageInsertOffsets[index] })))
  .map(block => block.type === "text" ? block : { type: "image", index: block.index });
assert.equal(JSON.stringify(pinnedJob.execution_snapshot.blocks), JSON.stringify(expectedBlocks));
assert.equal(pinnedJob.execution_snapshot.bodyText, planned.executionBodyText);
assert.deepEqual(Object.keys(pinnedJob.execution_snapshot).sort(), ["blocks", "bodyText", "images", "title", "version"]);
taskSettings = { pinFirstAfterIntro: false, pinLastBeforeClosing: false, allowParagraphSplit: true };
assert.equal(JSON.stringify((await api.createPublicationJob({ taskId: "1", draftId: "2" })).execution_snapshot), pinnedSnapshot);
reset(3);
const originalOrderJob = await api.createPublicationJob({ taskId: "1", draftId: "2" });
const originalOrderSnapshot = JSON.stringify(originalOrderJob.execution_snapshot);
for (const [index, assetId] of [3, 1, 2].entries()) assets.find(asset => asset.id === assetId).sort_order = index;
const reordered = downloads.orderedTaskImages("1", assets);
assert.deepEqual(Array.from(reordered, asset => asset.id), [3, 1, 2]);
const reorderedPreparation = preparation.prepareBlogPost(draft, reordered.length, taskSettings);
assert.deepEqual(Array.from(reorderedPreparation.blocks.filter(block => block.type === "image"), block => reordered[block.imageIndex].id), [3, 1, 2]);
assert.equal(JSON.stringify((await api.createPublicationJob({ taskId: "1", draftId: "2" })).execution_snapshot), originalOrderSnapshot);
// A new approved Draft gets the current order and independently copied Product photo.
assets.push({ id: 4, storage_path: "tasks/1/product-copy.png", file_name: "product.png", sort_order: 3, source_product_asset_id: 99 });
draft.id = 3;
const reorderedJob = await api.createPublicationJob({ taskId: "1", draftId: "3" });
assert.deepEqual(Array.from(reorderedJob.execution_snapshot.images, image => Number(image.assetId)), [3, 1, 2, 4]);
assert.equal(JSON.stringify(jobs[0].execution_snapshot), originalOrderSnapshot);
reset(1);
const jobA = await api.createPublicationJob({ taskId: "1", draftId: "2" });
const originalImagePath = assets[0].storage_path, frozenA = JSON.stringify(jobA.execution_snapshot);
assets[0].original_storage_path = originalImagePath;
assets[0].storage_path = "tasks/1/edited-B.webp"; assets[0].edit_metadata = { brightness: 110 };
draft.id = 3;
const jobB = await api.createPublicationJob({ taskId: "1", draftId: "3" });
const frozenB = JSON.stringify(jobB.execution_snapshot);
assert.equal(jobB.execution_snapshot.images[0].storagePath, "tasks/1/edited-B.webp");
assert.equal(downloads.numberedImageFilename(downloads.orderedTaskImages("1", assets)[0].storage_path, 0), "01.webp");
assets[0].storage_path = "tasks/1/edited-C.webp"; draft.id = 4;
assert.equal((await api.createPublicationJob({ taskId: "1", draftId: "4" })).execution_snapshot.images[0].storagePath, "tasks/1/edited-C.webp");
assert.equal(JSON.stringify(jobs[0].execution_snapshot), frozenA); assert.equal(JSON.stringify(jobs[1].execution_snapshot), frozenB);
assets[0].storage_path = originalImagePath; assets[0].edit_metadata = null;
assert.equal(JSON.stringify(jobs[1].execution_snapshot), frozenB);
for (const status of ["draft", "rejected"]) {
  reset(); draft.status = status;
  await assert.rejects(api.createPublicationJob({ taskId: "1", draftId: "2" }), /승인/);
}
reset();
await assert.rejects(api.createPublicationJob({ taskId: "9", draftId: "2" }), /작업/);
await assert.rejects(api.createPublicationJob({ taskId: "1", draftId: "9" }), /초안/);
draft.blog_task_id = 9;
await assert.rejects(api.createPublicationJob({ taskId: "1", draftId: "2" }), /초안/);
reset(); draft.sections = [{ body: 1 }];
await assert.rejects(api.createPublicationJob({ taskId: "1", draftId: "2" }), /형식/);
reset();
await Promise.all([api.createPublicationJob({ taskId: "1", draftId: "2" }), api.createPublicationJob({ taskId: "1", draftId: "2" })]);
assert.equal(jobs.length, 1);
const valid = jobs[0].execution_snapshot;
for (const mutate of [
  s => s.version = 2, s => s.title = " ", s => s.bodyText += "x", s => s.blocks = [],
  s => s.images.pop(), s => s.images[0].storagePath = "../bad", s => s.images[0].sortOrder = 0.5,
  s => s.images[0].assetId = 0, s => s.images[0].fileName = "", s => s.signedUrl = "secret",
  s => s.blocks.find(b => b.type === "image").index = 9,
  s => { const images = s.blocks.filter(b => b.type === "image"); images[1].index = images[0].index; },
  s => s.blocks.find(b => b.type === "image").signedUrl = "secret",
]) {
  const invalid = structuredClone(valid); mutate(invalid);
  assert.throws(() => api.parsePublicationSnapshot(invalid));
}
assert.equal(JSON.stringify(api.parsePublicationSnapshot(valid)), JSON.stringify(valid));
const detached = api.parsePublicationSnapshot(valid);
detached.title = "호출자가 변경";
assert.notEqual(valid.title, detached.title);
for (const invalid of [null, {}, { ...valid, images: null }, { ...valid, bodyText: " " }]) {
  assert.throws(() => api.parsePublicationSnapshot(invalid));
}
await assert.rejects(api.isAssetReferencedByPublicationJob({}), /참조/);
await assert.rejects(api.isAssetReferencedByPublicationJob({ storagePath: "../bad" }), /경로/);
const sql = await readFile("supabase/migrations/202610150003_create_blog_publication_jobs.sql", "utf8");
assert.match(sql, /format_type\(atttypid, atttypmod\)/);
assert.equal((sql.match(/ON DELETE RESTRICT/g) ?? []).length, 2);
assert.match(sql, /blog_draft_id %s NOT NULL UNIQUE/);
assert.match(sql, /attempt_no >= 0/);
assert.match(sql, /CHECK \(status IN \('queued', 'inserting', 'inserted', 'published', 'failed'\)\)/);
assert.match(sql, /ON public\.blog_publication_jobs \(status, created_at\)/);
assert.match(sql, /NEW\.execution_snapshot IS DISTINCT FROM OLD\.execution_snapshot/);
assert.match(sql, /BEFORE UPDATE ON public\.blog_publication_jobs/);
assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
assert.doesNotMatch(sql, /ALTER TABLE public\.blog_(?:tasks|drafts|task_assets)\b|DROP TABLE|DELETE FROM/i);
console.log("Publication Job tests passed: approval, ownership, idempotency/race, 0/1/2/8/10 images, immutable data, parser, references.");
