import { supabase } from "@/lib/supabase";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0) {
    return Response.json({ error: "작업 ID가 올바르지 않습니다." }, { status: 400 });
  }

  try {
    // Check every linked draft, including older drafts, before relying on DB cascade.
    const { data: protectedDrafts, error: lookupError } = await supabase
      .from("blog_drafts")
      .select("id")
      .eq("blog_task_id", id)
      .in("publishing_status", ["publishing", "published"])
      .limit(1);

    if (lookupError) {
      console.error("Blog task deletion lookup failed", { taskId: id, code: lookupError.code });
      return Response.json({ error: "연결된 초안 상태를 확인하지 못했습니다." }, { status: 500 });
    }
    if (protectedDrafts?.length) {
      return Response.json(
        { error: "발행 중이거나 이미 발행된 초안이 있어 삭제할 수 없습니다." },
        { status: 409 },
      );
    }

    // Prevent metadata cascade from orphaning task-specific Storage objects.
    const { data: taskAssets, error: assetError } = await supabase.from("blog_task_assets")
      .select("id").eq("blog_task_id", id).limit(1);
    if (assetError) {
      console.error("Blog task assets lookup failed", { taskId: id, code: assetError.code });
      return Response.json({ error: "블로그 사진을 확인하지 못했습니다." }, { status: 500 });
    }
    if (taskAssets?.length) {
      return Response.json({ error: "작업을 삭제하려면 블로그 사진을 먼저 전체 삭제해 주세요." }, { status: 409 });
    }

    const { data: deletedTask, error } = await supabase
      .from("blog_tasks")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
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
