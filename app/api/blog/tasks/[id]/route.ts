import { supabase } from "@/lib/supabase";
import { removeAllBlogTaskAssets } from "@/lib/blog-task-assets/delete";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
    return Response.json({ error: "작업 ID가 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const { data: jobs, error: jobError } = await supabase.from("blog_publication_jobs")
      .select("id").eq("blog_task_id", id).limit(1);
    if (jobError) return Response.json({ error: "발행 대기열 참조를 확인하지 못했습니다." }, { status: 500 });
    if (jobs?.length) return Response.json({ error: "발행 Job 기록이 있는 작업은 삭제할 수 없습니다. 발행 대기·입력 완료 기록은 Queue에서 삭제할 수 있습니다. 입력 중·발행 완료·입력 실패 기록은 직접 삭제할 수 없으며, 기록이 남아 있는 동안 작업은 보호됩니다." }, { status: 409 });
    // Check every linked draft, including older drafts, before relying on DB cascade.
    const { data: protectedDrafts, error: lookupError } = await supabase
      .from("blog_drafts")
      .select("id")
      .eq("blog_task_id", id)
      .in("publishing_status", ["published"])
      .limit(1);

    if (lookupError) {
      console.error("Blog task deletion lookup failed", { taskId: id, code: lookupError.code });
      return Response.json({ error: "연결된 초안 상태를 확인하지 못했습니다." }, { status: 500 });
    }
    if (protectedDrafts?.length) {
      return Response.json(
        { error: "이미 발행된 초안이 있어 삭제할 수 없습니다." },
        { status: 409 },
      );
    }

    try {
      const result = await removeAllBlogTaskAssets(id);
      if (result.preserved > 0) {
        return Response.json({ error: "발행 Job에서 사용하는 사진이 확인되어 작업 삭제를 중단했습니다. 목록을 새로고침해 주세요." }, { status: 409 });
      }
    } catch (error) {
      return Response.json({ error: `사진 정리에 실패해 작업을 삭제하지 않았습니다. ${error instanceof Error ? error.message : "사진 삭제 실패"}` }, { status: 409 });
    }

    // Prevent metadata cascade from orphaning task-specific Storage objects.
    const { data: taskAssets, error: assetError } = await supabase.from("blog_task_assets")
      .select("id").eq("blog_task_id", id).limit(1);
    if (assetError) {
      console.error("Blog task assets lookup failed", { taskId: id, code: assetError.code });
      return Response.json({ error: "블로그 사진을 확인하지 못했습니다." }, { status: 500 });
    }
    if (taskAssets?.length) {
      return Response.json({ error: "사진 정리 후 남아 있거나 새로 추가된 사진이 있어 작업을 삭제하지 않았습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }

    const { data: deletedTask, error } = await supabase
      .from("blog_tasks")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      if (error.code === "23503") return Response.json({ error: "연결된 발행 작업이나 데이터가 있어 삭제할 수 없습니다." }, { status: 409 });
      console.error("Blog task deletion failed", { taskId: id, code: error.code });
      return Response.json({ error: "블로그 작업을 삭제하지 못했습니다." }, { status: 500 });
    }
    if (!deletedTask) {
      return Response.json({ error: "삭제할 작업이 없거나 삭제 권한이 없습니다." }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Blog task deletion failed", {
      taskId: id,
      type: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "블로그 작업 삭제 중 오류가 발생했습니다." }, { status: 500 });
  }
}
