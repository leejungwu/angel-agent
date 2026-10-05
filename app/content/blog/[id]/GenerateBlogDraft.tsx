"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export type Draft = {
  title: string;
  intro: string;
  sections: { heading: string; body: string }[];
  closing: string;
  id?: string | number;
  status?: string | null;
  model?: string | null;
  created_at?: string | null;
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

export default function GenerateBlogDraft({
  taskId,
  initialDraft = null,
}: {
  taskId: number;
  initialDraft?: Draft | null;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(initialDraft);
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);

  async function generateDraft() {
    if (inFlight.current || editingDraft) return;
    inFlight.current = true;
    setGenerating(true);
    setSaved(false);

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

      setDraft({
        ...data.draft,
        id: typeof data.draftId === "number" ? data.draftId : undefined,
        status: "draft",
      });
      router.refresh();
    } catch {
      alert("AI 초안 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      inFlight.current = false;
      setGenerating(false);
    }
  }

  function startEditing() {
    if (!draft || draft.id == null || inFlight.current) return;
    setEditingDraft({ ...draft, sections: draft.sections.map((section) => ({ ...section })) });
    setSaved(false);
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDraft || editingDraft.id == null || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);

    const changes = {
      title: editingDraft.title,
      intro: editingDraft.intro,
      sections: editingDraft.sections.map((section) => ({
        heading: section.heading,
        body: section.body,
        imageAssetId: null,
      })),
      closing: editingDraft.closing,
    };

    try {
      const { data, error } = await supabase
        .from("blog_drafts")
        .update(changes)
        .eq("id", editingDraft.id)
        .eq("blog_task_id", taskId)
        .select("id")
        .single();

      if (error || !data) {
        alert(error?.message || "초안을 저장하지 못했습니다.");
        return;
      }

      setDraft({ ...editingDraft, ...changes });
      setEditingDraft(null);
      setSaved(true);
      router.refresh();
    } catch {
      alert("초안을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="mt-8 max-w-2xl">
      <button
        type="button"
        onClick={generateDraft}
        disabled={generating || saving || !!editingDraft}
        className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {generating ? "생성 중..." : draft ? "AI 초안 재생성" : "AI 초안 생성"}
      </button>
      {draft?.id != null && !editingDraft && (
        <button
          type="button"
          onClick={startEditing}
          disabled={generating || saving}
          className="ml-2 rounded-lg border bg-white px-4 py-2 disabled:opacity-50"
        >
          편집
        </button>
      )}
      {saved && <p role="status" className="mt-3 text-sm text-zinc-600">초안을 저장했습니다.</p>}

      {editingDraft && (
        <form onSubmit={saveDraft} className="mt-6 rounded-xl border bg-white p-6">
          <fieldset disabled={saving} className="flex flex-col gap-5">
            <label className="text-sm font-medium">
              제목
              <input
                className="mt-2 w-full rounded-lg border px-4 py-3"
                value={editingDraft.title}
                onChange={(event) => setEditingDraft({ ...editingDraft, title: event.target.value })}
              />
            </label>
            <label className="text-sm font-medium">
              도입
              <textarea
                className="mt-2 min-h-28 w-full rounded-lg border px-4 py-3"
                value={editingDraft.intro}
                onChange={(event) => setEditingDraft({ ...editingDraft, intro: event.target.value })}
              />
            </label>
            {editingDraft.sections.map((section, index) => (
              <div key={index} className="flex flex-col gap-3">
                <label className="text-sm font-medium">
                  섹션 {index + 1} 제목
                  <input
                    className="mt-2 w-full rounded-lg border px-4 py-3"
                    value={section.heading}
                    onChange={(event) => setEditingDraft({
                      ...editingDraft,
                      sections: editingDraft.sections.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, heading: event.target.value } : item),
                    })}
                  />
                </label>
                <label className="text-sm font-medium">
                  섹션 {index + 1} 본문
                  <textarea
                    className="mt-2 min-h-40 w-full rounded-lg border px-4 py-3"
                    value={section.body}
                    onChange={(event) => setEditingDraft({
                      ...editingDraft,
                      sections: editingDraft.sections.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, body: event.target.value } : item),
                    })}
                  />
                </label>
              </div>
            ))}
            <label className="text-sm font-medium">
              마무리
              <textarea
                className="mt-2 min-h-28 w-full rounded-lg border px-4 py-3"
                value={editingDraft.closing}
                onChange={(event) => setEditingDraft({ ...editingDraft, closing: event.target.value })}
              />
            </label>
            <div className="flex gap-2">
              <button type="submit" className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50">
                {saving ? "저장 중..." : "저장"}
              </button>
              <button
                type="button"
                onClick={() => setEditingDraft(null)}
                className="rounded-lg border px-4 py-2"
              >
                취소
              </button>
            </div>
          </fieldset>
        </form>
      )}

      <div aria-live="polite" aria-busy={generating || saving}>
        {draft && !editingDraft && (
          <article className="mt-6 rounded-xl border bg-white p-6">
            <h2 className="text-xl font-bold">{draft.title}</h2>
            <p className="mt-2 text-sm text-zinc-500">
              상태: {draft.status || "-"} · 모델: {draft.model || "-"} · 생성일: {draft.created_at
                ? new Date(draft.created_at).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })
                : "-"}
            </p>
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
