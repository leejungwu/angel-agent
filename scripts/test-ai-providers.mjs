import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

// Execute the real TypeScript modules with SDK/DB doubles. No API or DB requests.
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

let reply;
const calls = [];
class APIError extends Error {}
class OpenAI {
  static APIError = APIError;
  constructor(options) {
    const create = async (request) => { calls.push({ options, request }); return reply; };
    this.responses = { create };
    this.chat = { completions: { create } };
  }
}
class Anthropic {
  static APIError = APIError;
  constructor(options) {
    this.messages = { create: async (request) => { calls.push({ options, request }); return reply; } };
  }
}
const sdkMocks = {
  openai: OpenAI,
  "@anthropic-ai/sdk": Anthropic,
  "@anthropic-ai/sdk/helpers/json-schema": { jsonSchemaOutputFormat: (schema) => ({ type: "json_schema", schema }) },
};
const provider = load("lib/ai/provider.ts", sdkMocks);
const schema = load("lib/blog-generation/schema.ts");
const prompts = load("lib/blog-generation/prompts.ts");
const kin = load("lib/kin/generate.ts");
const presets = load("lib/kin/presets.ts");
const quality = load("lib/kin/quality-check.ts");
const kinProvider = load("lib/kin/provider.ts", { "@/lib/ai/provider": provider, "./generate": kin });
const draft = { title: "제목", intro: "도입", sections: [{ heading: "소제목", body: "본문", imageAssetId: null }], closing: "마무리" };
function success(kind, value) {
  const content = JSON.stringify(value);
  return kind === "openai" ? { status: "completed", output: [], output_text: content, model: "returned-model" }
    : kind === "anthropic" ? { stop_reason: "end_turn", content: [{ type: "text", text: content }], model: "returned-model" }
    : { choices: [{ finish_reason: "stop", message: { content } }], model: "returned-model" };
}
const task = { id: 1, product_id: 2, keyword: "키워드", topic: "주제", purpose: "목적", instructions: "추가 지시" };
const product = { id: 2, name: "윗잠베개", brand: "브랜드", usp: "USP", target_customer: "대상", customer_problem: "문제", notes: "메모" };
const writes = [];
const database = {
  from(table) {
    let operation = "read";
    let changes;
    return {
      select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; },
      insert(value) { operation = "insert"; changes = value; return this; },
      update(value) { operation = "update"; changes = value; return this; },
      async maybeSingle() {
        if (operation === "update") { writes.push({ table, changes }); return { data: { id: 1 }, error: null }; }
        return { data: table === "products" ? product : task, error: null };
      },
      async single() {
        writes.push({ table, changes });
        return { data: { id: table.startsWith("kin_") ? "12345678-1234-1234-1234-123456789abc" : 3 }, error: null };
      },
    };
  },
};
const route = load("app/api/blog/generate/route.ts", {
  ...sdkMocks, "@/lib/ai/provider": provider, "@/lib/blog-generation/schema": schema,
  "@/lib/blog-generation/prompts": prompts, "@/lib/supabase": { supabase: database },
});
const kinRoute = load("app/api/kin/generate/route.ts", {
  ...sdkMocks, "@/lib/kin/provider": kinProvider, "@/lib/kin/generate": kin,
  "@/lib/kin/presets": presets, "@/lib/kin/quality-check": quality,
  "@/lib/supabase": { supabase: database },
});
const request = (body) => new Request("http://localhost/api/blog/generate", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const keyNames = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY"];
const previousKeys = keyNames.map((name) => process.env[name]);
try {
  keyNames.forEach((name) => { process.env[name] = "mock-key"; });
  const prompt = prompts.buildBlogPrompt(product, task);
  assert.deepEqual(JSON.parse(prompt.input).task, {
    keyword: task.keyword, topic: task.topic, purpose: task.purpose, instructions: task.instructions,
  });
  assert.deepEqual(JSON.parse(prompt.input).referenceWritingGuides, {
    contentStrategy: prompts.BLOG_CONTENT_STRATEGY_GUIDE,
    copywritingSkills: prompts.BLOG_COPYWRITING_SKILLS_GUIDE,
  });
  assert.ok(prompts.BLOG_CONTENT_STRATEGY_GUIDE.trim());
  assert.ok(prompts.BLOG_COPYWRITING_SKILLS_GUIDE.trim());
  for (const kind of ["openai", "anthropic", "xai"]) {
    writes.length = 0;
    reply = success(kind, draft);
    const response = await route.POST(request({ taskId: 1, provider: kind }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, kind);
    assert.deepEqual(body.draft, draft);
    const saved = writes.find((write) => write.table === "blog_drafts").changes;
    assert.deepEqual(saved, { blog_task_id: 1, product_id: 2, ...draft, status: "draft", model: "returned-model" });
    assert.deepEqual(writes.find((write) => write.table === "blog_tasks").changes, { status: "generated" });
    const call = calls.at(-1);
    if (kind === "openai") {
      assert.equal(call.request.instructions, prompt.systemInstructions);
      assert.equal(call.request.input, prompt.input);
    } else if (kind === "anthropic") {
      assert.equal(call.request.system, prompt.systemInstructions);
      assert.equal(call.request.messages[0].content, prompt.input);
    } else {
      assert.equal(call.request.messages[0].content, prompt.systemInstructions);
      assert.equal(call.request.messages[1].content, prompt.input);
    }
    const format = kind === "openai" ? call.request.text.format
      : kind === "anthropic" ? call.request.output_config.format : call.request.response_format.json_schema;
    assert.deepEqual(format.schema, schema.DRAFT_SCHEMA);
    if (kind !== "anthropic") assert.equal(format.name, "blog_draft");
    if (kind === "xai") assert.equal(call.options.baseURL, "https://api.x.ai/v1");
    if (kind === "anthropic") assert.equal(call.request.max_tokens, 12000);

    reply = success(kind, { answer: "실제 질문에 대한 충분한 한국어 답변입니다. ".repeat(15), questionIntent: "질문의 구체적인 의도를 확인합니다.", productMentioned: false });
    const result = await kinProvider.generateKinWithProvider({ provider: kind, systemInstructions: "KIN fixed", input: "{}" });
    assert.ok(kin.isKinAnswer(JSON.parse(result.outputText)));
    assert.equal(result.model, "returned-model");
    const kinCall = calls.at(-1).request;
    const kinFormat = kind === "openai" ? kinCall.text.format
      : kind === "anthropic" ? kinCall.output_config.format : kinCall.response_format.json_schema;
    assert.deepEqual(kinFormat.schema, kin.ANSWER_SCHEMA);
    if (kind === "anthropic") assert.equal(kinCall.max_tokens, 4096);
    if (kind === "openai") assert.equal(kinCall.max_output_tokens, undefined);
    writes.length = 0;
    const kinResponse = await kinRoute.POST(request({ question: "어떤 생활 습관을 관리해야 하나요?", provider: kind }));
    assert.equal(kinResponse.status, 200);
    assert.ok(writes.find((write) => write.table === "kin_drafts"));
    assert.equal(writes.find((write) => write.table === "kin_tasks" && write.changes.status === "generated").changes.status, "generated");

    reply = success(kind, draft);
    if (kind === "openai") reply.status = "incomplete";
    if (kind === "anthropic") reply.stop_reason = "max_tokens";
    if (kind === "xai") reply.choices[0].finish_reason = "length";
    await assert.rejects(() => provider.generateStructuredWithProvider({ provider: kind, model: "m", schema: schema.DRAFT_SCHEMA,
      schemaName: "blog_draft", systemInstructions: "fixed", input: "{}" }), provider.ProviderOutputError);
    reply = success(kind, draft);
    if (kind === "openai") reply.output = [{ type: "message", content: [{ type: "refusal", refusal: "refused" }] }];
    if (kind === "anthropic") reply.stop_reason = "refusal";
    if (kind === "xai") reply.choices[0].message.refusal = "refused";
    writes.length = 0;
    assert.equal((await route.POST(request({ taskId: 1, provider: kind }))).status, 500);
    assert.equal(writes.length, 0);
  }
  reply = success("openai", draft);
  assert.equal((await route.POST(request({ taskId: 1 }))).status, 200);
  assert.equal((await route.POST(request({ taskId: 1, provider: "invalid" }))).status, 400);
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await route.POST(request({ taskId: 1, provider: "anthropic" }))).status, 500);
  process.env.ANTHROPIC_API_KEY = "mock-key";
  for (const invalid of [{ ...draft, sections: [{ ...draft.sections[0], imageAssetId: 1 }] }, { ...draft, unexpected: true }]) {
    writes.length = 0;
    reply = success("openai", invalid);
    assert.equal((await route.POST(request({ taskId: 1 }))).status, 500);
    assert.equal(writes.length, 0);
  }
  console.log("PASS: three provider dialects, Blog save contract, KIN compatibility, prompt separation, incomplete output, missing key and invalid draft rejection");
} finally {
  keyNames.forEach((name, index) => {
    if (previousKeys[index] === undefined) delete process.env[name];
    else process.env[name] = previousKeys[index];
  });
}
