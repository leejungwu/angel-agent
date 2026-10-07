"use client";

import { useId, useState, type ReactNode } from "react";

export default function RecentKinTasks({ count, children }: { count: number; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">최근 생성 작업 ({count})</h2>
        <button type="button" aria-expanded={expanded} aria-controls={contentId}
          onClick={() => setExpanded((value) => !value)}
          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">
          {expanded ? "접기" : "펼쳐보기"}
        </button>
      </div>
      <div id={contentId} hidden={!expanded}>{children}</div>
    </section>
  );
}
