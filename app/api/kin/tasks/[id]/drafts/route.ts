import { supabase } from "@/lib/supabase";
import { UUID_PATTERN } from "@/lib/kin/presets";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "유효한 작업 ID가 필요합니다." }, { status: 400 });
  const { data: task, error: taskError } = await supabase.from("kin_tasks").select("id, question").eq("id", id).maybeSingle();
  if (taskError) return Response.json({ error: "작업 조회 실패" }, { status: 500 });
  if (!task) return Response.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  const { data: drafts, error } = await supabase.from("kin_drafts")
    .select("id, answer, question_intent, provider, model, created_at").eq("kin_task_id", id)
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (error) return Response.json({ error: "답변 이력을 조회하지 못했습니다." }, { status: 500 });
  return Response.json({ task, drafts: drafts ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
