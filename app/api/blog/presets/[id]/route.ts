import { supabase } from "@/lib/supabase";
import { parseBlogPreset, BLOG_PRESET_FIELDS, BLOG_PRESET_UUID } from "@/lib/blog-generation/presets";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  let input;
  let hasTitle = false;
  try {
    if (!BLOG_PRESET_UUID.test(id)) throw new Error("InvalidId");
    const body = await request.json();
    input = parseBlogPreset(body);
    hasTitle = Object.hasOwn(body, "title_prompt");
  } catch { return Response.json({ error: "프리셋 ID, 이름, 시스템 지시와 숫자 범위를 확인해 주세요." }, { status: 400 }); }
  const { title_prompt, ...otherFields } = input;
  const { data, error } = await supabase.from("blog_prompt_presets")
    .update({ ...otherFields, ...(hasTitle ? { title_prompt } : {}), updated_at: new Date().toISOString() }).eq("id", id).select(BLOG_PRESET_FIELDS).maybeSingle();
  if (error) {
    console.error("Blog preset update failed", { code: error.code });
    return Response.json({ error: "프리셋을 수정하지 못했습니다." }, { status: 500 });
  }
  if (!data) return Response.json({ error: "프리셋을 찾을 수 없습니다." }, { status: 404 });
  return Response.json({ preset: data });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!BLOG_PRESET_UUID.test(id)) return Response.json({ error: "유효한 프리셋 ID가 필요합니다." }, { status: 400 });
  const { data, error } = await supabase.from("blog_prompt_presets").delete().eq("id", id).select("id").maybeSingle();
  if (error) {
    console.error("Blog preset delete failed", { code: error.code });
    return Response.json({ error: "프리셋을 삭제하지 못했습니다." }, { status: 500 });
  }
  if (!data) return Response.json({ error: "프리셋을 찾을 수 없습니다." }, { status: 404 });
  return Response.json({ ok: true });
}
