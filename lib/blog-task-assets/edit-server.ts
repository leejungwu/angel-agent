import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { BLOG_TASK_ASSET_BUCKET, blogTaskAssetPath, isBlogTaskAssetPath, type BlogTaskAsset } from "@/lib/blog-task-assets";
import { parseImageEdit } from "./edit";
import { isAssetReferencedByPublicationJob } from "@/lib/blog-publishing/publication-jobs";

export async function getEditableAsset(taskId: string, assetId: string) {
  const { data, error } = await supabase.from("blog_task_assets").select("id,storage_path,file_name,sort_order,original_storage_path,edit_metadata")
    .eq("blog_task_id", taskId).eq("id", assetId).returns<BlogTaskAsset[]>().maybeSingle();
  if (error || !data) throw new Error("편집할 작업 사진을 조회하지 못했습니다.");
  if (![data.storage_path, data.original_storage_path || data.storage_path].every(path => isBlogTaskAssetPath(taskId, path))) throw new Error("작업 사진 경로가 올바르지 않습니다.");
  return data;
}

export async function saveEditedAsset(taskId: string, assetId: string, expectedPath: string, file: Blob | null, metadata: unknown) {
  const asset = await getEditableAsset(taskId, assetId);
  if (asset.storage_path !== expectedPath) throw new Error("사진이 변경됐습니다. 편집 화면을 다시 열어 주세요.");
  const original = asset.original_storage_path || asset.storage_path;
  const storage = supabase.storage.from(BLOG_TASK_ASSET_BUCKET);
  let path = original, edit = null;
  if (file) {
    edit = parseImageEdit(metadata);
    if (file.type !== "image/webp" || !file.size || file.size > 10 * 1024 * 1024) throw new Error("10MB 이하 WebP 편집본만 저장할 수 있습니다.");
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" || new TextDecoder().decode(bytes.slice(8, 12)) !== "WEBP") throw new Error("WebP 파일 형식을 확인해 주세요.");
    path = blogTaskAssetPath(taskId, randomUUID(), asset.file_name, "image/webp");
    const { error } = await storage.upload(path, file, { contentType: "image/webp", upsert: false });
    if (error) throw new Error("편집본 업로드 실패. 기존 사진은 유지됩니다.");
  }
  // Previous original/derived objects are intentionally retained for immutable Jobs.
  try {
    const { data, error } = await supabase.from("blog_task_assets")
      .update({ storage_path: path, original_storage_path: original, edit_metadata: edit })
      .eq("blog_task_id", taskId).eq("id", assetId).eq("storage_path", expectedPath)
      .select("id,storage_path,file_name,sort_order,original_storage_path,edit_metadata").maybeSingle();
    if (error || !data) throw new Error("사진 저장 실패 또는 동시 변경이 발생했습니다. 다시 조회해 주세요.");
    return data;
  } catch (cause) {
    if (file) {
      // A response can be lost after commit. Only delete a copy confirmed unused.
      let current;
      try { current = await getEditableAsset(taskId, assetId); }
      catch { throw new Error("편집본 저장 여부를 확인하지 못해 파일을 보존했습니다. 목록을 새로고침해 주세요."); }
      if (current.storage_path === path) return current;
      if (!await isAssetReferencedByPublicationJob({ storagePath: path })) {
        const { error } = await storage.remove([path]);
        if (error) throw new Error("편집본 저장과 임시 복사본 정리에 실패했습니다. 기존 사진은 유지됩니다.");
      }
    }
    throw cause;
  }
}
