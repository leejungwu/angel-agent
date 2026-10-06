import { supabase } from "@/lib/supabase";
import { parsePreset, PRESET_FIELDS, UUID_PATTERN } from "@/lib/kin/presets";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return Response.json({ error: "유효한 프리셋 ID가 필요합니다." }, { status: 400 });
  const { data: original, error: readError } = await supabase.from("kin_prompt_presets")
    .select(PRESET_FIELDS).eq("id", id).maybeSingle();
  if (readError) {
    console.error("Kin preset duplicate lookup failed", { code: readError.code });
    return Response.json({ error: "원본 프리셋을 조회하지 못했습니다." }, { status: 500 });
  }
  if (!original) return Response.json({ error: "프리셋을 찾을 수 없습니다." }, { status: 404 });
  const input = parsePreset({ ...original, name: `${original.name.slice(0, 96)} 복사본`, is_default: false });
  const { data, error } = await supabase.from("kin_prompt_presets").insert(input).select(PRESET_FIELDS).single();
  if (error || !data) {
    console.error("Kin preset duplicate failed", { code: error?.code });
    return Response.json({ error: "프리셋을 복제하지 못했습니다." }, { status: 500 });
  }
  return Response.json({ preset: data }, { status: 201 });
}
