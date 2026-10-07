import { supabase } from "@/lib/supabase";
import { parsePreset, PRESET_FIELDS } from "@/lib/kin/presets";

export async function GET() {
  const { data, error } = await supabase.from("kin_prompt_presets").select(PRESET_FIELDS)
    .order("is_default", { ascending: false }).order("created_at").order("id");
  if (error) {
    console.error("Kin preset list failed", { code: error.code });
    return Response.json({ error: "프리셋 목록을 불러오지 못했습니다." }, { status: 500 });
  }
  return Response.json({ presets: data });
}

export async function POST(request: Request) {
  let input;
  try { input = parsePreset(await request.json()); }
  catch { return Response.json({ error: "이름과 프롬프트 지침은 필수이며 기본 제품 언급 수준을 확인해 주세요." }, { status: 400 }); }
  const { data, error } = await supabase.from("kin_prompt_presets").insert(input).select(PRESET_FIELDS).single();
  if (error || !data) {
    console.error("Kin preset create failed", { code: error?.code });
    return Response.json({ error: "프리셋을 저장하지 못했습니다." }, { status: 500 });
  }
  return Response.json({ preset: data }, { status: 201 });
}
