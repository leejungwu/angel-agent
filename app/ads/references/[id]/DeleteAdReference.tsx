"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
export default function DeleteAdReference({ id, updatedAt }: { id: string; updatedAt: string }) {
  const router = useRouter(), inFlight = useRef(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [removed, setRemoved] = useState(false);
  async function remove() {
    if (inFlight.current || removed || !window.confirm("광고 Reference와 첨부 파일을 삭제하시겠습니까?")) return;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/ads/references/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updatedAt }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "삭제 실패");
      if (result.warning) { setRemoved(true); setMessage(`Reference를 삭제했습니다. ${result.warning}`); return; }
      router.push("/ads/references"); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "삭제에 실패했습니다."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div><button onClick={remove} disabled={busy || removed} className="rounded-lg border px-4 py-2 text-red-600">{busy ? "삭제 중…" : "삭제"}</button>
    {message && <p role={removed ? "status" : "alert"}>{message}</p>}{removed && <Link href="/ads/references" className="underline">목록으로</Link>}</div>;
}
