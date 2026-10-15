export type BlogPresetInput = {
  name: string;
  description: string | null;
  system_prompt: string;
  strategy_prompt: string;
  style_prompt: string;
  article_prompt: string;
  target_chars: number;
  min_chars: number;
  max_chars: number;
  section_count: number | null;
  keyword_min: number | null;
  keyword_max: number | null;
  is_default: boolean;
};
export type BlogPreset = BlogPresetInput & { id: string; created_at: string; updated_at: string };
export const BLOG_PRESET_FIELDS = "id, name, description, system_prompt, strategy_prompt, style_prompt, article_prompt, target_chars, min_chars, max_chars, section_count, keyword_min, keyword_max, is_default, created_at, updated_at";
export const BLOG_PRESET_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBlogPreset(value: unknown): BlogPresetInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("프리셋 입력을 확인해 주세요.");
  const item = value as Record<string, unknown>;
  function text(key: string, max: number, required = false) {
    const candidate = item[key];
    if (candidate == null && !required) return "";
    if (typeof candidate !== "string" || candidate.length > max || (required && !candidate.trim())) throw new Error(`${key} 값을 확인해 주세요.`);
    // Prompt whitespace belongs to the editable preset and is not silently rewritten.
    return candidate;
  }
  function integer(key: string, required = false, min = 0, max = 2147483647) {
    const candidate = item[key] ?? null;
    if (candidate === null && !required) return null;
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < min || candidate > max) throw new Error(`${key} 범위를 확인해 주세요.`);
    return candidate;
  }
  const target_chars = integer("target_chars", true, 1)!;
  const min_chars = integer("min_chars", true, 1)!;
  const max_chars = integer("max_chars", true, 1)!;
  const keyword_min = integer("keyword_min");
  const keyword_max = integer("keyword_max");
  if (min_chars > target_chars || target_chars > max_chars) throw new Error("최소 ≤ 목표 ≤ 최대 글자 수여야 합니다.");
  if (keyword_min !== null && keyword_max !== null && keyword_min > keyword_max) throw new Error("키워드 최소 횟수는 최대 횟수 이하여야 합니다.");
  if (item.is_default !== undefined && typeof item.is_default !== "boolean") throw new Error("기본 프리셋 값을 확인해 주세요.");
  return {
    name: text("name", 100, true).trim(), description: text("description", 500).trim() || null,
    system_prompt: text("system_prompt", 30000, true), strategy_prompt: text("strategy_prompt", 30000),
    style_prompt: text("style_prompt", 30000), article_prompt: text("article_prompt", 30000),
    target_chars, min_chars, max_chars, section_count: integer("section_count", false, 1, 8),
    keyword_min, keyword_max, is_default: item.is_default === true,
  };
}
