"use client";

import { useState } from "react";
import Link from "next/link";
import { defaultPublicationSchedule, parsePublicationSchedule, seoulScheduleToIso, type PublishMode } from "@/lib/blog-publishing/schedule";

export default function AddPublicationJob({ taskId, draftId }: { taskId: number; draftId: string | number }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [publishMode, setPublishMode] = useState<PublishMode>("manual");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  function selectMode(mode: PublishMode) {
    if (mode === "scheduled" && !date && !time) {
      const initial = defaultPublicationSchedule();
      setDate(initial.date); setTime(initial.time);
    }
    setPublishMode(mode);
  }
  async function add() {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const schedule = publishMode === "scheduled" ? parsePublicationSchedule({ publishMode, scheduledAt: seoulScheduleToIso(date, time) }, true) : {};
      const response = await fetch("/api/blog/publication-jobs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, draftId, ...schedule }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "발행 대기열에 등록하지 못했습니다.");
      setMessage(result.alreadyExists ? `이미 등록된 Job과 기존 발행 설정을 그대로 사용합니다. (${result.job.id})` : `발행 대기열에 추가했습니다. (${result.job.id})`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "발행 대기열에 등록하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4">
    <fieldset disabled={busy} className="mb-3 space-y-2 text-sm">
      <legend className="mb-2 font-medium">발행 방식</legend>
      <div className="flex flex-wrap gap-4">
        {(["manual", "scheduled"] as const).map(mode => <label key={mode} className="flex items-center gap-2">
          <input type="radio" name={`publish-mode-${taskId}-${draftId}`} checked={publishMode === mode} onChange={() => selectMode(mode)} />
          {mode === "manual" ? "일반 발행" : "예약 발행"}
        </label>)}
      </div>
      {publishMode === "scheduled" && <div className="space-y-2">
        <p className="text-zinc-500">네이버 예약 발행에 사용할 날짜와 시간을 지정합니다. Extension이 예약 설정까지 입력하며 최종 발행은 직접 확인 후 진행합니다.</p>
        <div className="flex flex-wrap gap-3">
          <label>예약 날짜 (한국 시간) <input type="date" value={date} onChange={event => setDate(event.target.value)} className="rounded border px-2 py-1" /></label>
          <label>예약 시 <select aria-label="예약 시" value={time.slice(0, 2)} onChange={event => setTime(`${event.target.value}:${time.slice(3)}`)} className="rounded border px-2 py-1">
            {Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")).map(hour => <option key={hour} value={hour}>{hour}</option>)}
          </select></label>
          <label>예약 분 <select aria-label="예약 분" value={time.slice(3)} onChange={event => setTime(`${time.slice(0, 2)}:${event.target.value}`)} className="rounded border px-2 py-1">
            {["00", "10", "20", "30", "40", "50"].map(minute => <option key={minute} value={minute}>{minute}</option>)}
          </select></label>
        </div>
      </div>}
    </fieldset>
    <button type="button" onClick={add} disabled={busy} className="rounded-lg border bg-white px-4 py-2 text-sm disabled:opacity-50">
      {busy ? "등록 중..." : "발행 대기열에 추가"}
    </button>
    {message && <p role="status" className="mt-2 break-words text-sm text-zinc-600">{message} <Link href="/content/blog/publishing" className="underline">발행 대기열 보기</Link></p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  </div>;
}
