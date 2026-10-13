import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

async function load(path, imports = {}) {
  const testModule = { exports: {} };
  const code = ts.transpileModule(await readFile(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module: testModule, exports: testModule.exports, Buffer, require: (name) => {
    if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
    return imports[name];
  } });
  return testModule.exports;
}
const layout = await load("lib/blog-publishing/image-layout.ts");
const preparation = await load("lib/blog-publishing/preparation.ts", { "./image-layout": layout });
const draft = { id: 2, title: "제목", intro: "도입😀입니다.", sections: [{ heading: "소제목", body: "본문입니다. 다음 내용입니다." }], closing: "마무리입니다.", status: "approved" };
const assets = [{ id: 1, storage_path: "tasks/1/a.jpg", sort_order: 0 }, { id: 2, storage_path: "tasks/1/b.jpg", sort_order: 1 }];
const supabase = {
  from(table) {
    const query = { select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
      maybeSingle: async () => ({ data: table === "blog_tasks" ? { id: 1 } : draft }), returns: async () => ({ data: assets }) };
    return query;
  },
  storage: { from: () => ({ createSignedUrl: async (path, expires) => {
    assert.equal(expires, 600);
    return { data: { signedUrl: `https://storage.example.invalid/${path}` } };
  } }) },
};
const api = await load("lib/blog-publishing/extension-api.ts", {
  "node:crypto": {}, "@/lib/supabase": { supabase }, "./downloads": { orderedTaskImages: (_id, items) => items },
  "./preparation": preparation, "@/lib/blog-task-assets": { BLOG_TASK_ASSET_BUCKET: "blog-task-assets" },
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
}
result.images.forEach((image, index) => {
  assert.equal(image.index, index);
  assert.equal(image.insertOffset, prepared.imageInsertOffsets[index]);
  assert.equal(image.insertPrefix, result.bodyText.slice(0, image.insertOffset));
  assert.equal(image.expiresIn, 600);
});
assert.ok(prepared.bodyWithMarkers.includes("[사진 01 삽입]"), "Manual preview must remain separate");
for (const count of [0, 8, 10]) {
  assets.splice(0, assets.length, ...Array.from({ length: count }, (_, index) => ({ id: index + 1, storage_path: `tasks/1/${index}.jpg`, sort_order: index })));
  const all = await api.getExtensionBlogTask("1");
  assert.equal(all.blocks.filter((b) => b.type === "image").length, count);
  assert.equal(all.blocks.filter((b) => b.type === "text").map((b) => b.text).join(""), all.bodyText);
  let text = "";
  for (const block of all.blocks) {
    if (block.type === "text") text += block.text;
    else assert.equal(text.length, all.images[block.index].insertOffset);
  }
}
console.log("Extension API fixture passed: clean body, planned offsets, unchanged signed URL expiry, separate manual preview.");
