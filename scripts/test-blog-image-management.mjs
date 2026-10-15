import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import React from "react";

function load(file, mocks = {}) {
  const filename = resolve(file), mod = new Module(filename), original = createRequire(filename);
  mod.filename = filename;
  mod.require = name => name in mocks ? mocks[name] : original(name);
  mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, filename);
  return mod.exports;
}
const paths = load("lib/blog-task-assets.ts");
const downloads = load("lib/blog-publishing/downloads.ts", { "../blog-task-assets": paths });
let assets, protectedId, failRpc, failInsert, unknownInsert, failCopy, storageCalls, nextId, lostInsertResponse, failDelete;
const products = [1, 2, 3].map(id => ({ id, product_id: 9, asset_type: "image", storage_path: `products/9/${id}.png`, file_name: `${id}.png`, sort_order: id - 1 }));
function reset() {
  assets = [1, 2, 3].map(id => ({ id, blog_task_id: 7, storage_path: `tasks/7/id-${id}.png`, file_name: `${id}.png`, sort_order: id * 3 }));
  protectedId = null; failRpc = false; failInsert = false; unknownInsert = false; failCopy = false; lostInsertResponse = false; failDelete = false; storageCalls = []; nextId = 3;
}
const db = {
  from(table) {
    let input, mode = "read", single = false, limit = Infinity;
    const filters = [], sorting = [];
    const query = {
      select() { return this; }, eq(k, v) { filters.push(row => String(row[k]) === String(v)); return this; },
      in(k, values) { filters.push(row => values.includes(row[k])); return this; },
      order(k, options) { sorting.push([k, options?.ascending !== false]); return this; },
      limit(n) { limit = n; return this; }, maybeSingle() { single = true; return this; }, returns() { return this; },
      insert(value) { mode = "insert"; input = value; return this; },
      delete() { mode = "delete"; return this; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        if (mode === "insert") {
          assert.equal(table, "blog_task_assets");
          if (failInsert) return { error: { code: "23505" } };
          for (const row of input) assets.push({ ...row, id: ++nextId });
          if (lostInsertResponse) throw new Error("response lost after commit");
          return { error: null };
        }
        if (unknownInsert && filters.length > 1 && table === "blog_task_assets") return { data: null, error: { message: "network" } };
        const source = table === "blog_tasks" ? [{ id: 7, product_id: 9 }] : table === "product_assets" ? products : assets;
        const matches = source.filter(row => filters.every(filter => filter(row))).sort((a, b) => {
          for (const [key, asc] of sorting) { const n = String(a[key]).localeCompare(String(b[key]), "en", { numeric: true }); if (n) return asc ? n : -n; }
          return 0;
        }).slice(0, limit);
        if (mode === "delete") {
          if (failDelete) return { error: { message: "delete failed" } };
          assets = assets.filter(row => !matches.includes(row));
        }
        return { data: structuredClone(single ? matches[0] ?? null : matches), error: null };
      }).then(resolve, reject); },
    };
    return query;
  },
  async rpc(name, args) {
    if (failRpc) return { error: { message: "transaction rollback" } };
    if (name === "delete_blog_task_asset") {
      assets = assets.filter(row => String(row.id) !== String(args.p_asset_id));
      downloads.orderedTaskImages(7, assets).forEach((row, i) => { row.sort_order = i; });
    } else {
      assert.equal(name, "reorder_blog_task_assets");
      const ids = args.p_asset_ids;
      if (ids.length !== assets.length || new Set(ids).size !== ids.length || ids.some(id => !assets.some(row => String(row.id) === String(id)))) return { error: { message: "list changed" } };
      ids.forEach((id, i) => { assets.find(row => String(row.id) === String(id)).sort_order = i; });
    }
    return { error: null };
  },
  storage: { from(bucket) { return {
    async copy(source, destination, options) {
      assert.equal(bucket, "product-assets"); assert.equal(options.destinationBucket, paths.BLOG_TASK_ASSET_BUCKET);
      assert.ok(paths.isBlogTaskAssetPath(7, destination)); assert.notEqual(source, destination);
      storageCalls.push(["copy", bucket, source, destination]); return { error: failCopy ? { message: "copy" } : null };
    },
    async download(path) { storageCalls.push(["download", bucket, path]); return { data: new Blob(["png"], { type: "image/png" }) }; },
    async upload(path) { storageCalls.push(["restore", bucket, path]); return {}; },
    async remove(files) { assert.equal(bucket, paths.BLOG_TASK_ASSET_BUCKET); storageCalls.push(["remove", bucket, ...files]); return {}; },
    async createSignedUrl(path) { return { data: { signedUrl: `https://example.invalid/${path}` } }; },
  }; } },
};
const mocks = { "@/lib/supabase": { supabase: db }, "@/lib/blog-task-assets": paths };
const management = load("lib/blog-task-assets/manage.ts", mocks);
const deletion = load("lib/blog-task-assets/delete.ts", { ...mocks, "@/lib/blog-publishing/publication-jobs": {
  isAssetReferencedByPublicationJob: async ({ assetId }) => String(assetId) === String(protectedId),
} });
for (const bad of [null, {}, [1, "1"], [0], [-1], ["../7"], [true], [9007199254740992]]) assert.throws(() => management.parseAssetIds(bad));
assert.deepEqual(management.parseAssetIds([1, "2"]), ["1", "2"]);
reset();
await management.reorderBlogTaskAssets("7", ["2", "1", "3"]);
assert.deepEqual(downloads.orderedTaskImages(7, assets).map(row => row.id), [2, 1, 3]);
await management.reorderBlogTaskAssets("7", ["1", "3", "2"]);
assert.deepEqual(downloads.orderedTaskImages(7, structuredClone(assets)).map(row => row.id), [1, 3, 2], "Reload retains DB order");
const stable = JSON.stringify(assets);
await assert.rejects(management.reorderBlogTaskAssets("7", ["1", "2"]), /새로고침/);
assert.equal(JSON.stringify(assets), stable);
reset();
assert.deepEqual(await deletion.removeBlogTaskAsset(7, "2"), { deleted: 1, preserved: 0 });
assert.deepEqual(assets.map(row => [row.id, row.sort_order]), [[1, 0], [3, 1]]);
assert.ok(storageCalls.filter(call => call[0] === "remove").every(call => call[2] === "tasks/7/id-2.png"));
reset(); protectedId = 2;
assert.deepEqual(await deletion.removeBlogTaskAsset(7, "2"), { deleted: 1, preserved: 1 });
assert.equal(storageCalls.length, 0);
assert.deepEqual(assets.map(row => [row.id, row.sort_order]), [[1, 0], [3, 1]]);
reset(); protectedId = 2;
assert.deepEqual(await deletion.removeAllBlogTaskAssets(7), { deleted: 3, preserved: 1 });
assert.equal(assets.length, 0);
assert.ok(storageCalls.filter(call => call[0] === "remove").every(call => !call.includes("tasks/7/id-2.png")));
reset(); failDelete = true;
await assert.rejects(deletion.removeBlogTaskAsset(7, "2"), /복구/); assert.equal(assets.length, 3);
assert.ok(storageCalls.some(call => call[0] === "restore"));
reset(); failRpc = true;
await assert.rejects(deletion.removeBlogTaskAsset(7, "2"), /순서/); assert.equal(storageCalls.length, 0);
reset(); await assert.rejects(deletion.removeBlogTaskAsset(7, "99"), /찾지/);
for (const ids of [["1"], ["3", "1", "2"]]) {
  reset(); const productSnapshot = JSON.stringify(products);
  assert.equal(await management.reuseProductPhotos("7", ids), ids.length);
  const copies = assets.filter(row => row.source_product_asset_id);
  assert.deepEqual(copies.map(row => row.source_product_asset_id), products.filter(row => ids.includes(String(row.id))).map(row => row.id));
  assert.ok(copies.every(row => paths.isBlogTaskAssetPath(7, row.storage_path)));
  const beforeCopies = storageCalls.filter(call => call[0] === "copy").length;
  assert.equal(await management.reuseProductPhotos("7", ids), 0);
  assert.equal(storageCalls.filter(call => call[0] === "copy").length, beforeCopies);
  await deletion.removeBlogTaskAsset(7, String(copies[0].id));
  assert.equal(JSON.stringify(products), productSnapshot);
}
reset(); await assert.rejects(management.reuseProductPhotos("7", ["999"]), /연결/); assert.equal(storageCalls.length, 0);
reset(); failInsert = true;
await assert.rejects(management.reuseProductPhotos("7", ["1", "2"]), /중복/);
assert.equal(assets.length, 3); assert.equal(storageCalls.filter(call => call[0] === "remove")[0].length, 4);
reset(); failInsert = true; unknownInsert = true;
await assert.rejects(management.reuseProductPhotos("7", ["1"]), /상태 확인/);
assert.equal(storageCalls.filter(call => call[0] === "remove").length, 0, "Uncertain metadata must preserve copies");
reset(); failCopy = true;
await assert.rejects(management.reuseProductPhotos("7", ["1"]), /복사/);
assert.equal(assets.length, 3); assert.equal(storageCalls.filter(call => call[0] === "remove").length, 1);
reset(); lostInsertResponse = true;
assert.equal(await management.reuseProductPhotos("7", ["1", "2"]), 2);
assert.equal(assets.length, 5); assert.equal(storageCalls.filter(call => call[0] === "remove").length, 0);

