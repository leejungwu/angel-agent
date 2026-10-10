export const BLOG_TASK_ASSET_BUCKET = "blog-task-assets";
export const BLOG_TASK_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export type BlogTaskAsset = {
  id: string | number;
  storage_path: string;
  file_name: string;
  sort_order: number;
};

export function blogTaskAssetPath(taskId: string | number, uuid: string, filename: string, contentType: string): string {
  if (!/^[1-9]\d*$/.test(String(taskId)) || !/^[\w-]+$/.test(uuid) || !BLOG_TASK_IMAGE_TYPES.includes(contentType)) {
    throw new Error("Invalid blog task image path");
  }
  const base = filename.replace(/\.(jpe?g|png|webp)$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-160) || "image";
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
  return `tasks/${taskId}/${uuid}-${base}.${extension}`;
}

export function isBlogTaskAssetPath(taskId: string | number, path: string): boolean {
  return /^[1-9]\d*$/.test(String(taskId)) && path.startsWith(`tasks/${taskId}/`) &&
    !path.slice(`tasks/${taskId}/`.length).includes("/") && /^tasks\/[1-9]\d*\/[^/]+\.(jpe?g|png|webp)$/i.test(path);
}

export function scaledBlogImageSize(width: number, height: number) {
  const ratio = Math.min(1, 1800 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
