import { writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { BLOG_TASK_ASSET_BUCKET, isBlogTaskAssetPath } from "@/lib/blog-task-assets";
import { supabase } from "@/lib/supabase";

export class BlogTaskAssetDownloadError extends Error {
  constructor(assetId: string | number, cause: unknown) {
    super(`Blog task asset id=${assetId} 이미지 다운로드 실패`, { cause });
    this.name = "BlogTaskAssetDownloadError";
  }
}

export async function downloadBlogTaskAssetFiles(blogTaskId: string | number, directory: string): Promise<string[]> {
  const { data: assets, error } = await supabase.from("blog_task_assets")
    .select("id, blog_task_id, storage_path")
    .eq("blog_task_id", blogTaskId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error("Blog task assets 조회 실패", { cause: error });
  const paths: string[] = [];
  for (const asset of assets ?? []) {
    try {
      if (String(asset.blog_task_id) !== String(blogTaskId) ||
          typeof asset.storage_path !== "string" || !isBlogTaskAssetPath(blogTaskId, asset.storage_path)) {
        throw new Error("Invalid blog task image path");
      }
      const { data, error: downloadError } = await supabase.storage.from(BLOG_TASK_ASSET_BUCKET).download(asset.storage_path);
      if (downloadError || !data) throw downloadError ?? new Error("빈 다운로드 응답");
      if (data.size === 0) throw new Error("빈 이미지 파일");
      const path = join(directory, `${paths.length + 1}${extname(asset.storage_path).toLowerCase()}`);
      await writeFile(path, Buffer.from(await data.arrayBuffer()));
      paths.push(path);
    } catch (cause) {
      throw new BlogTaskAssetDownloadError(asset.id, cause);
    }
  }
  return paths;
}
