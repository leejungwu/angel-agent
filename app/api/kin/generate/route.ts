import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { generateKinWithProvider, isKinProvider, KinProviderOutputError, missingKinProviderKey, type KinProvider } from "@/lib/kin/provider";
import { supabase } from "@/lib/supabase";
import {
  compactVoc,
  isKinAnswer,
  kinAnswerValidationErrors,
  KIN_COMMON_STYLE_INSTRUCTIONS,
  KIN_INSTRUCTIONS,
} from "@/lib/kin/generate";
import { CONFIG_FIELDS, parsePresetConfig, structuredStyleInstructions, UUID_PATTERN, type PresetConfig } from "@/lib/kin/presets";
import { checkKinAnswer } from "@/lib/kin/quality-check";

type TaskInput = {
  product_id: number | null;
  question: string;
  question_url: string | null;
  category: string | null;
  purpose: "helpful" | "product_relevant";
  product_mention_level: "none" | "relevant" | "direct";
  instructions: string | null;
  preset_id: string | null;
  preset_name_snapshot: string | null;
  preset_instructions_snapshot: string | null;
  preset_config_snapshot: PresetConfig | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionalText(value: unknown, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > max) throw new Error("InvalidInput");
  return value.trim() || null;
}

function parseInput(body: Record<string, unknown>): TaskInput {
  const question = optionalText(body.question, 10000);
  const productId = body.productId ?? null;
  const purpose = body.purpose ?? "helpful";
  const level = body.productMentionLevel ?? "relevant";
  const presetId = body.presetId ?? null;
  if (presetId !== null && (typeof presetId !== "string" || !UUID_PATTERN.test(presetId))) throw new Error("InvalidInput");
  if (!question || (productId !== null && (typeof productId !== "number" || !Number.isSafeInteger(productId) || productId <= 0)) ||
      (purpose !== "helpful" && purpose !== "product_relevant") ||
      (level !== "none" && level !== "relevant" && level !== "direct")) throw new Error("InvalidInput");
  const questionUrl = optionalText(body.questionUrl, 2000);
  if (questionUrl && !["http:", "https:"].includes(new URL(questionUrl).protocol)) throw new Error("InvalidInput");
  return { product_id: productId as number | null, question, question_url: questionUrl,
    category: optionalText(body.category, 200), purpose, product_mention_level: level,
    instructions: optionalText(body.instructions, 3000), preset_id: presetId as string | null,
    preset_name_snapshot: null, preset_instructions_snapshot: null, preset_config_snapshot: null };
}

