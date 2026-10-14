import { supabase } from "@/lib/supabase";
import { parseBlogGenerationSettings, readStoredBlogGenerationSettings, BlogGenerationSettingsError } from "@/lib/blog-generation/settings";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return Response.json({ error: "잘못된 작업 ID입니다." }, { status: 400 });
  const { data, error } = await supabase.from("blog_tasks").select("id,generation_settings").eq("id", id).maybeSingle();
  if (error) return Response.json({ error: "콘텐츠 설정을 조회하지 못했습니다. DB migration 적용 여부를 확인해 주세요." }, { status: 500 });
  if (!data) return Response.json({ error: "작업이 없습니다." }, { status: 404 });
  return Response.json(readStoredBlogGenerationSettings(data.generation_settings), { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return Response.json({ error: "잘못된 작업 ID입니다." }, { status: 400 });
  let value: unknown;
  try { value = await request.json(); }
  catch { return Response.json({ error: "JSON 요청을 확인해 주세요." }, { status: 400 }); }
  if (!value || typeof value !== "object" || !("settings" in value)) return Response.json({ error: "settings가 필요합니다." }, { status: 400 });
  try {
    const settings = parseBlogGenerationSettings(value.settings);
    const { data, error } = await supabase.from("blog_tasks").update({ generation_settings: settings }).eq("id", id).select("id").maybeSingle();
    if (error) return Response.json({ error: "콘텐츠 설정을 저장하지 못했습니다. DB migration 적용 여부를 확인해 주세요." }, { status: 500 });
    if (!data) return Response.json({ error: "작업이 없습니다." }, { status: 404 });
    return Response.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BlogGenerationSettingsError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "콘텐츠 설정 저장 중 오류가 발생했습니다." }, { status: 500 });
  }
}
