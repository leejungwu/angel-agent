"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteBlogTaskButton({
  taskId,
  redirectToList = false,
}: {
  taskId: string | number;
  redirectToList?: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const inFlight = useRef(false);

  async function deleteTask() {
    if (inFlight.current) return;
    if (!confirm("이 블로그 작업과 연결된 초안을 모두 삭제하시겠습니까?")) return;
    inFlight.current = true;
    setDeleting(true);

    try {
      const response = await fetch(`/api/blog/tasks/${encodeURIComponent(String(taskId))}`, {
        method: "DELETE",
      });
      const result: unknown = await response.json();
      const data = typeof result === "object" && result !== null
        ? result as Record<string, unknown> : null;
      if (!response.ok || data?.ok !== true) {
        alert(typeof data?.error === "string" && data.error.trim()
          ? data.error : "블로그 작업을 삭제하지 못했습니다.");
        return;
      }
      if (redirectToList) router.push("/content/blog");
      router.refresh();
    } catch {
      alert("블로그 작업을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={deleteTask}
      disabled={deleting}
      className="rounded-lg border border-red-500 px-4 py-2 text-sm text-red-500 disabled:opacity-50"
    >
      {deleting ? "삭제 중..." : "작업 삭제"}
    </button>
  );
}
