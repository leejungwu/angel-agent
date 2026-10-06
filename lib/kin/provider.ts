import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { ANSWER_SCHEMA, KIN_MODEL } from "./generate";

export type KinProvider = "openai" | "anthropic" | "xai";
export const KIN_PROVIDER_MODELS: Record<KinProvider, string> = {
  openai: KIN_MODEL,
  anthropic: "claude-sonnet-5-5",
  xai: "grok-4.7",
};
const KEY_NAMES: Record<KinProvider, string> = {
  openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", xai: "XAI_API_KEY",
};
export function isKinProvider(value: unknown): value is KinProvider {
  return value === "openai" || value === "anthropic" || value === "xai";
}
export function missingKinProviderKey(provider: KinProvider) {
  const name = KEY_NAMES[provider];
  return process.env[name]?.trim() ? null : name;
}
export class KinProviderOutputError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "KinProviderOutputError";
  }
}
type GenerateInput = { provider: KinProvider; systemInstructions: string; input: string };
type GenerateResult = { outputText: string; provider: KinProvider; model: string };

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

export async function generateKinWithProvider({ provider, systemInstructions, input }: GenerateInput): Promise<GenerateResult> {
  const missing = missingKinProviderKey(provider);
  if (missing) throw new KinProviderOutputError(`missing_key:${missing}`);
  const apiKey = process.env[KEY_NAMES[provider]]!;
  const model = KIN_PROVIDER_MODELS[provider];
  if (provider === "anthropic") {
    const response = await new Anthropic({ apiKey }).messages.create({
      model, max_tokens: 4096, system: systemInstructions,
      messages: [{ role: "user", content: input }],
      // Official helper adapts unsupported schema constraints; route validation
      // still enforces the original ANSWER_SCHEMA limits for every provider.
      output_config: { format: jsonSchemaOutputFormat(ANSWER_SCHEMA as Parameters<typeof jsonSchemaOutputFormat>[0]) },
    });
    if (response.stop_reason === "refusal") throw new KinProviderOutputError("refusal");
    if (response.stop_reason !== "end_turn") throw new KinProviderOutputError(`incomplete:${response.stop_reason}`);
    const outputText = response.content.filter((block) => block.type === "text").map((block) => block.text).join("").trim();
    if (!outputText) throw new KinProviderOutputError("missing_text_block");
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
      reasoning_effort: "low",
      response_format: {
        type: "json_schema",
        json_schema: { name: "kin_answer", schema: ANSWER_SCHEMA, strict: true },
      },
    });
    const choice = completion.choices[0];
    if (choice?.message.refusal) throw new KinProviderOutputError("refusal");
    if (choice && choice.finish_reason !== "stop") throw new KinProviderOutputError(`incomplete:${choice.finish_reason}`);
    const outputText = choice?.message.content?.trim();
    if (!outputText) throw new KinProviderOutputError("missing_message_content");
      return { outputText, provider, model: completion.model };
    } catch (error) {
      logXaiError(error, model, apiKey, systemInstructions, input);
      throw error;
    }
  }
  const response = await client.responses.create({
    model, instructions: systemInstructions, input,
    text: { format: { type: "json_schema", name: "kin_answer", strict: true, schema: ANSWER_SCHEMA } },
    store: false,
  });
  const refused = response.output.some((item) => item.type === "message" && item.content.some((content) => content.type === "refusal"));
  if (refused) throw new KinProviderOutputError("refusal");
  if (response.status !== "completed") throw new KinProviderOutputError(`incomplete:${response.incomplete_details?.reason ?? response.status}`);
  const outputText = response.output_text?.trim();
  if (!outputText) throw new KinProviderOutputError("missing_output_text");
  return { outputText, provider, model: response.model };
}
