import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";
import React from "react";

function load(file, mocks = {}) {
  const filename = resolve(file), compiled = new Module(filename), original = createRequire(filename);
  compiled.filename = filename;
  compiled.require = name => name in mocks ? mocks[name] : original(name);
  compiled._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, filename);
  return compiled.exports;
}
const settings = load("lib/blog-publishing/image-placement-settings.ts");
const task = { id: 1, status: "generated", image_placement_settings: null };
let error = false, updated;
const db = { from(table) {
  assert.equal(table, "blog_tasks", "settings save must never write Drafts or Jobs");
  let id;
  return { update(value) { updated = value; assert.deepEqual(Object.keys(value), ["image_placement_settings"]); return this; },
    eq(_key, value) { id = value; return this; }, select() { return this; }, async maybeSingle() {
      if (error) return { error: { code: "fixture" } };
      if (id !== "1") return { data: null };
      Object.assign(task, updated); return { data: { id: task.id } };
    } };
} };
const api = load("app/api/blog/tasks/[id]/image-placement/route.ts", { "@/lib/supabase": { supabase: db }, "@/lib/blog-publishing/image-placement-settings": settings });
const request = input => new Request("http://localhost/api", { method: "PATCH", body: JSON.stringify(input) });
const context = id => ({ params: Promise.resolve({ id }) });
const desired = { pinFirstAfterIntro: true, pinLastBeforeClosing: true, allowParagraphSplit: false };
assert.equal((await api.PATCH(request(desired), context("1"))).status, 200);
assert.deepEqual(task.image_placement_settings, desired); assert.equal(task.status, "generated");
for (const input of [null, [], { allowParagraphSplit: "false" }, { status: "approved" }]) assert.equal((await api.PATCH(request(input), context("1"))).status, 400);
assert.equal((await api.PATCH(request(desired), context("bad"))).status, 400);
assert.equal((await api.PATCH(request(desired), context("2"))).status, 404);
error = true;
assert.equal((await api.PATCH(request(desired), context("1"))).status, 500);
error = false;

let state = [], cursor = 0, refreshes = 0;
const hooks = { useState(initial) { const i = cursor++; if (!(i in state)) state[i] = typeof initial === "function" ? initial() : initial; return [state[i], value => state[i] = typeof value === "function" ? value(state[i]) : value]; } };
const Control = load("app/content/blog/[id]/ImagePlacementSettings.tsx", { react: hooks,
  "next/navigation": { useRouter: () => ({ refresh: () => refreshes++ }) }, "@/lib/blog-publishing/image-placement-settings": settings,
}).default;
function render(initialSettings = null) { cursor = 0; return Control({ taskId: 1, initialSettings }); }
const walk = node => !node || typeof node !== "object" ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
assert.deepEqual(walk(render()).filter(node => node.type === "input").map(node => node.props.checked), [false, false, true]);
for (const [index, checked] of [[0, true], [1, true], [2, false]]) walk(render()).filter(node => node.type === "input")[index].props.onChange({ target: { checked } });
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/blog/tasks/1/image-placement"); assert.equal(options.method, "PATCH");
    assert.deepEqual(JSON.parse(options.body), desired); return Response.json({ settings: desired });
  };
  await render().props.onSubmit({ preventDefault() {} });
  assert.equal(refreshes, 1);
  assert.ok(walk(render()).some(node => node.props?.role === "status"));
  state = [];
  globalThis.fetch = async () => Response.json({ error: "fixture save failure" }, { status: 500 });
  await render().props.onSubmit({ preventDefault() {} });
  assert.ok(walk(render()).some(node => node.props?.role === "alert"));
} finally { globalThis.fetch = originalFetch; }
const sql = readFileSync("supabase/migrations/202610150004_add_blog_image_placement_settings.sql", "utf8");
assert.match(sql, /ALTER TABLE public\.blog_tasks ADD COLUMN image_placement_settings jsonb;/);
assert.doesNotMatch(sql, /UPDATE\s+public|CREATE TABLE|NOT NULL|DROP\s/i);
console.log("PASS: placement settings API/UI, defaults, save/errors, Task-only update, nullable additive migration.");
