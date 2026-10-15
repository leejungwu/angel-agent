"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BLOG_TASK_ASSET_BUCKET, type BlogTaskAsset } from "@/lib/blog-task-assets";
import { prepareBlogPost } from "@/lib/blog-publishing/preparation";
import { createImageZip, numberedImageFilename, orderedTaskImages } from "@/lib/blog-publishing/downloads";
import type { BlogBody } from "@/lib/blog-generation/body";

export default function PreparationPanel({ taskId, draft, assets, assetError, imagePlacementSettings }: {
  taskId: string; draft: BlogBody & { title: string }; assets: BlogTaskAsset[]; assetError?: string; imagePlacementSettings?: unknown;
}) {
  const photos = orderedTaskImages(taskId, assets);
  const prepared = prepareBlogPost(draft, photos.length, imagePlacementSettings);
  const [includeMarkers, setIncludeMarkers] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewUrls = useRef(new Map<string, string>());
  useEffect(() => {
    const urls = previewUrls.current;
    return () => { urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, []);

  async function copy(title: boolean) {
    setError(""); setFeedback("");
    try {
      await navigator.clipboard.writeText(title ? prepared.title : includeMarkers ? prepared.bodyWithMarkers : prepared.body);
      setFeedback(title ? "제목 복사됨" : "본문 복사됨");
    } catch { setError("클립보드 복사에 실패했습니다. 브라우저의 클립보드 권한을 확인해 주세요."); }
  }

  async function imageBlob(asset: BlogTaskAsset) {
    const { data, error } = await supabase.storage.from(BLOG_TASK_ASSET_BUCKET).download(asset.storage_path);
    if (error || !data?.size) throw new Error(`사진 ${photos.indexOf(asset) + 1} 다운로드 실패`);
    return data;
  }

  function save(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  async function handlePhoto(asset?: BlogTaskAsset, preview = false) {
    setBusy(true); setError(""); setFeedback("");
    try {
      if (asset) {
        const blob = await imageBlob(asset);
        if (preview) {
          const key = String(asset.id), url = URL.createObjectURL(blob);
          const previous = previewUrls.current.get(key);
          if (previous) URL.revokeObjectURL(previous);
          previewUrls.current.set(key, url); setPreviews((current) => ({ ...current, [key]: url }));
        } else save(blob, numberedImageFilename(asset.storage_path, photos.indexOf(asset)));
      } else {
        const files = [];
        for (const [index, photo] of photos.entries()) files.push({
          name: numberedImageFilename(photo.storage_path, index), data: new Uint8Array(await (await imageBlob(photo)).arrayBuffer()),
        });
        save(new Blob([createImageZip(files)], { type: "application/zip" }), `blog-${taskId}-images.zip`);
        setFeedback("사진 ZIP 다운로드 준비됨");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "사진 처리 실패"); }
    finally { setBusy(false); }
  }

  const button = "rounded-lg border bg-white px-4 py-2 text-sm font-medium disabled:opacity-50";
  return <div className="mt-6 space-y-6">
    <p className="rounded-xl border bg-zinc-50 p-4 text-sm leading-7">제목 복사 → 네이버 글쓰기에서 붙여넣기 → 본문 복사·붙여넣기 → 표시 위치에 같은 번호의 사진 삽입 → 직접 검수 후 발행</p>
    <p role="status" className="text-sm text-zinc-600">{feedback}</p>
    {(error || assetError) && <p role="alert" className="text-sm text-red-600">{error || `사진 조회 실패: ${assetError}`}</p>}
    <section className="rounded-xl border bg-white p-6">
      <h2 className="text-sm font-medium text-zinc-500">제목</h2>
      <p className="mt-2 text-2xl font-bold">{prepared.title}</p>
      <button className={`${button} mt-4`} onClick={() => copy(true)}>제목 복사</button>
    </section>
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <section className="rounded-xl border bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-bold">본문 미리보기</h2>
          <button className={button} onClick={() => copy(false)}>본문 복사</button>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={includeMarkers} onChange={(event) => setIncludeMarkers(event.target.checked)} />복사할 본문에 사진 위치 표시 포함</label>
        <div className="mt-6 space-y-5 leading-8">
          {prepared.blocks.map((block, index) => block.type === "text"
            ? <p key={index} className="whitespace-pre-wrap">{block.text}</p>
            : <p key={index} className="border-y border-dashed bg-zinc-50 py-3 text-center text-sm font-medium">📷 사진 {String(block.imageIndex + 1).padStart(2, "0")} 삽입</p>)}
        </div>
      </section>
      <section className="rounded-xl border bg-white p-6">
        <h2 className="text-xl font-bold">사진 목록 ({photos.length})</h2>
        <button className={`${button} mt-4 w-full`} disabled={busy || !!assetError || !photos.length} onClick={() => handlePhoto()}>사진 전체 다운로드 (ZIP)</button>
        {busy && <p role="status" className="mt-2 text-sm text-zinc-500">사진 준비 중...</p>}
        {!photos.length && <p className="mt-4 text-sm text-zinc-500">등록된 사진이 없습니다.</p>}
        <div className="mt-4 space-y-4">{photos.map((asset, index) => <div key={asset.id} className="rounded-lg border p-3">
          <p className="font-medium">사진 {String(index + 1).padStart(2, "0")}</p>
          <p className="mt-1 text-sm text-zinc-500">{numberedImageFilename(asset.storage_path, index)}</p>
          <div className="mt-2 flex gap-2">
            <button className={button} disabled={busy || !!assetError} onClick={() => handlePhoto(asset, true)}>미리보기</button>
            <button className={button} disabled={busy || !!assetError} onClick={() => handlePhoto(asset)}>다운로드</button>
          </div>
          {previews[String(asset.id)] && <Image src={previews[String(asset.id)]} alt={`사진 ${index + 1}`} width={320} height={240} unoptimized className="mt-3 h-auto w-full rounded-lg" />}
        </div>)}</div>
      </section>
    </div>
  </div>;
}
