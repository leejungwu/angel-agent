import OpenAI from "openai";
import { supabase } from "@/lib/supabase";
import { analyzeVoc, VocAnalysisError, VOC_MODEL, VOC_SCHEMA_VERSION, type VocReview } from "@/lib/voc/analyze";

export const runtime = "nodejs";

// Same-process race protection, retained across dev reloads. The DB check below
// also rejects persisted processing runs; no database constraint is changed.
const vocGlobal = globalThis as typeof globalThis & { vocActiveProducts?: Set<number> };
const activeProducts = vocGlobal.vocActiveProducts ??= new Set<number>();

function logFailure(stage: string, runId: string | undefined, error: unknown) {
  const cause = error instanceof VocAnalysisError ? error.cause : error;
  console.error("VOC analysis failed", {
    stage, runId,
    chunkIndex: error instanceof VocAnalysisError ? error.chunkIndex : undefined,
    level: error instanceof VocAnalysisError ? error.level : undefined,
    type: cause instanceof Error ? cause.name : "DatabaseError",
    code: typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined,
    status: cause instanceof OpenAI.APIError ? cause.status : undefined,
    requestId: cause instanceof OpenAI.APIError ? cause.requestID : undefined,
  });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const productId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(productId) || productId <= 0) {
    return Response.json({ error: "유효한 상품 ID가 필요합니다." }, { status: 400 });
  }
  if (activeProducts.has(productId)) {
    return Response.json({ error: "이 상품의 VOC 분석이 이미 진행 중입니다." }, { status: 409 });
  }
  activeProducts.add(productId);
  let stage = "product_lookup";
  let runId: string | undefined;
  try {
    const { data: product, error: productError } = await supabase.from("products")
      .select("id").eq("id", productId).maybeSingle();
    if (productError) throw productError;
    if (!product) return Response.json({ error: "상품을 찾을 수 없습니다." }, { status: 404 });

    stage = "processing_lookup";
    const { data: processingRun, error: processingError } = await supabase.from("voc_analysis_runs")
      .select("id").eq("product_id", productId).eq("status", "processing").limit(1).maybeSingle();
    if (processingError) throw processingError;
    if (processingRun) return Response.json({ error: "이 상품의 VOC 분석이 이미 진행 중입니다." }, { status: 409 });

    stage = "reviews_lookup";
    const reviews: VocReview[] = [];
    const snapshotTime = new Date().toISOString();
    let cursor: string | undefined;
    // Keyset pagination handles Supabase row caps without limiting analysis to
    // the first page. The time boundary excludes new imports during this run.
    while (true) {
      let query = supabase.from("reviews").select("id, rating, title, content")
        .eq("product_id", productId).lte("created_at", snapshotTime)
        .order("id", { ascending: true }).limit(1_000);
      if (cursor) query = query.gt("id", cursor);
      const { data: page, error } = await query.returns<VocReview[]>();
      if (error) throw error;
      if (!page?.length) break;
      reviews.push(...page);
      cursor = page[page.length - 1].id;
    }
    if (!reviews.length) return Response.json({ error: "분석할 리뷰가 없습니다." }, { status: 400 });
    if (!process.env.OPENAI_API_KEY?.trim()) {
      return Response.json({ error: "OPENAI_API_KEY 환경변수가 설정되지 않았습니다." }, { status: 500 });
    }

    stage = "run_creation";
    const { data: run, error: runError } = await supabase.from("voc_analysis_runs")
      .insert({ product_id: productId, status: "processing", review_count: reviews.length,
        model: VOC_MODEL, schema_version: VOC_SCHEMA_VERSION })
      .select("id").single();
    if (runError || !run) throw runError ?? new Error("Run creation returned no row");
    runId = run.id;

    stage = "chunk_analysis";
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const { result, model } = await analyzeVoc(client, reviews);

    stage = "result_storage";
    const { data: saved, error: saveError } = await supabase.from("voc_analysis_runs")
      .update({ status: "completed", review_count: reviews.length, model,
        schema_version: VOC_SCHEMA_VERSION, result, error_message: null, updated_at: new Date().toISOString() })
      .eq("id", runId).eq("status", "processing").select("id").maybeSingle();
    if (saveError || !saved) throw saveError ?? new Error("Run state changed before saving");
    return Response.json({ ok: true, runId: saved.id, reviewCount: reviews.length, model,
      schemaVersion: VOC_SCHEMA_VERSION, result });
  } catch (error) {
    const failureStage = error instanceof VocAnalysisError ? error.stage : stage;
    logFailure(failureStage, runId, error);
    const messages: Record<string, string> = {
      product_lookup: "상품 조회에 실패했습니다.", reviews_lookup: "리뷰 조회에 실패했습니다.",
      processing_lookup: "VOC 분석 진행 상태를 확인하지 못했습니다.",
      run_creation: "VOC 분석 실행을 저장하지 못했습니다.", chunk_analysis: "리뷰 chunk 분석에 실패했습니다.",
      final_synthesis: "최종 VOC 통합 분석에 실패했습니다.", result_storage: "VOC 분석 결과를 저장하지 못했습니다.",
    };
    const message = messages[failureStage] ?? "VOC 분석 처리 중 오류가 발생했습니다.";
    if (runId) {
      try {
        const { data, error: updateError } = await supabase.from("voc_analysis_runs")
          .update({ status: "failed", error_message: `${failureStage}: ${message}`,
            updated_at: new Date().toISOString() })
          .eq("id", runId).eq("status", "processing").select("id").maybeSingle();
        if (updateError || !data) logFailure("failure_storage", runId, updateError ?? new Error("Run state changed"));
      } catch (updateError) { logFailure("failure_storage", runId, updateError); }
    }
    return Response.json({ error: message, ...(runId ? { runId } : {}) }, { status: 500 });
  } finally {
    activeProducts.delete(productId);
  }
}
