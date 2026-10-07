// Server-side calls only. UI uses import type for AIProvider.
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
export type AIProvider = "openai" | "anthropic" | "xai";
const KEY_NAMES: Record<AIProvider, string> = {
  openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", xai: "XAI_API_KEY",
};
export function isAIProvider(value: unknown): value is AIProvider {
  return value === "openai" || value === "anthropic" || value === "xai";
}
export function missingProviderKey(provider: AIProvider) {
  const name = KEY_NAMES[provider];
  return process.env[name]?.trim() ? null : name;
}
export class ProviderOutputError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "ProviderOutputError";
  }
}
export type GenerateInput = {
  provider: AIProvider; model: string; schema: Record<string, unknown>; schemaName: string;
  systemInstructions: string; input: string; maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high";
};
type GenerateResult = { outputText: string; provider: AIProvider; model: string };

function logXaiError(error: unknown, model: string, apiKey: string, systemInstructions: string, input: string) {
  const privateStrings = [apiKey, systemInstructions, input];
  // Redact any input fields echoed by a provider; never log the SDK error object.
  function collect(value: unknown) {
    if (typeof value === "string" && value) privateStrings.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  }
  try { collect(JSON.parse(input)); } catch { /* Raw input is already covered. */ }
  function safe(value: unknown) {
    if (typeof value !== "string") return null;
    let text = value;
    for (const secret of privateStrings.sort((a, b) => b.length - a.length)) {
      text = text.split(secret).join("[redacted]");
      text = text.split(JSON.stringify(secret).slice(1, -1)).join("[redacted]");
    }
    return text.replace(/Bearer\s+\S+/gi, "[redacted]").slice(0, 1500);
  }
  const apiError = error instanceof OpenAI.APIError ? error : null;
  console.error("xAI error", {
    provider: "xai", model, name: error instanceof Error ? error.name : "UnknownError",
    status: apiError?.status ?? null, code: safe(apiError?.code), type: safe(apiError?.type),
    message: safe(error instanceof Error ? error.message : "Unknown error"),
    requestId: safe(apiError?.requestID),
  });
}

export async function generateStructuredWithProvider({
  provider, model, schema, schemaName, systemInstructions, input, maxOutputTokens, reasoningEffort,
}: GenerateInput): Promise<GenerateResult> {
  const missing = missingProviderKey(provider);
  if (missing) throw new ProviderOutputError(`missing_key:${missing}`);
  const apiKey = process.env[KEY_NAMES[provider]]!;
  if (provider === "anthropic") {
    const response = await new Anthropic({ apiKey }).messages.create({
      model, max_tokens: maxOutputTokens ?? 4096, system: systemInstructions,
      messages: [{ role: "user", content: input }],
      // Official helper adapts unsupported schema constraints; route validation
      // still enforces the original schema limits for every provider.
      output_config: { format: jsonSchemaOutputFormat(schema as Parameters<typeof jsonSchemaOutputFormat>[0]) },
    });
    if (response.stop_reason === "refusal") throw new ProviderOutputError("refusal");
    if (response.stop_reason !== "end_turn") throw new ProviderOutputError(`incomplete:${response.stop_reason}`);
    const outputText = response.content.filter((block) => block.type === "text").map((block) => block.text).join("").trim();
    if (!outputText) throw new ProviderOutputError("missing_text_block");
    return { outputText, provider, model: response.model };
  }
  const client = new OpenAI({ apiKey, ...(provider === "xai" ? { baseURL: "https://api.x.ai/v1" } : {}) });
  if (provider === "xai") {
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemInstructions },
          { role: "user", content: input },
        ],
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        ...(maxOutputTokens !== undefined ? { max_completion_tokens: maxOutputTokens } : {}),
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, schema, strict: true },
        },
      });
      const choice = completion.choices[0];
      if (choice?.message.refusal) throw new ProviderOutputError("refusal");
      if (choice && choice.finish_reason !== "stop") throw new ProviderOutputError(`incomplete:${choice.finish_reason}`);
      const outputText = choice?.message.content?.trim();
      if (!outputText) throw new ProviderOutputError("missing_message_content");
      return { outputText, provider, model: completion.model };
    } catch (error) {
      logXaiError(error, model, apiKey, systemInstructions, input);
      throw error;
    }
  }
  const response = await client.responses.create({
    model, instructions: systemInstructions, input,
    ...(maxOutputTokens !== undefined ? { max_output_tokens: maxOutputTokens } : {}),
    text: { format: { type: "json_schema", name: schemaName, strict: true, schema } },
    store: false,
  });
  const refused = response.output.some((item) => item.type === "message" && item.content.some((content) => content.type === "refusal"));
  if (refused) throw new ProviderOutputError("refusal");
  if (response.status !== "completed") throw new ProviderOutputError(`incomplete:${response.incomplete_details?.reason ?? response.status}`);
  const outputText = response.output_text?.trim();
  if (!outputText) throw new ProviderOutputError("missing_output_text");
  return { outputText, provider, model: response.model };
}
