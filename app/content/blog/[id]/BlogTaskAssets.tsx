"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  BLOG_TASK_ASSET_BUCKET, BLOG_TASK_IMAGE_TYPES, blogTaskAssetPath,
  type BlogTaskAsset,
} from "@/lib/blog-task-assets";
import { removeAllBlogTaskAssets } from "@/lib/blog-task-assets/delete";
import { compactBlogImage } from "@/lib/blog-task-assets/compact";

export default function BlogTaskAssets({ taskId, assets, errorMessage }: {
  taskId: string | number;
  assets: BlogTaskAsset[];
  errorMessage?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const uploadedPaths = useRef(new Map<File, string>());
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !files.length || errorMessage) return;
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
    if (inFlight.current || !assets.length || errorMessage) return;
    if (!confirm("이 블로그 작업의 사진을 모두 삭제하시겠습니까? Storage 파일도 함께 삭제됩니다.")) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const count = await removeAllBlogTaskAssets(taskId);
      setSuccess(`${count}장의 사진을 삭제했습니다.`);
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
      <p className="mt-2 text-sm text-zinc-500">총 {assets.length}장 · 업로드 순서대로 글에 삽입됩니다.</p>
      {errorMessage && <p role="alert" className="mt-2 text-red-600">사진 목록 조회 오류: {errorMessage}</p>}
      <ol className="mt-3 list-inside list-decimal text-sm">
        {assets.map((asset) => <li key={asset.id} className="break-words">{asset.file_name}</li>)}
      </ol>
      <form onSubmit={upload} className="mt-5" aria-busy={busy}>
        <input ref={inputRef} type="file" multiple accept={BLOG_TASK_IMAGE_TYPES.join(",")}
          aria-label="사진 선택" disabled={busy || !!errorMessage} className="hidden"
          onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setError(""); }} />
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy || !!errorMessage}
          className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">
          사진 업로드
        </button>
        <p className="mt-2 text-sm text-zinc-500">JPEG, PNG, WebP · 여러 장 선택 가능</p>
        {files.length > 0 && <p className="mt-2 text-sm text-zinc-500">선택한 사진 {files.length}장</p>}
        <button type="submit" disabled={busy || !!errorMessage || !files.length}
          className="mt-3 rounded-lg bg-black px-4 py-2 text-sm text-white disabled:opacity-50">
          {busy ? progress || "처리 중..." : "저장"}
        </button>
      </form>
      <button type="button" onClick={removeAll} disabled={busy || !!errorMessage || !assets.length}
        className="mt-3 rounded-lg border border-red-500 px-4 py-2 text-sm text-red-600 disabled:opacity-50">
        사진 전체 삭제
      </button>
      {error && <p role="alert" className="mt-3 break-words text-sm text-red-600">{error}</p>}
      {success && <p role="status" className="mt-3 text-sm text-zinc-600">{success}</p>}
    </section>
  );
}
