import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

function load(file, mocks = {}) {
  const filename = resolve(file), compiled = new Module(filename);
  compiled.filename = filename;
  const original = createRequire(filename);
  compiled.require = name => name in mocks ? mocks[name] : original(name);
  compiled._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, filename);
  return compiled.exports;
}
const rows = {
  blog_tasks: [{ id: 1 }],
  blog_drafts: [{ id: 2, blog_task_id: 1, title: "고정 제목", intro: "도입입니다. 다음 설명입니다.", sections: [{ heading: "제목", body: "본문입니다. 추가 설명입니다." }], closing: "마무리입니다.", status: "approved" }],
  blog_task_assets: [{ id: 1, blog_task_id: 1, storage_path: "tasks/1/a.png", file_name: "a.png", sort_order: 0 }],
  blog_publication_jobs: [],
};
const writes = [], orders = [];
let nextId = 0, storageRemoves = 0, dbError = false, beforeUpdate;
const db = { from(table) {
  assert.ok(table in rows);
  let operation = "read", input, max = Infinity;
  const filters = [], sorting = [];
  const query = {
    select() { return this; }, returns() { return this; },
    eq(k, v) { filters.push(row => String(row[k]) === String(v)); return this; },
    in(k, values) { filters.push(row => values.includes(row[k])); return this; },
    contains(k, value) { filters.push(row => value.images.every(wanted => row[k].images.some(image => Object.entries(wanted).every(([key, candidate]) => image[key] === candidate)))); return this; },
    order(key, options) { sorting.push([key, options?.ascending !== false]); orders.push([table, key, options?.ascending !== false]); return this; },
    limit(value) { max = value; return this; },
    insert(value) { input = value; operation = "insert"; return this; },
    update(value) { input = value; operation = "update"; return this; },
    delete() { operation = "delete"; return this; },
    async maybeSingle() { return run(true); },
    async single() { return run(true); },
    then(resolve, reject) { return Promise.resolve(run(false)).then(resolve, reject); },
  };
  function run(single) {
    if (dbError) return { error: { code: "fixture" }, data: null };
    if (operation === "update" && beforeUpdate) { const change = beforeUpdate; beforeUpdate = undefined; change(); }
    if (operation === "insert") {
      if (rows[table].some(row => row.blog_draft_id === input.blog_draft_id)) return { error: { code: "23505" }, data: null };
      const row = { ...structuredClone(input), id: `${String(++nextId).padStart(8, "0")}-1234-1234-1234-123456789abc`, status: "queued", attempt_no: 0, created_at: "2026-10-15T00:00:00Z", inserted_at: null, published_at: null };
      rows[table].push(row); writes.push([table, operation]); return { data: structuredClone(row), error: null };
    }
    const matches = rows[table].filter(row => filters.every(filter => filter(row))).sort((a, b) => {
      for (const [key, ascending] of sorting) {
        const diff = String(a[key]).localeCompare(String(b[key]), "en", { numeric: true });
        if (diff) return ascending ? diff : -diff;
      }
      return 0;
    }).slice(0, max);
    if (operation === "update") { matches.forEach(row => Object.assign(row, input)); writes.push([table, operation]); }
    if (operation === "delete") { matches.forEach(row => rows[table].splice(rows[table].indexOf(row), 1)); writes.push([table, operation]); }
    return { data: structuredClone(single ? matches[0] ?? null : matches), error: null };
  }
  return query;
}, async rpc(name, args) {
  assert.equal(name, "reorder_blog_task_assets");
  assert.equal(args.p_asset_ids.length, rows.blog_task_assets.length);
  args.p_asset_ids.forEach((id, index) => { rows.blog_task_assets.find(asset => String(asset.id) === String(id)).sort_order = index; });
  return { error: null };
}, storage: { from: () => ({
  download: async () => ({ data: new Blob(["image"], { type: "image/png" }) }),
  remove: async () => { storageRemoves++; return {}; }, upload: async () => ({}),
}) } };
const assetsModule = load("lib/blog-task-assets.ts");
const placementSettings = load("lib/blog-publishing/image-placement-settings.ts");
const layout = load("lib/blog-publishing/image-layout.ts", { "./image-placement-settings": placementSettings });
const preparation = load("lib/blog-publishing/preparation.ts", { "./image-layout": layout });
const blockUtils = load("lib/blog-publishing/blocks.ts");
const downloads = load("lib/blog-publishing/downloads.ts", { "../blog-task-assets": assetsModule });
const publication = load("lib/blog-publishing/publication-jobs.ts", {
  "@/lib/supabase": { supabase: db }, "../blog-task-assets": assetsModule, "./downloads": downloads, "./preparation": preparation, "./blocks": blockUtils,
});
const common = { "@/lib/supabase": { supabase: db }, "@/lib/blog-publishing/publication-jobs": publication };
const recoveryNow = Date.parse("2026-10-15T12:00:00Z");
for (const [age, expected] of [[599999, false], [600000, true], [600001, true], [-1, false]]) {
  assert.equal(publication.isStalePublicationInserting({ status: "inserting", started_at: new Date(recoveryNow - age).toISOString() }, recoveryNow), expected);
}
for (const started_at of [null, "invalid"]) assert.equal(publication.isStalePublicationInserting({ status: "inserting", started_at }, recoveryNow), false);
assert.equal(publication.isStalePublicationInserting({ status: "queued", started_at: "2026-10-15T00:00:00Z" }, recoveryNow), false);
const create = load("app/api/blog/publication-jobs/route.ts", common);
const remove = load("app/api/blog/publication-jobs/[id]/route.ts", common);
const deletion = load("lib/blog-task-assets/delete.ts", { ...common, "@/lib/blog-task-assets": assetsModule });
const assetRoute = load("app/api/blog/tasks/[id]/assets/route.ts", { "@/lib/blog-task-assets/delete": deletion });
const taskRoute = load("app/api/blog/tasks/[id]/route.ts", common);
const request = input => new Request("http://localhost/api", { method: "POST", body: JSON.stringify(input) });
const context = id => ({ params: Promise.resolve({ id }) });
for (const status of ["draft", "rejected"]) {
  rows.blog_drafts[0].status = status;
  assert.equal((await create.POST(request({ taskId: 1, draftId: 2 }))).status, 403);
}
rows.blog_drafts[0].status = "approved";
assert.equal((await create.POST(request({ taskId: 1, draftId: 9 }))).status, 404);
assert.equal((await create.POST(request({ taskId: {}, draftId: 2 }))).status, 400);
assert.equal((await create.POST(request(null))).status, 400);
const first = await create.POST(request({ taskId: 1, draftId: 2 }));
assert.equal(first.status, 201);
assert.equal((await first.json()).alreadyExists, false);
const repeated = await create.POST(request({ taskId: 1, draftId: 2 }));
assert.equal(repeated.status, 200);
assert.equal((await repeated.json()).alreadyExists, true);
assert.equal(rows.blog_publication_jobs.length, 1);
rows.blog_drafts[0].status = "rejected";
assert.equal((await create.POST(request({ taskId: 1, draftId: 2 }))).status, 403);
rows.blog_drafts[0].status = "approved";
const job = rows.blog_publication_jobs[0];
const frozen = JSON.stringify(job.execution_snapshot);
const Link = ({ href, children, ...props }) => React.createElement("a", { href, ...props }, children);
const page = load("app/content/blog/publishing/page.tsx", { ...common, "next/link": Link,
  "./RemovePublicationJob": ({ jobId }) => React.createElement("button", { "data-job": jobId }, "대기열에서 제거"),
  "./PublicationJobTransition": ({ status }) => React.createElement("button", {}, status === "inserted" ? "발행 완료 기록" : "다시 대기열로"),
}).default;
rows.blog_task_assets.push({ id: 9, blog_task_id: 1, storage_path: "tasks/1/new.png", file_name: "new.png", sort_order: 1 });
const taskPhotoFixture = structuredClone(rows.blog_task_assets);
rows.blog_drafts[0].title = "나중 제목";
for (const [status, label] of [["queued", "발행 대기"], ["inserting", "입력 중"], ["inserted", "네이버 입력 완료"], ["published", "발행 완료"], ["failed", "입력 실패"]]) {
  job.status = status; job.error_message = status === "failed" ? "fixture failure" : null;
  const html = renderToStaticMarkup(await page());
  assert.ok(html.includes("고정 제목") && !html.includes("나중 제목"));
  assert.ok(html.includes("사진 1장") && html.includes(label));
  assert.equal(html.includes("대기열에서 제거"), status === "queued");
  assert.equal(html.includes("발행 완료 기록"), status === "inserted");
  assert.equal(html.includes("다시 대기열로"), status === "failed");
  assert.equal(html.includes("/prepare"), false);
  if (status === "failed") assert.ok(html.includes("fixture failure"));
  assert.equal((await taskRoute.DELETE(request({}), context("1"))).status, 409);
  const frozenJob = JSON.stringify(job);
  const removedPhotos = await assetRoute.DELETE(request({}), context("1"));
  assert.equal(removedPhotos.status, 200);
  assert.deepEqual(await removedPhotos.json(), { ok: true, deleted: 2, preserved: 1 });
  assert.equal(storageRemoves, 1, "All Job states preserve referenced Storage files");
  assert.equal(rows.blog_task_assets.length, 0);
  assert.equal(JSON.stringify(job), frozenJob);
  rows.blog_task_assets = structuredClone(taskPhotoFixture); storageRemoves = 0;
  if (status !== "queued") assert.equal((await remove.DELETE(request({}), context(job.id))).status, 409);
  assert.equal(JSON.stringify(job.execution_snapshot), frozen);
}
assert.ok(orders.some(([table, key, asc]) => table === "blog_publication_jobs" && key === "created_at" && asc === false));
const patch = input => remove.PATCH(request(input), context(job.id));
const source = { snapshot: JSON.stringify(job.execution_snapshot), taskId: job.blog_task_id, draftId: job.blog_draft_id };
for (const url of [undefined, "", "  ", null, "https://blog.naver.com/example/123", "http://example.test/post"]) {
  job.status = "inserted";
  assert.equal((await patch({ action: "publish", publishedUrl: url })).status, 200);
  assert.equal(job.status, "published");
  assert.ok(Number.isFinite(Date.parse(job.published_at)));
  assert.equal(job.published_url, typeof url === "string" && url.trim() ? url : null);
  const html = renderToStaticMarkup(await page());
  if (typeof url === "string" && url.trim()) assert.ok(html.includes(`href="${url}"`));
}
for (const url of ["ftp://example.test", "javascript:alert(1)", "/relative", "example.test", "https://", "https://bad host", 123]) {
  job.status = "inserted";
  assert.equal((await patch({ action: "publish", publishedUrl: url })).status, 400);
  assert.equal(job.status, "inserted");
}
for (const status of ["queued", "inserting", "failed", "published"]) {
  job.status = status;
  assert.equal((await patch({ action: "publish" })).status, 409);
}
job.status = "failed"; job.attempt_no = 3; job.error_message = "실패"; job.started_at = "2026-10-15T01:00:00Z"; job.inserted_at = "2026-10-15T01:00:01Z";
assert.equal((await patch({ action: "retry" })).status, 200);
assert.equal(job.status, "queued"); assert.equal(job.attempt_no, 3);
assert.equal(job.error_message, null); assert.equal(job.started_at, null); assert.equal(job.inserted_at, null);
assert.equal(JSON.stringify(job.execution_snapshot), source.snapshot);
assert.equal(job.blog_task_id, source.taskId); assert.equal(job.blog_draft_id, source.draftId);
for (const status of ["queued", "inserting", "inserted", "published"]) {
  job.status = status;
  assert.equal((await patch({ action: "retry" })).status, 409);
}
assert.equal((await patch({ action: "inserting", status: "published" })).status, 400);
job.status = "inserting"; job.started_at = new Date(Date.now() - 9 * 60 * 1000).toISOString();
assert.equal((await patch({ action: "recover" })).status, 409);
assert.equal((await patch({ action: "recover", started_at: "2000-01-01T00:00:00Z" })).status, 409, "client time must not override stored started_at");
assert.equal(job.status, "inserting");
let insertingHtml = renderToStaticMarkup(await page());
assert.ok(insertingHtml.includes("네이버 입력 중")); assert.equal(insertingHtml.includes("다시 대기열로"), false);
job.started_at = new Date(Date.now() - 10 * 60 * 1000).toISOString(); job.inserted_at = null; job.error_message = "기록 미확인";
insertingHtml = renderToStaticMarkup(await page());
assert.ok(insertingHtml.includes("입력이 중단된 것으로 보입니다")); assert.ok(insertingHtml.includes("다시 대기열로"));
const recovered = await Promise.all([patch({ action: "recover" }), patch({ action: "recover" })]);
assert.deepEqual(recovered.map(response => response.status).sort(), [200, 409]);
assert.equal(job.status, "queued"); assert.equal(job.attempt_no, 3);
assert.equal(job.started_at, null); assert.equal(job.error_message, null); assert.equal(job.inserted_at, null);
assert.equal(JSON.stringify(job.execution_snapshot), source.snapshot);
assert.equal(job.blog_task_id, source.taskId); assert.equal(job.blog_draft_id, source.draftId);
for (const change of [() => { job.status = "inserted"; }, () => { job.attempt_no++; job.started_at = new Date().toISOString(); }]) {
  job.status = "inserting"; job.started_at = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  beforeUpdate = change;
  assert.equal((await patch({ action: "recover" })).status, 409, "completion/new claim racing recovery must win");
}
for (const status of ["queued", "inserted", "published", "failed"]) {
  job.status = status; job.started_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.equal((await patch({ action: "recover" })).status, 409);
}
job.status = "queued";
assert.equal((await remove.DELETE(request({}), context(job.id))).status, 200);
assert.equal(rows.blog_publication_jobs.length, 0);
assert.equal(rows.blog_drafts.length, 1); assert.equal(rows.blog_task_assets.length, 2);
assert.equal((await assetRoute.DELETE(request({}), context("1"))).status, 200);
assert.equal(storageRemoves, 2);
dbError = true;
assert.equal((await create.POST(request({ taskId: 1, draftId: 2 }))).status, 500);
assert.equal((await taskRoute.DELETE(request({}), context("1"))).status, 500);
const removesBeforeError = storageRemoves;
assert.equal((await assetRoute.DELETE(request({}), context("1"))).status, 409);
assert.equal(storageRemoves, removesBeforeError);
assert.ok(renderToStaticMarkup(await page()).includes("조회하지 못했습니다"));
dbError = false;
assert.ok(writes.every(([table]) => table === "blog_publication_jobs" || table === "blog_task_assets"));

