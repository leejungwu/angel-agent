"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RemovePublicationJob({ jobId, status = "queued", scheduledAuto = false }: { jobId: string; status?: "queued" | "inserted"; scheduledAuto?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    const warning = status === "inserted"
      ? `Angel Agent의 발행 Job 기록만 삭제합니다. 초안과 사진은 삭제되지 않습니다.\n네이버에 이미 입력되었거나 예약된 글은 취소·삭제되지 않습니다.${scheduledAuto ? "\n네이버 예약 등록이 이미 요청되었을 수 있습니다. 예약 취소는 네이버에서 직접 확인해 주세요." : ""}\nJob 기록을 삭제하시겠습니까?`
      : "발행 대기열에서 제거할까요? 초안과 사진은 삭제되지 않습니다.";
    if (busy || !confirm(warning)) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/blog/publication-jobs/${jobId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "대기열에서 제거하지 못했습니다.");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "대기열에서 제거하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4">
    <button type="button" onClick={remove} disabled={busy} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">
      {busy ? "제거 중..." : status === "inserted" ? "Job 기록 삭제" : "대기열에서 제거"}
    </button>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </div>;
}
