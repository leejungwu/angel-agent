"use client";

import { useState } from "react";
import Link from "next/link";

export default function AddPublicationJob({ taskId, draftId }: { taskId: number; draftId: string | number }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function add() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/blog/publication-jobs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, draftId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "발행 대기열에 등록하지 못했습니다.");
      setMessage(result.alreadyExists ? `이미 등록된 Job을 사용합니다. (${result.job.id})` : `발행 대기열에 추가했습니다. (${result.job.id})`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "발행 대기열에 등록하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4">
    <button type="button" onClick={add} disabled={busy} className="rounded-lg border bg-white px-4 py-2 text-sm disabled:opacity-50">
      {busy ? "등록 중..." : "발행 대기열에 추가"}
    </button>
    {message && <p role="status" className="mt-2 break-words text-sm text-zinc-600">{message} <Link href="/content/blog/publishing" className="underline">발행 대기열 보기</Link></p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </div>;
}