// Exercise the client request handlers without browser/API side effects.
let state = [], cursor = 0, refreshes = 0;
const hooks = {
  useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => state[i] = typeof value === "function" ? value(state[i]) : value]; },
  useRef(initial) { return { current: initial }; },
};
const add = load("app/content/blog/[id]/AddPublicationJob.tsx", { react: hooks, "next/link": Link }).default;
const removeControl = load("app/content/blog/publishing/RemovePublicationJob.tsx", { react: hooks, "next/navigation": { useRouter: () => ({ refresh: () => refreshes++ }) } }).default;
const transitionControl = load("app/content/blog/publishing/PublicationJobTransition.tsx", { react: hooks, "next/navigation": { useRouter: () => ({ refresh: () => refreshes++ }) } }).default;
const walk = element => !element || typeof element !== "object" ? [] : [element, ...React.Children.toArray(element.props?.children).flatMap(walk)];
const render = (component, props) => { cursor = 0; return component(props); };
const originalFetch = globalThis.fetch, originalConfirm = globalThis.confirm;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/blog/publication-jobs");
    assert.deepEqual(JSON.parse(options.body), { taskId: 1, draftId: 2 });
    return Response.json({ job: { id: "job", status: "queued" }, alreadyExists: true });
  };
  await walk(render(add, { taskId: 1, draftId: 2 })).find(node => node.type === "button").props.onClick();
  const added = render(add, { taskId: 1, draftId: 2 });
  assert.ok(walk(added).some(node => node.props?.role === "status" && String(node.props.children).includes("이미 등록된")));
  assert.ok(walk(added).some(node => node.props?.href === "/content/blog/publishing"));
  state = []; globalThis.confirm = () => true;
  globalThis.fetch = async (url, options) => { assert.equal(url, "/api/blog/publication-jobs/job"); assert.equal(options.method, "DELETE"); return Response.json({ ok: true }); };
  await walk(render(removeControl, { jobId: "job" })).find(node => node.type === "button").props.onClick();
  assert.equal(refreshes, 1);
  state = [];
  const props = { jobId: "job", status: "inserted" };
  walk(render(transitionControl, props)).find(node => node.type === "button").props.onClick();
  const opened = render(transitionControl, props);
  assert.ok(walk(opened).some(node => node.type === "p" && String(node.props.children).includes("자동 확인하지 않습니다")));
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, "PATCH"); assert.deepEqual(JSON.parse(options.body), { action: "publish", publishedUrl: "" });
    return Response.json({ job: { id: "job", status: "published" } });
  };
  await walk(opened).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.equal(refreshes, 2);
  state = [];
  globalThis.fetch = async (_url, options) => { assert.deepEqual(JSON.parse(options.body), { action: "retry" }); return Response.json({ job: { status: "queued" } }); };
  await walk(render(transitionControl, { jobId: "job", status: "failed" })).find(node => node.type === "button").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refreshes, 3);
  state = [];
  globalThis.confirm = () => false;
  let recoveryRequests = 0;
  globalThis.fetch = async (_url, options) => { recoveryRequests++; assert.deepEqual(JSON.parse(options.body), { action: "recover" }); return Response.json({ job: { status: "queued" } }); };
  walk(render(transitionControl, { jobId: "job", status: "inserting" })).find(node => node.type === "button").props.onClick();
  assert.equal(recoveryRequests, 0);
  globalThis.confirm = () => true;
  walk(render(transitionControl, { jobId: "job", status: "inserting" })).find(node => node.type === "button").props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(recoveryRequests, 1); assert.equal(refreshes, 4);
} finally { globalThis.fetch = originalFetch; globalThis.confirm = originalConfirm; }
const AddStub = () => null;
const generate = load("app/content/blog/[id]/GenerateBlogDraft.tsx", {
  ...common, react: hooks, "next/link": Link, "next/navigation": { useRouter: () => ({ refresh: () => refreshes++ }) },
  "@/lib/blog-generation/body": load("lib/blog-generation/body.ts"),
  "@/lib/blog-generation/models": load("lib/blog-generation/models.ts"),
  "@/lib/blog-generation/snapshot": { readBlogGenerationSnapshot: () => null },
  "./BlogPresetControl": () => null, "./BlogGenerationDetails": () => null, "./AddPublicationJob": AddStub,
}).default;
for (const status of ["draft", "rejected", "approved"]) {
  state = [];
  const tree = render(generate, { taskId: 1, initialDraft: { ...rows.blog_drafts[0], status } });
  assert.equal(walk(tree).some(node => node.type === AddStub), status === "approved");
}
for (const status of ["draft", "approved", "rejected"]) {
  state = [];
  const original = { ...rows.blog_drafts[0], status, generation_snapshot: { version: 1, original: "생성 당시 기록" }, provider: "openai", model: "gpt-6.1-sol", created_at: "2026-10-15T00:00:00Z" };
  Object.assign(rows.blog_drafts[0], structuredClone(original));
  const preservedJob = { id: "existing-job", blog_task_id: 1, blog_draft_id: 2, status: "queued", execution_snapshot: JSON.parse(source.snapshot) };
  rows.blog_publication_jobs.push(preservedJob);
  const jobBeforeEdit = JSON.stringify(preservedJob);
  const editProps = { taskId: 1, initialDraft: structuredClone(original) };
  await walk(render(generate, editProps)).find(node => node.type === "button" && node.props.children === "편집").props.onClick();
  const editor = render(generate, editProps);
  assert.equal(rows.blog_drafts[0].status, status, "opening edit must not invalidate approval before saving");
  assert.equal(walk(editor).some(node => node.type === "p" && String(node.props.children).includes("내용을 수정하면 다시 승인이 필요합니다.")), status !== "draft");
  for (const [from, to] of [[original.title, "수정 제목"], [original.intro, "수정 도입"], [original.sections[0].heading, "수정 소제목"], [original.sections[0].body, "수정 본문"], [original.closing, "수정 마무리"]]) {
    walk(render(generate, editProps)).find(node => ["input", "textarea"].includes(node.type) && node.props.value === from).props.onChange({ target: { value: to } });
  }
  const beforeSave = writes.length;
  await walk(render(generate, editProps)).find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  assert.deepEqual(writes.slice(beforeSave), [["blog_drafts", "update"]], "content/status must save in one update without Job writes");
  const saved = rows.blog_drafts[0];
  assert.equal(saved.status, "draft");
  assert.equal(saved.title, "수정 제목"); assert.equal(saved.intro, "수정 도입"); assert.equal(saved.closing, "수정 마무리");
  assert.deepEqual(saved.sections, [{ heading: "수정 소제목", body: "수정 본문", imageAssetId: null }]);
  for (const key of ["generation_snapshot", "provider", "model", "created_at"]) assert.deepEqual(saved[key], original[key]);
  assert.equal(JSON.stringify(preservedJob), jobBeforeEdit);
  assert.equal((await create.POST(request({ taskId: 1, draftId: 2 }))).status, 403, "edited draft cannot register without reapproval");
  assert.ok(walk(render(generate, editProps)).some(node => node.type === "button" && node.props.children === "승인"));
  assert.match(renderToStaticMarkup(render(generate, editProps)), /상태: draft/);
  assert.equal(walk(render(generate, editProps)).some(node => node.type === AddStub), false);
  rows.blog_publication_jobs.pop();
}
state = []; rows.blog_drafts[0].status = "draft";
const props = { taskId: 1, initialDraft: structuredClone(rows.blog_drafts[0]) };
await walk(render(generate, props)).find(node => node.type === "button" && node.props.children === "승인").props.onClick();
assert.equal(rows.blog_drafts[0].status, "approved");
assert.ok(walk(render(generate, props)).some(node => node.type === AddStub && node.props.draftId === 2));
for (const [button, expected] of [["draft로 되돌리기", "draft"], ["거절", "rejected"], ["draft로 되돌리기", "draft"], ["승인", "approved"]]) {
  await walk(render(generate, props)).find(node => node.type === "button" && node.props.children === button).props.onClick();
  assert.equal(rows.blog_drafts[0].status, expected);
}
const generationFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/blog/generate");
    assert.equal(JSON.parse(options.body).taskId, 1);
    return Response.json({ ok: true, draft: rows.blog_drafts[0], draftId: 3, createdAt: "2026-10-15T01:00:00Z", provider: "openai", model: "gpt-6.1-sol" });
  };
  await walk(render(generate, props)).find(node => node.type === "button" && String(node.props.children).includes("AI 초안")).props.onClick();
  const tree = render(generate, props);
  assert.equal(walk(tree).some(node => node.type === AddStub), false, "new generation remains draft, not automatically queued/approved");
  assert.ok(walk(tree).some(node => node.type === "button" && node.props.children === "승인"));
  assert.equal(rows.blog_publication_jobs.length, 0);
} finally { globalThis.fetch = generationFetch; }
const form = readFileSync("app/content/blog/[id]/GenerateBlogDraft.tsx", "utf8");
assert.match(form, /draft\.status === "approved" && !editingDraft && !controlsBusy/);
assert.match(form, /<AddPublicationJob key=\{draft.id\} taskId=\{taskId\} draftId=\{draft.id\}/);
assert.match(form, /async function generateDraft/); assert.match(form, /async function saveDraft/); assert.match(form, /async function changeStatus/);
console.log("PASS: Publication Queue API/UI, approval/idempotency, snapshot photo count, queued-only removal, all-state photo/Task protection, client request/refresh.");
