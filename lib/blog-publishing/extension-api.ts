import { timingSafeEqual } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { orderedTaskImages } from "./downloads";
import { prepareBlogPost } from "./preparation";
import { createBlogExecutionBlocks } from "./blocks";
import { BLOG_TASK_ASSET_BUCKET, type BlogTaskAsset } from "@/lib/blog-task-assets";

export function authorizeExtension(request: Request): Response | null {
  const token = process.env.ANGEL_EXTENSION_TOKEN;
  if (!token || token.length < 32) return Response.json({ error: "ANGEL_EXTENSION_TOKEN을 32자 이상으로 설정해 주세요." }, { status: 503 });
  const actual = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(token);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return Response.json({ error: "Extension 연결 토큰을 확인해 주세요." }, { status: 401 });
  return null;
}

export class ExtensionDraftError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}

export async function getExtensionBlogTask(id: string, draftId?: string) {
  let draftQuery = supabase.from("blog_drafts").select("id,title,intro,sections,closing,status").eq("blog_task_id", id);
  if (draftId) draftQuery = draftQuery.eq("id", draftId);
  else draftQuery = draftQuery.eq("status", "approved");
  const [task, draftResult, assets] = await Promise.all([
    supabase.from("blog_tasks").select("id").eq("id", id).maybeSingle(),
    draftQuery
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("blog_task_assets").select("id,storage_path,file_name,sort_order").eq("blog_task_id", id)
      .order("sort_order", { ascending: true }).order("id", { ascending: true }).returns<BlogTaskAsset[]>(),
  ]);
  if (task.error || draftResult.error || assets.error) throw new Error("발행 준비 자료를 조회하지 못했습니다.");
  if (!task.data) return null;
  if (!draftResult.data) {
    if (draftId) return null;
    throw new ExtensionDraftError("승인된 초안이 없습니다. 앱에서 초안을 승인한 후 다시 선택하세요.", 409, "NO_APPROVED_DRAFT");
  }
  const draft = draftResult.data;
  if (draft.status !== "approved") throw new ExtensionDraftError("승인된 초안만 네이버 입력에 사용할 수 있습니다.", 403, "DRAFT_NOT_APPROVED");
  let sections: unknown = draft.sections;
  if (typeof sections === "string") sections = JSON.parse(sections);
  if (typeof draft.title !== "string" || !draft.title.trim() ||
    (draft.intro != null && typeof draft.intro !== "string") || (draft.closing != null && typeof draft.closing !== "string") ||
    !Array.isArray(sections) || !sections.every((s) => s && typeof s.body === "string" && (s.heading == null || typeof s.heading === "string"))) {
    throw new Error("초안의 제목·본문 형식을 확인해 주세요.");
  }
  const images = orderedTaskImages(id, assets.data ?? []);
  const prepared = prepareBlogPost({ title: draft.title, intro: draft.intro, sections, closing: draft.closing }, images.length);
  if (!prepared.body.trim()) throw new Error("초안 본문이 비어 있습니다.");
  const signedImages = await Promise.all(images.map(async (asset, index) => {
    const { data, error } = await supabase.storage.from(BLOG_TASK_ASSET_BUCKET).createSignedUrl(asset.storage_path, 600);
    if (error || !data?.signedUrl) throw new Error("사진 접근 URL을 준비하지 못했습니다.");
    const insertOffset = prepared.imageInsertOffsets[index];
    return { id: asset.id, index, insertOffset, insertPrefix: prepared.executionBodyText.slice(0, insertOffset), sortOrder: asset.sort_order, signedUrl: data.signedUrl, expiresIn: 600 };
  }));
  const blocks = createBlogExecutionBlocks(prepared.executionBodyText, signedImages);
  return {
    id: task.data.id, draftId: draft.id, status: draft.status, title: prepared.title,
    paragraphs: prepared.blocks.filter((b) => b.type === "text").map((b) => b.text),
    bodyText: prepared.executionBodyText,
    images: signedImages,
    blocks,
  };
}
