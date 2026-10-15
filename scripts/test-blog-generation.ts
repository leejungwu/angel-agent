import assert from "node:assert/strict";
import "./test-blog-draft-validation";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseBlogPreset } from "../lib/blog-generation/presets";
import { buildBlogPrompt } from "../lib/blog-generation/prompts";
import { createBlogGenerationSnapshot, readBlogGenerationSnapshot } from "../lib/blog-generation/snapshot";
import { checkBlogBodyLength } from "../lib/blog-generation/body";

const input = { name: " 프리셋 ", description: "설명", system_prompt: "\n사용자 시스템 지시\n", strategy_prompt: "전략", style_prompt: "문체", article_prompt: "전개", target_chars: 1600, min_chars: 1430, max_chars: 1870, section_count: 3, keyword_min: 0, keyword_max: 3 };
const preset = { ...parseBlogPreset(input), id: "12345678-1234-1234-1234-123456789abc", created_at: "", updated_at: "" };
assert.equal(preset.name, "프리셋");
assert.equal(preset.system_prompt, input.system_prompt);
for (const patch of [{ name: " " }, { system_prompt: " " }, { target_chars: 0 }, { target_chars: 1429 }, { max_chars: 1599 }, { min_chars: -1 }, { min_chars: "1430" }, { max_chars: 1.2 }, { section_count: 0 }, { section_count: 9 }, { keyword_min: -1 }, { keyword_min: 4, keyword_max: 3 }, { is_default: "true" }]) assert.throws(() => parseBlogPreset({ ...input, ...patch }));
assert.equal(parseBlogPreset({ ...input, section_count: null, keyword_min: null, keyword_max: null }).section_count, null);
const product = { id: 2, name: "제품", brand: null, usp: null, target_customer: null, customer_problem: null, notes: null };
const task = { keyword: "단일 키워드", topic: "주제", instructions: "이번 글 지시" };
const prompt = buildBlogPrompt(product, task, preset);
assert.equal(prompt.systemInstructions, preset.system_prompt);
assert.deepEqual(JSON.parse(prompt.input), {
  preset: { strategyPrompt: preset.strategy_prompt, stylePrompt: preset.style_prompt, articlePrompt: preset.article_prompt,
    target_chars: 1600, min_chars: 1430, max_chars: 1870, section_count: 3, keyword_min: 0, keyword_max: 3 },
  product: { name: product.name, brand: null, usp: null, target_customer: null, customer_problem: null, notes: null }, task,
});
assert.equal(prompt.input.split(task.keyword).length - 1, 1);
assert.equal(prompt.input.split(task.instructions).length - 1, 1);
assert.doesNotMatch(prompt.input + prompt.systemInstructions, /BLOG_FIXED|referenceWritingGuides|generationInstructions|bodyLengthGuide|항상 우선하세요/);
const snapshot = createBlogGenerationSnapshot(preset, task, product, "xai", "grok-4.7");
snapshot.responseModel = "returned-model";
preset.style_prompt = "나중에 수정"; task.instructions = "나중에 수정"; product.name = "나중에 수정";
assert.equal(snapshot.preset.style_prompt, "문체");
assert.equal(snapshot.task.instructions, "이번 글 지시");
assert.equal(snapshot.product.name, "제품");
assert.equal(readBlogGenerationSnapshot(snapshot)?.responseModel, "returned-model");
for (const old of [null, undefined, {}, { version: 99 }]) assert.equal(readBlogGenerationSnapshot(old), null);
assert.equal(checkBlogBodyLength({ intro: "가".repeat(1430), sections: [] }, snapshot.preset).status, "ok");
assert.equal(checkBlogBodyLength({ intro: "가".repeat(1429), sections: [] }, snapshot.preset).status, "too_short");
assert.equal(checkBlogBodyLength({ intro: "가".repeat(1871), sections: [] }, snapshot.preset).status, "too_long");
const sql = readFileSync("supabase/migrations/202610150001_create_blog_prompt_presets.sql", "utf8");
const [, columnsText, values] = sql.match(/INSERT INTO public.blog_prompt_presets \(([^)]+)\)\s*VALUES\s*([\s\S]*);\s*COMMIT;/)!;
const columns = columnsText.split(",").map(s => s.trim());
const rows = [...values.matchAll(/\('(?:[^']|'')*'[\s\S]*?,\s*(?:true|false)\)/g)].map(match => {
  const tokens = [...match[0].slice(1, -1).matchAll(/'((?:[^']|'')*)'|\b(NULL|true|false|\d+)\b/g)].map(token => token[1] !== undefined ? token[1].replace(/''/g, "'") : token[2] === "NULL" ? null : token[2] === "true" ? true : token[2] === "false" ? false : Number(token[2]));
  return Object.fromEntries(columns.map((key, index) => [key, tokens[index]]));
});
const hashes = JSON.parse(readFileSync("scripts/blog-preset-seed-hashes.json", "utf8"));
assert.equal(rows.length, 5);
assert.deepEqual(rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === "string" && key.endsWith("_prompt") ? createHash("sha256").update(value).digest("hex") : value]))), hashes);
assert.deepEqual(rows.filter(row => row.is_default).map(row => row.name), ["정보형"]);
for (const row of rows) parseBlogPreset(row);
assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM/i);
console.log("PASS: preset ranges, exact prompt assembly/no hidden prose, single Task fields, immutable snapshot, explicit body bounds, five verbatim seeds, additive SQL");
