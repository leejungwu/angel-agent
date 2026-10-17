import { supabase } from "@/lib/supabase";
import { readBlogSettings, parseBlogSettings, BlogSettingsError } from "@/lib/blog-generation/settings";

function failure(error: unknown) {
  return Response.json({ error: error instanceof BlogSettingsError ? error.message : "Blog 설정 처리에 실패했습니다." }, { status: error instanceof BlogSettingsError ? error.status : 500 });
}
export async function GET() {
  try { return Response.json({ settings: await readBlogSettings() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  let input;
  try { input = parseBlogSettings(await request.json()); }
  catch (error) { return failure(error instanceof BlogSettingsError ? error : new BlogSettingsError("Topic 설정을 확인하세요.")); }
  try {
    const { data, error } = await supabase.rpc("save_blog_generation_settings", { p_topic_model: input.topic_model, p_topic_prompt: input.topic_prompt, p_expected_updated_at: input.updated_at });
    if (error) throw new BlogSettingsError("Blog 설정을 저장하지 못했습니다.", 500);
    if (!Array.isArray(data) || !data.length) throw new BlogSettingsError("다른 화면에서 설정이 변경되었습니다. 새로고침 후 다시 수정하세요.", 409);
    return Response.json({ settings: data[0] });
  } catch (error) { return failure(error); }
}
