import { supabase } from "@/lib/supabase";
import { parseBlogPreset, BLOG_PRESET_FIELDS, BLOG_PRESET_UUID } from "@/lib/blog-generation/presets";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!BLOG_PRESET_UUID.test(id)) return Response.json({ error: "유효한 프리셋 ID가 필요합니다." }, { status: 400 });
  const { data: original, error: readError } = await supabase.from("blog_prompt_presets")
    .select(BLOG_PRESET_FIELDS).eq("id", id).maybeSingle();
  if (readError) {
    console.error("Blog preset duplicate lookup failed", { code: readError.code });
    return Response.json({ error: "원본 프리셋을 조회하지 못했습니다." }, { status: 500 });
  }
  if (!original) return Response.json({ error: "프리셋을 찾을 수 없습니다." }, { status: 404 });
  const input = parseBlogPreset({ ...original, name: `${original.name.slice(0, 96)} 복사본`, is_default: false });
  const { data, error } = await supabase.from("blog_prompt_presets").insert(input).select(BLOG_PRESET_FIELDS).single();
  if (error || !data) {
    console.error("Blog preset duplicate failed", { code: error?.code });
    return Response.json({ error: "프리셋을 복제하지 못했습니다." }, { status: 500 });
  }
  return Response.json({ preset: data }, { status: 201 });
}
