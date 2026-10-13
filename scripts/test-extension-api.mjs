import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

async function load(path, imports = {}) {
  const testModule = { exports: {} };
  const code = ts.transpileModule(await readFile(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module: testModule, exports: testModule.exports, Buffer, URL, Response, TextEncoder, require: (name) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  } });
  return testModule.exports;
}
const layout = await load("lib/blog-publishing/image-layout.ts");
const preparation = await load("lib/blog-publishing/preparation.ts", { "./image-layout": layout });
const blockUtils = await load("lib/blog-publishing/blocks.ts");
const taskAssets = await load("lib/blog-task-assets.ts");
const downloads = await load("lib/blog-publishing/downloads.ts", { "../blog-task-assets": taskAssets });
const draft = { id: 2, title: "제목", intro: "도입😀입니다.", sections: [{ heading: "소제목", body: "본문입니다. 다음 내용입니다." }], closing: "마무리입니다.", status: "approved" };
const assets = [{ id: 1, storage_path: "tasks/1/a.jpg", sort_order: 0 }, { id: 2, storage_path: "tasks/1/b.jpg", sort_order: 1 }];
const supabase = {
  from(table) {
    const filters = new Map();
    const query = { select() { return this; }, eq(key, value) { filters.set(key, String(value)); return this; }, order() { return this; }, limit() { return this; },
      maybeSingle: async () => {
        if (table === "blog_tasks") return { data: filters.get("id") === "1" ? { id: 1 } : null };
        assert.equal(filters.get("blog_task_id"), "1");
        return { data: !filters.has("id") || filters.get("id") === String(draft.id) ? draft : null };
      }, returns: async () => ({ data: assets }) };
    return query;
  },
  storage: { from: () => ({ createSignedUrl: async (path, expires) => {
    assert.equal(expires, 600);
    return { data: { signedUrl: `https://storage.example.invalid/${path}` } };
  } }) },
};
const api = await load("lib/blog-publishing/extension-api.ts", {
  "node:crypto": {}, "@/lib/supabase": { supabase }, "./downloads": downloads,
  "./preparation": preparation, "./blocks": blockUtils, "@/lib/blog-task-assets": { BLOG_TASK_ASSET_BUCKET: "blog-task-assets" },
});
const result = await api.getExtensionBlogTask("1");
const prepared = preparation.prepareBlogPost(draft, assets.length);
assert.equal(result.bodyText, prepared.executionBodyText);
assert.equal(result.bodyText.includes("[사진 "), false);
assert.equal(result.imageMarkers, undefined);
assert.equal(result.images.length, 2);
assert.equal(result.blocks.filter((block) => block.type === "image").length, 2);
assert.equal(result.blocks.filter((block) => block.type === "text").map((block) => block.text).join(""), result.bodyText);
for (const block of result.blocks.filter((block) => block.type === "image")) {
  assert.equal(block.signedUrl, result.images[block.index].signedUrl);
  assert.equal(block.id, result.images[block.index].id);
}
result.images.forEach((image, index) => {
  assert.equal(image.index, index);
  assert.equal(image.insertOffset, prepared.imageInsertOffsets[index]);
  assert.equal(image.insertPrefix, result.bodyText.slice(0, image.insertOffset));
  assert.equal(image.expiresIn, 600);
});
assert.ok(prepared.bodyWithMarkers.includes("[사진 01 삽입]"), "Manual preview must remain separate");
for (const count of [0, 8, 10]) {
  assets.splice(0, assets.length, ...Array.from({ length: count }, (_, index) => ({ id: index + 1, storage_path: `tasks/1/${index}.jpg`, sort_order: index })).reverse());
  const all = await api.getExtensionBlogTask("1");
  assert.equal(all.blocks.filter((b) => b.type === "image").length, count);
  assert.equal(all.blocks.filter((b) => b.type === "text").map((b) => b.text).join(""), all.bodyText);
  assert.deepEqual(Array.from(all.images, (image) => image.id), Array.from({ length: count }, (_, index) => index + 1));
  const textKey = (value) => value.replace(/\s/g, "");
  assert.equal(textKey(all.bodyText), textKey(preparation.composeBlogBody(draft)));
  let text = "";
  for (const block of all.blocks) {
    if (block.type === "text") text += block.text;
    else assert.equal(text.length, all.images[block.index].insertOffset);
  }
}
const route = await load("app/api/extension/blog-tasks/[id]/route.ts", {
  "@/lib/blog-publishing/extension-api": { ...api, authorizeExtension: () => null },
});
const response = await route.GET(new Request("http://localhost/api/extension/blog-tasks/1?draftId=2"), { params: Promise.resolve({ id: "1" }) });
assert.equal(response.status, 200);
const payload = await response.json();
assert.equal(payload.draftId, 2);
assert.equal(payload.blocks.filter((b) => b.type === "image").length, 10);
assert.equal(payload.blocks.filter((b) => b.type === "text").map((b) => b.text).join(""), payload.bodyText);
assert.equal(response.headers.get("Cache-Control"), "no-store");
for (const [draftId, status] of [["bad", 400], ["999", 404]]) {
  const failed = await route.GET(new Request(`http://localhost/api/extension/blog-tasks/1?draftId=${draftId}`), { params: Promise.resolve({ id: "1" }) });
  assert.equal(failed.status, status);
}
for (const [body, images] of [["ABC", [{ index: 0, insertOffset: 4 }]], ["ABC", [{ index: 0, insertOffset: 2 }, { index: 1, insertOffset: 1 }]], ["😀", [{ index: 0, insertOffset: 1 }]], ["ABC", [{ index: 0, insertOffset: 0 }, { index: 0, insertOffset: 0 }]]]) {
  assert.throws(() => blockUtils.createBlogExecutionBlocks(body, images), /유효하지/);
}
const sharedBoundary = blockUtils.createBlogExecutionBlocks("AAA\n\nBBB", [{ index: 0, insertOffset: 3 }, { index: 1, insertOffset: 3 }]);
assert.deepEqual(Array.from(sharedBoundary, (b) => b.type), ["text", "image", "image", "text"]);
console.log("Extension API fixture passed: clean body, planned offsets, unchanged signed URL expiry, separate manual preview.");
