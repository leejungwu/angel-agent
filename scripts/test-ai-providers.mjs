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
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
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
const blogBody = load("lib/blog-generation/body.ts");
const blogModels = load("lib/blog-generation/models.ts");
const prompts = load("lib/blog-generation/prompts.ts", { "./body": blogBody });
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
  "@/lib/blog-generation/body": blogBody,
  "@/lib/blog-generation/models": blogModels,
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
// Render controlled inputs with hook doubles; no DOM, browser, API or DB access.
const hookValues = [];
let hookIndex = 0;
const jsx = (type, props) => ({ type, props });
const GenerateBlogDraft = load("app/content/blog/[id]/GenerateBlogDraft.tsx", {
  react: {
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = typeof initial === "function" ? initial() : initial;
      return [hookValues[index], (value) => { hookValues[index] = value; }];
    },
    useRef(value) { return { current: value }; },
  },
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "next/navigation": { useRouter: () => ({ refresh() {} }) },
  "@/lib/supabase": { supabase: database },
  "@/lib/blog-generation/body": blogBody,
  "@/lib/blog-generation/models": blogModels,
}).default;
function renderBlog(initialDraft = null) {
  hookIndex = 0;
  return GenerateBlogDraft({ taskId: 1, initialDraft });
}
function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
try {
  keyNames.forEach((name) => { process.env[name] = "mock-key"; });
  let tree = renderBlog();
  const modelSelect = () => nodes(tree).find((node) => node.type === "select");
  assert.ok(modelSelect(), "Blog must expose a model select");
  assert.equal(modelSelect().props.value, "gpt-6.1-sol");
  modelSelect().props.onChange({ target: { value: "gpt-6-astra" } });
  tree = renderBlog();
  assert.equal(modelSelect().props.value, "gpt-6-astra");
  for (const kind of ["anthropic", "xai", "openai"]) {
    nodes(tree).find((node) => node.type === "input" && node.props.value === kind).props.onChange();
    tree = renderBlog();
    assert.equal(modelSelect().props.value, blogModels.BLOG_DEFAULT_MODELS[kind]);
    assert.deepEqual(nodes(modelSelect()).filter((node) => node.type === "option").map((node) => node.props.value),
      blogModels.BLOG_MODEL_OPTIONS[kind].map((option) => option.value));
  }
  hookValues.length = 0;
  tree = renderBlog({ ...draft, model: "claude-opus-5-5" });
  assert.equal(modelSelect().props.value, "claude-opus-5-5");
  hookValues.length = 0;
  tree = renderBlog({ ...draft, model: "gpt-5-mini-2025-08-07" });
  assert.equal(modelSelect().props.value, "gpt-6.1-sol", "legacy model must fall back to the provider default");
  hookValues.length = 0;
  tree = renderBlog();
  modelSelect().props.onChange({ target: { value: "gpt-6-astra" } });
  tree = renderBlog();
  const previousFetch = globalThis.fetch;
  let generationRequest;
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "/api/blog/generate");
      generationRequest = JSON.parse(options.body);
      return Response.json({ ok: true, draftId: 3, draft, provider: "openai", model: "gpt-6-astra" });
    };
    await nodes(tree).find((node) => node.type === "button" && node.props.children === "AI 초안 생성").props.onClick();
    assert.deepEqual(generationRequest, { taskId: 1, provider: "openai", model: "gpt-6-astra" });
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.deepEqual(blogModels.BLOG_DEFAULT_MODELS, {
    openai: "gpt-6.1-sol", anthropic: "claude-sonnet-5-5", xai: "grok-4.7",
  });
  assert.deepEqual(blogModels.BLOG_MODEL_OPTIONS, {
    openai: [
      { value: "gpt-6-luna", label: "GPT-6 Luna" },
      { value: "gpt-6.1-sol", label: "GPT-6.1 Sol" },
      { value: "gpt-6-astra", label: "GPT-6 Astra" },
    ],
    anthropic: [
      { value: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
      { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { value: "claude-opus-5-5", label: "Claude Opus 5.5" },
    ],
    xai: [{ value: "grok-4.7", label: "Grok 4.7" }],
  });
  for (const kind of ["openai", "anthropic", "xai"]) {
    assert.equal(blogModels.resolveBlogModel(kind), blogModels.BLOG_DEFAULT_MODELS[kind]);
    for (const option of blogModels.BLOG_MODEL_OPTIONS[kind]) {
      assert.equal(blogModels.resolveBlogModel(kind, option.value), option.value);
    }
    for (const invalid of [null, "", 42, {}, "unknown-model", "gpt-5-mini"]) {
      assert.equal(blogModels.resolveBlogModel(kind, invalid), null);
    }
  }
  assert.equal(blogModels.resolveBlogModel("openai", "claude-sonnet-5-5"), null);
  assert.equal(blogModels.resolveBlogModel("anthropic", "gpt-6.1-sol"), null);
  assert.equal(blogModels.resolveBlogModel("xai", "gpt-6.1-sol"), null);
  const prompt = prompts.buildBlogPrompt(product, task);
  assert.deepEqual(JSON.parse(prompt.input).task, {
    keyword: task.keyword, topic: task.topic, instructions: task.instructions,
  });
  assert.doesNotMatch(prompt.systemInstructions + prompt.input, /purpose/);
  for (const file of ["app/content/blog/new/page.tsx", "app/content/blog/[id]/page.tsx", "app/content/blog/[id]/EditBlogTask.tsx", "app/api/blog/generate/route.ts"]) {
    assert.doesNotMatch(readFileSync(resolve(file), "utf8"), /\bpurpose\b/, `${file} must not read or write legacy purpose`);
  }
  assert.match(JSON.parse(prompt.input).bodyLengthGuide, /1500.*1200~1800/);
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
    assert.deepEqual(body.bodyLength, blogBody.checkBlogBodyLength(draft));
    const saved = writes.find((write) => write.table === "blog_drafts").changes;
    assert.deepEqual(saved, { blog_task_id: 1, product_id: 2, ...draft, status: "draft", model: "returned-model" });
    assert.deepEqual(writes.find((write) => write.table === "blog_tasks").changes, { status: "generated" });
    const call = calls.at(-1);
    assert.equal(call.request.model, blogModels.BLOG_DEFAULT_MODELS[kind]);
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
  for (const kind of ["openai", "anthropic", "xai"]) {
    for (const { value: model } of blogModels.BLOG_MODEL_OPTIONS[kind]) {
      writes.length = 0;
      reply = success(kind, draft);
      const response = await route.POST(request({ taskId: 1, provider: kind, model }));
      assert.equal(response.status, 200);
      assert.equal(calls.at(-1).request.model, model);
      assert.equal(writes.find((write) => write.table === "blog_drafts").changes.model, "returned-model");
    }
    for (const model of [null, "", 42, {}, "unknown-model", kind === "openai" ? "claude-sonnet-5-5" : "gpt-6.1-sol"]) {
      writes.length = 0;
      const callCount = calls.length;
      assert.equal((await route.POST(request({ taskId: 1, provider: kind, model }))).status, 400);
      assert.equal(calls.length, callCount, "invalid model must not call a provider");
      assert.equal(writes.length, 0, "invalid model must not write drafts");
    }
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
  console.log("PASS: model options/defaults, UI provider reset/request, model allowlist, three provider dialects, Blog save contract, KIN compatibility, prompt separation and invalid output rejection");
} finally {
  keyNames.forEach((name, index) => {
    if (previousKeys[index] === undefined) delete process.env[name];
    else process.env[name] = previousKeys[index];
  });
}
