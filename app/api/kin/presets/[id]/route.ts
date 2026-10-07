import { supabase } from "@/lib/supabase";
import { parsePreset, PRESET_FIELDS, UUID_PATTERN } from "@/lib/kin/presets";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  let input;
  try {
    if (!UUID_PATTERN.test(id)) throw new Error("InvalidId");
    input = parsePreset(await request.json());
  } catch { return Response.json({ error: "프리셋 ID, 이름, 지침과 제품 언급 수준을 확인해 주세요." }, { status: 400 }); }
  const { data, error } = await supabase.from("kin_prompt_presets")
    .update({ ...input, updated_at: new Date().toISOString() }).eq("id", id).select(PRESET_FIELDS).maybeSingle();
  if (error) {
    console.error("Kin preset update failed", { code: error.code });
    return Response.json({ error: "프리셋을 수정하지 못했습니다." }, { status: 500 });
  }
  if (!data) return Response.json({ error: "프리셋을 찾을 수 없습니다." }, { status: 404 });
  return Response.json({ preset: data });
}

export async function DELETE(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "유효한 프리셋 ID가 필요합니다." }, { status: 400 });
  const { data, error } = await supabase.from("kin_prompt_presets").delete().eq("id", id).select("id").maybeSingle();
  if (error) {
    console.error("Kin preset delete failed", { code: error.code });
    return Response.json({ error: "프리셋을 삭제하지 못했습니다." }, { status: 500 });
  }
  if (!data) return Response.json({ error: "프리셋을 찾을 수 없습니다." }, { status: 404 });
  return Response.json({ ok: true });
}
