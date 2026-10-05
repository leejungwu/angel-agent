import { supabase } from "@/lib/supabase";

function logFailure(stage: string, draftId: number, error: unknown) {
  console.error("Blog publishing result failed", {
    stage,
    draftId,
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

  const data = typeof body === "object" && body !== null
    ? body as Record<string, unknown> : null;
  const draftId = data?.draftId;
  if (typeof draftId !== "number" || !Number.isFinite(draftId)) {
    return Response.json({ error: "draftId는 유효한 숫자여야 합니다." }, { status: 400 });
  }
  const result = data?.result;
  if (result !== "published" && result !== "failed") {
    return Response.json({ error: "result는 published 또는 failed여야 합니다." }, { status: 400 });
  }

  const publishedUrl = typeof data?.publishedUrl === "string" ? data.publishedUrl.trim() : "";
  if (result === "published" && !publishedUrl) {
    return Response.json({ error: "publishedUrl이 필요합니다." }, { status: 400 });
  }
  const failureMessage = typeof data?.error === "string" && data.error.trim()
    ? data.error.trim() : "블로그 발행에 실패했습니다.";

  let stage = "draft lookup";
  try {
    const { data: draft, error } = await supabase
      .from("blog_drafts")
      .select("id, publishing_status")
      .eq("id", draftId)
      .maybeSingle();

    if (error) {
      logFailure(stage, draftId, error);
      return Response.json({ error: "초안을 조회하지 못했습니다." }, { status: 500 });
    }
    if (!draft) {
      return Response.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });
    }
    if (draft.publishing_status !== "publishing") {
      return Response.json({ error: "발행 중인 초안만 결과를 처리할 수 있습니다." }, { status: 409 });
    }

    stage = "publishing result update";
    const changes = result === "published"
      ? {
          publishing_status: result,
          published_url: publishedUrl,
          published_at: new Date().toISOString(),
          publishing_error: null,
        }
      : {
          publishing_status: result,
          publishing_error: failureMessage,
          published_url: null,
          published_at: null,
        };

    const { data: updatedDraft, error: updateError } = await supabase
      .from("blog_drafts")
      .update(changes)
      .eq("id", draft.id)
      .eq("publishing_status", "publishing")
      .select("id, publishing_status, published_url")
      .maybeSingle();

    if (updateError) {
      logFailure(stage, draftId, updateError);
      return Response.json({ error: "발행 결과를 저장하지 못했습니다." }, { status: 500 });
    }
    if (!updatedDraft) {
      return Response.json({ error: "초안 상태가 변경되어 결과를 처리할 수 없습니다." }, { status: 409 });
    }

    return Response.json({
      ok: true,
      draftId: updatedDraft.id,
      publishingStatus: updatedDraft.publishing_status,
      ...(result === "published" ? { publishedUrl: updatedDraft.published_url } : {}),
    });
  } catch (error) {
    logFailure(stage, draftId, error);
    return Response.json({ error: "발행 결과 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
