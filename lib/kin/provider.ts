import { generateStructuredWithProvider, type AIProvider } from "@/lib/ai/provider";
import { ANSWER_SCHEMA, KIN_MODEL } from "./generate";

// Compatibility wrapper: KIN owns its schema and defaults, not the transport.
export { isAIProvider as isKinProvider, missingProviderKey as missingKinProviderKey,
  ProviderOutputError as KinProviderOutputError } from "@/lib/ai/provider";
export type KinProvider = AIProvider;
export const KIN_PROVIDER_MODELS: Record<KinProvider, string> = {
  openai: KIN_MODEL, anthropic: "claude-sonnet-5-5", xai: "grok-4.7",
};
export function generateKinWithProvider(input: {
  provider: KinProvider; systemInstructions: string; input: string;
}) {
  return generateStructuredWithProvider({ ...input, model: KIN_PROVIDER_MODELS[input.provider],
    schema: ANSWER_SCHEMA, schemaName: "kin_answer",
    ...(input.provider === "anthropic" ? { maxOutputTokens: 4096 } : {}),
    ...(input.provider === "xai" ? { reasoningEffort: "low" as const } : {}),
  });
}
