"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Draft = {
  title: string;
  intro: string;
  sections: { heading: string; body: string }[];
  closing: string;
};

function isDraft(value: unknown): value is Draft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Record<string, unknown>;
  return typeof draft.title === "string" &&
    typeof draft.intro === "string" &&
    typeof draft.closing === "string" &&
    Array.isArray(draft.sections) && draft.sections.length > 0 &&
    draft.sections.every((section: unknown) => {
      if (typeof section !== "object" || section === null) return false;
      const item = section as Record<string, unknown>;
      return typeof item.heading === "string" && typeof item.body === "string";
    });
}

export default function GenerateBlogDraft({ taskId }: { taskId: number }) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const inFlight = useRef(false);

  async function generateDraft() {
    if (inFlight.current) return;
    inFlight.current = true;
    setGenerating(true);

    try {
      const response = await fetch("/api/blog/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      });
      const result: unknown = await response.json();

      if (typeof result !== "object" || result === null) {
        alert("AI 초안 생성에 실패했습니다.");
        return;
      }
      const data = result as Record<string, unknown>;
      if (!response.ok || data.ok !== true) {
        alert(typeof data.error === "string" && data.error.trim()
          ? data.error : "AI 초안 생성에 실패했습니다.");
        return;
      }
      if (!isDraft(data.draft)) {
        alert("AI 초안 생성에 실패했습니다.");
        return;
      }

      setDraft(data.draft);
      router.refresh();
    } catch {
      alert("AI 초안 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      inFlight.current = false;
      setGenerating(false);
    }
  }

  return (
    <div className="mt-8 max-w-2xl">
      <button
        type="button"
        onClick={generateDraft}
        disabled={generating}
        className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {generating ? "생성 중..." : "AI 초안 생성"}
      </button>

      <div aria-live="polite" aria-busy={generating}>
        {draft && (
          <article className="mt-6 rounded-xl border bg-white p-6">
            <h2 className="text-xl font-bold">{draft.title}</h2>
            <section className="mt-6">
              <h3 className="font-semibold">도입</h3>
              <p className="mt-2 whitespace-pre-wrap break-words">{draft.intro}</p>
            </section>
            {draft.sections.map((section, index) => (
              <section key={index} className="mt-6">
                <h3 className="font-semibold">{section.heading}</h3>
                <p className="mt-2 whitespace-pre-wrap break-words">{section.body}</p>
              </section>
            ))}
            <section className="mt-6">
              <h3 className="font-semibold">마무리</h3>
              <p className="mt-2 whitespace-pre-wrap break-words">{draft.closing}</p>
            </section>
          </article>
        )}
      </div>
    </div>
  );
}
