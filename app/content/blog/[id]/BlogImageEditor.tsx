"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { DEFAULT_IMAGE_EDIT, applyImagePreset, dragImageRect, editedImageBlob, parseImageEdit, renderEditedImage, type ImageEdit, type ImageRect } from "@/lib/blog-task-assets/edit";
import { scaledBlogImageSize, type BlogTaskAsset } from "@/lib/blog-task-assets";

export default function BlogImageEditor({ taskId, asset, onClose, onSaved }: {
  taskId: string | number; asset: BlogTaskAsset; onClose: () => void; onSaved: () => void;
}) {
  const [settings, setSettings] = useState<ImageEdit>(() => structuredClone(DEFAULT_IMAGE_EDIT));
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [expectedPath, setExpectedPath] = useState(asset.storage_path);
  const [canRestore, setCanRestore] = useState(!!asset.edit_metadata);
  const [estimate, setEstimate] = useState<{ settings: ImageEdit; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [selection, setSelection] = useState<{ mode: "crop" | "blur"; rect: ImageRect } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const originalCanvas = useRef<HTMLCanvasElement>(null), previewCanvas = useRef<HTMLCanvasElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const endpoint = `/api/blog/tasks/${taskId}/assets/${asset.id}/edit`;

  useEffect(() => {
    let active = true, bitmap: ImageBitmap | undefined;
    heading.current?.focus();
    (async () => {
      const response = await fetch(endpoint, { cache: "no-store" }), result = await response.json();
      if (!response.ok) throw new Error(result.error || "사진 편집 조회 실패");
      const source = await fetch(result.originalUrl);
      if (!source.ok) throw new Error("원본 이미지를 읽지 못했습니다.");
      bitmap = await createImageBitmap(await source.blob());
      if (!active) { bitmap.close(); return; }
      setExpectedPath(result.asset.storage_path);
      setCanRestore(!!result.asset.edit_metadata);
      setSettings(result.asset.edit_metadata ? parseImageEdit(result.asset.edit_metadata) : structuredClone(DEFAULT_IMAGE_EDIT));
      setImage(bitmap);
    })().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "이미지 로딩 실패"); });
    return () => { active = false; bitmap?.close(); };
  }, [endpoint]);

  useEffect(() => {
    if (!image || !originalCanvas.current) return;
    const original = originalCanvas.current, size = scaledBlogImageSize(image.width, image.height);
    original.width = size.width; original.height = size.height;
    original.getContext("2d")?.drawImage(image, 0, 0, size.width, size.height);
  }, [image]);

  useEffect(() => {
    if (!image || !previewCanvas.current) return;
    const frame = requestAnimationFrame(() => {
      try {
        if (!previewCanvas.current) return;
        const rendered = renderEditedImage(image, image.width, image.height, settings, 900);
        const preview = previewCanvas.current;
        preview.width = rendered.width; preview.height = rendered.height;
        preview.getContext("2d")?.drawImage(rendered, 0, 0);
      } catch (cause) { setError(cause instanceof Error ? cause.message : "미리보기 실패"); }
    });
    return () => cancelAnimationFrame(frame);
  }, [image, settings]);

  useEffect(() => {
    if (!image || busy) return;
    let active = true;
    // Encode only after interaction settles, and reuse this exact Blob on save.
    const timer = setTimeout(() => {
      try {
        const rendered = renderEditedImage(image, image.width, image.height, settings);
        editedImageBlob(rendered).then(blob => { if (active) setEstimate({ settings, blob }); })
          .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "예상 용량 계산 실패"); });
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "예상 용량 계산 실패"); }
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [image, settings, busy]);

  function point(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) };
  }
  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    if (!image || busy) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    start.current = point(event); setSelection(null);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>, mode: "crop" | "blur") {
    if (start.current) setSelection({ mode, rect: dragImageRect(start.current, point(event)) });
  }
  function finishDrag(event: PointerEvent<HTMLDivElement>, mode: "crop" | "blur") {
    if (!start.current) return;
    const rect = dragImageRect(start.current, point(event)); start.current = null; setSelection(null);
    if (rect.width < 0.005 || rect.height < 0.005) return;
    setSettings(current => mode === "crop" ? { ...current, crop: rect, blurRegions: [] }
      : { ...current, blurRegions: [...current.blurRegions, rect].slice(0, 20) });
  }
  function cancelDrag() { start.current = null; setSelection(null); }

  async function save(restore = false) {
    if (busy || !image) return;
    setBusy(true); setError("");
    try {
      let body: FormData | string;
      if (restore) body = JSON.stringify({ action: "restore", expectedPath });
      else {
        const blob = estimate?.settings === settings ? estimate.blob : await editedImageBlob(renderEditedImage(image, image.width, image.height, settings));
        body = new FormData(); body.set("file", blob, "edited.webp");
        body.set("metadata", JSON.stringify(settings)); body.set("expectedPath", expectedPath);
      }
      const response = await fetch(endpoint, { method: restore ? "PATCH" : "POST", body, ...(restore ? { headers: { "Content-Type": "application/json" } } : {}) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "사진 편집 저장 실패");
      if (restore) { setSettings(structuredClone(DEFAULT_IMAGE_EDIT)); setCanRestore(false); }
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "사진 편집 저장 실패"); }
    finally { setBusy(false); }
  }
  const box = (rect: ImageRect) => ({ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });
  const resultSize = image ? scaledBlogImageSize(image.width * settings.crop.width, image.height * settings.crop.height) : null;
  return <section aria-label="사진 편집" className="my-4 rounded-lg border bg-zinc-50 p-4">
    <h3 ref={heading} tabIndex={-1} className="font-medium">사진 편집 · {asset.file_name}</h3>
    <p className="mt-2 text-sm text-zinc-500">Task 원본으로 편집합니다. Product 원본과 기존 발행 작업은 바뀌지 않습니다.</p>
    {!image && !error && <p role="status">원본 로딩 중...</p>}
    <fieldset disabled={busy || !image} className="mt-3 space-y-4 text-sm">
      <details open><summary>Crop · 원본 위에서 사각 영역 선택</summary>
        <p className="my-2 text-zinc-500">Crop을 바꾸면 Blur 영역은 초기화됩니다.</p>
        <div className="relative touch-none cursor-crosshair" onPointerDown={beginDrag} onPointerMove={event => moveDrag(event, "crop")} onPointerUp={event => finishDrag(event, "crop")} onPointerCancel={cancelDrag}>
          <canvas ref={originalCanvas} className="block h-auto w-full" />
          <div className="pointer-events-none absolute border-2 border-blue-500" style={box(selection?.mode === "crop" ? selection.rect : settings.crop)} />
        </div>
        <button type="button" className="mt-2 rounded border px-2 py-1" onClick={() => setSettings(current => ({ ...current, crop: { ...DEFAULT_IMAGE_EDIT.crop }, blurRegions: [] }))}>Crop 전체 영역</button>
      </details>
      <section aria-label="보정" className="space-y-2"><h4 className="font-medium">보정</h4>
        {([
          ["brightness", "밝기", 50, 150, "%"], ["contrast", "대비", 50, 150, "%"], ["saturation", "채도", 0, 200, "%"],
          ["temperature", "색온도", -100, 100, ""], ["sharpness", "선명도", 0, 100, ""],
        ] as const).map(([key, label, min, max, unit]) => <label key={key} className="block">{label} {settings[key]}{unit}
          <input aria-label={label} type="range" min={min} max={max} value={settings[key]} onChange={event => setSettings(current => ({ ...current, [key]: Number(event.target.value) }))} className="w-full" />
          {key === "temperature" && <span className="flex justify-between text-xs text-zinc-500"><span>차갑게</span><span>따뜻하게</span></span>}
        </label>)}
      </section>
      <section aria-label="효과" className="space-y-3"><h4 className="font-medium">효과</h4>
        <label className="block">필터 <select aria-label="필터" value={settings.filter} onChange={event => setSettings(current => applyImagePreset(current, event.target.value as ImageEdit["filter"]))} className="rounded border p-1">
          {[["none", "원본"], ["vivid", "선명"], ["warm", "따뜻하게"], ["cool", "차갑게"], ["grayscale", "흑백"], ["high-contrast", "고대비"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <p className="text-xs text-zinc-500">필터는 보정값을 설정합니다. 선택 후 슬라이더로 세부 조정할 수 있습니다.</p>
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.border.enabled} onChange={event => setSettings(current => ({ ...current, border: { ...current.border, enabled: event.target.checked } }))} />테두리 사용</label>
        <div className="flex flex-wrap items-center gap-3">
          <label>두께 {settings.border.width}px <input aria-label="테두리 두께" type="range" min={0} max={30} disabled={!settings.border.enabled} value={settings.border.width} onChange={event => setSettings(current => ({ ...current, border: { ...current.border, width: Number(event.target.value) } }))} /></label>
          <label>색상 <input aria-label="테두리 색상" type="color" disabled={!settings.border.enabled} value={settings.border.color} onChange={event => setSettings(current => ({ ...current, border: { ...current.border, color: event.target.value } }))} /></label>
        </div>
      </section>
      <div className="space-y-2"><h4 className="font-medium">워터마크</h4>
        <input aria-label="워터마크 텍스트" placeholder="비어 있으면 사용 안 함" maxLength={100} value={settings.watermark.text} onChange={event => setSettings(current => ({ ...current, watermark: { ...current.watermark, text: event.target.value } }))} className="w-full rounded border p-2" />
        <div className="flex flex-wrap items-center gap-3">
          <label>위치 <select value={settings.watermark.position} onChange={event => setSettings(current => ({ ...current, watermark: { ...current.watermark, position: event.target.value as ImageEdit["watermark"]["position"] } }))} className="rounded border p-1">
            {[["top-left", "좌상"], ["top-right", "우상"], ["center", "중앙"], ["bottom-left", "좌하"], ["bottom-right", "우하"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <label>크기 <input type="number" min={8} max={128} value={settings.watermark.fontSize} onChange={event => setSettings(current => ({ ...current, watermark: { ...current.watermark, fontSize: Number(event.target.value) } }))} className="w-20 rounded border p-1" /></label>
          <label>투명도 <input type="range" min={0} max={1} step={0.05} value={settings.watermark.opacity} onChange={event => setSettings(current => ({ ...current, watermark: { ...current.watermark, opacity: Number(event.target.value) } }))} /></label>
        </div>
      </div>
      <div><p className="font-medium">결과 미리보기 · 사각 드래그로 Blur 추가 ({settings.blurRegions.length}/20)</p>
        <div className="relative mt-2 touch-none cursor-crosshair" onPointerDown={beginDrag} onPointerMove={event => moveDrag(event, "blur")} onPointerUp={event => finishDrag(event, "blur")} onPointerCancel={cancelDrag}>
          <canvas ref={previewCanvas} aria-label="편집 결과 미리보기" className="block h-auto w-full" />
          {selection?.mode === "blur" && <div className="pointer-events-none absolute border-2 border-red-500" style={box(selection.rect)} />}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">{settings.blurRegions.map((_, index) => <button type="button" key={index} className="rounded border px-2 py-1" onClick={() => setSettings(current => ({ ...current, blurRegions: current.blurRegions.filter((_, i) => i !== index) }))}>Blur {index + 1} 제거</button>)}</div>
      </div>
    </fieldset>
    {resultSize && <section aria-label="결과 이미지 정보" className="mt-4 rounded border bg-white p-3 text-sm">
      <h4 className="font-medium">결과</h4>
      <p>{resultSize.width} × {resultSize.height} · WebP</p>
      <p>{estimate?.settings === settings ? `예상 ${Math.max(1, Math.round(estimate.blob.size / 1024))} KB` : "예상 용량 계산 중..."}</p>
      <p className="mt-1 text-xs text-zinc-500">미리보기는 최대 900px로 축소합니다. 저장은 위 결과 크기 기준입니다.</p>
    </section>}
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" disabled={busy || !image || !canRestore} onClick={() => void save(true)} className="rounded border px-3 py-2 text-sm disabled:opacity-40">원본으로 되돌리기</button>
      <button type="button" disabled={busy} onClick={onClose} className="rounded border px-3 py-2 text-sm disabled:opacity-40">취소</button>
      <button type="button" disabled={busy || !image} onClick={() => void save()} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-40">{busy ? "저장 중..." : "저장"}</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
  </section>;
}