const routeMocks = { "@/lib/blog-task-assets/manage": management, ...mocks };
const orderRoute = load("app/api/blog/tasks/[id]/assets/order/route.ts", routeMocks);
reset();
let response = await orderRoute.PATCH(new Request("http://local", { method: "PATCH", body: JSON.stringify({ assetIds: [2, 1, 3] }) }), { params: Promise.resolve({ id: "7" }) });
assert.equal(response.status, 200);
response = await orderRoute.PATCH(new Request("http://local", { method: "PATCH", body: "null" }), { params: Promise.resolve({ id: "7" }) }); assert.equal(response.status, 400);
const productRoute = load("app/api/blog/tasks/[id]/assets/product/route.ts", routeMocks);
response = await productRoute.POST(new Request("http://local", { method: "POST", body: JSON.stringify({ assetIds: [1] }) }), { params: Promise.resolve({ id: "7" }) }); assert.equal(response.status, 200);
response = await productRoute.GET(new Request("http://local"), { params: Promise.resolve({ id: "7" }) });
assert.equal(response.status, 200); assert.equal((await response.json()).images[0].added, true);
const deleteRoute = load("app/api/blog/tasks/[id]/assets/[assetId]/route.ts", { "@/lib/blog-task-assets/delete": deletion });
protectedId = 2;
response = await deleteRoute.DELETE(new Request("http://local"), { params: Promise.resolve({ id: "7", assetId: "2" }) }); assert.equal(response.status, 200);
assert.equal((await response.json()).preserved, 1);

