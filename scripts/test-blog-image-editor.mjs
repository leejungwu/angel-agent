import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import React from "react";

function load(file, mocks = {}) {
  const filename = resolve(file), mod = new Module(filename), original = createRequire(filename);
  mod.filename = filename; mod.require = name => name in mocks ? mocks[name] : original(name);
  mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText, filename);
  return mod.exports;
}
const base = load("lib/blog-task-assets.ts");
const edit = load("lib/blog-task-assets/edit.ts", { "../blog-task-assets": base });
const webp = () => new Blob(["RIFF0000WEBPtest"], { type: "image/webp" });
const defaults = () => structuredClone(edit.DEFAULT_IMAGE_EDIT);
for (const invalid of [null, {}, { ...defaults(), brightness: 49 }, { ...defaults(), brightness: 151 }, { ...defaults(), crop: { x: 0.9, y: 0, width: 0.5, height: 1 } }, { ...defaults(), blurRegions: [{ x: 0, y: 0, width: -1, height: 1 }] }]) assert.throws(() => edit.parseImageEdit(invalid));
assert.deepEqual(edit.dragImageRect({ x: 0.8, y: 0.9 }, { x: 0.2, y: 0.1 }), { x: 0.2, y: 0.1, width: 0.6000000000000001, height: 0.8 });
let canvases = [], encodes = 0;
function canvas() {
  const calls = [], stack = [];
  const context = { filter: "none", drawImage(...args) { calls.push(["draw", this.filter, ...args]); },
    save() { stack.push(this.filter); }, restore() { this.filter = stack.pop(); }, beginPath() {}, clip() {},
    rect(...args) { calls.push(["rect", ...args]); }, fillText(...args) { calls.push(["text", ...args]); },
    getImageData(_x, _y, width, height) { return { data: new Uint8ClampedArray(width * height * 4).fill(100) }; },
    putImageData(image) { calls.push(["pixels", ...image.data.slice(0, 4)]); },
    strokeRect(...args) { calls.push(["border", this.strokeStyle, this.lineWidth, ...args]); },
  };
  const value = { width: 0, height: 0, calls, context, getContext: () => context, toBlob(callback, type, quality) { encodes++; assert.equal(type, "image/webp"); assert.equal(quality, 0.82); callback(webp()); } };
  canvases.push(value); return value;
}
const oldDocument = globalThis.document;
globalThis.document = { createElement(tag) { assert.equal(tag, "canvas"); return canvas(); } };
try {
  const settings = defaults(); settings.crop = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }; settings.brightness = 110;
  settings.watermark.text = "BENICTION";
  settings.blurRegions = [{ x: 0.1, y: 0.2, width: 0.2, height: 0.3 }, { x: 0.6, y: 0.5, width: 0.2, height: 0.2 }];
  const source = {};
  const rendered = edit.renderEditedImage(source, 4000, 2000, settings);
  assert.deepEqual([rendered.width, rendered.height], [1800, 900]);
  assert.deepEqual(rendered.calls[0], ["draw", "brightness(110%)", source, 1000, 500, 2000, 1000, 0, 0, 1800, 900]);
  assert.deepEqual(rendered.calls.filter(call => call[0] === "rect")[0], ["rect", 180, 180, 360, 270]);
  assert.equal(rendered.calls.filter(call => call[0] === "draw" && call[1] === "blur(12px)").length, 2);
  assert.equal(rendered.calls.at(-1)[0], "text");
  assert.equal((await edit.editedImageBlob(rendered)).type, "image/webp");
  assert.equal(rendered.calls.some(call => call[0] === "border" || call[0] === "pixels"), false);
  const adjusted = { ...settings, contrast: 120, saturation: 0, temperature: 20, sharpness: 40, border: { enabled: true, width: 10, color: "#123456" } };
  const combined = edit.renderEditedImage(source, 4000, 2000, adjusted);
  assert.equal(combined.calls[0][1], "brightness(110%) contrast(120%) saturate(0%)");
  assert.deepEqual(combined.calls.find(call => call[0] === "pixels"), ["pixels", 105, 100, 95, 100]);
  assert.deepEqual(combined.calls.find(call => call[0] === "border"), ["border", "#123456", 10, 5, 5, 1790, 890]);
  assert.ok(combined.calls.findIndex(call => call[0] === "pixels") < combined.calls.findIndex(call => call[0] === "rect"));
  assert.ok(combined.calls.findIndex(call => call[0] === "rect") < combined.calls.findIndex(call => call[0] === "border"));
  assert.equal(combined.calls.at(-1)[0], "text");
  const preview = edit.renderEditedImage(source, 4000, 2000, adjusted, 900);
  assert.deepEqual([preview.width, preview.height], [900, 450]);
  assert.deepEqual(preview.calls.find(call => call[0] === "border"), ["border", "#123456", 5, 2.5, 2.5, 895, 445]);
  assert.equal(preview.context.font, "16px sans-serif");
  for (const position of ["top-left", "top-right", "center", "bottom-left", "bottom-right"]) {
    settings.watermark.position = position;
    assert.ok(edit.renderEditedImage(source, 800, 600, settings).calls.some(call => call[0] === "text"));
  }
} finally { globalThis.document = oldDocument; }

