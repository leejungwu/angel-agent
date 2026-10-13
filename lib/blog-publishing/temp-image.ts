import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BLOG_TASK_ASSET_BUCKET } from "@/lib/blog-task-assets";

const directory = () => join(tmpdir(), "angel-agent", "naver-upload");
const validId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

export class TempImageError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function createTempImage(signedUrl: unknown) {
  let url: URL;
  try {
    if (typeof signedUrl !== "string" || signedUrl.length > 16000) throw new Error();
    url = new URL(signedUrl);
    const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    if (url.origin !== storage.origin || url.username || url.password ||
      !url.pathname.startsWith(`/storage/v1/object/sign/${BLOG_TASK_ASSET_BUCKET}/`) || !url.searchParams.get("token")) throw new Error();
  } catch { throw new TempImageError("작업 이미지 signed URL을 확인하세요.", 400); }
  const response = await fetch(url, { redirect: "error", cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body) throw new TempImageError("사진을 가져오지 못했습니다. 작업을 다시 선택하세요.", 502);
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) throw new TempImageError("PNG/JPEG/WebP 사진만 지원합니다.", 415);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 10 * 1024 * 1024) throw new TempImageError("사진은 10MB 이하여야 합니다.", 413);
      chunks.push(Buffer.from(chunk.value));
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && mime === "image/png" ? "png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && mime === "image/jpeg" ? "jpg"
    : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" && mime === "image/webp" ? "webp" : null;
  if (!size || !extension) throw new TempImageError("사진 파일 형식이 올바르지 않습니다.", 415);
  const tempId = randomUUID();
  const absolutePath = join(directory(), `${tempId}.${extension}`);
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  try { await writeFile(absolutePath, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") await deleteTempImage(tempId);
    throw error;
  }
  return { tempId, absolutePath };
}

export async function deleteTempImage(tempId: string) {
  if (!validId(tempId)) throw new TempImageError("잘못된 tempId입니다.", 400);
  // 클라이언트 경로는 받지 않습니다. UUID와 지원 확장자로 서버 전용 경로만 계산합니다.
  await Promise.all(["png", "jpg", "webp"].map(async (extension) => {
    try { await unlink(join(directory(), `${tempId}.${extension}`)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }));
}
