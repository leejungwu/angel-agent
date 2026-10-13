import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, access } from "node:fs/promises";
import * as files from "node:fs/promises";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import ts from "typescript";
const root = await mkdtemp(path.join(tmpdir(), "angel-temp-test-"));
let response;
const imports = { "node:fs/promises": files, "node:crypto": crypto, "node:path": path, "node:os": { tmpdir: () => root }, "@/lib/blog-task-assets": { BLOG_TASK_ASSET_BUCKET: "blog-task-assets" } };
try {
  const code = ts.transpileModule(await readFile("lib/blog-publishing/temp-image.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const testModule = { exports: {} };
  vm.runInNewContext(code, { module: testModule, exports: testModule.exports, require: (name) => imports[name], process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://storage.fixture.test" } }, Buffer, URL, AbortSignal, fetch: async (_url, options) => { assert.equal(options.redirect, "error"); return response; } });
  const api = testModule.exports;
  const url = "https://storage.fixture.test/storage/v1/object/sign/blog-task-assets/tasks/1/a.png?token=secret";
  response = new Response(Uint8Array.from([137,80,78,71,13,10,26,10,1]), { headers: { "content-type": "image/png" } });
  const result = await api.createTempImage(url);
  assert.ok(path.isAbsolute(result.absolutePath));
  assert.ok(result.absolutePath.startsWith(root));
  assert.equal(path.extname(result.absolutePath), ".png");
  await access(result.absolutePath);
  await api.deleteTempImage(result.tempId); await api.deleteTempImage(result.tempId);
  await assert.rejects(access(result.absolutePath));
  await assert.rejects(api.deleteTempImage("../outside"));
  await assert.rejects(api.createTempImage("https://evil.test/a.png"));
  response = new Response("error", { status: 403 });
  await assert.rejects(api.createTempImage(url));
  response = new Response("not an image", { headers: { "content-type": "image/png" } });
  await assert.rejects(api.createTempImage(url));
  response = new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } });
  await assert.rejects(api.createTempImage(url), (error) => error.status === 413);
  for (const [mime, bytes, extension] of [["image/jpeg", [255,216,255,1], ".jpg"], ["image/webp", [82,73,70,70,0,0,0,0,87,69,66,80], ".webp"]]) {
    response = new Response(Uint8Array.from(bytes), { headers: { "content-type": mime } });
    const image = await api.createTempImage(url);
    assert.equal(path.extname(image.absolutePath), extension);
    await api.deleteTempImage(image.tempId);
  }
  const routeImports = {
    "@/lib/blog-publishing/extension-api": { authorizeExtension: (request) => request.headers.get("authorization") === "Bearer fixture-secret" ? null : Response.json({ error: "Unauthorized" }, { status: 401 }) },
    "@/lib/blog-publishing/temp-image": api,
  };
  async function route(file) {
    const routeModule = { exports: {} };
    const source = ts.transpileModule(await readFile(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    vm.runInNewContext(source, { module: routeModule, exports: routeModule.exports, require: (name) => routeImports[name], Response, console: { error() {} } });
    return routeModule.exports;
  }
  const create = await route("app/api/extension/temp-image/route.ts");
  const cleanup = await route("app/api/extension/temp-image/[tempId]/route.ts");
  assert.equal((await create.POST(new Request("http://localhost/api", { method: "POST" }))).status, 401);
  const request = (body) => new Request("http://localhost/api", { method: "POST", headers: { authorization: "Bearer fixture-secret" }, body });
  assert.equal((await create.POST(request("invalid-json"))).status, 400);
  assert.equal((await create.POST(request("{}"))).status, 400);
  response = new Response(Uint8Array.from([137,80,78,71,13,10,26,10,1]), { headers: { "content-type": "image/png" } });
  const created = await create.POST(request(JSON.stringify({ signedUrl: url })));
  assert.equal(created.status, 200);
  const temp = await created.json();
  const deletedRequest = new Request("http://localhost/api", { method: "DELETE", headers: { authorization: "Bearer fixture-secret" } });
  assert.equal((await cleanup.DELETE(new Request("http://localhost/api"), { params: Promise.resolve({ tempId: temp.tempId }) })).status, 401);
  assert.equal((await cleanup.DELETE(deletedRequest, { params: Promise.resolve({ tempId: "../outside" }) })).status, 400);
  assert.equal((await cleanup.DELETE(deletedRequest, { params: Promise.resolve({ tempId: temp.tempId }) })).status, 200);
  assert.equal((await cleanup.DELETE(deletedRequest, { params: Promise.resolve({ tempId: temp.tempId }) })).status, 200);
  console.log("Temp image checks passed: signed URL scope, byte validation, OS temp file, UUID cleanup, idempotence, traversal rejection.");
} finally { await rm(root, { recursive: true }); }
