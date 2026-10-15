import type { AIProvider } from "../ai/provider";
import { parseBlogPreset, type BlogPreset, type BlogPresetInput } from "./presets";
import type { BlogPromptProduct, BlogPromptTask } from "./prompts";

export type BlogGenerationSnapshot = {
  version: 1;
  preset: Omit<BlogPresetInput, "is_default"> & { id: string };
  task: BlogPromptTask;
  product: BlogPromptProduct & { id: string | number };
  provider: AIProvider;
  requestedModel: string;
  responseModel: string | null;
};

export function createBlogGenerationSnapshot(preset: BlogPreset, task: BlogPromptTask,
  product: BlogPromptProduct & { id: string | number }, provider: AIProvider, requestedModel: string): BlogGenerationSnapshot {
  const { name, description, system_prompt, strategy_prompt, style_prompt, article_prompt,
    target_chars, min_chars, max_chars, section_count, keyword_min, keyword_max } = preset;
  return structuredClone({ version: 1, preset: { id: preset.id, name, description, system_prompt, strategy_prompt,
    style_prompt, article_prompt, target_chars, min_chars, max_chars, section_count, keyword_min, keyword_max },
    task: { keyword: task.keyword, topic: task.topic, instructions: task.instructions },
    product: { id: product.id, name: product.name, brand: product.brand, usp: product.usp,
      target_customer: product.target_customer, customer_problem: product.customer_problem, notes: product.notes },
    provider, requestedModel, responseModel: null });
}

export function readBlogGenerationSnapshot(value: unknown): BlogGenerationSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as BlogGenerationSnapshot;
  if (item.version !== 1 || !item.preset || typeof item.preset.id !== "string" ||
    !["openai", "anthropic", "xai"].includes(item.provider) || typeof item.requestedModel !== "string" ||
    (item.responseModel !== null && typeof item.responseModel !== "string") || !item.task || !item.product) return null;
  try { parseBlogPreset(item.preset); } catch { return null; }
  return item;
}
