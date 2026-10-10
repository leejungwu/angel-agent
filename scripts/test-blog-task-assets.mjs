import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Module from "node:module";
import ts from "typescript";

function load(file, mocks = {}) {
  const filename = resolve(file);
  const compiled = new Module(filename);
  compiled.filename = filename;
  const originalRequire = compiled.require.bind(compiled);
  compiled.require = (name) => name in mocks ? mocks[name] : originalRequire(name);
  compiled._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, filename);
  return compiled.exports;
}

const assets = load("lib/blog-task-assets.ts");
const firstPath = assets.blogTaskAssetPath(7, "first-id", "사진 1.PNG", "image/webp");
assert.match(firstPath, /^tasks\/7\/first-id-[^/]+\.webp$/);
assert.notEqual(firstPath, assets.blogTaskAssetPath(8, "first-id", "사진 1.PNG", "image/webp"));
assert.ok(assets.isBlogTaskAssetPath(7, firstPath));
assert.equal(assets.isBlogTaskAssetPath(8, firstPath), false);
assert.equal(assets.isBlogTaskAssetPath(7, "tasks/7/../8/file.webp"), false);
assert.throws(() => assets.blogTaskAssetPath("../8", "id", "a.png", "image/png"));
assert.throws(() => assets.blogTaskAssetPath(7, "id", "a.txt", "text/plain"));
assert.deepEqual(assets.scaledBlogImageSize(3600, 2400), { width: 1800, height: 1200 });
assert.deepEqual(assets.scaledBlogImageSize(800, 600), { width: 800, height: 600 });
const compact = load("lib/blog-task-assets/compact.ts", { "@/lib/blog-task-assets": assets }).compactBlogImage;
const originalBitmap = globalThis.createImageBitmap;
const originalDocument = globalThis.document;
let generatedBlob = new Blob(["smaller"], { type: "image/webp" });
let encodedQuality;
let canvas;
try {
  globalThis.createImageBitmap = async () => ({ width: 3600, height: 2400, close() {} });
  globalThis.document = { createElement() {
    canvas = { width: 0, height: 0, getContext: () => ({ drawImage() {} }),
      toBlob(callback, type, quality) { assert.equal(type, "image/webp"); encodedQuality = quality; callback(generatedBlob); } };
    return canvas;
  } };
  const file = { type: "image/png", size: 1000 };
  assert.equal(await compact(file), generatedBlob);
  assert.deepEqual([canvas.width, canvas.height, encodedQuality], [1800, 1200, 0.82]);
  generatedBlob = new Blob(["larger than original"], { type: "image/webp" });
  const tinyFile = { type: "image/png", size: 1 };
  assert.equal(await compact(tinyFile), tinyFile);
  await assert.rejects(() => compact({ type: "text/plain", size: 100 }), /JPEG|PNG|WebP/);
  await assert.rejects(() => compact({ type: "image/png", size: 0 }), /JPEG|PNG|WebP/);
  generatedBlob = new Blob(["broken"], { type: "image/png" });
  await assert.rejects(() => compact(file), /WebP/);
} finally {
  globalThis.createImageBitmap = originalBitmap;
  globalThis.document = originalDocument;
}

const rows = Array.from({ length: 15 }, (_, index) => ({
  id: index + 1, blog_task_id: 7, sort_order: 14 - index,
  storage_path: assets.blogTaskAssetPath(7, `id-${index}`, `photo-${index}.png`, "image/png"),
}));
rows.push({ id: 16, blog_task_id: 8, sort_order: 0,
  storage_path: assets.blogTaskAssetPath(8, "other", "other.png", "image/png") });
