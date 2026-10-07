import { supabase } from "@/lib/supabase";

const REMOVABLE_STATUSES = ["queued", "failed", "ready_for_review"];

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "유효한 JSON 요청 본문이 필요합니다." }, { status: 400 });
  }
  const draftId = typeof body === "object" && body !== null && "draftId" in body ? body.draftId : undefined;
  if (typeof draftId !== "number" || !Number.isSafeInteger(draftId) || draftId <= 0) {
    return Response.json({ error: "draftId는 유효한 양의 정수여야 합니다." }, { status: 400 });
  }

  try {
    const { data: draft, error } = await supabase.from("blog_drafts")
      .select("id, status, publishing_status").eq("id", draftId).maybeSingle();
    if (error) {
      console.error("Publishing queue removal lookup failed", { draftId, code: error.code });
      return Response.json({ error: "초안 상태를 조회하지 못했습니다." }, { status: 500 });
    }
    if (!draft) return Response.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });
    if (draft.status !== "approved" || !REMOVABLE_STATUSES.includes(draft.publishing_status)) {
      return Response.json({ error: "발행 대기·실패·검수 대기 상태의 승인 초안만 대기 해제할 수 있습니다. 발행 중이거나 발행된 초안은 해제할 수 없습니다." }, { status: 409 });
    }

    // Compare-and-set: a concurrent publish claim must prevent queue removal.
    // Draft content/status and publication metadata are deliberately untouched.
    const { data: updated, error: updateError } = await supabase.from("blog_drafts")
      .update({ publishing_status: null, publishing_error: null })
      .eq("id", draft.id).eq("status", "approved")
      .eq("publishing_status", draft.publishing_status)
      .select("id").maybeSingle();
    if (updateError) {
      console.error("Publishing queue removal update failed", { draftId, code: updateError.code });
      return Response.json({ error: "발행 대기를 해제하지 못했습니다." }, { status: 500 });
    }
    if (!updated) return Response.json({ error: "초안 상태가 변경되었습니다. 최신 상태를 확인해주세요." }, { status: 409 });
    return Response.json({ ok: true, draftId: updated.id, publishingStatus: null });
  } catch (error) {
    console.error("Publishing queue removal failed", { draftId, type: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "발행 대기 해제 중 오류가 발생했습니다." }, { status: 500 });
  }
}
