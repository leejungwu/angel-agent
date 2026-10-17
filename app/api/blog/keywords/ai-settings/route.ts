import { supabase } from "@/lib/supabase";
import { readKeywordAISettings, parseKeywordAISettings, KEYWORD_AI_SETTINGS_FIELDS } from "@/lib/blog-keywords/ai-settings";
import { KeywordError } from "@/lib/blog-keywords/shared";

function failure(error: unknown) {
  return Response.json({ error: error instanceof KeywordError ? error.message : "AI 기준 설정 처리에 실패했습니다." }, { status: error instanceof KeywordError ? error.status : 500 });
}
export async function GET() {
  try { return Response.json({ settings: await readKeywordAISettings() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function PATCH(request: Request) {
  let settings;
  try { settings = parseKeywordAISettings(await request.json()); }
  catch (error) { return failure(error instanceof KeywordError ? error : new KeywordError("AI 기준을 확인하세요.")); }
  try {
    const { data, error } = await supabase.rpc("save_blog_keyword_ai_settings", {
      p_relevance_criteria: settings.relevance_criteria, p_recommendation_criteria: settings.recommendation_criteria, p_expected_updated_at: settings.updated_at,
      p_relevance_model: settings.relevanceModel, p_recommendation_model: settings.recommendationModel,
    }).select(KEYWORD_AI_SETTINGS_FIELDS);
    if (error) throw new KeywordError("AI 기준 저장에 실패했습니다. migration과 연결 상태를 확인하세요.", 500);
    if (!Array.isArray(data) || !data.length) throw new KeywordError("다른 화면에서 기준이 변경되었습니다. 새로고침 후 다시 수정하세요.", 409);
    return Response.json({ settings: data[0] });
  } catch (error) { return failure(error); }
}
export const PUT = PATCH;
