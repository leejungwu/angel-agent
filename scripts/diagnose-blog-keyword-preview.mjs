// Read-only HTTP diagnostic: never sends action=import.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const [file, productId, mappingJson, baseUrl = "http://localhost:3000"] = process.argv.slice(2);
assert.ok(file && /^\d+$/.test(productId ?? "") && Number(productId) > 0 && mappingJson,
  'Usage: node scripts/diagnose-blog-keyword-preview.mjs <file> <productId> <mapping JSON> [base URL]');
const mapping = JSON.parse(mappingJson);
const bytes = readFileSync(file);
for (const action of ["inspect", "preview"]) {
  const body = new FormData();
  body.set("file", new File([bytes], basename(file)));
  body.set("productId", productId);
  body.set("action", action);
  body.set("source", "");
  body.set("mapping", JSON.stringify(mapping));
  const request = new Request(new URL("/api/blog/keywords/import", baseUrl), { method: "POST", body });
  const requestBytes = (await request.clone().arrayBuffer()).byteLength;
  const started = Date.now();
  let stage = "FETCH";
  try {
    const response = await fetch(request, { signal: AbortSignal.timeout(120000) });
    stage = "BODY_READ";
    const text = await response.text();
    stage = "JSON_PARSE";
    const result = JSON.parse(text);
    const counts = Object.fromEntries(Object.entries(result).filter(([, value]) => typeof value === "number"));
    console.log(JSON.stringify({ action, fields: [...body.keys()], requestBytes, status: response.status,
      headers: Object.fromEntries(["content-type", "content-length", "transfer-encoding", "content-encoding"].map(key => [key, response.headers.get(key)])),
      responseBytes: Buffer.byteLength(text), jsonParsed: true, durationMs: Date.now() - started,
      counts, sampleCount: result.samples?.length ?? 0, columnCount: result.columns?.length ?? 0,
      error: response.ok ? undefined : result.error }));
    if (!response.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ action, stage, exceptionName: error.name, durationMs: Date.now() - started }));
    process.exitCode = 1;
  }
}
