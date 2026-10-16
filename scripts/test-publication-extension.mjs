import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

function load(file, mocks = {}) {
  const filename = resolve(file), compiled = new Module(filename), original = createRequire(filename);
  compiled.filename = filename;
  compiled.require = name => name in mocks ? mocks[name] : original(name);
  compiled._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return compiled.exports;
}
const id = "00000000-0000-4000-8000-000000000001";
let row, signCalls, signFail, denied = false;
function reset(count = 2) {
  const images = Array.from({ length: count }, (_, index) => ({ assetId: index + 1, storagePath: `tasks/1/${index}.png`, fileName: `${index}.png`, sortOrder: index }));
  const blocks = images.flatMap((_, index) => [{ type: "text", text: `구간${index}입니다.\n\n` }, { type: "image", index }]);
  blocks.push({ type: "text", text: "마지막 본문입니다." });
  row = { id, blog_task_id: 1, blog_draft_id: 2, status: "queued", attempt_no: 0, error_message: "이전 오류", execution_snapshot: {
    version: 1, title: "고정 제목", bodyText: blocks.filter(block => block.type === "text").map(block => block.text).join(""), blocks, images,
  } };
  signCalls = []; signFail = false;
}
const db = {
  from(table) {
    assert.equal(table, "blog_publication_jobs", "Execution must never read mutable Drafts/Task assets");
    const filters = []; let update;
    const query = {
      select() { return this; }, order() { return this; },
      eq(key, value) { filters.push(candidate => candidate[key] === value); return this; },
      in(key, values) { filters.push(candidate => values.includes(candidate[key])); return this; },
      update(value) { update = value; return this; },
      async maybeSingle() { return run(true); },
      then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject); },
    };
    function run(single) {
      const matches = row && filters.every(filter => filter(row));
      if (matches && update) Object.assign(row, update);
      return { data: structuredClone(single ? matches ? row : null : matches ? [row] : []), error: null };
    }
    return query;
  },
  storage: { from(bucket) { assert.equal(bucket, "blog-task-assets"); return { async createSignedUrl(path, seconds) {
    signCalls.push(path); assert.equal(seconds, 600);
    return signFail ? { error: { code: "fixture" } } : { data: { signedUrl: `https://storage.invalid/${path}?generation=${signCalls.length}` } };
  } }; } },
};
const schedule = load("lib/blog-publishing/schedule.ts");
const assets = load("lib/blog-task-assets.ts");
const placementSettings = load("lib/blog-publishing/image-placement-settings.ts");
const layout = load("lib/blog-publishing/image-layout.ts", { "./image-placement-settings": placementSettings });
const preparation = load("lib/blog-publishing/preparation.ts", { "./image-layout": layout });
const blocks = load("lib/blog-publishing/blocks.ts");
const downloads = load("lib/blog-publishing/downloads.ts", { "../blog-task-assets": assets });
const jobs = load("lib/blog-publishing/publication-jobs.ts", { "@/lib/supabase": { supabase: db }, "../blog-task-assets": assets, "./schedule": schedule, "./downloads": downloads, "./preparation": preparation, "./blocks": blocks });
const api = load("lib/blog-publishing/publication-extension.ts", { "@/lib/supabase": { supabase: db }, "../blog-task-assets": assets, "./schedule": schedule, "./publication-jobs": jobs });
for (const count of [0, 1, 2, 8, 10]) {
  reset(count);
  const frozen = JSON.stringify(row.execution_snapshot);
  const listed = await api.listExtensionPublicationJobs();
  assert.equal(listed[0].id, id); assert.equal(listed[0].imageCount, count);
  const preview = await api.publicationJobToExtensionTask(await api.getPublicationJob(id));
  assert.equal(signCalls.length, 0, "selection must not issue expiring URLs");
  assert.ok(preview.images.every(image => image.signedUrl === ""));
  const results = await Promise.allSettled([api.claimPublicationJob(id, "blocks"), api.claimPublicationJob(id, "blocks")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.find(result => result.status === "rejected").reason.status, 409);
  const task = results.find(result => result.status === "fulfilled").value;
  assert.equal(row.status, "inserting"); assert.equal(row.attempt_no, 1); assert.ok(row.started_at);
  assert.equal(task.jobId, id); assert.equal(task.attemptNo, 1); assert.equal(task.draftId, 2);
  assert.equal(task.title, "고정 제목"); assert.equal(task.images.length, count);
  assert.equal(task.blocks.filter(block => block.type === "image").length, count);
  assert.equal(task.blocks.filter(block => block.type === "text").map(block => block.text).join(""), task.bodyText);
  let offset = 0;
  for (const block of task.blocks) {
    if (block.type === "text") offset += block.text.length;
    else { assert.equal(block.signedUrl, task.images[block.index].signedUrl); assert.equal(block.insertOffset, offset); assert.equal(block.insertPrefix, task.bodyText.slice(0, offset)); }
  }
  assert.equal(JSON.stringify(row.execution_snapshot), frozen);
  assert.equal((await api.recordPublicationResult(id, 1, "inserted")).applied, true);
  assert.equal(row.status, "inserted"); assert.ok(row.inserted_at); assert.equal(row.error_message, null);
  assert.equal((await api.recordPublicationResult(id, 1, "inserted")).alreadyApplied, true);
  assert.equal((await api.recordPublicationResult(id, 1, "failed", "late failure")).applied, false);
  assert.equal(row.status, "inserted");
}
reset(10);
await assert.rejects(api.claimPublicationJob(id, "legacy"), /3장 초과/);
assert.equal(row.status, "queued"); assert.equal(signCalls.length, 0);
reset(3); assert.equal((await api.claimPublicationJob(id, "legacy")).images.length, 3);
assert.equal((await api.recordPublicationResult(id, 1, "failed", "PHOTO_UPLOAD: fixture")).applied, true);
assert.equal(row.status, "failed"); assert.equal(row.error_message, "PHOTO_UPLOAD: fixture");
assert.equal((await api.listExtensionPublicationJobs())[0].status, "failed");
await assert.rejects(api.claimPublicationJob(id, "blocks"), /발행 대기/);
// Web retry preserves the snapshot/attempt; only the next Extension claim increments it.
const retrySnapshot = JSON.stringify(row.execution_snapshot);
await jobs.transitionPublicationJob(id, { action: "retry" });
assert.equal(row.status, "queued"); assert.equal(row.attempt_no, 1);
await api.claimPublicationJob(id, "legacy");
assert.equal(row.attempt_no, 2); assert.equal(JSON.stringify(row.execution_snapshot), retrySnapshot);
assert.equal((await api.recordPublicationResult(id, 1, "inserted")).applied, false);
assert.equal((await api.recordPublicationResult(id, 1, "failed", "old")).applied, false);
assert.equal(row.status, "inserting");
assert.equal((await api.recordPublicationResult(id, 2, "inserted")).applied, true);
reset(1); signFail = true;
await assert.rejects(api.claimPublicationJob(id, "blocks"), /준비/);
assert.equal(row.status, "failed");
reset(1);
const originalDraft = { title: "고정 제목" }, originalAssets = ["tasks/1/0.png"];
const beforeChanges = await api.claimPublicationJob(id, "blocks");
await api.recordPublicationResult(id, 1, "failed", "fixture");
originalDraft.title = "변경한 제목"; originalAssets.splice(0, 1, "tasks/1/changed.png");
await jobs.transitionPublicationJob(id, { action: "retry" });
const afterChanges = await api.claimPublicationJob(id, "blocks");
assert.equal(afterChanges.title, beforeChanges.title);
assert.equal(afterChanges.bodyText, beforeChanges.bodyText);
assert.notEqual(afterChanges.title, originalDraft.title);
assert.equal(signCalls.at(-1), "tasks/1/0.png");
assert.notEqual(afterChanges.images[0].signedUrl, beforeChanges.images[0].signedUrl, "each execution signs frozen paths again");
assert.equal(afterChanges.attemptNo, 2);
reset(); row.execution_snapshot.bodyText = "잘못된 본문";
await assert.rejects(api.claimPublicationJob(id, "blocks")); assert.equal(row.status, "queued");
reset(1);
await api.claimPublicationJob(id, "blocks");
const recoverySnapshot = JSON.stringify(row.execution_snapshot);
row.started_at = new Date(Date.now() - 10 * 60 * 1000).toISOString();
await jobs.transitionPublicationJob(id, { action: "recover" });
assert.equal(row.status, "queued"); assert.equal(row.attempt_no, 1);
assert.equal(JSON.stringify(row.execution_snapshot), recoverySnapshot);
assert.equal((await api.recordPublicationResult(id, 1, "inserted")).applied, false);
await api.claimPublicationJob(id, "blocks");
assert.equal(row.attempt_no, 2);
assert.equal((await api.recordPublicationResult(id, 1, "failed", "late old execution")).applied, false);
assert.equal(row.status, "inserting");
assert.equal((await api.recordPublicationResult(id, 2, "inserted")).applied, true);

const common = { "@/lib/blog-publishing/publication-extension": api, "@/lib/blog-publishing/publication-jobs": jobs,
  "@/lib/blog-publishing/extension-api": { authorizeExtension: () => denied ? Response.json({ error: "Unauthorized" }, { status: 401 }) : null } };
const list = load("app/api/extension/publication-jobs/route.ts", common);
const detail = load("app/api/extension/publication-jobs/[id]/route.ts", common);
const claim = load("app/api/extension/publication-jobs/[id]/claim/route.ts", common);
const result = load("app/api/extension/publication-jobs/[id]/result/route.ts", common);
const request = input => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(input) });
const context = { params: Promise.resolve({ id }) };
reset(2);
denied = true;
assert.equal((await list.GET(request({}))).status, 401);
assert.equal((await detail.GET(request({}), context)).status, 401);
assert.equal((await claim.POST(request({ publisher: "blocks" }), context)).status, 401);
assert.equal((await result.POST(request({}), context)).status, 401);
denied = false;
assert.equal((await detail.GET(request({}), { params: Promise.resolve({ id: "invalid" }) })).status, 400);
assert.equal((await detail.GET(request({}), context)).status, 200); assert.equal(signCalls.length, 0);
assert.equal((await claim.POST(request({ publisher: "unknown" }), context)).status, 400);
assert.equal((await claim.POST(request({ publisher: "blocks" }), context)).status, 200);
assert.equal((await claim.POST(request({ publisher: "blocks" }), context)).status, 409);
assert.equal((await result.POST(request({ attemptNo: 1, outcome: "published" }), context)).status, 400);
assert.equal((await result.POST(request({ attemptNo: "1", outcome: "inserted" }), context)).status, 400);
assert.equal((await result.POST(request({ attemptNo: 1, outcome: "inserted" }), context)).status, 200);
assert.equal((await (await list.GET(request({}))).json()).jobs.length, 0);
console.log("PASS: Job API/auth, snapshot-only adapter 0/1/2/8/10, fresh signing, atomic claim, legacy cap, success/failure, stale/idempotent results.");