// A detached Task row does not participate in snapshot signing, for queued or failed Jobs.
const placement = load("lib/blog-publishing/image-placement-settings.ts");
const layout = load("lib/blog-publishing/image-layout.ts", { "./image-placement-settings": placement });
const preparation = load("lib/blog-publishing/preparation.ts", { "./image-layout": layout });
const blockUtils = load("lib/blog-publishing/blocks.ts");
const snapshotDb = { from() { assert.fail("Snapshot adapter must not read Task rows"); }, storage: { from(bucket) {
  assert.equal(bucket, "blog-task-assets");
  return { createSignedUrl: async path => { assert.equal(path, "tasks/7/id-2.png"); return { data: { signedUrl: `https://example.invalid/${path}` } }; } };
} } };
const jobs = load("lib/blog-publishing/publication-jobs.ts", { "@/lib/supabase": { supabase: snapshotDb }, "../blog-task-assets": paths, "./downloads": downloads, "./preparation": preparation, "./blocks": blockUtils });
const extension = load("lib/blog-publishing/publication-extension.ts", { "@/lib/supabase": { supabase: snapshotDb }, "../blog-task-assets": paths, "./publication-jobs": jobs });
for (const status of ["queued", "failed"]) {
  reset(); protectedId = 2;
  const job = { blog_task_id: 7, status, execution_snapshot: {
    version: 1, title: "기존 Job", bodyText: "앞뒤", blocks: [{ type: "text", text: "앞" }, { type: "image", index: 0 }, { type: "text", text: "뒤" }],
    images: [{ assetId: 2, storagePath: "tasks/7/id-2.png", fileName: "2.png", sortOrder: 1 }],
  } };
  const frozen = JSON.stringify(job);
  await deletion.removeBlogTaskAsset(7, "2");
  assert.equal(assets.some(asset => asset.id === 2), false);
  const payload = await extension.publicationJobToExtensionTask(job, true);
  assert.equal(payload.images[0].signedUrl, "https://example.invalid/tasks/7/id-2.png");
  assert.equal(payload.blocks.filter(block => block.type === "image").length, 1);
  assert.equal(JSON.stringify(job), frozen);
  assert.equal(storageCalls.length, 0);
}

