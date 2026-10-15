"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RemovePublicationJob({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    if (busy || !confirm("발행 대기열에서 제거할까요? 초안과 사진은 삭제되지 않습니다.")) return;
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
      {busy ? "제거 중..." : "대기열에서 제거"}
    </button>
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </div>;
}
