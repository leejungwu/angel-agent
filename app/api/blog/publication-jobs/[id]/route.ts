import { supabase } from "@/lib/supabase";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return Response.json({ error: "Job ID가 올바르지 않습니다." }, { status: 400 });
  }
  // Keep the status predicate on DELETE itself, including when service credentials are used later.
  const { data, error } = await supabase.from("blog_publication_jobs")
    .delete().eq("id", id).eq("status", "queued").select("id").maybeSingle();
  if (error) return Response.json({ error: "대기열에서 제거하지 못했습니다." }, { status: 500 });
  if (!data) return Response.json({ error: "발행 대기 상태의 Job만 제거할 수 있습니다. 이미 제거됐거나 상태가 변경됐습니다." }, { status: 409 });
  return Response.json({ ok: true });
}