const states = []; let hook = 0, refreshed = 0, requests = [];
const reactMock = { ...React, useRef: value => { const index = hook++; if (!(index in states)) states[index] = { current: value }; return states[index]; }, useEffect: () => {}, useState: initial => {
  const index = hook++; if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
  return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
} };
const Form = load("app/content/blog/[id]/BlogTaskAssets.tsx", {
  ...mocks, react: reactMock, "next/navigation": { useRouter: () => ({ refresh: () => refreshed++ }) },
  "@/lib/blog-task-assets/compact": {}, "./ImagePlacementSettings": { default: () => null },
  "./BlogImageEditor": { default: () => null },
  "@/lib/blog-publishing/downloads": downloads,
}).default;
function render() { hook = 0; return Form({ taskId: 7, assets: downloads.orderedTaskImages(7, assets) }); }
function nodes(node, predicate, found = []) {
  if (!node || typeof node !== "object") return found;
  if (predicate(node)) found.push(node);
  React.Children.forEach(node.props?.children, child => nodes(child, predicate, found)); return found;
}
const oldFetch = globalThis.fetch, oldConfirm = globalThis.confirm;
try {
  reset();
  globalThis.fetch = async (url, options) => { requests.push([url, options]); return { ok: true, json: async () => ({ ok: true }) }; };
  let tree = render();
  const up = nodes(tree, node => node.type === "button" && node.props.children === "위로");
  const down = nodes(tree, node => node.type === "button" && node.props.children === "아래로");
  assert.equal(up[0].props.disabled, true); assert.equal(down.at(-1).props.disabled, true);
  up[1].props.onClick(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(requests[0][1].body), { assetIds: ["2", "1", "3"] }); assert.equal(refreshed, 0);
  tree = render(); nodes(tree, node => node.type === "button" && node.props.children === "아래로")[1].props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(requests[1][1].body), { assetIds: ["2", "3", "1"] });
  globalThis.confirm = () => true;
  for (const [payload, expectedRole, message] of [
    [{ ok: true, preserved: 1 }, "status", "기존 발행 작업에서 사용하는 원본 파일은 보존됩니다."],
    [{ ok: true, preserved: 0 }, "status", "사진을 삭제했습니다."],
    [{ ok: false, error: "삭제 API 실패" }, "alert", "삭제 API 실패"],
  ]) {
    states.length = 0;
    globalThis.fetch = async () => ({ ok: payload.ok, json: async () => payload });
    nodes(render(), node => node.type === "button" && node.props.children === "삭제")[0].props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(nodes(render(), node => node.props?.role === expectedRole).some(node => String(node.props.children).includes(message)));
  }
  states.length = 0;
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: "전체 삭제 API 실패" }) });
  await nodes(render(), node => node.type === "button" && node.props.children === "사진 전체 삭제")[0].props.onClick();
  assert.ok(nodes(render(), node => node.props?.role === "alert").some(node => String(node.props.children).includes("전체 삭제 API 실패")));
  states.length = 0; reset(); assets[0].id = 7; assets[0].edit_metadata = { brightness: 110 };
  tree = render();
  assert.ok(nodes(tree, node => node.type === "span").some(node => React.Children.toArray(node.props.children).join("").includes("상태: 편집본")));
  nodes(tree, node => node.type === "button" && node.props.children === "편집")[0].props.onClick();
  tree = render();
  const editor = nodes(tree, node => !!node.props?.onSaved)[0];
  assert.equal(editor.props.asset.id, 7);
  const siblingKeys = tree.props.children.filter(child => React.isValidElement(child) && child.key !== null).map(child => child.key);
  assert.equal(new Set(siblingKeys).size, siblingKeys.length, "Equal Task/asset IDs must have distinct sibling keys");
  assert.equal(nodes(tree, node => node.type === "button" && node.props.children === "사진 전체 삭제")[0].props.disabled, true);
  editor.props.onClose(); assert.equal(nodes(render(), node => !!node.props?.onSaved).length, 0);
  nodes(render(), node => node.type === "button" && node.props.children === "편집")[0].props.onClick();
  const beforeSaveRefresh = refreshed; nodes(render(), node => !!node.props?.onSaved)[0].props.onSaved(); assert.equal(refreshed, beforeSaveRefresh + 1);
} finally { globalThis.fetch = oldFetch; globalThis.confirm = oldConfirm; }

const sql = readFileSync("supabase/migrations/202610150005_blog_image_management.sql", "utf8");
assert.match(sql, /UNIQUE INDEX[\s\S]*blog_task_id, source_product_asset_id/);
assert.match(sql, /SECURITY INVOKER/); assert.doesNotMatch(sql, /SECURITY DEFINER/);
assert.match(sql, /FOR UPDATE/); assert.match(sql, /count\(DISTINCT id\)/);
assert.match(sql, /WITH ORDINALITY/); assert.match(sql, /PERFORM public.reorder_blog_task_assets/);
assert.doesNotMatch(sql, /UPDATE public.blog_publication_jobs/);
console.log("PASS: individual delete/restore/protection, contiguous order, reorder persistence/UI, independent Product copies, duplicates/failures, API validation, migration contract.");
