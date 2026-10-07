import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { generateStructuredWithProvider, isAIProvider, missingProviderKey, ProviderOutputError, type AIProvider } from "@/lib/ai/provider";
import { DRAFT_SCHEMA, isDraft } from "@/lib/blog-generation/schema";
import { buildBlogPrompt } from "@/lib/blog-generation/prompts";
import { supabase } from "@/lib/supabase";

const BLOG_MODELS: Record<AIProvider, string> = {
  openai: "gpt-5-mini", anthropic: "claude-sonnet-5-5", xai: "grok-4.7",
};

function serverError(message: string) {
  return Response.json({ error: message }, { status: 500 });
}

// Log diagnostic identifiers only; SDK error objects can contain sensitive data.
function logFailure(stage: string, error: unknown) {
  if (error instanceof OpenAI.APIError || error instanceof Anthropic.APIError) {
    console.error("Blog generation failed", {
      stage,
      status: error.status,
      code: error instanceof OpenAI.APIError ? error.code : undefined,
      requestId: error.requestID,
    });
  } else {
    console.error("Blog generation failed", {
      stage,
      type: error instanceof Error ? error.name : "DatabaseError",
      code: typeof error === "object" && error !== null && "code" in error
        ? error.code : undefined,
    });
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "유효한 JSON 요청 본문이 필요합니다." },
      { status: 400 },
    );
  }

  const taskId =
    typeof body === "object" && body !== null && "taskId" in body
      ? body.taskId
      : undefined;

  if (typeof taskId !== "number" || !Number.isFinite(taskId)) {
    return Response.json(
      { error: "taskId는 유효한 숫자여야 합니다." },
      { status: 400 },
    );
  }

  const requestedProvider = typeof body === "object" && body !== null && "provider" in body ? body.provider : undefined;
  if (requestedProvider !== undefined && !isAIProvider(requestedProvider)) {
    return Response.json({ error: "provider는 openai, anthropic, xai 중 하나여야 합니다." }, { status: 400 });
  }
  const provider = requestedProvider ?? "openai";
  const missingKey = missingProviderKey(provider);
  if (missingKey) return serverError(`${missingKey} 환경변수가 설정되지 않았습니다.`);

  let stage = "task lookup";
  try {
    const { data: task, error: taskError } = await supabase
      .from("blog_tasks")
      .select("id, product_id, keyword, topic, purpose, instructions")
      .eq("id", taskId)
      .maybeSingle();

    if (taskError) {
      logFailure(stage, taskError);
      return serverError("블로그 작업을 조회하지 못했습니다.");
    }
    if (!task) {
      return Response.json({ error: "블로그 작업을 찾을 수 없습니다." }, { status: 404 });
    }
    if (task.product_id == null) {
      return Response.json({ error: "연결된 상품을 찾을 수 없습니다." }, { status: 404 });
    }

    stage = "product lookup";
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, name, brand, usp, target_customer, customer_problem, notes")
      .eq("id", task.product_id)
      .maybeSingle();

    if (productError) {
      logFailure(stage, productError);
      return serverError("상품 정보를 조회하지 못했습니다.");
    }
    if (!product) {
      return Response.json({ error: "연결된 상품을 찾을 수 없습니다." }, { status: 404 });
    }

    stage = `${provider} generation`;
    const response = await generateStructuredWithProvider({
      provider, model: BLOG_MODELS[provider], schema: DRAFT_SCHEMA, schemaName: "blog_draft",
      ...buildBlogPrompt(product, task),
      ...(provider !== "openai" ? { maxOutputTokens: 12000 } : {}),
      ...(provider === "xai" ? { reasoningEffort: "low" as const } : {}),
    });

    stage = "output validation";
    const draft: unknown = JSON.parse(response.outputText);
    if (!isDraft(draft)) {
      logFailure(stage, new Error("InvalidDraftOutput"));
      return serverError("AI 초안의 형식이 올바르지 않습니다.");
    }

    stage = "draft insert";
    const { data: savedDraft, error: draftError } = await supabase
      .from("blog_drafts")
      .insert({
        blog_task_id: task.id,
        product_id: product.id,
        title: draft.title,
        intro: draft.intro,
        sections: draft.sections,
        closing: draft.closing,
        status: "draft",
        model: response.model,
      })
      .select("id")
      .single();

    if (draftError || !savedDraft) {
      logFailure(stage, draftError);
      return serverError("블로그 초안을 저장하지 못했습니다.");
    }

    stage = "task status update";
    const { data: updatedTask, error: updateError } = await supabase
      .from("blog_tasks")
      .update({ status: "generated" })
      .eq("id", task.id)
      .select("id")
      .maybeSingle();

    if (updateError || !updatedTask) {
      logFailure(stage, updateError);
      return serverError("초안은 저장되었지만 작업 상태를 변경하지 못했습니다.");
    }

    return Response.json({ ok: true, taskId, draftId: savedDraft.id, draft, provider: response.provider, model: response.model });
  } catch (error) {
    if (error instanceof ProviderOutputError) stage = `${provider} output validation: ${error.reason}`;
    logFailure(stage, error);
    return serverError("블로그 초안 생성 처리 중 오류가 발생했습니다.");
  }
}
