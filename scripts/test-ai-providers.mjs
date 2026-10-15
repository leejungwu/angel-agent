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
const blogPresets = load("lib/blog-generation/presets.ts");
const snapshots = load("lib/blog-generation/snapshot.ts", { "./presets": blogPresets });
const prompts = load("lib/blog-generation/prompts.ts");
const blogPreset = { ...blogPresets.parseBlogPreset({ name: "프리셋", system_prompt: "편집한 시스템", strategy_prompt: "전략", style_prompt: "문체", article_prompt: "전개", target_chars: 1600, min_chars: 1400, max_chars: 1900, section_count: 3, keyword_min: 0, keyword_max: 3, is_default: true }), id: "12345678-1234-1234-1234-123456789abc", created_at: "", updated_at: "" };
const kin = load("lib/kin/generate.ts");
const presets = load("lib/kin/presets.ts", { "./generate": kin });
const kinPrompts = load("lib/kin/prompts.ts");
const kinMention = load("lib/kin/mention-validation.ts");
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
let availablePresets = [blogPreset];
let failPresetSave = false;
const database = {
  from(table) {
    let operation = "read";
    let changes;
    const filters = {};
    return {
      select() { return this; }, eq(key, value) { filters[key] = value; return this; }, order() { return this; }, limit() { return this; },
      insert(value) { operation = "insert"; changes = value; return this; },
      update(value) { operation = "update"; changes = value; return this; },
      async maybeSingle() {
        if (operation === "update") {
          if (table === "blog_tasks" && "preset_id" in changes && failPresetSave) return { data: null, error: { code: "MOCK_SAVE_FAILED" } };
          writes.push({ table, changes, filters });
          if (table === "blog_tasks" && "preset_id" in changes) task.preset_id = changes.preset_id;
          return { data: { id: 1, status: changes.status }, error: null };
        }
        if (table === "kin_prompt_settings") return { data: { system_prompt: "공통 시스템", common_style_prompt: "공통 스타일" }, error: null };
        return { data: table === "products" ? product : table === "blog_prompt_presets"
          ? availablePresets.find((preset) => Object.entries(filters).every(([key, value]) => preset[key] === value)) ?? null : task, error: null };
      },
      async single() {
        writes.push({ table, changes, filters });
        return { data: { id: table.startsWith("kin_") ? "12345678-1234-1234-1234-123456789abc" : 3, created_at: "2026-10-14T01:02:03.000Z", status: changes?.status }, error: null };
      },
    };
  },
};
const route = load("app/api/blog/generate/route.ts", {
  ...sdkMocks, "@/lib/ai/provider": provider, "@/lib/blog-generation/schema": schema,
  "@/lib/blog-generation/prompts": prompts, "@/lib/supabase": { supabase: database },
  "@/lib/blog-generation/body": blogBody,
  "@/lib/blog-generation/models": blogModels,
  "@/lib/blog-generation/presets": blogPresets, "@/lib/blog-generation/snapshot": snapshots,
});
const kinRoute = load("app/api/kin/generate/route.ts", {
  ...sdkMocks, "@/lib/kin/provider": kinProvider, "@/lib/kin/generate": kin,
  "@/lib/kin/presets": presets, "@/lib/kin/quality-check": quality,
  "@/lib/kin/prompts": kinPrompts, "@/lib/kin/mention-validation": kinMention,
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
const PresetControl = "PresetControl";
const Details = load("app/content/blog/[id]/BlogGenerationDetails.tsx", { "react/jsx-runtime": { jsx, jsxs: jsx }, "@/lib/blog-generation/snapshot": snapshots }).default;
const GenerateBlogDraft = load("app/content/blog/[id]/GenerateBlogDraft.tsx", {
  react: {
    useState(initial) {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = typeof initial === "function" ? initial() : initial;
      return [hookValues[index], (value) => { hookValues[index] = typeof value === "function" ? value(hookValues[index]) : value; }];
    },
    useRef(value) { return { current: value }; },
  },
  "react/jsx-runtime": { jsx, jsxs: jsx },
  "next/navigation": { useRouter: () => ({ refresh() {} }) },
  "next/link": { default: "a" },
  "@/lib/supabase": { supabase: database },
  "@/lib/blog-generation/body": blogBody,
  "@/lib/blog-generation/models": blogModels,
  "@/lib/blog-generation/presets": blogPresets,
  "@/lib/blog-generation/snapshot": snapshots,
  "./BlogPresetControl": { __esModule: true, default: PresetControl },
  "./BlogGenerationDetails": { __esModule: true, default: Details },
}).default;
function renderBlog(initialDraft = null, initialPresetId = blogPreset.id, initialDrafts = []) {
  hookIndex = 0;
  return GenerateBlogDraft({ taskId: 1, initialDraft, initialPresetId, initialPresets: [blogPreset], initialDrafts });
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
    assert.deepEqual(generationRequest, { taskId: 1, provider: "openai", model: "gpt-6-astra", presetId: blogPreset.id });
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
  const prompt = prompts.buildBlogPrompt(product, task, blogPreset);
  assert.deepEqual(JSON.parse(prompt.input).task, {
    keyword: task.keyword, topic: task.topic, instructions: task.instructions,
  });
  assert.doesNotMatch(prompt.systemInstructions + prompt.input, /purpose/);
  for (const file of ["app/content/blog/new/page.tsx", "app/content/blog/[id]/page.tsx", "app/content/blog/[id]/EditBlogTask.tsx", "app/api/blog/generate/route.ts"]) {
    assert.doesNotMatch(readFileSync(resolve(file), "utf8"), /\bpurpose\b/, `${file} must not read or write legacy purpose`);
  }
  assert.equal(prompt.systemInstructions, blogPreset.system_prompt);
  assert.equal(JSON.parse(prompt.input).preset.stylePrompt, blogPreset.style_prompt);
  for (const kind of ["openai", "anthropic", "xai"]) {
    writes.length = 0;
    reply = success(kind, draft);
    const response = await route.POST(request({ taskId: 1, provider: kind }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, kind);
    assert.deepEqual(body.draft, draft);
    assert.deepEqual(body.bodyLength, blogBody.checkBlogBodyLength(draft, blogPreset));
    const saved = writes.find((write) => write.table === "blog_drafts").changes;
    assert.deepEqual(saved, { blog_task_id: 1, product_id: 2, ...draft, status: "draft", model: "returned-model", provider: kind,
      generation_snapshot: { ...snapshots.createBlogGenerationSnapshot(blogPreset, task, product, kind, blogModels.BLOG_DEFAULT_MODELS[kind]), responseModel: "returned-model" } });
    assert.equal(body.generationSnapshot.preset.system_prompt, blogPreset.system_prompt);
    assert.deepEqual(writes.find((write) => write.table === "blog_tasks" && write.changes.status).changes, { status: "generated" });
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
    assert.equal(writes.filter(write => write.table === "blog_drafts").length, 0);
  }
  reply = success("openai", draft);
  failPresetSave = true;
  const beforeSaveFailure = calls.length;
  assert.equal((await route.POST(request({ taskId: 1 }))).status, 500);
  assert.equal(calls.length, beforeSaveFailure, "Preset selection save failure must prevent generation");
  failPresetSave = false;
  assert.match(JSON.stringify(Details({ snapshot: null })), /기존 생성본 · 생성 설정 기록 없음/);
  const snapshot = snapshots.createBlogGenerationSnapshot(blogPreset, task, product, "openai", "requested");
  snapshot.responseModel = "returned-model";
  const details = JSON.stringify(Details({ snapshot }));
  assert.match(details, /당시 프리셋 전체 보기/);
  assert.match(details, /편집한 시스템/);
  hookValues.length = 0;
  const older = { ...draft, id: 1, title: "이전 제목", status: "draft", model: "old-model", created_at: "2026-10-13T00:00:00Z" };
  const newer = { ...draft, id: 2, title: "새 제목", status: "approved", model: "new-model", created_at: "2026-10-14T00:00:00Z" };
  tree = renderBlog(newer, undefined, [newer, older]);
  assert.match(JSON.stringify(Details({ snapshot: null })), /생성 설정 기록 없음/);
  const oldItem = nodes(tree).find((node) => node.type === "li" && JSON.stringify(node).includes("이전 제목"));
  nodes(oldItem).find((node) => node.type === "button").props.onClick();
  tree = renderBlog(newer, undefined, [newer, older]);
  assert.match(JSON.stringify(nodes(tree).find((node) => node.type === "article")), /이전 제목/);
  assert.match(JSON.stringify(nodes(tree).find((node) => node.type === "article")), /이전 생성본 미리보기/);
  const editing = nodes(tree).find((node) => node.type === "button" && node.props.children === "편집");
  editing.props.onClick();
  tree = renderBlog(newer, undefined, [newer, older]);
  assert.equal(nodes(tree).find((node) => node.type === "input" && node.props.value === "이전 제목").props.value, "이전 제목");
  assert.ok(nodes(tree).filter((node) => node.type === "button" && node.props.children === "이 생성본 보기").every((node) => node.props.disabled));
  nodes(tree).find((node) => node.type === "button" && node.props.children === "취소").props.onClick();
  tree = renderBlog(newer, undefined, [newer, older]);
  await nodes(tree).find((node) => node.type === "button" && node.props.children === "승인").props.onClick();
  const approval = writes.findLast((write) => write.table === "blog_drafts");
  assert.equal(approval.filters.id, 1);
  assert.equal(approval.filters.blog_task_id, 1);
  assert.equal(approval.changes.status, "approved");
  hookValues.length = 0;
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
  const secondPreset = { ...blogPreset, id: "22345678-1234-1234-1234-123456789abc", name: "두 번째", is_default: false, system_prompt: "다른 시스템" };
  availablePresets = [blogPreset, secondPreset];
  assert.equal((await route.POST(request({ taskId: 1, presetId: secondPreset.id }))).status, 200);
  assert.equal(task.preset_id, secondPreset.id);
  assert.equal(calls.at(-1).request.instructions, secondPreset.system_prompt);
  assert.equal((await route.POST(request({ taskId: 1 }))).status, 200);
  assert.equal(calls.at(-1).request.instructions, secondPreset.system_prompt, "Task preset precedes default");
  task.preset_id = null;
  assert.equal((await route.POST(request({ taskId: 1 }))).status, 200);
  assert.equal(task.preset_id, blogPreset.id);
  availablePresets = [];
  const beforeMissingPreset = calls.length;
  assert.equal((await route.POST(request({ taskId: 1, presetId: secondPreset.id }))).status, 400);
  task.preset_id = null;
  assert.equal((await route.POST(request({ taskId: 1 }))).status, 409);
  assert.equal(calls.length, beforeMissingPreset);
  availablePresets = [blogPreset];
  for (const invalid of [{ taskId: 1, presetId: "invalid" }, { taskId: 1, settings: {} }, { taskId: 1, product: {} }]) {
    assert.equal((await route.POST(request(invalid))).status, 400);
  }
  assert.equal((await route.POST(request({ taskId: 1, provider: "invalid" }))).status, 400);
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await route.POST(request({ taskId: 1, provider: "anthropic" }))).status, 500);
  process.env.ANTHROPIC_API_KEY = "mock-key";
  for (const invalid of [{ ...draft, sections: [{ ...draft.sections[0], imageAssetId: 1 }] }, { ...draft, unexpected: true }]) {
    writes.length = 0;
    reply = success("openai", invalid);
    assert.equal((await route.POST(request({ taskId: 1 }))).status, 500);
    assert.equal(writes.filter(write => write.table === "blog_drafts").length, 0);
  }
  console.log("PASS: model options/defaults, UI provider reset/request, model allowlist, three provider dialects, Blog save contract, KIN compatibility, prompt separation and invalid output rejection");
} finally {
  keyNames.forEach((name, index) => {
    if (previousKeys[index] === undefined) delete process.env[name];
    else process.env[name] = previousKeys[index];
  });
}
