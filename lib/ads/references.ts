export const AD_PLATFORMS = { meta: "Meta", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", other: "기타" };
export const AD_MEDIA_TYPES = { image: "이미지", video: "영상", other: "기타" };
export const AD_ASSET_BUCKET = "ad-reference-assets";
export const AD_FILE_TYPES: Record<string, { extension: string; mediaType: string }> = {
  "image/jpeg": { extension: "jpg", mediaType: "image" }, "image/png": { extension: "png", mediaType: "image" },
  "image/webp": { extension: "webp", mediaType: "image" }, "video/mp4": { extension: "mp4", mediaType: "video" },
  "video/webm": { extension: "webm", mediaType: "video" },
};
export type AdReferenceInput = {
  title: string; brand_name: string; product_id: number | null;
  platform: keyof typeof AD_PLATFORMS; media_type: keyof typeof AD_MEDIA_TYPES;
  source_url: string | null; landing_url: string | null; tags: string[]; notes: string | null;
};
export type AdReference = AdReferenceInput & {
  id: string; asset_storage_path: string | null; original_file_name: string | null; created_at: string; updated_at: string;
};
export class AdReferenceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function assertAdReferenceId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new AdReferenceError("광고 Reference ID를 확인하세요.");
}
export function parseAdReference(value: unknown): AdReferenceInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AdReferenceError("광고 정보를 확인하세요.");
  const item = value as Record<string, unknown>;
  const text = (key: string, max: number, required = false) => {
    const raw = item[key];
    if (raw != null && typeof raw !== "string") throw new AdReferenceError(`${key}: 문자열이 필요합니다.`);
    const result = (raw as string | null | undefined)?.trim() || null;
    if ((required && !result) || (result && result.length > max)) throw new AdReferenceError(`${key}: 필수 여부 또는 최대 ${max}자를 확인하세요.`);
    return result;
  };
  const url = (key: string) => {
    const result = text(key, 2048);
    if (!result) return null;
    try { const parsed = new URL(result); if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); }
    catch { throw new AdReferenceError(`${key}: http/https URL을 입력하세요.`); }
    return result;
  };
  const productId = item.product_id;
  if (productId != null && (!Number.isSafeInteger(productId) || (productId as number) <= 0)) throw new AdReferenceError("연결 Product를 확인하세요.");
  if (typeof item.platform !== "string" || !Object.hasOwn(AD_PLATFORMS, item.platform)) throw new AdReferenceError("플랫폼을 확인하세요.");
  if (typeof item.media_type !== "string" || !Object.hasOwn(AD_MEDIA_TYPES, item.media_type)) throw new AdReferenceError("소재 유형을 확인하세요.");
  if (!Array.isArray(item.tags) || item.tags.length > 30 || item.tags.some(tag => typeof tag !== "string" || !tag.trim() || tag.trim().length > 50)) throw new AdReferenceError("태그는 각각 1~50자, 최대 30개입니다.");
  return { title: text("title", 200, true)!, brand_name: text("brand_name", 200, true)!, product_id: productId as number | null ?? null,
    platform: item.platform as AdReferenceInput["platform"], media_type: item.media_type as AdReferenceInput["media_type"],
    source_url: url("source_url"), landing_url: url("landing_url"), tags: [...new Set(item.tags.map(tag => (tag as string).trim()))], notes: text("notes", 20000) };
}
export function validateAdFile(file: Pick<File, "type" | "size" | "name">, mediaType: string) {
  const format = AD_FILE_TYPES[file.type];
  if (!format || format.mediaType !== mediaType || file.size <= 0 || file.size > (mediaType === "image" ? 10 : 50) * 1024 * 1024) {
    throw new AdReferenceError("소재 유형에 맞는 JPEG/PNG/WebP(10MB 이하), MP4/WebM(50MB 이하) 파일을 선택하세요.");
  }
  return format.extension;
}
