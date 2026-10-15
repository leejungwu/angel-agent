import { createPublicationJob, isPublicationSourceId, PublicationJobError } from "@/lib/blog-publishing/publication-jobs";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  let input;
  try {
    input = await request.json();
    if (!input || typeof input !== "object" || Array.isArray(input) || !isPublicationSourceId(input.taskId) || !isPublicationSourceId(input.draftId)) throw new Error();
  } catch { return Response.json({ error: "작업과 초안 ID를 확인해 주세요." }, { status: 400 }); }
  try {
    // Registration requires current approval even when an older immutable Job exists.
    const { data: draft, error } = await supabase.from("blog_drafts").select("status")
      .eq("id", input.draftId).eq("blog_task_id", input.taskId).maybeSingle();
    if (error) throw new Error("DraftLookupFailed");
    if (!draft) return Response.json({ error: "해당 작업의 초안이 없습니다." }, { status: 404 });
    if (draft.status !== "approved") return Response.json({ error: "승인된 초안만 등록할 수 있습니다." }, { status: 403 });
    const job = await createPublicationJob({ taskId: input.taskId, draftId: input.draftId, publishMode: input.publishMode, scheduledAt: input.scheduledAt });
    return Response.json({ job: { id: job.id, status: job.status, publishMode: job.publish_mode, scheduledAt: job.scheduled_at }, alreadyExists: job.alreadyExists }, { status: job.alreadyExists ? 200 : 201 });
  } catch (error) {
    if (error instanceof PublicationJobError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "발행 대기열 등록에 실패했습니다. DB migration 적용 상태와 초안·사진을 확인해 주세요." }, { status: 500 });
  }
}