reset(10);
assert.equal((await api.publicationJobToExtensionTask(row)).publishMode, "manual");
assert.equal((await api.publicationJobToExtensionTask(row)).scheduledAt, null);
row.publish_mode = "scheduled"; row.scheduled_at = "2026-10-20T05:30:00.000Z";
const scheduleBefore = row.scheduled_at;
assert.equal((await api.listExtensionPublicationJobs())[0].scheduledAt, scheduleBefore);
const scheduledTask = await api.claimPublicationJob(id, "blocks");
assert.equal(scheduledTask.publishMode, "scheduled"); assert.equal(scheduledTask.scheduledAt, scheduleBefore);
await api.recordPublicationResult(id, 1, "failed", "fixture");
await jobs.transitionPublicationJob(id, { action: "retry" });
assert.equal(row.scheduled_at, scheduleBefore); assert.equal(row.attempt_no, 1);
await api.claimPublicationJob(id, "blocks");
row.started_at = new Date(Date.now() - 600001).toISOString();
await jobs.transitionPublicationJob(id, { action: "recover" });
assert.equal(row.scheduled_at, scheduleBefore); assert.equal(row.attempt_no, 2);
assert.equal((await api.publicationJobToExtensionTask(await api.getPublicationJob(id))).scheduledAt, scheduleBefore);
console.log("PASS: default/scheduled Extension metadata, claim, retry and stale recovery preserve schedule.");

