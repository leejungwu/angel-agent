import { authorizeExtension } from "@/lib/blog-publishing/extension-api";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const denied = authorizeExtension(request);
  if (denied) return denied;
  const { data, error } = await supabase.from("blog_drafts").select("id,blog_task_id,title,status,created_at")
    .eq("status", "approved")
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (error) return Response.json({ error: "Blog Task 목록을 조회하지 못했습니다." }, { status: 500 });
  const seen = new Set<string>();
  const tasks = (data ?? []).filter((draft) => {
    const id = String(draft.blog_task_id);
    if (seen.has(id)) return false;
    seen.add(id); return true;
  }).map((draft) => ({ id: draft.blog_task_id, draftId: draft.id, title: draft.title, status: draft.status }));
  return Response.json({ tasks }, { headers: { "Cache-Control": "no-store" } });
}
