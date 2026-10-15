import type { PresetConfig, MentionLevel } from "./presets";

export type KinPromptSettings = { system_prompt: string; common_style_prompt: string; updated_at?: string };
export const KIN_PROMPT_FIELDS = "system_prompt, common_style_prompt, updated_at";

export function parseKinPromptSettings(value: unknown): KinPromptSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("공통 프롬프트를 확인해 주세요.");
  const item = value as Record<string, unknown>;
  if (typeof item.system_prompt !== "string" || !item.system_prompt.trim() || item.system_prompt.length > 30000 ||
    typeof item.common_style_prompt !== "string" || item.common_style_prompt.length > 30000) throw new Error("시스템 지시는 필수이며 각 프롬프트는 30,000자 이하여야 합니다.");
  return { system_prompt: item.system_prompt, common_style_prompt: item.common_style_prompt };
}

export type KinPromptTask = {
  preset_instructions_snapshot: string | null; preset_config_snapshot: PresetConfig | null;
  instructions: string | null; purpose: string; product_mention_level: MentionLevel;
  question_url: string | null; category: string | null; question: string;
};

export function buildKinPrompt(common: KinPromptSettings, task: KinPromptTask, product: unknown, voc: unknown) {
  return {
    // Priority and mention policy are program contracts; all writing prose is editable data.
    systemInstructions: JSON.stringify({
      instructionPriority: ["output_schema", "additionalInstructions", "preset", "commonPrompt"],
      productMentionPolicy: {
        level: task.product_mention_level, productSelected: product !== null,
        requireProductName: product !== null && task.product_mention_level === "direct",
        forbidProductNameAndBrand: task.product_mention_level === "none",
        productMentionedMustMatchProductOrBrandInAnswer: true,
      },
    }),
    input: JSON.stringify({
      commonPrompt: { systemPrompt: common.system_prompt, commonStylePrompt: common.common_style_prompt },
      preset: { instructions: task.preset_instructions_snapshot, config: task.preset_config_snapshot },
      additionalInstructions: task.instructions,
      task: { purpose: task.purpose, product_mention_level: task.product_mention_level, question_url: task.question_url, category: task.category },
      question: task.question, product, voc,
    }),
  };
}
