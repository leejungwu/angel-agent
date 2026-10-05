import { supabase } from "@/lib/supabase";

function logFailure(stage: string, error: unknown) {
  console.error("Blog publishing failed", {
    stage,
    type: error instanceof Error ? error.name : "DatabaseError",
    code: typeof error === "object" && error !== null && "code" in error
      ? error.code : undefined,
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "유효한 JSON 요청 본문이 필요합니다." }, { status: 400 });
  }

  const draftId = typeof body === "object" && body !== null && "draftId" in body
    ? body.draftId : undefined;
  if (typeof draftId !== "number" || !Number.isFinite(draftId)) {
    return Response.json({ error: "draftId는 유효한 숫자여야 합니다." }, { status: 400 });
  }

  let stage = "draft lookup";
  try {
    const { data: draft, error } = await supabase
      .from("blog_drafts")
      .select("id, blog_task_id, product_id, title, intro, sections, closing, status, publishing_status, published_url, published_at, publishing_error")
      .eq("id", draftId)
      .maybeSingle();

    if (error) {
      logFailure(stage, error);
      return Response.json({ error: "초안을 조회하지 못했습니다." }, { status: 500 });
    }
    if (!draft) {
      return Response.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });
    }
    if (draft.status !== "approved") {
      return Response.json({ error: "승인된 초안만 발행할 수 있습니다." }, { status: 409 });
    }
    if (draft.publishing_status !== "queued") {
      return Response.json({ error: "발행 대기 등록된 초안만 처리할 수 있습니다." }, { status: 409 });
    }

    stage = "publishing status update";
    const { data: updatedDraft, error: updateError } = await supabase
      .from("blog_drafts")
      .update({
        publishing_status: "publishing",
        publishing_error: null,
        published_url: null,
        published_at: null,
      })
      .eq("id", draft.id)
      .eq("status", "approved")
      .eq("publishing_status", "queued")
      .select("id, publishing_status")
      .maybeSingle();

    if (updateError) {
      logFailure(stage, updateError);
      return Response.json({ error: "발행 상태를 변경하지 못했습니다." }, { status: 500 });
    }
    if (!updatedDraft) {
      return Response.json({ error: "초안 상태가 변경되어 발행 처리를 시작할 수 없습니다." }, { status: 409 });
    }

    // TODO: Connect the actual publishing process here, after claiming the queued draft.
    // Pass draft content to the publisher and handle published/failed results separately.
    return Response.json({
      ok: true,
      draftId: updatedDraft.id,
      publishingStatus: updatedDraft.publishing_status,
    });
  } catch (error) {
    logFailure(stage, error);
    return Response.json({ error: "발행 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
