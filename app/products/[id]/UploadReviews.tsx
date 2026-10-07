"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type ReviewImportBatch = {
  id: string;
  file_name: string | null;
  status: string;
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  error_message: string | null;
  created_at: string;
};

export default function UploadReviews({ productId, reviewCount, latestBatch, queryError }: {
  productId: number;
  reviewCount: number | null;
  latestBatch: ReviewImportBatch | null;
  queryError: string | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (processing) return;
    setError("");
    setMessage("");
    const file = input.current?.files?.[0];
    if (!file || !/\.(csv|xlsx)$/i.test(file.name) || !file.size || file.size > 10 * 1024 * 1024) {
      setError("10MB 이하의 CSV/XLSX 파일 1개를 선택해주세요.");
      return;
    }
    setProcessing(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/products/${productId}/reviews/import`, { method: "POST", body });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "리뷰 가져오기에 실패했습니다.");
      setMessage(`${result.totalRows.toLocaleString()}개 중 ${result.importedRows.toLocaleString()}개 저장 / ${result.skippedRows.toLocaleString()}개 건너뜀`);
      if (input.current) input.current.value = "";
    } catch (error) {
      setError(error instanceof Error ? error.message : "리뷰 가져오기에 실패했습니다.");
    } finally {
      setProcessing(false);
      router.refresh();
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <p>저장된 리뷰: {reviewCount == null ? "조회 불가" : `${reviewCount.toLocaleString()}개`}</p>
      {queryError && <p role="alert" className="text-red-600">{queryError}</p>}
      {latestBatch ? (
        <div className="text-sm text-zinc-600">
          <p>최근 import: {latestBatch.status} · {latestBatch.file_name || "-"}</p>
          <p>{latestBatch.total_rows.toLocaleString()}개 중 {latestBatch.imported_rows.toLocaleString()}개 저장 / {latestBatch.skipped_rows.toLocaleString()}개 건너뜀</p>
          {latestBatch.error_message && <p className="text-red-600">{latestBatch.error_message}</p>}
        </div>
      ) : <p className="text-sm text-zinc-500">아직 가져온 리뷰 파일이 없습니다.</p>}
      <form onSubmit={upload} className="space-y-3">
        <label className="block text-sm">
          CSV/XLSX 리뷰 파일 (최대 10MB · 10,000행)
          <input ref={input} type="file" accept=".csv,.xlsx" disabled={processing} required
            className="mt-2 block w-full rounded-lg border p-2" />
        </label>
        <button type="submit" disabled={processing}
          className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50">
          {processing ? "processing · 가져오는 중..." : "Import Reviews"}
        </button>
      </form>
      {message && <p role="status" className="text-green-700">{message}</p>}
      {error && <p role="alert" className="text-red-600">{error}</p>}
    </div>
  );
}
