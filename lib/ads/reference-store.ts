import { supabase } from "@/lib/supabase";
import { AD_ASSET_BUCKET, AdReferenceError, assertAdReferenceId, parseAdReference, validateAdFile, type AdReference } from "./references";

export async function getAdReference(id: string): Promise<AdReference> {
  assertAdReferenceId(id);
  const { data, error } = await supabase.from("ad_references").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("광고 Reference 조회에 실패했습니다.");
  if (!data) throw new AdReferenceError("광고 Reference가 없습니다.", 404);
  return data;
}
async function removeAsset(path: string | null): Promise<string | null> {
  if (!path) return null;
  if (!/^references\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|mp4|webm)$/i.test(path)) return "파일 경로를 확인하지 못해 원본을 보존했습니다.";
  try {
    const { error } = await supabase.storage.from(AD_ASSET_BUCKET).remove([path]);
    return error ? "Reference 변경은 완료됐지만 첨부 파일 정리에 실패했습니다." : null;
  } catch { return "파일 정리에 실패했습니다. Storage에 파일이 남아 있을 수 있습니다."; }
}
export async function saveAdReference(value: unknown, file: File | null, options: { id?: string; updatedAt?: string; removeAsset?: boolean } = {}) {
  const input = parseAdReference(value);
  const extension = file ? validateAdFile(file, input.media_type) : null;
  const previous = options.id ? await getAdReference(options.id) : null;
  if (previous && options.updatedAt !== previous.updated_at) throw new AdReferenceError("다른 화면에서 변경됐습니다. 새로고침 후 수정하세요.", 409);
  if (previous?.asset_storage_path && !file && !options.removeAsset && previous.media_type !== input.media_type) throw new AdReferenceError("소재 유형 변경 시 파일을 교체하거나 제거하세요.");
  const id = previous?.id ?? crypto.randomUUID();
  let path = options.removeAsset ? null : previous?.asset_storage_path ?? null;
  if (file) {
    path = `references/${id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from(AD_ASSET_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new Error("파일 업로드에 실패했습니다.");
  }
  const values = { ...input, asset_storage_path: path, original_file_name: file ? file.name : path ? previous?.original_file_name ?? null : null };
  // New object paths keep replacement separate from the existing file until DB save succeeds.
  const query = previous ? supabase.from("ad_references").update(values).eq("id", id).eq("updated_at", previous.updated_at)
    : supabase.from("ad_references").insert({ id, ...values });
  const { data, error } = await query.select("id").maybeSingle();
  if (error || !data) {
    // A network failure can leave commit outcome unknown; preserve the new file rather than break a saved row.
    throw new AdReferenceError(file ? "저장 결과를 확인하지 못했습니다. 목록을 확인하세요. 업로드 파일은 안전을 위해 보존했습니다." : "저장하지 못했습니다. Product 또는 변경 상태를 확인하고 새로고침하세요.", 409);
  }
  const warning = previous?.asset_storage_path && previous.asset_storage_path !== path ? await removeAsset(previous.asset_storage_path) : null;
  return { id, warning };
}
export async function deleteAdReference(id: string, updatedAt: string) {
  const previous = await getAdReference(id);
  if (previous.updated_at !== updatedAt) throw new AdReferenceError("다른 화면에서 변경됐습니다. 새로고침 후 삭제하세요.", 409);
  const { data, error } = await supabase.from("ad_references").delete().eq("id", id).eq("updated_at", updatedAt).select("id").maybeSingle();
  if (error || !data) throw new AdReferenceError("삭제하지 못했습니다. 새로고침 후 다시 확인하세요.", 409);
  return { warning: await removeAsset(previous.asset_storage_path) };
}
