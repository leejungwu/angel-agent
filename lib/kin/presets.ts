import { ANSWER_SCHEMA } from "./generate";

export type MentionLevel = "none" | "relevant" | "direct";
export type PresetConfig = {
  paragraph_count: number | null;
  min_chars: number | null;
  max_chars: number | null;
  keywords: string[];
  max_keyword_mentions_per_paragraph: number | null;
  banned_phrases: string[];
};
export type KinPreset = PresetConfig & {
  id: string;
  name: string;
  description: string | null;
  instructions: string;
  default_product_mention_level: MentionLevel | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};
export const CONFIG_FIELDS = "paragraph_count, min_chars, max_chars, keywords, max_keyword_mentions_per_paragraph, banned_phrases";
export const PRESET_FIELDS = `id, name, description, instructions, default_product_mention_level, is_default, created_at, updated_at, ${CONFIG_FIELDS}`;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePresetConfig(item: Record<string, unknown>): PresetConfig {
  function integer(key: string, min: number, max = 2147483647) {
    const value = item[key] ?? null;
    if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)) throw new Error("InvalidPresetConfig");
    return value as number | null;
  }
  function list(key: string) {
    const value = item[key] ?? [];
    if (!Array.isArray(value) || value.some((text) => typeof text !== "string")) throw new Error("InvalidPresetConfig");
    return [...new Set((value as string[]).map((text) => text.trim()).filter(Boolean))];
  }
  const config = { paragraph_count: integer("paragraph_count", 2, 5), min_chars: integer("min_chars", ANSWER_SCHEMA.properties.answer.minLength, ANSWER_SCHEMA.properties.answer.maxLength),
    max_chars: integer("max_chars", ANSWER_SCHEMA.properties.answer.minLength, ANSWER_SCHEMA.properties.answer.maxLength), keywords: list("keywords"),
    max_keyword_mentions_per_paragraph: integer("max_keyword_mentions_per_paragraph", 1, 3), banned_phrases: list("banned_phrases") };
  if (config.min_chars !== null && config.max_chars !== null && config.min_chars > config.max_chars) throw new Error("InvalidPresetConfig");
  return config;
}

export function parsePreset(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("InvalidPreset");
  const item = value as Record<string, unknown>;
  function text(key: string, max: number, required = false) {
    const value = item[key];
    if (value == null && !required) return null;
    if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new Error("InvalidPreset");
    return value.trim() || null;
  }
  const level = item.default_product_mention_level ?? null;
  if (level !== null && level !== "none" && level !== "relevant" && level !== "direct") throw new Error("InvalidPreset");
  if (item.is_default !== undefined && typeof item.is_default !== "boolean") throw new Error("InvalidPreset");
  return { name: text("name", 100, true)!, description: text("description", 500),
    instructions: text("instructions", 6000, true)!, default_product_mention_level: level,
    ...parsePresetConfig(item),
    ...(item.is_default !== undefined ? { is_default: item.is_default as boolean } : {}) };
}
