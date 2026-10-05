import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve, dirname } from "node:path";
import { supabase } from "@/lib/supabase";

export class ProductAssetDownloadError extends Error {
  constructor(assetId: string | number, cause: unknown) {
    super(`Product asset id=${assetId} 이미지 다운로드 실패`, { cause });
    this.name = "ProductAssetDownloadError";
  }
}

export async function createProductAssetDirectory(draftId: number): Promise<string> {
  const root = join(tmpdir(), "angel-agent", "naver-blog");
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, `${draftId}-`));
}

export async function removeProductAssetDirectory(directory: string): Promise<void> {
  const root = resolve(tmpdir(), "angel-agent", "naver-blog");
  if (dirname(resolve(directory)) !== root) throw new Error("Invalid product asset temporary directory");
  await rm(directory, { recursive: true, force: true, maxRetries: 3 });
}

export async function downloadProductAssetFiles(
  productId: string | number | null, directory: string,
): Promise<string[]> {
  if (productId == null) {
    console.log("product assets count:", 0);
    console.log("downloaded asset count:", 0);
    return [];
  }
  const { data: assets, error } = await supabase.from("product_assets")
    .select("id, storage_path")
    .eq("product_id", productId)
    .eq("asset_type", "image")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error("Product assets 조회 실패", { cause: error });
  console.log("product assets count:", assets?.length ?? 0);
  const paths: string[] = [];
  try {
    for (const asset of assets ?? []) {
      try {
        if (typeof asset.storage_path !== "string" || !asset.storage_path.trim()) {
          throw new Error("storage_path가 비어 있습니다.");
        }
        const extension = extname(asset.storage_path);
        if (!/^\.(jpe?g|png|webp)$/i.test(extension)) throw new Error("지원하지 않는 이미지 확장자");
        const { data, error: downloadError } = await supabase.storage
          .from("product-assets").download(asset.storage_path);
        if (downloadError || !data) throw downloadError ?? new Error("빈 다운로드 응답");
        if (data.size === 0) throw new Error("빈 이미지 파일");
        const path = join(directory, `${paths.length + 1}${extension}`);
        await writeFile(path, Buffer.from(await data.arrayBuffer()));
        paths.push(path);
      } catch (cause) {
        throw new ProductAssetDownloadError(asset.id, cause);
      }
    }
    return paths;
  } finally {
    console.log("downloaded asset count:", paths.length);
  }
}
