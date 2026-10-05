"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export type PublishingStatus = null | "queued" | "publishing" | "published" | "failed";

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
  const inFlight = useRef(false);

  async function toggleQueue() {
    if (inFlight.current || (status !== null && status !== "queued")) return;
    inFlight.current = true;
    setUpdating(true);
    const nextStatus = status === null ? "queued" : null;

    try {
      let query = supabase
        .from("blog_drafts")
        .update({ publishing_status: nextStatus })
        .eq("id", draftId)
        .eq("status", "approved");

      query = status === null
        ? query.is("publishing_status", null)
        : query.eq("publishing_status", "queued");

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

  return (
    <div className="mt-3" aria-live="polite" aria-busy={updating}>
      <p className="text-sm text-zinc-500">발행 상태: {status ?? "미등록"}</p>
      {(status === null || status === "queued") && (
        <button
          type="button"
          onClick={toggleQueue}
          disabled={updating}
          className="mt-2 rounded-lg border bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {updating ? "변경 중..." : status === null ? "발행 대기 등록" : "발행 대기 해제"}
        </button>
      )}
    </div>
  );
}
