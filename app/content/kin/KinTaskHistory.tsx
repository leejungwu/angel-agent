"use client";

import { useRef, useState } from "react";

type HistoricalDraft = { id: string; answer: string; question_intent: string | null; provider: string | null; model: string | null; created_at: string };

export default function KinTaskHistory({ taskId, question }: { taskId: string; question: string }) {
  const [expanded, setExpanded] = useState(false);
  const [drafts, setDrafts] = useState<HistoricalDraft[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const selected = drafts?.find((draft) => draft.id === selectedId);
  async function open() {
    if (expanded) { setExpanded(false); return; }
    setExpanded(true);
    if (inFlight.current) return;
    inFlight.current = true; setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/kin/tasks/${taskId}/drafts`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "답변 조회 실패");
      setDrafts(data.drafts); setSelectedId(data.drafts[0]?.id ?? "");
    } catch (error) { setMessage(error instanceof Error ? error.message : "답변 조회 실패"); }
    finally { inFlight.current = false; setLoading(false); }
  }
  async function copy() {
    if (!selected) return;
    try { await navigator.clipboard.writeText(selected.answer); setMessage("답변을 복사했습니다."); }
    catch { setMessage("복사 실패: 아래 답변을 선택해 직접 복사해 주세요."); }
  }
  return <div>
    <button type="button" aria-expanded={expanded} onClick={() => void open()} className="w-full text-left text-sm font-medium underline decoration-zinc-300 underline-offset-4">{question}</button>
    {expanded && <div className="mt-4 space-y-3 border-t pt-4">
      {loading ? <p role="status" className="text-sm">답변 불러오는 중...</p> : drafts?.length === 0 ? <p className="text-sm text-zinc-500">저장된 답변 없음</p> : null}
      {!!drafts?.length && <label className="block text-sm">Draft 선택
        <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setMessage(""); }} className="mt-2 w-full rounded-lg border px-3 py-2">
          {drafts.map((draft) => <option key={draft.id} value={draft.id}>{new Date(draft.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · {draft.model ?? "모델 기록 없음"} · {draft.id}</option>)}
        </select>
      </label>}
      {selected && <>
        <p className="text-sm text-zinc-600">질문 의도: {selected.question_intent || "기록 없음"}</p>
        <p className="text-xs text-zinc-500">제공자: {selected.provider || "기록 없음"} · 모델: {selected.model || "기록 없음"} · 생성일: {new Date(selected.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
        <textarea aria-label="이전 지식인 답변" readOnly rows={14} value={selected.answer} className="w-full rounded-lg border bg-zinc-50 p-4 text-sm leading-7" />
        <button type="button" onClick={() => void copy()} className="rounded-lg border px-4 py-2 text-sm">답변 복사</button>
      </>}
      {message && <p role="status" className="text-sm text-zinc-600">{message}</p>}
    </div>}
  </div>;
}
