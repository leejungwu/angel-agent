import { BLOG_TASK_IMAGE_TYPES, scaledBlogImageSize } from "@/lib/blog-task-assets";

export async function compactBlogImage(file: File): Promise<Blob> {
  if (!BLOG_TASK_IMAGE_TYPES.includes(file.type) || !file.size) throw new Error("비어 있지 않은 JPEG, PNG, WebP 이미지만 업로드할 수 있습니다.");
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaledBlogImageSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("이미지 압축을 시작할 수 없습니다.");
    context.drawImage(bitmap, 0, 0, width, height);
    const webp = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) =>
      blob?.size && blob.type === "image/webp" ? resolve(blob) : reject(new Error("WebP 이미지 압축에 실패했습니다.")),
    "image/webp", 0.82));
    return webp.size < file.size ? webp : file;
  } finally {
    bitmap.close();
  }
}
