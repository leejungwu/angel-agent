import { BLOG_TASK_ASSET_BUCKET, isBlogTaskAssetPath, type BlogTaskAsset } from "@/lib/blog-task-assets";
import { supabase } from "@/lib/supabase";
import { isAssetReferencedByPublicationJob } from "@/lib/blog-publishing/publication-jobs";

type RemovalResult = { deleted: number; preserved: number };

export async function removeAllBlogTaskAssets(taskId: string | number): Promise<RemovalResult> {
  return removeBlogTaskAssets(taskId);
}

export async function removeBlogTaskAsset(taskId: string | number, assetId: string): Promise<RemovalResult> {
  return removeBlogTaskAssets(taskId, assetId);
}

async function removeBlogTaskAssets(taskId: string | number, assetId?: string): Promise<RemovalResult> {
  const { data: assets, error } = await supabase.from("blog_task_assets")
    .select("id, storage_path, file_name, sort_order")
    .eq("blog_task_id", taskId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .returns<BlogTaskAsset[]>();
  if (error) throw new Error(`사진 목록 조회 실패: ${error.message}`);
  const targets = assetId === undefined ? assets ?? [] : (assets ?? []).filter(asset => String(asset.id) === assetId);
  if (assetId !== undefined && targets.length !== 1) throw new Error("이 작업의 사진을 찾지 못했습니다.");
  if (targets.some((asset) => !isBlogTaskAssetPath(taskId, asset.storage_path))) {
    throw new Error("다른 작업의 이미지 경로가 포함되어 삭제를 중단했습니다.");
  }
  // Resolve every reference before touching Storage; a failed lookup must not delete files.
  const retained = new Set<string>();
  for (const asset of targets) {
    if (await isAssetReferencedByPublicationJob({ assetId: asset.id, storagePath: asset.storage_path })) {
      retained.add(String(asset.id));
    }
  }
  const storage = supabase.storage.from(BLOG_TASK_ASSET_BUCKET);
  let deleted = 0, preserved = 0;
  let remaining = [...(assets ?? [])];
  for (const asset of targets) {
    try {
      const originalOrder = remaining.map(item => item.id);
      const reorder = async (ids: (string | number)[]) => {
        const { error } = await supabase.rpc("reorder_blog_task_assets", { p_task_id: taskId, p_asset_ids: ids });
        if (error) throw new Error("사진 순서 저장 실패. 목록을 새로고침해 주세요.");
      };
      // Put the target last atomically, so deleting its row leaves 0..N-1 without a new migration.
      await reorder([...originalOrder.filter(id => String(id) !== String(asset.id)), asset.id]);
      const keepStorage = retained.has(String(asset.id));
      let backup: Blob | null = null;
      const restore = async () => {
        if (!backup) return;
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
      try {
        if (!keepStorage) {
          const { data, error: downloadError } = await storage.download(asset.storage_path);
          if (downloadError || !data || data.size === 0) throw new Error("원본 백업 실패");
          backup = data;
          const { error: removeError } = await storage.remove([asset.storage_path]);
          if (removeError) {
            const { data: present } = await storage.download(asset.storage_path);
            if (!present?.size) await restore();
            throw new Error(`Storage 삭제 실패: ${removeError.message}`);
          }
        }
        const { data, error: deleteError } = await supabase.from("blog_task_assets")
          .delete().eq("blog_task_id", taskId).eq("id", asset.id).select("id");
        if (deleteError || data?.length !== 1) {
          throw new Error("DB metadata 삭제 실패; 해당 사진은 복구했습니다.");
        }
      } catch (cause) {
        await restore();
        await reorder(originalOrder);
        throw cause;
      }
      deleted++;
      if (keepStorage) preserved++;
      remaining = remaining.filter(item => String(item.id) !== String(asset.id));
    } catch (cause) {
      throw new Error(`${deleted}/${targets.length}장 삭제 완료. ${cause instanceof Error ? cause.message : "사진 삭제 실패"}`, { cause });
    }
  }
  return { deleted, preserved };
}
