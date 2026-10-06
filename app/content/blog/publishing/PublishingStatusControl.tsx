"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export type PublishingStatus = null | "queued" | "publishing" | "ready_for_review" | "published" | "failed";

export default function PublishingStatusControl({
  draftId,
  initialStatus,
}: {
  draftId: string | number;
  initialStatus: PublishingStatus;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [updating, setUpdating] = useState(false);
  const [starting, setStarting] = useState(false);
  const inFlight = useRef(false);

  async function toggleQueue() {
    if (inFlight.current || (status !== null && status !== "queued" && status !== "failed" && status !== "publishing")) return;
    inFlight.current = true;
    setUpdating(true);
    const nextStatus = status === "queued" ? null : "queued";

    try {
      let query = supabase
        .from("blog_drafts")
        .update({
          publishing_status: nextStatus,
          ...(status === "failed" || status === "publishing" ? { publishing_error: null } : {}),
        })
        .eq("id", draftId)
        .eq("status", "approved");

      query = status === null
        ? query.is("publishing_status", null)
        : query.eq("publishing_status", status);

      const { data, error } = await query
        .select("id, publishing_status")
        .maybeSingle()
        .returns<{ id: string | number; publishing_status: PublishingStatus }>();

      if (error) {
        alert(error.message);
        return;
      }
      if (!data) {
        alert("초안 상태가 변경되어 처리하지 못했습니다. 최신 상태를 확인해 주세요.");
        router.refresh();
        return;
      }

      setStatus(data.publishing_status);
      router.refresh();
    } catch {
      alert("발행 대기 상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      inFlight.current = false;
      setUpdating(false);
    }
  }

  async function startPublishing() {
    if (inFlight.current || status !== "queued") return;
    const numericDraftId = Number(draftId);
    if (!Number.isFinite(numericDraftId)) {
      alert("초안 ID가 올바르지 않습니다.");
      return;
    }

    inFlight.current = true;
    setStarting(true);
    try {
      const response = await fetch("/api/blog/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: numericDraftId }),
      });
      const result: unknown = await response.json();
      const data = typeof result === "object" && result !== null
        ? result as Record<string, unknown> : null;

      if (!response.ok || data?.ok !== true) {
        alert(typeof data?.error === "string" && data.error.trim()
          ? data.error : "발행 시작에 실패했습니다.");
        return;
      }
      if (data.publishingStatus !== "ready_for_review" || data.result !== "ready_for_review" || data.published !== false) {
        alert("발행 시작에 실패했습니다.");
        return;
      }

      setStatus("ready_for_review");
    } catch {
      alert("발행 시작에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      inFlight.current = false;
      setStarting(false);
      // Also reload failed/conflicting responses so the retry button appears promptly.
      router.refresh();
    }
  }

  return (
    <div className="mt-3" aria-live="polite" aria-busy={updating || starting}>
      <p className="text-sm text-zinc-500">
        발행 상태: {status === "ready_for_review" ? "입력 완료 · 최종 검수 대기" : status ?? "미등록"}
      </p>
      {(status === null || status === "queued" || status === "failed" || status === "publishing") && (
        <button
          type="button"
          onClick={toggleQueue}
          disabled={updating || starting}
          className="mt-2 rounded-lg border bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {updating ? "변경 중..." : status === "failed" ? "다시 시도"
            : status === "publishing" ? "발행 대기로 복구"
            : status === null ? "발행 대기 등록" : "발행 대기 해제"}
        </button>
      )}
      {status === "queued" && (
        <button
          type="button"
          onClick={startPublishing}
          disabled={updating || starting}
          className="ml-2 mt-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {starting ? "발행 시작 중..." : "발행 시작"}
        </button>
      )}
    </div>
  );
}
