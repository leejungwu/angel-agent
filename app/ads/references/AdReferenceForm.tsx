"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AD_PLATFORMS, AD_MEDIA_TYPES, AD_FILE_TYPES, parseAdReference, validateAdFile, type AdReference } from "@/lib/ads/references";

export default function AdReferenceForm({ reference, products }: { reference?: AdReference; products: { id: number; name: string }[] }) {
  const router = useRouter(), inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [savedId, setSavedId] = useState<string>();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (inFlight.current || savedId) return;
    const form = new FormData(event.currentTarget);
    setMessage("");
    try {
      const input = parseAdReference({ title: form.get("title"), brand_name: form.get("brand_name"), product_id: form.get("product_id") ? Number(form.get("product_id")) : null,
        platform: form.get("platform"), media_type: form.get("media_type"), source_url: form.get("source_url"), landing_url: form.get("landing_url"),
        tags: String(form.get("tags") ?? "").split(",").map(tag => tag.trim()).filter(Boolean), notes: form.get("notes") });
      const file = form.get("file");
      const upload = file instanceof File && file.size > 0 ? file : null;
      if (upload) validateAdFile(upload, input.media_type);
      const body = new FormData(); body.set("data", JSON.stringify(input));
      if (upload) body.set("file", upload);
      if (reference) { body.set("updatedAt", reference.updated_at); body.set("removeAsset", String(form.get("removeAsset") === "on")); }
      inFlight.current = true; setBusy(true);
      const response = await fetch(reference ? `/api/ads/references/${reference.id}` : "/api/ads/references", { method: reference ? "PATCH" : "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "저장하지 못했습니다.");
      if (result.warning) { setSavedId(result.id); setMessage(`저장했습니다. ${result.warning}`); return; }
      router.push(`/ads/references/${result.id}`); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "저장 중 오류가 발생했습니다."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const field = "mt-1 block w-full rounded-lg border px-3 py-2";
  return <form onSubmit={submit} className="mt-6 max-w-2xl space-y-4 rounded-xl border bg-white p-6">
    <fieldset disabled={busy || !!savedId} className="space-y-4">
      <label className="block">광고명 *<input name="title" required maxLength={200} defaultValue={reference?.title} className={field} /></label>
      <label className="block">브랜드 *<input name="brand_name" required maxLength={200} defaultValue={reference?.brand_name} className={field} /></label>
      <label className="block">연결 Product (선택)<select name="product_id" defaultValue={reference?.product_id ?? ""} className={field}><option value="">연결 없음</option>{products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
      <label className="block">플랫폼<select name="platform" defaultValue={reference?.platform ?? "meta"} className={field}>{Object.entries(AD_PLATFORMS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="block">소재 유형<select name="media_type" defaultValue={reference?.media_type ?? "image"} className={field}>{Object.entries(AD_MEDIA_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="block">광고 원본 URL<input name="source_url" type="url" maxLength={2048} defaultValue={reference?.source_url ?? ""} className={field} /></label>
      <label className="block">랜딩 URL<input name="landing_url" type="url" maxLength={2048} defaultValue={reference?.landing_url ?? ""} className={field} /></label>
      <label className="block">파일 (선택)<input name="file" type="file" accept={Object.keys(AD_FILE_TYPES).join(",")} className={field} /></label>
      <p className="text-sm text-zinc-500">이미지 JPEG/PNG/WebP 10MB · 영상 MP4/WebM 50MB 이하. 파일 없이 URL만 저장할 수 있습니다.</p>
      {reference?.asset_storage_path && <label className="block text-sm"><input type="checkbox" name="removeAsset" /> 기존 첨부 제거 ({reference.original_file_name}). 새 파일 선택 시 교체합니다.</label>}
      <label className="block">태그 (쉼표로 구분)<input name="tags" defaultValue={reference?.tags.join(", ")} className={field} /></label>
      <label className="block">메모<textarea name="notes" maxLength={20000} rows={6} defaultValue={reference?.notes ?? ""} className={field} /></label>
      <button disabled={busy} className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50">{busy ? "저장 중…" : "저장"}</button>
    </fieldset>
    <Link href={savedId ? `/ads/references/${savedId}` : reference ? `/ads/references/${reference.id}` : "/ads/references"} className="inline-block underline">{savedId ? "저장한 Reference 보기" : "취소"}</Link>
    {message && <p role={savedId ? "status" : "alert"} className="whitespace-pre-wrap break-words">{message}</p>}
  </form>;
}
