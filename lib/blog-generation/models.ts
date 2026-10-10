import type { AIProvider } from "../ai/provider";

export const BLOG_MODEL_OPTIONS: Record<AIProvider, { value: string; label: string }[]> = {
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
};

export const BLOG_DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-6.1-sol", anthropic: "claude-sonnet-5-5", xai: "grok-4.7",
};

export function resolveBlogModel(provider: AIProvider, requestedModel: unknown = undefined): string | null {
  if (requestedModel === undefined) return BLOG_DEFAULT_MODELS[provider];
  return typeof requestedModel === "string" && BLOG_MODEL_OPTIONS[provider].some(({ value }) => value === requestedModel)
    ? requestedModel : null;
}
