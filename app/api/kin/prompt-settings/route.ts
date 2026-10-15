import { supabase } from "@/lib/supabase";
import { KIN_PROMPT_FIELDS, parseKinPromptSettings } from "@/lib/kin/prompts";

export async function GET() {
  const { data, error } = await supabase.from("kin_prompt_settings").select(KIN_PROMPT_FIELDS).eq("id", true).maybeSingle();
  if (error || !data) return Response.json({ error: "공통 프롬프트를 조회하지 못했습니다. migration 적용 여부를 확인해 주세요." }, { status: 500 });
  return Response.json({ settings: data }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  let settings;
  try { settings = parseKinPromptSettings(await request.json()); }
  catch { return Response.json({ error: "시스템 지시와 공통 스타일 지시를 확인해 주세요. 각 30,000자 이하여야 합니다." }, { status: 400 }); }
  const { data, error } = await supabase.from("kin_prompt_settings")
    .update({ ...settings, updated_at: new Date().toISOString() }).eq("id", true).select(KIN_PROMPT_FIELDS).maybeSingle();
  if (error || !data) return Response.json({ error: "공통 프롬프트를 저장하지 못했습니다. migration 적용 여부를 확인해 주세요." }, { status: 500 });
  return Response.json({ settings: data });
}
