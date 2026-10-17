import type { BlogPreset } from "./presets";

export type BlogPromptProduct = {
  name: string | null; brand: string | null; usp: string | null;
  target_customer: string | null; customer_problem: string | null; notes: string | null;
};
export type BlogPromptTask = { keyword: string | null; topic: string | null; instructions: string | null };

export function buildBlogPrompt(product: BlogPromptProduct, task: BlogPromptTask, preset: BlogPreset) {
  return {
    systemInstructions: preset.system_prompt,
    input: JSON.stringify({
      preset: {
        strategyPrompt: preset.strategy_prompt, stylePrompt: preset.style_prompt, titlePrompt: preset.title_prompt ?? "", articlePrompt: preset.article_prompt,
        target_chars: preset.target_chars, min_chars: preset.min_chars, max_chars: preset.max_chars,
        section_count: preset.section_count, keyword_min: preset.keyword_min, keyword_max: preset.keyword_max,
      },
      product: { name: product.name, brand: product.brand, usp: product.usp,
        target_customer: product.target_customer, customer_problem: product.customer_problem, notes: product.notes },
      task: { keyword: task.keyword, topic: task.topic, instructions: task.instructions },
    }),
  };
}
