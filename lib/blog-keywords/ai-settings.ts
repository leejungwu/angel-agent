import { supabase } from "@/lib/supabase";
import { KeywordError } from "./shared";

export const KEYWORD_AI_SETTINGS_FIELDS = "id,relevance_criteria,recommendation_criteria,relevance_version,created_at,updated_at";
export type KeywordAISettings = {
  id: boolean; relevance_criteria: string; recommendation_criteria: string;
  relevance_version: number; created_at: string; updated_at: string;
};
export function parseKeywordAISettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new KeywordError("AI 기준을 확인하세요.");
  const row = value as Record<string, unknown>;
  const criteria = (key: string) => {
    if (typeof row[key] !== "string" || row[key].length > 30000) throw new KeywordError("각 AI 기준은 1~30,000자여야 합니다.");
    const text = row[key].replace(/\s+/g, " ").trim();
    if (!text) throw new KeywordError("AI 기준을 비워둘 수 없습니다.");
    return text;
  };
  if (typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) throw new KeywordError("저장할 설정을 다시 불러오세요.");
  return { relevance_criteria: criteria("relevance_criteria"), recommendation_criteria: criteria("recommendation_criteria"), updated_at: row.updated_at };
}
export async function readKeywordAISettings(): Promise<KeywordAISettings> {
  const { data, error } = await supabase.from("blog_keyword_ai_settings").select(KEYWORD_AI_SETTINGS_FIELDS).eq("id", true).maybeSingle();
  if (error || !data || !data.relevance_criteria?.trim() || !data.recommendation_criteria?.trim() || !Number.isInteger(data.relevance_version) || data.relevance_version < 1) {
    throw new KeywordError("AI 기준 설정을 조회하지 못했습니다. 202610170007 migration과 연결 상태를 확인하세요.", 500);
  }
  return data;
}
