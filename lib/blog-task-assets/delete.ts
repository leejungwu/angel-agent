import { BLOG_TASK_ASSET_BUCKET, isBlogTaskAssetPath, type BlogTaskAsset } from "@/lib/blog-task-assets";
import { supabase } from "@/lib/supabase";
import { isAssetReferencedByPublicationJob } from "@/lib/blog-publishing/publication-jobs";

export async function removeAllBlogTaskAssets(taskId: string | number): Promise<number> {
  const { data: assets, error } = await supabase.from("blog_task_assets")
    .select("id, storage_path, file_name, sort_order")
    .eq("blog_task_id", taskId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .returns<BlogTaskAsset[]>();
  if (error) throw new Error(`사진 목록 조회 실패: ${error.message}`);
  const targets = assets ?? [];
  if (targets.some((asset) => !isBlogTaskAssetPath(taskId, asset.storage_path))) {
    throw new Error("다른 작업의 이미지 경로가 포함되어 삭제를 중단했습니다.");
  }
  // Check every target before touching Storage: an all-delete must not partially
  // remove unreferenced images before discovering a protected image later.
  for (const asset of targets) {
    if (await isAssetReferencedByPublicationJob({ assetId: asset.id, storagePath: asset.storage_path })) {
      throw new Error("발행 대기열 또는 입력·발행 이력이 참조하는 사진은 삭제할 수 없습니다. 대기 중인 Job을 먼저 제거해 주세요.");
    }
  }
  const storage = supabase.storage.from(BLOG_TASK_ASSET_BUCKET);
  let deleted = 0;
  for (const asset of targets) {
    try {
      const { data: backup, error: downloadError } = await storage.download(asset.storage_path);
      if (downloadError || !backup || backup.size === 0) throw new Error("원본 백업 실패");
      const restore = async () => {
        const { error: restoreError } = await storage.upload(asset.storage_path, backup, {
          contentType: backup.type, upsert: false,
        });
        if (restoreError) {
          const { data: existing, error: checkError } = await storage.download(asset.storage_path);
          if (checkError || !existing?.size) {
            throw new Error(`Storage 복구도 실패했습니다 (${asset.storage_path}). 관리자 확인이 필요합니다.`);
          }
        }
      };
      const { error: removeError } = await storage.remove([asset.storage_path]);
      if (removeError) {
        const { data: remaining } = await storage.download(asset.storage_path);
        if (!remaining?.size) await restore();
        throw new Error(`Storage 삭제 실패: ${removeError.message}`);
      }
      const { data, error: deleteError } = await supabase.from("blog_task_assets")
        .delete().eq("blog_task_id", taskId).eq("id", asset.id).select("id");
      if (deleteError || data?.length !== 1) {
        await restore();
        throw new Error("DB metadata 삭제 실패; 해당 사진은 복구했습니다.");
      }
      deleted++;
    } catch (cause) {
      throw new Error(`${deleted}/${targets.length}장 삭제 완료. ${cause instanceof Error ? cause.message : "사진 삭제 실패"}`, { cause });
    }
  }
  return deleted;
}