reset(2);
assert.equal((await api.publicationJobToExtensionTask(row)).finalizeMode, "review");
row.publish_mode = "scheduled"; row.scheduled_at = "2099-10-20T05:30:00Z"; row.finalize_mode = "auto";
const finalSnapshot = JSON.stringify(row.execution_snapshot);
assert.equal((await api.listExtensionPublicationJobs())[0].finalizeMode, "auto");
assert.equal((await api.publicationJobToExtensionTask(await api.getPublicationJob(id))).finalizeMode, "auto");
assert.equal((await api.claimPublicationJob(id, "blocks")).finalizeMode, "auto");
await api.recordPublicationResult(id, 1, "failed", "fixture");
await jobs.transitionPublicationJob(id, { action: "retry" });
assert.equal(row.finalize_mode, "auto");
await api.claimPublicationJob(id, "blocks");
row.started_at = new Date(Date.now() - 600001).toISOString();
await jobs.transitionPublicationJob(id, { action: "recover" });
assert.equal(row.finalize_mode, "auto");
await api.claimPublicationJob(id, "blocks");
await api.recordPublicationResult(id, 3, "inserted");
assert.equal(row.status, "inserted"); assert.equal(row.published_at, undefined);
assert.equal(row.finalize_mode, "auto"); assert.equal(JSON.stringify(row.execution_snapshot), finalSnapshot);
console.log("PASS: finalize review compatibility, auto list/detail/claim serializer, retry/recovery immutable consent, inserted not published.");
