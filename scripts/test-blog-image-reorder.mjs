import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import React from "react";

function load(file, mocks) {
  const filename = resolve(file), mod = new Module(filename), original = createRequire(filename);
  mod.filename = filename;
  mod.require = name => name in mocks ? mocks[name] : original(name);
  mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, filename);
  return mod.exports;
}
const assetsModule = load("lib/blog-task-assets.ts", {});
const downloads = load("lib/blog-publishing/downloads.ts", { "../blog-task-assets": assetsModule });
const fixture = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, sort_order: index, file_name: `${index + 1}.png`, storage_path: `tasks/7/${index + 1}.png` }));
const tick = () => new Promise(resolve => setImmediate(resolve));
let hooks, cursor, effects, props, refreshes, requests, database, active, maxActive;
const react = { ...React,
  useState(initial) { const i = cursor++; hooks[i] ??= { value: typeof initial === "function" ? initial() : initial }; return [hooks[i].value, next => { hooks[i].value = typeof next === "function" ? next(hooks[i].value) : next; }]; },
  useRef(initial) { const i = cursor++; hooks[i] ??= { current: initial }; return hooks[i]; },
  useEffect(effect, deps) { const i = cursor++, previous = hooks[i]; if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
    hooks[i] = { deps }; effects.push(effect);
  } },
};
const Form = load("app/content/blog/[id]/BlogTaskAssets.tsx", {
  react, "next/navigation": { useRouter: () => ({ refresh: () => refreshes++ }) },
  "@/lib/supabase": { supabase: { storage: { from: () => ({ createSignedUrl: async path => ({ data: { signedUrl: `https://example.invalid/${path}` } }) }) } } },
  "@/lib/blog-task-assets": assetsModule, "@/lib/blog-task-assets/compact": {},
  "./ImagePlacementSettings": { default: () => null }, "@/lib/blog-publishing/downloads": downloads,
  "./BlogImageEditor": { default: () => null },
}).default;
function nodes(node, predicate, found = []) {
  if (!node || typeof node !== "object") return found;
  if (predicate(node)) found.push(node);
  React.Children.forEach(node.props?.children, child => nodes(child, predicate, found)); return found;
}
function render() { cursor = 0; effects = []; const tree = Form(props); for (const effect of effects) effect(); return tree; }
function ids() { return nodes(render(), node => node.type === "li" && node.key !== null).map(node => Number(node.key)); }
function button(id, label) { return nodes(nodes(render(), node => node.type === "li" && node.key === String(id))[0], node => node.type === "button" && node.props.children === label)[0]; }
function click(id, direction) { button(id, direction).props.onClick(); }
function setup() {
  hooks = []; props = { taskId: 7, assets: structuredClone(fixture) }; refreshes = 0; requests = []; active = 0; maxActive = 0; database = fixture.map(asset => asset.id);
  render();
}
const oldFetch = globalThis.fetch;
try {
  globalThis.fetch = (url, options) => new Promise(resolve => {
    assert.equal(url, "/api/blog/tasks/7/assets/order"); assert.equal(options.method, "PATCH");
    active++; maxActive = Math.max(maxActive, active);
    const order = JSON.parse(options.body).assetIds.map(Number);
    requests.push({ order, finish(ok = true) {
      active--; if (ok) database = order;
      resolve({ ok, json: async () => ok ? { ok: true } : { error: "순서 저장 실패" } });
    } });
  });
  setup();
  assert.equal(button(1, "위로").props.disabled, true); assert.equal(button(5, "아래로").props.disabled, true);
  click(3, "위로"); assert.deepEqual(ids(), [1, 3, 2, 4, 5], "Swap before server response");
  assert.equal(requests.length, 1); assert.equal(button(3, "위로").props.disabled, false);
  for (const label of ["삭제", "사진 전체 삭제", "제품 사진에서 추가", "사진 업로드", "저장"]) {
    assert.ok(nodes(render(), node => node.type === "button" && node.props.children === label).every(node => node.props.disabled));
  }
  requests[0].finish(); await tick(); assert.equal(refreshes, 0);
  click(3, "아래로"); assert.deepEqual(ids(), [1, 2, 3, 4, 5]); requests[1].finish(); await tick();
  assert.deepEqual(database, ids()); assert.equal(refreshes, 0);
  // A real reload starts from the order persisted by the API.
  const persisted = database.map((id, sort_order) => ({ ...fixture.find(asset => asset.id === id), sort_order }));
  hooks = []; props = { ...props, assets: persisted }; render(); assert.deepEqual(ids(), database);

  setup(); click(5, "위로"); click(5, "위로"); click(5, "위로");
  assert.deepEqual(ids(), [1, 5, 2, 3, 4]); assert.equal(requests.length, 1);
  requests[0].finish(); await tick(); assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].order, [1, 5, 2, 3, 4]);
  requests[1].finish(); await tick(); assert.deepEqual(database, ids()); assert.equal(maxActive, 1); assert.equal(refreshes, 0);
  const labels = nodes(render(), node => node.type === "span" && node.props.className?.includes("flex-1")).map(node => React.Children.toArray(node.props.children).join(""));
  assert.ok(labels[1].includes("사진 02") && labels[1].includes("5.png"));

  setup(); click(4, "위로"); click(4, "아래로"); click(4, "위로");
  requests[0].finish(); await tick(); assert.equal(requests.length, 1, "Skip redundant latest order");
  assert.deepEqual(database, [1, 2, 4, 3, 5]); assert.deepEqual(ids(), database);

  setup(); click(5, "위로"); requests[0].finish(); await tick();
  const confirmed = [...database];
  click(5, "위로"); click(5, "위로"); assert.notDeepEqual(ids(), confirmed);
  requests[1].finish(false); await tick();
  assert.deepEqual(ids(), confirmed); assert.deepEqual(database, confirmed);
  assert.equal(requests.length, 2); assert.equal(refreshes, 0);
  assert.ok(nodes(render(), node => node.props?.role === "alert").some(node => String(node.props.children).includes("순서 저장 실패")));
  assert.equal(nodes(render(), node => node.type === "button" && node.props.children === "사진 전체 삭제")[0].props.disabled, false);
} finally { globalThis.fetch = oldFetch; }
console.log("PASS: immediate up/down, numbering, serialized/coalesced saves, rapid inputs, confirmed rollback/error, list-operation lock, no reorder refresh, persisted reload.");
