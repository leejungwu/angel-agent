import { BLOG_BODY_TARGET_CHARS } from "./body";

export const BLOG_TEMPLATE_OPTIONS = [
  { value: "review", label: "후기형" }, { value: "informational", label: "정보형" },
  { value: "comparison", label: "비교형" }, { value: "problem_solution", label: "문제 해결형" },
  { value: "product_intro", label: "제품 소개형" },
] as const;
export const BLOG_TONE_OPTIONS = [
  { value: "natural", label: "자연스러운 문체" }, { value: "polite", label: "해요체" }, { value: "formal", label: "합니다체" },
] as const;
export const BLOG_PRODUCT_EXPOSURE_OPTIONS = [
  { value: "low", label: "낮음" }, { value: "medium", label: "보통" }, { value: "high", label: "높음" },
] as const;
export const BLOG_CTA_OPTIONS = [{ value: "none", label: "없음" }, { value: "closing", label: "마무리에서 안내" }] as const;

export type BlogGenerationSettings = {
  template: typeof BLOG_TEMPLATE_OPTIONS[number]["value"];
  tone: typeof BLOG_TONE_OPTIONS[number]["value"];
  targetLength: number;
  sectionCount: number;
  mainKeyword?: string;
  keywordUsage: { min: number; max: number };
  productExposure: typeof BLOG_PRODUCT_EXPOSURE_OPTIONS[number]["value"];
  cta: typeof BLOG_CTA_OPTIONS[number]["value"];
  additionalInstructions?: string;
};

export const BLOG_GENERATION_LIMITS = {
  targetLength: { min: 500, max: 5000 }, sectionCount: { min: 1, max: 8 },
  keywordUsage: { min: 0, max: 20 }, mainKeyword: 100, additionalInstructions: 3000,
} as const;

export const DEFAULT_BLOG_GENERATION_SETTINGS: Readonly<BlogGenerationSettings> = Object.freeze({
  template: "informational", tone: "natural", targetLength: BLOG_BODY_TARGET_CHARS, sectionCount: 3,
  mainKeyword: undefined, additionalInstructions: undefined,
  keywordUsage: Object.freeze({ min: 0, max: 3 }), productExposure: "medium", cta: "none",
});

export class BlogGenerationSettingsError extends Error {
  constructor(public readonly field: string) {
    super(`Blog generation settings의 ${field} 값을 확인해 주세요.`);
    this.name = "BlogGenerationSettingsError";
  }
}

/** Omitted fields use defaults. User values are never silently coerced. */
export function parseBlogGenerationSettings(value: unknown = undefined): BlogGenerationSettings {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) throw new BlogGenerationSettingsError("settings");
  const input = (value ?? {}) as Record<string, unknown>;
  const allowed = ["template", "tone", "targetLength", "sectionCount", "mainKeyword", "keywordUsage", "productExposure", "cta", "additionalInstructions"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new BlogGenerationSettingsError("settings");
  const defaults = DEFAULT_BLOG_GENERATION_SETTINGS;
  function option<T extends string>(field: string, options: readonly { value: T }[], fallback: T): T {
    const selected = input[field] === undefined ? fallback : input[field];
    if (typeof selected !== "string" || !options.some((entry) => entry.value === selected)) throw new BlogGenerationSettingsError(field);
    return selected as T;
  }
  function integer(field: string, candidate: unknown, min: number, max: number): number {
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < min || candidate > max) throw new BlogGenerationSettingsError(field);
    return candidate;
  }
  function optionalText(field: string, max: number): string | undefined {
    const text = input[field];
    if (text === undefined) return undefined;
    if (typeof text !== "string" || text.length > max) throw new BlogGenerationSettingsError(field);
    return text.trim() || undefined;
  }
  const usage = input.keywordUsage === undefined ? defaults.keywordUsage : input.keywordUsage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage) || Object.keys(usage).some((key) => key !== "min" && key !== "max")) throw new BlogGenerationSettingsError("keywordUsage");
  const range = usage as Record<string, unknown>;
  const min = integer("keywordUsage.min", range.min, 0, BLOG_GENERATION_LIMITS.keywordUsage.max);
  const max = integer("keywordUsage.max", range.max, 0, BLOG_GENERATION_LIMITS.keywordUsage.max);
  if (min > max) throw new BlogGenerationSettingsError("keywordUsage");
  return {
    template: option("template", BLOG_TEMPLATE_OPTIONS, defaults.template), tone: option("tone", BLOG_TONE_OPTIONS, defaults.tone),
    targetLength: integer("targetLength", input.targetLength === undefined ? defaults.targetLength : input.targetLength, BLOG_GENERATION_LIMITS.targetLength.min, BLOG_GENERATION_LIMITS.targetLength.max),
    sectionCount: integer("sectionCount", input.sectionCount === undefined ? defaults.sectionCount : input.sectionCount, BLOG_GENERATION_LIMITS.sectionCount.min, BLOG_GENERATION_LIMITS.sectionCount.max),
    mainKeyword: optionalText("mainKeyword", BLOG_GENERATION_LIMITS.mainKeyword), keywordUsage: { min, max },
    productExposure: option("productExposure", BLOG_PRODUCT_EXPOSURE_OPTIONS, defaults.productExposure),
    cta: option("cta", BLOG_CTA_OPTIONS, defaults.cta),
    additionalInstructions: optionalText("additionalInstructions", BLOG_GENERATION_LIMITS.additionalInstructions),
  };
}