let row = { id: 1, blog_task_id: 7, storage_path: "tasks/7/A.png", file_name: "product.png", sort_order: 2, original_storage_path: null, edit_metadata: null };
const objects = new Map([[row.storage_path, webp()]]), productOriginal = "products/9/original.png";
let failUpdate = false, loseResponse = false, writes = [];
const db = { from(table) {
  assert.equal(table, "blog_task_assets", "Never write Product or Job rows");
  const filters = []; let patch;
  return { select() { return this; }, eq(key, value) { filters.push([key, value]); return this; },
    update(value) { patch = value; return this; }, returns() { return this; },
    async maybeSingle() {
      const matches = filters.every(([key, value]) => String(row[key]) === String(value));
      if (!matches) return { data: null };
      if (patch) {
        if (failUpdate) return { error: { message: "fixture" } };
        assert.deepEqual(Object.keys(patch).sort(), ["edit_metadata", "original_storage_path", "storage_path"]);
        Object.assign(row, structuredClone(patch)); writes.push(patch);
        if (loseResponse) throw new Error("response lost");
      }
      return { data: structuredClone(row) };
    },
  };
}, storage: { from(bucket) {
  assert.equal(bucket, "blog-task-assets");
  return { async upload(path, file, options) { assert.equal(options.upsert, false); assert.equal(objects.has(path), false); objects.set(path, file); return {}; },
    async remove(paths) { paths.forEach(path => objects.delete(path)); return {}; },
    async createSignedUrl(path) { assert.ok(objects.has(path)); return { data: { signedUrl: `https://example.invalid/${path}` } }; },
  };
} } };
const server = load("lib/blog-task-assets/edit-server.ts", { "@/lib/supabase": { supabase: db }, "@/lib/blog-task-assets": base, "./edit": edit,
  "@/lib/blog-publishing/publication-jobs": { isAssetReferencedByPublicationJob: async () => false },
});
const settings = defaults(); settings.crop = { x: 0.1, y: 0.2, width: 0.7, height: 0.6 }; settings.brightness = 125;
settings.contrast = 105; settings.saturation = 95; settings.temperature = 15; settings.sharpness = 20; settings.filter = "warm";
settings.border = { enabled: true, width: 4, color: "#123456" };
settings.watermark.text = "BENICTION"; settings.blurRegions = [{ x: 0.1, y: 0.1, width: 0.3, height: 0.2 }];
const jobA = { image: { assetId: 1, storagePath: row.storage_path, fileName: row.file_name, sortOrder: row.sort_order } };
const frozenA = JSON.stringify(jobA);
const savedB = await server.saveEditedAsset("7", "1", row.storage_path, webp(), settings);
const pathB = savedB.storage_path;
assert.notEqual(pathB, jobA.image.storagePath); assert.equal(savedB.original_storage_path, jobA.image.storagePath);
assert.deepEqual([savedB.id, savedB.sort_order], [1, 2]); assert.deepEqual(savedB.edit_metadata, settings);
assert.deepEqual((await server.getEditableAsset("7", "1")).edit_metadata, settings, "Persisted edit survives reload");
const jobB = { image: { ...jobA.image, storagePath: pathB } }, frozenB = JSON.stringify(jobB);
await server.saveEditedAsset("7", "1", pathB, webp(), { ...settings, brightness: 75 });
const pathC = row.storage_path;
assert.notEqual(pathC, pathB); assert.ok([jobA.image.storagePath, pathB, pathC].every(path => objects.has(path)));
assert.equal(JSON.stringify(jobA), frozenA); assert.equal(JSON.stringify(jobB), frozenB);
await assert.rejects(server.saveEditedAsset("7", "1", pathB, webp(), settings), /변경/);
await server.saveEditedAsset("7", "1", pathC, null, null);
assert.equal(row.storage_path, jobA.image.storagePath); assert.equal(row.edit_metadata, null);
assert.deepEqual([row.id, row.sort_order], [1, 2]); assert.ok(objects.has(pathB));
assert.ok(writes.every(patch => !JSON.stringify(patch).includes(productOriginal)));
failUpdate = true; const count = objects.size;
await assert.rejects(server.saveEditedAsset("7", "1", row.storage_path, webp(), settings), /실패/);
assert.equal(objects.size, count); failUpdate = false;
loseResponse = true; await server.saveEditedAsset("7", "1", row.storage_path, webp(), settings); loseResponse = false;
assert.ok(objects.has(row.storage_path));
await assert.rejects(server.saveEditedAsset("7", "1", row.storage_path, new Blob(["bad"], { type: "image/webp" }), settings), /형식/);
const route = load("app/api/blog/tasks/[id]/assets/[assetId]/edit/route.ts", { "@/lib/supabase": { supabase: db }, "@/lib/blog-task-assets": base, "@/lib/blog-task-assets/edit-server": server });
const context = { params: Promise.resolve({ id: "7", assetId: "1" }) };
let response = await route.GET(new Request("http://local"), context);
assert.equal(response.status, 200); assert.ok((await response.json()).originalUrl.endsWith("tasks/7/A.png"));
const form = new FormData(); form.set("file", webp(), "edited.webp"); form.set("expectedPath", row.storage_path); form.set("metadata", JSON.stringify(settings));
response = await route.POST(new Request("http://local", { method: "POST", body: form }), context); assert.equal(response.status, 200);
response = await route.PATCH(new Request("http://local", { method: "PATCH", body: JSON.stringify({ action: "restore", expectedPath: row.storage_path }) }), context); assert.equal(response.status, 200);

