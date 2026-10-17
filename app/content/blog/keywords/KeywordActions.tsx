"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
export default function KeywordActions({ id, productId, status }: { id: string; productId: string | number; status: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (status === "used") return null;
  async function changeStatus() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/blog/keywords/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: status === "unused" ? "excluded" : "unused" }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "상태 변경 실패"); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "상태 변경 실패"); } finally { setBusy(false); }
  }
  return <div className="space-y-2">
    {status === "unused" && <Link href={`/content/blog/new?keywordId=${id}&productId=${productId}`} className="block underline">블로그 작업 만들기</Link>}
    <button type="button" disabled={busy} onClick={() => void changeStatus()} className="rounded border px-2 py-1">{busy ? "저장 중…" : status === "unused" ? "제외" : "미사용으로"}</button>
    {error && <p role="alert" className="text-red-600">{error}</p>}
  </div>;
}
