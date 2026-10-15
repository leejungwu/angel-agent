import { supabase } from "@/lib/supabase";
import { parseBlogPreset, BLOG_PRESET_FIELDS } from "@/lib/blog-generation/presets";

export async function GET() {
  const { data, error } = await supabase.from("blog_prompt_presets").select(BLOG_PRESET_FIELDS)
    .order("is_default", { ascending: false }).order("created_at").order("id");
  if (error) {
    console.error("Blog preset list failed", { code: error.code });
    return Response.json({ error: "프리셋 목록을 불러오지 못했습니다." }, { status: 500 });
  }
  return Response.json({ presets: data });
}

export async function POST(request: Request) {
  let input;
  try { input = parseBlogPreset(await request.json()); }
  catch { return Response.json({ error: "이름, 시스템 지시, 글자 수와 키워드 범위를 확인해 주세요." }, { status: 400 }); }
  const { data, error } = await supabase.from("blog_prompt_presets").insert(input).select(BLOG_PRESET_FIELDS).single();
  if (error || !data) {
    console.error("Blog preset create failed", { code: error?.code });
    return Response.json({ error: "프리셋을 저장하지 못했습니다." }, { status: 500 });
  }
  return Response.json({ preset: data }, { status: 201 });
}
