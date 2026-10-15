import "./test-kin-ranges";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildKinPrompt, parseKinPromptSettings } from "../lib/kin/prompts";
import { kinMentionValidationErrors } from "../lib/kin/mention-validation";
import { parsePresetConfig } from "../lib/kin/presets";

const common = parseKinPromptSettings({ system_prompt: "\n편집한 공통 시스템\n", common_style_prompt: "공통 스타일" });
assert.equal(common.system_prompt, "\n편집한 공통 시스템\n");
assert.throws(() => parseKinPromptSettings({ system_prompt: " ", common_style_prompt: "" }));
const task = { preset_instructions_snapshot: "선택 스타일", preset_config_snapshot: parsePresetConfig({ min_chars: 500, max_chars: 900 }),
  instructions: "이번 질문 지시", purpose: "helpful", product_mention_level: "direct" as const, question_url: null, category: null, question: "질문" };
const product = { name: "윗잠베개", brand: "브랜드" };
const prompt = buildKinPrompt(common, task, product, null);
assert.deepEqual(JSON.parse(prompt.systemInstructions).instructionPriority, ["output_schema", "additionalInstructions", "preset", "commonPrompt"]);
assert.equal(JSON.parse(prompt.systemInstructions).productMentionPolicy.requireProductName, true);
assert.deepEqual(JSON.parse(prompt.input), { commonPrompt: { systemPrompt: common.system_prompt, commonStylePrompt: common.common_style_prompt },
  preset: { instructions: task.preset_instructions_snapshot, config: task.preset_config_snapshot },
  additionalInstructions: task.instructions, task: { purpose: "helpful", product_mention_level: "direct", question_url: null, category: null }, question: "질문", product, voc: null });
assert.doesNotMatch(prompt.systemInstructions, /작성하세요|우선하세요|고정 규칙/);
const draft = (answer: string, productMentioned: boolean) => ({ answer, productMentioned, questionIntent: "질문 의도를 요약합니다." });
assert.deepEqual(kinMentionValidationErrors(draft("윗잠베개 소개", true), product, "direct"), []);
assert.deepEqual(kinMentionValidationErrors(draft("일반 정보", false), product, "direct"), ["direct_product_name_missing"]);
assert.ok(kinMentionValidationErrors(draft("브랜드 소개", true), product, "direct").includes("direct_product_name_missing"));
for (const name of [product.name, product.brand]) {
  assert.ok(kinMentionValidationErrors(draft(name, false), product, "none").includes("forbidden_product_or_brand"));
  assert.ok(kinMentionValidationErrors(draft(name, false), product, "relevant").includes("productMentioned_mismatch"));
}
assert.deepEqual(kinMentionValidationErrors(draft("일반 정보", false), product, "none"), []);
assert.deepEqual(kinMentionValidationErrors(draft("브랜드 소개", true), product, "relevant"), []);
assert.ok(kinMentionValidationErrors(draft("정보", true), null, "relevant").includes("productMentioned_without_product"));
assert.ok(kinMentionValidationErrors(draft("정보", true), product, "relevant").includes("productMentioned_mismatch"));
const sql = readFileSync("supabase/migrations/202610150002_kin_common_prompts.sql", "utf8");
const seed = sql.slice(sql.indexOf("VALUES (true,"));
const strings = [...seed.matchAll(/'((?:[^']|'')*)'/g)].map(match => match[1].replace(/''/g, "'").replace(/\\x20/g, " "));
const expected = JSON.parse(readFileSync("scripts/kin-prompt-seed-hashes.json", "utf8"));
assert.deepEqual(strings.map(value => createHash("sha256").update(value).digest("hex")), Object.values(expected));
assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM/i);
console.log("PASS: editable KIN common prompts, explicit priority/data assembly, mention hard failures, verbatim additive seed");