function logFailure(stage: string, error: unknown) {
  console.error("Kin generation failed", error instanceof OpenAI.APIError || error instanceof Anthropic.APIError
    ? { stage, status: error.status, requestId: error.requestID }
    : { stage, type: error instanceof Error ? error.name : "DatabaseError",
      code: error && typeof error === "object" && "code" in error ? error.code : undefined });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  let input: TaskInput | undefined;
  let provider: KinProvider = "openai";
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("InvalidInput");
    body = value as Record<string, unknown>;
    if (body.provider !== undefined) {
      if (!isKinProvider(body.provider)) return Response.json({ error: "provider는 openai, anthropic, xai 중 하나여야 합니다." }, { status: 400 });
      provider = body.provider;
    }
    if (body.taskId !== undefined) {
      if (typeof body.taskId !== "string" || !UUID.test(body.taskId)) throw new Error("InvalidInput");
    } else input = parseInput(body);
  } catch {
    return Response.json({ error: "질문과 입력값을 확인해 주세요. 질문은 필수이며 상품 ID와 선택 옵션이 유효해야 합니다." }, { status: 400 });
  }
  const missingKey = missingKinProviderKey(provider);
  if (missingKey) {
    return Response.json({ error: `${missingKey} 환경변수가 설정되지 않았습니다.` }, { status: 500 });
  }

  let taskId: string | undefined;
  let stage = "task lookup";
  let draftSaved = false;
  try {
    if (body.taskId) {
      const { data, error } = await supabase.from("kin_tasks")
        .select("id, product_id, question, question_url, category, purpose, product_mention_level, instructions, preset_id, preset_name_snapshot, preset_instructions_snapshot, preset_config_snapshot")
        .eq("id", body.taskId).maybeSingle();
      if (error) throw error;
      if (!data) return Response.json({ error: "지식인 작업을 찾을 수 없습니다." }, { status: 404 });
      taskId = data.id;
      input = data as TaskInput;
    }
    if (!input) throw new Error("MissingTaskInput");
    // Regeneration uses the original snapshot, even after preset edits/deletion.
    if (!taskId && input.preset_id) {
      stage = "preset lookup";
      const { data: preset, error: presetError } = await supabase.from("kin_prompt_presets")
        .select(`name, instructions, default_product_mention_level, ${CONFIG_FIELDS}`).eq("id", input.preset_id).maybeSingle();
      if (presetError) throw presetError;
      if (!preset) return Response.json({ error: "선택한 프리셋이 존재하지 않습니다." }, { status: 400 });
      input.preset_name_snapshot = preset.name;
      input.preset_instructions_snapshot = preset.instructions;
      input.preset_config_snapshot = parsePresetConfig(preset);
      if (body.productMentionLevel == null) {
        input.product_mention_level = preset.default_product_mention_level ?? "relevant";
      }
    }
    stage = "product and VOC lookup";
    let product = null;
    let voc = null;
    if (input.product_id !== null) {
      const { data, error } = await supabase.from("products")
        .select("name, brand, usp, target_customer, customer_problem, notes")
        .eq("id", input.product_id).maybeSingle();
      if (error) throw error;
      if (!data) {
        if (taskId) throw new Error("ProductMissingForExistingTask");
        return Response.json({ error: "상품을 찾을 수 없습니다." }, { status: 404 });
      }
      product = data;
      const { data: run, error: runError } = await supabase.from("voc_analysis_runs")
        .select("result").eq("product_id", input.product_id).eq("status", "completed")
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
      if (runError) throw runError;
      voc = compactVoc(run?.result);
    }
    stage = "task insert";
    if (!taskId) {
      const { data, error } = await supabase.from("kin_tasks").insert(input).select("id").single();
      if (error || !data) throw error ?? new Error("TaskInsertFailed");
      taskId = data.id;
    }
    stage = `${provider} generation`;
    const response = await generateKinWithProvider({
      provider,
      systemInstructions: `${KIN_INSTRUCTIONS}\n\n${KIN_COMMON_STYLE_INSTRUCTIONS}`,
      input: JSON.stringify({
        presetInstructions: input.preset_instructions_snapshot,
        structuredStyleInstructions: structuredStyleInstructions(input.preset_config_snapshot),
        product, voc,
        additionalInstructions: input.instructions,
        task: { purpose: input.purpose, product_mention_level: input.product_mention_level,
          question_url: input.question_url, category: input.category },
        question: input.question,
      }),
    });
    stage = "output validation";
    // Temporary diagnostics: shape and lengths only, never answer/question text.
    console.info("Kin output response", {
      provider, outputTextPresent: Boolean(response.outputText),
    });
    let draft: unknown;
    try { draft = JSON.parse(response.outputText); }
    catch { stage = "output validation: invalid JSON"; throw new Error("InvalidOutputJSON"); }
    const parsed = draft !== null && typeof draft === "object" && !Array.isArray(draft)
      ? draft as Record<string, unknown> : null;
    const validationErrors = kinAnswerValidationErrors(draft);
    console.info("Kin output validation", {
      outputTextPresent: Boolean(response.outputText), keys: parsed ? Object.keys(parsed) : [],
      answerType: typeof parsed?.answer,
      answerLength: typeof parsed?.answer === "string" ? [...parsed.answer].length : null,
      questionIntentType: typeof parsed?.questionIntent,
      questionIntentLength: typeof parsed?.questionIntent === "string" ? [...parsed.questionIntent].length : null,
      productMentionedType: typeof parsed?.productMentioned,
      productMentioned: typeof parsed?.productMentioned === "boolean" ? parsed.productMentioned : null,
      validationErrors,
    });
    if (!isKinAnswer(draft)) {
      stage = `output validation: schema (${validationErrors.join(", ")})`;
      throw new Error("InvalidAnswerOutput");
    }
    // A separate policy check, not a Structured Output shape mismatch.
    if ((!product || input.product_mention_level === "none") && draft.productMentioned) {
      stage = "output validation: product mention policy";
      throw new Error("UnexpectedProductMention");
    }
    stage = "quality check";
    const qualityCheck = checkKinAnswer({ answer: draft.answer, question: input.question,
      instructions: input.instructions, productName: product?.name ?? null,
      mentionLevel: input.product_mention_level, config: input.preset_config_snapshot });
    stage = "draft insert";
    const { data: saved, error: saveError } = await supabase.from("kin_drafts").insert({
      kin_task_id: taskId, product_id: input.product_id, answer: draft.answer,
      model: response.model, status: "draft",
    }).select("id").single();
    if (saveError || !saved) throw saveError ?? new Error("DraftInsertFailed");
    draftSaved = true;
    stage = "task update";
    const { data: updated, error: updateError } = await supabase.from("kin_tasks")
      .update({ status: "generated", updated_at: new Date().toISOString() }).eq("id", taskId).select("id").maybeSingle();
    if (updateError || !updated) throw updateError ?? new Error("TaskUpdateFailed");
    return Response.json({ ok: true, taskId, draftId: saved.id, draft, model: response.model, qualityCheck });
  } catch (error) {
    if (error instanceof KinProviderOutputError) stage = `${provider} output validation: ${error.reason}`;
    logFailure(stage, error);
    if (taskId) {
      try {
        const { error: failureError } = await supabase.from("kin_tasks")
          .update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", taskId);
        if (failureError) logFailure("failed status update", failureError);
      } catch (failureError) { logFailure("failed status update", failureError); }
    }
    return Response.json({ error: draftSaved
      ? "답변은 저장되었지만 작업 상태를 변경하지 못했습니다."
      : "지식인 답변 생성 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
