import { randomUUID } from "node:crypto";
import { supabase } from "@/lib/supabase";
import { BLOG_TASK_ASSET_BUCKET, blogTaskAssetPath, type BlogTaskAsset } from "@/lib/blog-task-assets";

export function parseAssetIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.some(id => (typeof id !== "string" && typeof id !== "number") || (typeof id === "number" && !Number.isSafeInteger(id)) || !/^[1-9]\d*$/.test(String(id))) || new Set(value.map(String)).size !== value.length) {
    throw new Error("사진 ID 목록을 확인해 주세요.");
  }
  return value.map(String);
}

export async function reorderBlogTaskAssets(taskId: string, ids: string[]) {
  const { error } = await supabase.rpc("reorder_blog_task_assets", { p_task_id: taskId, p_asset_ids: ids });
  if (error) throw new Error("사진 순서 저장 실패. 목록을 새로고침한 뒤 다시 시도해 주세요.");
}

type ProductPhoto = { id: string | number; storage_path: string; file_name: string | null; sort_order: number };

export async function listProductPhotos(taskId: string) {
  const { data: task, error: taskError } = await supabase.from("blog_tasks").select("product_id").eq("id", taskId).maybeSingle();
  if (taskError || !task) throw new Error("블로그 작업 조회 실패");
  if (!task.product_id) return [];
  const { data, error } = await supabase.from("product_assets").select("id,storage_path,file_name,sort_order")
    .eq("product_id", task.product_id).eq("asset_type", "image").order("sort_order").order("id").returns<ProductPhoto[]>();
  if (error) throw new Error("제품 사진 조회 실패");
  const photos = data ?? [];
  if (photos.some(photo => !photo.storage_path.startsWith(`products/${task.product_id}/`) || photo.storage_path.includes(".."))) {
    throw new Error("제품 사진 경로를 확인해 주세요.");
  }
  return photos;
}

export async function reuseProductPhotos(taskId: string, ids: string[]) {
  if (!ids.length) throw new Error("제품 사진을 선택해 주세요.");
  const photos = await listProductPhotos(taskId);
  if (ids.some(id => !photos.some(photo => String(photo.id) === id))) throw new Error("연결된 제품의 사진만 추가할 수 있습니다.");
  const { data: existing, error } = await supabase.from("blog_task_assets").select("source_product_asset_id,sort_order")
    .eq("blog_task_id", taskId);
  if (error) throw new Error("기존 사진 조회 실패");
  const selected = photos.filter(photo => ids.includes(String(photo.id)) && !(existing ?? []).some(asset => String(asset.source_product_asset_id) === String(photo.id)));
  if (!selected.length) return 0;
  const firstOrder = Math.max(-1, ...(existing ?? []).map(asset => asset.sort_order)) + 1;
  const storage = supabase.storage.from(BLOG_TASK_ASSET_BUCKET);
  const copied: string[] = [];
  const rows: (Omit<BlogTaskAsset, "id"> & { blog_task_id: string; source_product_asset_id: string | number })[] = [];
  let metadataAttempted = false;
  try {
    for (const photo of selected) {
      const extension = photo.storage_path.match(/\.(jpe?g|png|webp)$/i)?.[1].toLowerCase();
      if (!extension) throw new Error("JPEG, PNG, WebP 제품 사진만 추가할 수 있습니다.");
      const mime = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
      const path = blogTaskAssetPath(taskId, randomUUID(), photo.file_name || `product.${extension}`, mime);
      copied.push(path);
      const { error: copyError } = await supabase.storage.from("product-assets").copy(photo.storage_path, path, { destinationBucket: BLOG_TASK_ASSET_BUCKET });
      if (copyError) throw new Error("제품 사진 복사 실패");
      rows.push({ blog_task_id: taskId, source_product_asset_id: photo.id, storage_path: path, file_name: photo.file_name || `product.${extension}`, sort_order: firstOrder + rows.length });
    }
    metadataAttempted = true;
    const { error: insertError } = await supabase.from("blog_task_assets").insert(rows);
    if (insertError) throw new Error("제품 사진 저장 실패. 중복 추가 또는 목록 변경 여부를 확인해 주세요.");
    return rows.length;
  } catch (cause) {
    if (metadataAttempted) {
      // Both rejected promises and API errors may follow a committed INSERT.
      try {
        const { data: present, error: checkError } = await supabase.from("blog_task_assets").select("storage_path").eq("blog_task_id", taskId).in("storage_path", copied);
        if (checkError) throw checkError;
        const unused = copied.filter(path => !(present ?? []).some(asset => asset.storage_path === path));
        copied.splice(0, copied.length, ...unused);
        if (!unused.length) return rows.length;
      } catch {
        throw new Error("사진 저장 상태 확인 실패. 복사본을 보존했습니다. 다시 추가하기 전에 목록을 확인해 주세요.");
      }
    }
    if (copied.length) {
      const { error: cleanupError } = await storage.remove(copied);
      if (cleanupError) throw new Error("제품 사진 추가 실패. 복사된 Storage 파일 정리도 실패했습니다. 관리자 확인이 필요합니다.");
    }
    throw cause;
  }
}
