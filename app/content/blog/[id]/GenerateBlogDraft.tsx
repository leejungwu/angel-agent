"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { AIProvider } from "@/lib/ai/provider";
import { checkBlogBodyLength } from "@/lib/blog-generation/body";
import { BLOG_MODEL_OPTIONS, BLOG_DEFAULT_MODELS, resolveBlogModel } from "@/lib/blog-generation/models";
import type { BlogPreset } from "@/lib/blog-generation/presets";
import { readBlogGenerationSnapshot } from "@/lib/blog-generation/snapshot";
import BlogPresetControl from "./BlogPresetControl";
import BlogGenerationDetails from "./BlogGenerationDetails";
import AddPublicationJob from "./AddPublicationJob";

export type Draft = {
  title: string;
  intro: string;
  sections: { heading: string; body: string }[];
  closing: string;
  id?: string | number;
  status?: string | null;
  model?: string | null;
  provider?: AIProvider;
  created_at?: string | null;
  generation_snapshot?: unknown;
};

const PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI", anthropic: "Claude", xai: "Grok",
};

// Older drafts have no provider field; resolve known model families on reload.
function providerFromModel(model?: string | null): AIProvider | undefined {
  if (model?.startsWith("claude-")) return "anthropic";
  if (model?.startsWith("grok-")) return "xai";
  if (model && /^(gpt-|o[134](?:-|$))/.test(model)) return "openai";
  return undefined;
}

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

