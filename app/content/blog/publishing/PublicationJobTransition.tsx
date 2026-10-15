"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function PublicationJobTransition({ jobId, status }: { jobId: string; status: "inserted" | "failed" | "inserting" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function transition(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busy) return;
    if (status === "failed" && !confirm("네이버에 일부 입력된 내용이 없는지 직접 확인했나요? 같은 본문·사진으로 다시 대기열에 넣습니다. 다음 입력은 처음부터 실행됩니다.")) return;
    if (status === "inserting" && !confirm("기존 Extension 입력이 종료된 것을 확인했나요? 실행 중이라면 복구하지 마세요. 네이버의 부분 입력을 확인·정리한 뒤 같은 자료로 처음부터 다시 입력합니다.")) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/blog/publication-jobs/${jobId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(status === "inserted" ? { action: "publish", publishedUrl: url } : { action: status === "inserting" ? "recover" : "retry" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "상태를 변경하지 못했습니다.");
      setOpen(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "상태를 변경하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 text-sm">
    {status !== "inserted" ? <>
      <p className="mb-2 text-zinc-500">{status === "inserting" ? "입력 시작 후 10분이 지났습니다. 기존 Extension 입력이 종료된 것을 확인하고 네이버의 부분 입력을 정리한 뒤 복구하세요. 자동으로 재실행하지 않습니다." : "네이버의 부분 입력을 확인·정리한 뒤 재시도하세요. 같은 자료를 처음부터 입력합니다."}</p>
      <button type="button" onClick={() => void transition()} disabled={busy} className="rounded-lg border px-4 py-2 disabled:opacity-50">{busy ? "변경 중..." : "다시 대기열로"}</button>
    </> : !open ? <button type="button" onClick={() => setOpen(true)} className="rounded-lg border px-4 py-2">발행 완료 기록</button> : (
      <form onSubmit={transition} className="max-w-xl space-y-3 rounded-lg border p-4">
        <p className="text-zinc-600">네이버에서 실제 발행한 것을 직접 확인한 후 기록하세요. 발행 여부를 자동 확인하지 않습니다.</p>
        <label className="block">발행 URL (선택)
          <input type="url" value={url} onChange={event => setUrl(event.target.value)} disabled={busy} placeholder="https://blog.naver.com/..." className="mt-2 w-full rounded-lg border px-3 py-2" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className="rounded-lg border px-4 py-2 disabled:opacity-50">{busy ? "기록 중..." : "직접 확인한 발행 완료 기록"}</button>
          <button type="button" onClick={() => { setOpen(false); setError(""); }} disabled={busy} className="rounded-lg border px-4 py-2 disabled:opacity-50">취소</button>
        </div>
      </form>
    )}
    {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
  </div>;
}
