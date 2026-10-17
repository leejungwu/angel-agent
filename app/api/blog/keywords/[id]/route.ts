import { supabase } from "@/lib/supabase";
import { KEYWORD_ID } from "@/lib/blog-keywords/shared";
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!KEYWORD_ID.test(id)) return Response.json({ error: "Keyword ID를 확인하세요." }, { status: 400 });
  let status: unknown;
  try { status = (await request.json()).status; } catch { return Response.json({ error: "상태를 확인하세요." }, { status: 400 }); }
  if (status !== "unused" && status !== "excluded") return Response.json({ error: "미사용/제외 전환만 가능합니다." }, { status: 400 });
  const { data, error } = await supabase.from("blog_keywords").update({ status }).eq("id", id).eq("status", status === "unused" ? "excluded" : "unused").select("id").maybeSingle();
  if (error) return Response.json({ error: "상태 저장에 실패했습니다." }, { status: 500 });
  if (!data) return Response.json({ error: "상태가 변경됐거나 사용된 키워드입니다. 새로고침하세요." }, { status: 409 });
  return Response.json({ ok: true });
}
