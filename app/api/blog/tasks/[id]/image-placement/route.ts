import { supabase } from "@/lib/supabase";
import { parseBlogImagePlacementSettings } from "@/lib/blog-publishing/image-placement-settings";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return Response.json({ error: "작업 ID가 올바르지 않습니다." }, { status: 400 });
  let settings;
  try { settings = parseBlogImagePlacementSettings(await request.json()); }
  catch { return Response.json({ error: "사진 배치 설정의 체크박스 값을 확인해 주세요." }, { status: 400 }); }
  const { data, error } = await supabase.from("blog_tasks").update({ image_placement_settings: settings }).eq("id", id).select("id").maybeSingle();
  if (error) return Response.json({ error: "사진 배치 설정을 저장하지 못했습니다. DB migration 적용 상태를 확인해 주세요." }, { status: 500 });
  if (!data) return Response.json({ error: "블로그 작업이 없습니다." }, { status: 404 });
  return Response.json({ settings });
}
