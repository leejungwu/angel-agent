"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  BLOG_TASK_ASSET_BUCKET, BLOG_TASK_IMAGE_TYPES, blogTaskAssetPath,
  type BlogTaskAsset,
} from "@/lib/blog-task-assets";
import { compactBlogImage } from "@/lib/blog-task-assets/compact";
import ImagePlacementSettings from "./ImagePlacementSettings";
import { orderedTaskImages } from "@/lib/blog-publishing/downloads";
import BlogImageEditor from "./BlogImageEditor";

type ProductPhoto = { id: string | number; file_name: string | null; previewUrl: string; added: boolean };

export default function BlogTaskAssets({ taskId, assets, errorMessage, imagePlacementSettings }: {
  taskId: string | number;
  assets: BlogTaskAsset[];
  errorMessage?: string;
  imagePlacementSettings?: unknown;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const inFlight = useRef(false);
  const uploadedPaths = useRef(new Map<File, string>());
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [productPhotos, setProductPhotos] = useState<ProductPhoto[] | null>(null);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [photos, setPhotos] = useState(() => orderedTaskImages(taskId, assets));
  const desiredOrder = useRef(photos);
  const confirmedOrder = useRef(photos);
  const savingOrder = useRef(false);
  const [reordering, setReordering] = useState(false);
  const [editing, setEditing] = useState<BlogTaskAsset | null>(null);
  const listBusy = busy || reordering || !!editing;

  useEffect(() => {
    if (savingOrder.current) return;
    const current = orderedTaskImages(taskId, assets);
    desiredOrder.current = current;
    confirmedOrder.current = current;
    setPhotos(current);
  }, [taskId, assets]);

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  useEffect(() => {
    let active = true;
    Promise.all(assets.map(async asset => {
      const { data } = await supabase.storage.from(BLOG_TASK_ASSET_BUCKET).createSignedUrl(asset.storage_path, 600);
      return [String(asset.id), data?.signedUrl ?? ""] as const;
    })).then(entries => { if (active) setPreviews(Object.fromEntries(entries)); })
      .catch(() => { if (active) setPreviews({}); });
    return () => { active = false; };
  }, [assets]);

  async function manage(path: string, method: string, body?: unknown) {
    if (inFlight.current || savingOrder.current || editing || errorMessage) return;
    inFlight.current = true; setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/blog/tasks/${taskId}/assets${path}`, {
        method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "사진 관리 요청 실패");
      if (method === "GET") { setProductPhotos(result.images); setSelectedProductIds([]); }
      else {
        setSuccess(method === "POST" ? `${result.added}장의 제품 사진을 추가했습니다.`
          : method === "DELETE" ? result.preserved > 0
            ? "Task에서 사진을 제거했습니다. 기존 발행 작업에서 사용하는 원본 파일은 보존됩니다."
            : "사진을 삭제했습니다."
          : "사진 목록을 저장했습니다.");
        setProductPhotos(null); router.refresh();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "사진 관리 요청 실패"); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function saveOrder() {
    if (savingOrder.current) return;
    savingOrder.current = true; setReordering(true);
    const sameOrder = (a: BlogTaskAsset[], b: BlogTaskAsset[]) => a.every((asset, index) => String(asset.id) === String(b[index]?.id)) && a.length === b.length;
    try {
      while (!sameOrder(desiredOrder.current, confirmedOrder.current)) {
        const sent = desiredOrder.current;
        const response = await fetch(`/api/blog/tasks/${taskId}/assets/order`, {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetIds: sent.map(asset => String(asset.id)) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "사진 순서를 저장하지 못했습니다.");
        confirmedOrder.current = sent;
      }
      setSuccess("사진 순서를 저장했습니다.");
    } catch (cause) {
      desiredOrder.current = confirmedOrder.current;
      setPhotos(confirmedOrder.current);
      setError(cause instanceof Error ? cause.message : "사진 순서를 저장하지 못했습니다.");
    } finally { savingOrder.current = false; setReordering(false); }
  }

  function move(assetId: string | number, delta: number) {
    if (inFlight.current || editing || errorMessage) return;
    const next = [...desiredOrder.current];
    const index = next.findIndex(asset => String(asset.id) === String(assetId));
    if (index < 0 || index + delta < 0 || index + delta >= next.length) return;
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    desiredOrder.current = next;
    setPhotos(next); setError(""); setSuccess("");
    void saveOrder();
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || savingOrder.current || editing || !files.length || errorMessage) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    let completed = 0;
    let current: File | undefined;
    try {
      const invalid = files.find((file) => !BLOG_TASK_IMAGE_TYPES.includes(file.type) || file.size === 0);
      if (invalid) throw new Error(`${invalid.name}: 비어 있지 않은 JPEG, PNG, WebP 이미지만 업로드할 수 있습니다.`);
      const { data: last, error: lookupError } = await supabase.from("blog_task_assets")
        .select("sort_order").eq("blog_task_id", taskId)
        .order("sort_order", { ascending: false }).order("id", { ascending: false })
        .limit(1).maybeSingle();
      if (lookupError) throw new Error(`기존 사진 조회 실패: ${lookupError.message}`);
      const firstSortOrder = last ? last.sort_order + 1 : 0;
      const storage = supabase.storage.from(BLOG_TASK_ASSET_BUCKET);
      for (const file of files) {
        current = file;
        setProgress(`${completed + 1}/${files.length} 업로드 중...`);
        let path = uploadedPaths.current.get(file);
        if (!path) {
          let image: Blob;
          try { image = await compactBlogImage(file); }
          catch (cause) { throw new Error(`이미지 압축 실패: ${cause instanceof Error ? cause.message : "파일을 읽지 못했습니다."}`); }
          path = blogTaskAssetPath(taskId, crypto.randomUUID(), file.name, image.type);
          const { error: uploadError } = await storage.upload(path, image, { contentType: image.type, upsert: false });
          if (uploadError) {
            const { error: cleanupError } = await storage.remove([path]);
            if (cleanupError) throw new Error(`Storage 업로드 실패; 파일 상태 확인 필요 (${path}): ${uploadError.message}`);
            throw new Error(`Storage 업로드 실패: ${uploadError.message}`);
          }
          uploadedPaths.current.set(file, path);
        }
        const { error: insertError } = await supabase.from("blog_task_assets").insert({
          blog_task_id: taskId, storage_path: path, file_name: file.name,
          sort_order: firstSortOrder + completed,
        });
        if (insertError) {
          const { data: present, error: checkError } = await supabase.from("blog_task_assets")
            .select("id").eq("blog_task_id", taskId).eq("storage_path", path).maybeSingle();
          if (checkError) throw new Error(`사진 정보 저장 상태 확인 실패 (${path}). 다시 시도하기 전에 확인해 주세요.`);
          if (present) {
            uploadedPaths.current.delete(file);
            completed++;
            continue;
          }
          const { error: cleanupError } = await storage.remove([path]);
          if (cleanupError) {
            throw new Error(`사진 정보 저장 실패. Storage 정리도 실패했습니다 (${path}): ${cleanupError.message}`);
          }
          uploadedPaths.current.delete(file);
          throw new Error(`사진 정보 저장 실패: ${insertError.message}`);
        }
        uploadedPaths.current.delete(file);
        completed++;
      }
      setFiles([]);
      if (inputRef.current) inputRef.current.value = "";
    } catch (cause) {
      setFiles(files.slice(completed));
      setError(`${current ? `${current.name}: ` : ""}${cause instanceof Error ? cause.message : "사진 업로드 실패"}`);
    } finally {
      if (completed) setSuccess(`${completed}장의 사진을 저장했습니다.`);
      setProgress("");
      inFlight.current = false;
      setBusy(false);
      router.refresh();
    }
  }

  async function removeAll() {
    if (inFlight.current || savingOrder.current || editing || !assets.length || errorMessage) return;
    if (!confirm("이 블로그 작업의 사진을 모두 제거하시겠습니까? 기존 발행 작업에서 사용하는 원본 파일은 보존됩니다.")) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/blog/tasks/${taskId}/assets`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "사진을 삭제하지 못했습니다.");
      setSuccess(result.preserved > 0
        ? `Task에서 ${result.deleted}장의 사진을 제거했습니다. 기존 발행 작업에서 사용하는 원본 파일 ${result.preserved}개는 보존됩니다.`
        : `${result.deleted}장의 사진을 삭제했습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "사진 삭제 실패");
    } finally {
      inFlight.current = false;
      setBusy(false);
      router.refresh();
    }
  }

  return (
    <section className="mt-8 max-w-2xl rounded-xl border bg-white p-6">
      <h2 className="text-xl font-semibold">블로그 사진</h2>
      <p className="mt-2 text-sm text-zinc-500">총 {assets.length}장 · 아래 순서대로 글에 삽입됩니다. 기존 대기열의 사진은 바뀌지 않습니다.</p>
      <ImagePlacementSettings key={`placement-${taskId}`} taskId={taskId} initialSettings={imagePlacementSettings} />
      {errorMessage && <p role="alert" className="mt-2 text-red-600">사진 목록 조회 오류: {errorMessage}</p>}
      {editing && <BlogImageEditor key={`editor-${editing.id}`} taskId={taskId} asset={editing} onClose={() => setEditing(null)} onSaved={() => {
        setEditing(null); setSuccess("사진을 저장했습니다. 기존 발행 작업은 유지됩니다."); router.refresh();
      }} />}
      <ol className="mt-3 space-y-3 text-sm">
        {photos.map((asset, index) => <li key={asset.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
          {previews[String(asset.id)] && <a href={previews[String(asset.id)]} target="_blank" rel="noreferrer" aria-label={`${asset.file_name} 미리보기`}>
            {/* Signed Storage previews expire; keep the original image URL without optimization. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previews[String(asset.id)]} alt={asset.file_name} className="h-16 w-16 rounded object-cover" />
          </a>}
          <span className="min-w-0 flex-1 break-words">사진 {String(index + 1).padStart(2, "0")} · {asset.file_name}<span className="block text-xs text-zinc-500">상태: {asset.edit_metadata ? "편집본" : "원본"}</span></span>
          <div className="flex gap-2">
            <button type="button" disabled={busy || !!editing || !!errorMessage || index === 0} onClick={() => move(asset.id, -1)} className="rounded border px-2 py-1 disabled:opacity-40">위로</button>
            <button type="button" disabled={busy || !!editing || !!errorMessage || index === photos.length - 1} onClick={() => move(asset.id, 1)} className="rounded border px-2 py-1 disabled:opacity-40">아래로</button>
            <button type="button" disabled={listBusy || !!errorMessage} onClick={() => { setEditing(asset); setError(""); }} className="rounded border px-2 py-1 disabled:opacity-40">편집</button>
            <button type="button" disabled={listBusy || !!errorMessage} onClick={() => {
              if (confirm(`${asset.file_name} 사진을 삭제하시겠습니까?`)) void manage(`/${asset.id}`, "DELETE");
            }} className="rounded border px-2 py-1 text-red-600 disabled:opacity-40">삭제</button>
          </div>
        </li>)}
      </ol>
      <button type="button" disabled={listBusy || !!errorMessage} onClick={() => void manage("/product", "GET")} className="mt-4 rounded-lg border px-4 py-2 text-sm disabled:opacity-50">제품 사진에서 추가</button>
      {productPhotos && <fieldset disabled={listBusy} className="mt-3 rounded-lg border p-3 text-sm">
        <legend>연결된 제품 사진</legend>
        {!productPhotos.length && <p>추가할 제품 사진이 없습니다.</p>}
        <div className="space-y-2">{productPhotos.map(photo => <label key={photo.id} className="flex items-center gap-3">
          <input type="checkbox" disabled={photo.added} checked={selectedProductIds.includes(String(photo.id))} onChange={event => setSelectedProductIds(current => event.target.checked ? [...current, String(photo.id)] : current.filter(id => id !== String(photo.id)))} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo.previewUrl} alt={photo.file_name || "제품 사진"} className="h-12 w-12 rounded object-cover" />
          <span className="break-words">{photo.file_name || "제품 사진"}{photo.added ? " · 이미 추가됨" : ""}</span>
        </label>)}</div>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={!selectedProductIds.length} onClick={() => void manage("/product", "POST", { assetIds: selectedProductIds })} className="rounded border px-3 py-1 disabled:opacity-40">선택 사진 추가</button>
          <button type="button" onClick={() => setProductPhotos(null)} className="rounded border px-3 py-1">취소</button>
        </div>
      </fieldset>}
      {reordering && <p role="status" className="mt-3 text-sm text-zinc-500">사진 순서 저장 중...</p>}
      <form onSubmit={upload} className="mt-5" aria-busy={listBusy}>
        <input ref={inputRef} type="file" multiple accept={BLOG_TASK_IMAGE_TYPES.join(",")}
          aria-label="사진 선택" disabled={listBusy || !!errorMessage} className="hidden"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            setFiles((current) => [...current, ...selected]);
            event.target.value = "";
            setError("");
          }} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={listBusy || !!errorMessage}
          className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">
          사진 업로드
        </button>
        <p className="mt-2 text-sm text-zinc-500">JPEG, PNG, WebP · 여러 장 선택 가능</p>
        {files.length > 0 && <p className="mt-2 text-sm text-zinc-500">선택한 사진 {files.length}장</p>}
        {files.length > 0 && (
          <ol className="mt-3 list-inside list-decimal text-sm text-zinc-500">
            {files.map((file, index) => (
              <li key={index} className="break-words">
                {file.name}
                <button type="button" aria-label={`${file.name} 선택 해제`} disabled={busy}
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  className="ml-2 rounded px-1 text-red-600 disabled:opacity-50">×</button>
              </li>
            ))}
          </ol>
        )}
        <button type="submit" disabled={listBusy || !!errorMessage || !files.length}
          className="mt-3 rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50">
          {busy ? progress || "처리 중..." : "저장"}
        </button>
      </form>
      <button type="button" onClick={removeAll} disabled={listBusy || !!errorMessage || !assets.length}
        className="mt-3 rounded-lg border border-red-500 px-4 py-2 text-sm text-red-600 disabled:opacity-50">
        사진 전체 삭제
      </button>
      {error && <p ref={errorRef} tabIndex={-1} role="alert" className="mt-3 break-words text-sm text-red-600">{error}</p>}
      {success && <p role="status" className="mt-3 text-sm text-zinc-600">{success}</p>}
    </section>
  );
}