// Existing /prepare and Job snapshot builders read only the current path and original sort_order.
const downloads = load("lib/blog-publishing/downloads.ts", { "../blog-task-assets": base });
assert.equal(downloads.orderedTaskImages(7, [{ ...row, storage_path: pathB }])[0].storage_path, pathB);
const sql = readFileSync("supabase/migrations/202610150006_blog_image_editor.sql", "utf8");
assert.match(sql, /ADD COLUMN original_storage_path text/); assert.match(sql, /ADD COLUMN edit_metadata jsonb/);
assert.doesNotMatch(sql, /UPDATE public.blog_publication_jobs|DROP TABLE|DELETE FROM/);

// Exercise the real editor component with deterministic pointer/Canvas/browser adapters.
let hooks = [], cursor = 0, effects = [], submitted, saved = 0, uiMetadata = null;
const timers = new Map(); let timerId = 0;
const react = { ...React, useState(initial) { const i = cursor++; hooks[i] ??= { value: typeof initial === "function" ? initial() : initial }; return [hooks[i].value, value => { hooks[i].value = typeof value === "function" ? value(hooks[i].value) : value; }]; },
  useRef(initial) { const i = cursor++; hooks[i] ??= { current: initial }; return hooks[i]; },
  useEffect(effect, deps) { const i = cursor++, before = hooks[i]; if (!before || deps.some((value, j) => value !== before.deps[j])) { hooks[i] = { deps }; effects.push(() => { before?.cleanup?.(); hooks[i].cleanup = effect(); }); } },
};
const Editor = load("app/content/blog/[id]/BlogImageEditor.tsx", { react, "@/lib/blog-task-assets/edit": edit, "@/lib/blog-task-assets": base }).default;
function walk(node, predicate, found = []) { if (!node || typeof node !== "object") return found; if (predicate(node)) found.push(node); React.Children.forEach(node.props?.children, child => walk(child, predicate, found)); return found; }
function render() {
  cursor = 0; effects = [];
  const tree = Editor({ taskId: 7, asset: { ...row, edit_metadata: null }, onClose() {}, onSaved() { saved++; } });
  walk(tree, node => !!node.props?.ref).forEach(node => { node.props.ref.current = node.type === "canvas" ? canvas() : { focus() {} }; });
  effects.forEach(effect => effect()); return tree;
}
const previous = { fetch: globalThis.fetch, createImageBitmap: globalThis.createImageBitmap, document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
try {
  globalThis.document = { createElement: () => canvas() };
  globalThis.requestAnimationFrame = callback => { callback(); return 1; }; globalThis.cancelAnimationFrame = () => {};
  globalThis.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.createImageBitmap = async () => ({ width: 4000, height: 2000, close() {} });
  globalThis.fetch = async (url, options) => {
    if (options?.method === "POST") { submitted = options.body; return { ok: true, json: async () => ({ asset: row }) }; }
    if (options?.method === "PATCH") return { ok: true, json: async () => ({ asset: row }) };
    if (String(url).startsWith("https:")) return { ok: true, blob: async () => webp() };
    return { ok: true, json: async () => ({ asset: { ...row, edit_metadata: uiMetadata }, originalUrl: "https://example.invalid/original" }) };
  };
  render(); await new Promise(resolve => setImmediate(resolve));
  const beforeSliderEncodes = encodes;
  let tree = render();
  const pointer = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, preventDefault() {}, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }), setPointerCapture() {} } });
  let target = walk(tree, node => !!node.props?.onPointerDown)[0];
  target.props.onPointerDown(pointer(20, 10)); target.props.onPointerUp(pointer(140, 80));
  tree = render(); walk(tree, node => node.props?.['aria-label'] === "밝기")[0].props.onChange({ target: { value: "110" } });
  tree = render(); walk(tree, node => node.props?.['aria-label'] === "워터마크 텍스트")[0].props.onChange({ target: { value: "TEST" } });
  tree = render(); target = walk(tree, node => !!node.props?.onPointerDown)[1];
  target.props.onPointerDown(pointer(40, 20)); target.props.onPointerUp(pointer(80, 60));
  tree = render(); walk(tree, node => node.props?.['aria-label'] === "필터")[0].props.onChange({ target: { value: "warm" } });
  tree = render(); walk(tree, node => node.props?.['aria-label'] === "대비")[0].props.onChange({ target: { value: "105" } });
  tree = render(); walk(tree, node => node.type === "input" && node.props.type === "checkbox")[0].props.onChange({ target: { checked: true } });
  tree = render(); walk(tree, node => node.props?.['aria-label'] === "테두리 두께")[0].props.onChange({ target: { value: "4" } });
  tree = render();
  assert.equal(encodes, beforeSliderEncodes, "Continuous slider input must not encode each intermediate setting");
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 450);
  assert.equal(submitted, undefined, "Adjustments must not upload before Save");
  [...timers.values()][0].callback(); await new Promise(resolve => setImmediate(resolve));
  tree = render();
  const info = walk(tree, node => node.props?.['aria-label'] === "결과 이미지 정보")[0];
  assert.ok(walk(info, node => node.type === "p").some(node => React.Children.toArray(node.props.children).join("").includes("1800 × 1050 · WebP")));
  assert.ok(walk(info, node => node.type === "p").some(node => String(node.props.children).includes("예상 1 KB")));
  const beforeSaveEncodes = encodes;
  tree = render(); walk(tree, node => node.type === "button" && node.props.children === "저장")[0].props.onClick();
  await new Promise(resolve => setImmediate(resolve));
  const config = JSON.parse(submitted.get("metadata"));
  assert.deepEqual(config.crop, { x: 0.1, y: 0.1, width: 0.6, height: 0.7000000000000001 });
  assert.equal(config.brightness, 100); assert.equal(config.watermark.text, "TEST"); assert.equal(config.blurRegions.length, 1);
  assert.equal(config.temperature, 25); assert.equal(config.contrast, 105); assert.equal(config.filter, "warm");
  assert.deepEqual(config.border, { enabled: true, width: 4, color: "#000000" });
  assert.equal(submitted.get("file").type, "image/webp"); assert.equal(saved, 1);
  assert.equal(encodes, beforeSaveEncodes, "Save reuses the current full-size estimated Blob");
  hooks.forEach(hook => hook?.cleanup?.()); hooks = [];
  uiMetadata = { ...settings, contrast: 130, sharpness: 40, border: { enabled: true, width: 5, color: "#000000" } };
  render(); await new Promise(resolve => setImmediate(resolve)); tree = render();
  assert.equal(walk(tree, node => node.props?.['aria-label'] === "대비")[0].props.value, 130);
  walk(tree, node => node.type === "button" && node.props.children === "원본으로 되돌리기")[0].props.onClick();
  await new Promise(resolve => setImmediate(resolve)); tree = render();
  assert.equal(walk(tree, node => node.props?.['aria-label'] === "대비")[0].props.value, 100);
  assert.equal(walk(tree, node => node.props?.['aria-label'] === "선명도")[0].props.value, 0);
  assert.equal(walk(tree, node => node.props?.['aria-label'] === "필터")[0].props.value, "none");
  assert.equal(saved, 2);
} finally { hooks.forEach(hook => hook?.cleanup?.()); Object.assign(globalThis, previous); }
console.log("PASS: crop coordinates, brightness, five watermarks, one/multiple blur, shared preview/export, editor pointer/save, metadata persistence, restore, unique A/B/C paths, immutable old paths/Jobs, CAS/errors and additive migration.");
