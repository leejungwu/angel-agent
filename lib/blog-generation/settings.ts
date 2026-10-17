import { supabase } from "@/lib/supabase";
import { resolveBlogModel } from "./models";

export const BLOG_SETTINGS_FIELDS = "id,topic_model,topic_prompt,created_at,updated_at";
export type BlogGenerationSettings = { id: boolean; topic_model: string; topic_prompt: string; created_at: string; updated_at: string };
export class BlogSettingsError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function parseBlogSettings(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BlogSettingsError("Topic 설정을 확인하세요.");
  const row = value as Record<string, unknown>;
  if (typeof row.topic_model !== "string" || !resolveBlogModel("openai", row.topic_model)) throw new BlogSettingsError("허용된 OpenAI 모델을 선택하세요.");
  if (typeof row.topic_prompt !== "string" || !row.topic_prompt.trim() || row.topic_prompt.length > 30000) throw new BlogSettingsError("Topic 생성 기준은 1~30,000자여야 합니다.");
  if (typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))) throw new BlogSettingsError("설정을 다시 불러오세요.");
  return { topic_model: row.topic_model, topic_prompt: row.topic_prompt.trim(), updated_at: row.updated_at };
}
export async function readBlogSettings(): Promise<BlogGenerationSettings> {
  const { data, error } = await supabase.from("blog_generation_settings").select(BLOG_SETTINGS_FIELDS).eq("id", true).maybeSingle();
  if (!error && data) {
    try { parseBlogSettings(data); return data; } catch { /* Invalid stored settings must not silently fall back. */ }
  }
  throw new BlogSettingsError("Blog Topic 설정을 조회하지 못했습니다. 202610170009 migration과 모델·연결 상태를 확인하세요.", 500);
}