function formatCreatedAt(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "생성일시 확인 불가";
  return new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export default function GenerateBlogDraft({
  taskId,
  initialDraft = null,
  initialPresetId = "",
  initialPresets = [],
  initialDrafts = [],
}: {
  taskId: number;
  initialDraft?: Draft | null;
  initialPresetId?: string;
  initialPresets?: BlogPreset[];
  initialDrafts?: Draft[];
}) {
  const router = useRouter();
  const [presetId, setPresetId] = useState(initialPresetId || initialPresets.find((item) => item.is_default)?.id || "");
  const [presetBusy, setPresetBusy] = useState(false);
  const [provider, setProvider] = useState<AIProvider>(initialDraft?.provider ?? providerFromModel(initialDraft?.model) ?? "openai");
  const [model, setModel] = useState(() => resolveBlogModel(provider, initialDraft?.model) ?? BLOG_DEFAULT_MODELS[provider]);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(initialDraft);
  const [sessionDrafts, setSessionDrafts] = useState<Draft[]>([]);
  const [editingDraft, setEditingDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [changingStatus, setChangingStatus] = useState(false);
  const inFlight = useRef(false);
  const actualProvider = draft?.provider ?? providerFromModel(draft?.model);
  const visibleDraft = editingDraft ?? draft;
  const snapshot = readBlogGenerationSnapshot(visibleDraft?.generation_snapshot);
  const bodyLength = visibleDraft ? checkBlogBodyLength(visibleDraft, snapshot?.preset) : null;
  const historyMap = new Map<string, Draft>();
  for (const item of [...initialDrafts, ...(initialDraft ? [initialDraft] : []), ...sessionDrafts]) {
    if (item.id != null) historyMap.set(String(item.id), item);
  }
  const history = [...historyMap.values()].sort((a, b) =>
    (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0) || String(b.id).localeCompare(String(a.id), "en", { numeric: true }));
  const controlsBusy = generating || saving || presetBusy || changingStatus || !!editingDraft;
  function rememberDraft(value: Draft) {
    setDraft(value);
    setSessionDrafts((current) => [...current.filter((item) => String(item.id) !== String(value.id)), value]);
  }

  async function generateDraft() {
    if (inFlight.current || editingDraft || presetBusy) return;
    inFlight.current = true;
    setGenerating(true);
    setSaved(false);

    try {
      const response = await fetch("/api/blog/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, presetId: presetId || null, provider, model }),
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

      rememberDraft({
        ...data.draft,
        id: typeof data.draftId === "number" || typeof data.draftId === "string" ? data.draftId : undefined,
        created_at: typeof data.createdAt === "string" ? data.createdAt : null,
        generation_snapshot: data.generationSnapshot,
        status: "draft",
        model: typeof data.model === "string" ? data.model : undefined,
        provider: data.provider === "openai" || data.provider === "anthropic" || data.provider === "xai"
          ? data.provider : undefined,
      });
      router.refresh();
    } catch (error) {
      alert(error instanceof Error ? error.message : "AI 초안 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.");
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

      rememberDraft({ ...editingDraft, ...changes });
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

  async function changeStatus(status: "draft" | "approved" | "rejected") {
    if (!draft || draft.id == null || editingDraft || inFlight.current) return;
    inFlight.current = true;
    setChangingStatus(true);
    setSaved(false);

    try {
      const { data, error } = await supabase
        .from("blog_drafts")
        .update({ status })
        .eq("id", draft.id)
        .eq("blog_task_id", taskId)
        .select("id, status")
        .single();

      if (error || !data) {
        alert(error?.message || "초안 상태를 변경하지 못했습니다.");
        return;
      }

      rememberDraft({ ...draft, status: data.status });
      router.refresh();
    } catch {
      alert("초안 상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      inFlight.current = false;
      setChangingStatus(false);
    }
  }

  return (
    <div className="mt-8 max-w-2xl">
      <BlogPresetControl initialPresets={initialPresets} selectedId={presetId}
        onSelect={(preset) => setPresetId(preset?.id ?? "")} onBusy={setPresetBusy}
        disabled={generating || saving || presetBusy || changingStatus || !!editingDraft} />
      <fieldset disabled={generating || saving || presetBusy || changingStatus || !!editingDraft} className="mb-4 flex gap-4">
        <legend className="mb-2 text-sm font-medium">생성에 사용할 AI 제공자</legend>
        {([{ value: "openai", label: "OpenAI" }, { value: "anthropic", label: "Claude" }, { value: "xai", label: "Grok" }] as const).map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <input type="radio" name="blog-provider" value={option.value} checked={provider === option.value}
              onChange={() => {
                setProvider(option.value);
                setModel(BLOG_DEFAULT_MODELS[option.value]);
              }} />
            {option.label}
          </label>
        ))}
      </fieldset>
      <label className="mb-3 block text-sm font-medium">
        모델
        <select value={model} onChange={(event) => setModel(event.target.value)}
          disabled={generating || saving || presetBusy || changingStatus || !!editingDraft}
          className="mt-2 block rounded-lg border px-4 py-3">
          {BLOG_MODEL_OPTIONS[provider].map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <p className="mb-3 text-sm text-zinc-500">{PROVIDER_LABELS[provider]}로 {draft ? "재생성" : "생성"}합니다.</p>
      <button
        type="button"
        onClick={generateDraft}
        disabled={generating || saving || presetBusy || changingStatus || !!editingDraft}
        className="rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50"
      >
        {generating ? "생성 중..." : draft ? "AI 초안 재생성" : "AI 초안 생성"}
      </button>
      {draft?.id != null && !editingDraft && (
        <button
          type="button"
          onClick={startEditing}
          disabled={generating || saving || presetBusy || changingStatus}
          className="ml-2 rounded-lg border bg-white px-4 py-2 disabled:opacity-50"
        >
          편집
        </button>
      )}
      {draft?.id != null && !editingDraft && (
        <div className="mt-3 flex items-center gap-2">
          {draft.status === "draft" && (
            <>
              <button
                type="button"
                onClick={() => changeStatus("approved")}
                disabled={generating || saving || presetBusy || changingStatus}
                className="rounded-lg border bg-white px-4 py-2 disabled:opacity-50"
              >
                승인
              </button>
              <button
                type="button"
                onClick={() => changeStatus("rejected")}
                disabled={generating || saving || presetBusy || changingStatus}
                className="rounded-lg border bg-white px-4 py-2 disabled:opacity-50"
              >
                거절
              </button>
            </>
          )}
          {(draft.status === "approved" || draft.status === "rejected") && (
            <button
              type="button"
              onClick={() => changeStatus("draft")}
              disabled={generating || saving || presetBusy || changingStatus}
              className="rounded-lg border bg-white px-4 py-2 disabled:opacity-50"
            >
              draft로 되돌리기
            </button>
          )}
          {changingStatus && <p role="status" className="text-sm text-zinc-500">상태 변경 중...</p>}
        </div>
      )}
      {saved && <p role="status" className="mt-3 text-sm text-zinc-600">초안을 저장했습니다.</p>}
      {draft?.id != null && draft.status === "approved" && !editingDraft && !controlsBusy && (
        <AddPublicationJob key={draft.id} taskId={taskId} draftId={draft.id} />
      )}
      {bodyLength && (
        <p role="status" className={`mt-3 text-sm ${bodyLength.status === "ok" ? "text-zinc-500" : "text-amber-700"}`}>
          본문 {bodyLength.characters.toLocaleString("ko-KR")}자
          {snapshot && <> · 목표 {snapshot.preset.target_chars}자 · 권장 {snapshot.preset.min_chars}~{snapshot.preset.max_chars}자</>}
          {bodyLength.status === "too_short" && " · 권장 분량보다 짧습니다."}
          {bodyLength.status === "too_long" && " · 권장 분량보다 깁니다."}
          <span className="block">제목 제외 · 공백 포함 · 줄바꿈 제외</span>
        </p>
      )}

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

      <div aria-live="polite" aria-busy={generating || saving || presetBusy || changingStatus}>
        {draft?.id && !editingDraft && <Link href={`/content/blog/${taskId}/prepare?draftId=${draft.id}`} className="mt-4 inline-block rounded-lg border px-4 py-2 text-sm">네이버 발행 준비</Link>}
        {draft && !editingDraft && (
          <article className="mt-6 rounded-xl border bg-white p-6">
            <p className="mb-2 text-sm font-medium">Draft #{draft.id ?? "-"} · {String(draft.id) === String(history[0]?.id) ? "최신 생성" : "이전 생성본 미리보기"}</p>
            <h2 className="text-xl font-bold">{draft.title}</h2>
            <p className="mt-2 text-sm text-zinc-500">
              상태: {draft.status || "-"} · 제공자: {actualProvider ? PROVIDER_LABELS[actualProvider] : "확인 불가"} · 모델: {draft.model || "-"} · 생성일시: {formatCreatedAt(draft.created_at)}
            </p>
            <BlogGenerationDetails snapshot={draft.generation_snapshot} />
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
      {history.length > 0 && <section className="mt-6 rounded-xl border bg-white p-5">
        <h2 className="font-semibold">생성 이력 · 최신순</h2>
        <p className="mt-2 text-sm text-zinc-500">선택한 생성본을 위에서 미리보고 편집·승인할 수 있습니다. 재생성은 현재 선택한 프리셋과 Task 정보를 사용합니다.</p>
        <ol className="mt-4 space-y-3">{history.map((item) => <li key={item.id} className="rounded-lg border p-3">
          <p className="font-medium">Draft #{item.id} · {item.title} {String(item.id) === String(history[0]?.id) && <span className="text-xs text-blue-700">최신 생성</span>}</p>
          <p className="mt-1 text-xs text-zinc-500">{formatCreatedAt(item.created_at)} · {item.model || "모델 확인 불가"} · {item.status || "-"}</p>
          <button type="button" disabled={controlsBusy || String(item.id) === String(draft?.id)} onClick={() => { if (inFlight.current || editingDraft) return; setDraft(item); setSaved(false); }}
            className="mt-2 rounded-lg border px-3 py-1 text-sm disabled:opacity-50">{String(item.id) === String(draft?.id) ? "현재 미리보기" : "이 생성본 보기"}</button>
        </li>)}</ol>
      </section>}
    </div>
  );
}