const calls = [];
let includeForeign = false;
const supabase = {
  from(table) {
    assert.equal(table, "blog_task_assets");
    const query = { taskId: null, orders: [], select() { return this; },
      eq(column, value) { assert.equal(column, "blog_task_id"); this.taskId = value; return this; },
      order(column, options) { this.orders.push([column, options.ascending]); return this; },
      then(resolve) {
        calls.push({ taskId: this.taskId, orders: this.orders });
        const selected = rows.filter((row) => row.blog_task_id === this.taskId);
        if (includeForeign && selected.length) selected.push(rows.at(-1));
        selected.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
        return Promise.resolve({ data: selected, error: null }).then(resolve);
      },
    };
    return query;
  },
  storage: { from(bucket) {
    assert.equal(bucket, "blog-task-assets");
    return { async download(path) {
      assert.ok(assets.isBlogTaskAssetPath(7, path), "must not download another task's file");
      return { data: new Blob([path]), error: null };
    } };
  } },
};
const downloader = load("lib/naver-blog/blog-task-asset-files.ts", {
  "@/lib/supabase": { supabase },
  "@/lib/blog-task-assets": assets,
});
const directory = await mkdtemp(join(tmpdir(), "angel-blog-task-assets-test-"));
try {
  const paths = await downloader.downloadBlogTaskAssetFiles(7, directory);
  assert.equal(paths.length, 15);
  assert.deepEqual(calls[0], { taskId: 7, orders: [["sort_order", true], ["id", true]] });
  for (const [index, path] of paths.entries()) {
    assert.equal(await readFile(path, "utf8"), rows.filter((row) => row.blog_task_id === 7)
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)[index].storage_path);
  }
  assert.deepEqual(await downloader.downloadBlogTaskAssetFiles(9, directory), []);
  includeForeign = true;
  await assert.rejects(() => downloader.downloadBlogTaskAssetFiles(7, directory), /task|asset/i);
  assert.doesNotMatch(readFileSync(resolve("app/api/blog/publish/route.ts"), "utf8"), /downloadProductAssetFiles|product_assets/);

  const targetRows = rows.filter((row) => row.blog_task_id === 7).slice(0, 2);
  const removed = [];
  const restored = [];
  let failSecondDelete = false;
  const deleteSupabase = {
    from(table) {
      assert.equal(table, "blog_task_assets");
      let operation = "read";
      let taskId;
      let id;
      const query = {
        select() { return this; },
        returns() { return this; },
        eq(column, value) {
          if (column === "blog_task_id") taskId = value;
          else if (column === "id") id = value;
          else assert.fail(`unexpected filter ${column}`);
          return this;
        },
        order() { return this; },
        delete() { operation = "delete"; return this; },
        then(resolve) {
          assert.equal(taskId, 7);
          const result = operation === "read"
            ? { data: targetRows, error: null }
            : failSecondDelete && id === targetRows[1].id
              ? { data: null, error: { message: "DB unavailable" } }
              : { data: [{ id }], error: null };
          return Promise.resolve(result).then(resolve);
        },
      };
      return query;
    },
    storage: { from(bucket) {
      assert.equal(bucket, "blog-task-assets");
      return {
        async download(path) { assert.ok(targetRows.some((row) => row.storage_path === path)); return { data: new Blob([path], { type: "image/png" }), error: null }; },
        async remove(paths) { assert.equal(paths.length, 1); removed.push(paths[0]); return { error: null }; },
        async upload(path, blob) { assert.ok(blob.size); restored.push(path); return { error: null }; },
      };
    } },
  };
  const deletion = load("lib/blog-task-assets/delete.ts", {
    "@/lib/supabase": { supabase: deleteSupabase },
    "@/lib/blog-task-assets": assets,
  });
  assert.equal(await deletion.removeAllBlogTaskAssets(7), 2);
  assert.deepEqual(removed, targetRows.map((row) => row.storage_path));
  assert.deepEqual(restored, []);
  removed.length = 0;
  failSecondDelete = true;
  await assert.rejects(() => deletion.removeAllBlogTaskAssets(7), /1\/2.*복구/);
  assert.deepEqual(restored, [targetRows[1].storage_path]);
  assert.ok(removed.every((path) => assets.isBlogTaskAssetPath(7, path)));
  const removedBeforeForeign = removed.length;
  targetRows.push(rows.at(-1));
  await assert.rejects(() => deletion.removeAllBlogTaskAssets(7), /다른 작업/);
  assert.equal(removed.length, removedBeforeForeign, "foreign path must block deletion before any object changes");
} finally {
  await rm(directory, { recursive: true });
}
console.log("PASS: task paths, resize dimensions, task isolation, 15 image order, empty assets and publisher source");
