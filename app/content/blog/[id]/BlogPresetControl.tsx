"use client";

import { useRef, useState } from "react";
import { parseBlogPreset, type BlogPreset, type BlogPresetInput } from "@/lib/blog-generation/presets";

const prompts = [
  ["system_prompt", "기본/시스템 지시"], ["strategy_prompt", "콘텐츠 전략"],
  ["style_prompt", "문체/카피라이팅"], ["title_prompt", "Title Prompt"], ["article_prompt", "글 구조/목적"],
] as const;
const numbers = [
  ["target_chars", "목표 글자 수"], ["min_chars", "최소 글자 수"], ["max_chars", "최대 글자 수"],
  ["section_count", "소제목 수"], ["keyword_min", "키워드 최소 사용 횟수"], ["keyword_max", "키워드 최대 사용 횟수"],
] as const;
const emptyPreset: BlogPresetInput = { name: "", description: null, system_prompt: "", strategy_prompt: "", style_prompt: "", title_prompt: "", article_prompt: "",
  target_chars: 1500, min_chars: 1200, max_chars: 1800, section_count: 3, keyword_min: 0, keyword_max: 3, is_default: false };

export default function BlogPresetControl({ initialPresets, selectedId, disabled, onSelect, onBusy }: {
  initialPresets: BlogPreset[]; selectedId: string; disabled: boolean;
  onSelect: (preset: BlogPreset | null) => void; onBusy: (busy: boolean) => void;
}) {
  const [presets, setPresets] = useState(initialPresets);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<BlogPresetInput>(emptyPreset);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const selected = presets.find((preset) => preset.id === selectedId);
  function edit(preset?: BlogPreset) {
    setForm(preset ? { ...preset } : { ...emptyPreset }); setEditing(preset?.id ?? "new"); setError(""); onBusy(true);
  }
  function cancel() { setEditing(null); setError(""); onBusy(false); }
  async function mutate(action: "save" | "delete" | "duplicate") {
    if (inFlight.current) return;
    if (action === "delete" && !confirm("이 프리셋을 삭제할까요? 기존 초안과 생성 당시 기록은 유지됩니다.")) return;
    const id = action === "save" ? editing : selectedId;
    if (!id) return;
    inFlight.current = true; setSaving(true); setError(""); onBusy(true);
    try {
      const response = await fetch(id === "new" ? "/api/blog/presets" : `/api/blog/presets/${id}${action === "duplicate" ? "/duplicate" : ""}`, {
        method: action === "delete" ? "DELETE" : id === "new" || action === "duplicate" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        ...(action === "save" ? { body: JSON.stringify(parseBlogPreset(form)) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "프리셋 처리 실패");
      if (action === "delete") {
        setPresets((items) => items.filter((item) => item.id !== id)); onSelect(null);
      } else {
        setPresets((items) => [...items.filter((item) => item.id !== data.preset.id), data.preset]); onSelect(data.preset);
      }
      setEditing(null); onBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "프리셋 처리 실패");
      if (editing === null) onBusy(false);
    } finally { inFlight.current = false; setSaving(false); }
  }
  const field = "mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2";
  const button = "rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50";
  return <section className="mb-5 rounded-xl border bg-white p-5">
    <label className="block text-sm font-medium">콘텐츠 프리셋
      <select className={field} value={selectedId} disabled={disabled || saving || editing !== null}
        onChange={(event) => onSelect(presets.find((item) => item.id === event.target.value) ?? null)}>
        <option value="">작업 프리셋 또는 기본 프리셋 사용</option>
        {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
    </label>
    {selected?.description && <p className="mt-2 text-xs text-zinc-500">{selected.description}</p>}
    <p className="mt-3 text-xs text-zinc-500">여기에 표시된 프리셋 내용이 Blog 생성 prompt에 사용됩니다. 코드에서 별도의 글쓰기 문구를 추가하지 않습니다.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" className={button} disabled={disabled || saving || editing !== null} onClick={() => edit()}>새 프리셋</button>
      <button type="button" className={button} disabled={disabled || saving || editing !== null || !selected} onClick={() => edit(selected)}>편집</button>
      <button type="button" className={button} disabled={disabled || saving || editing !== null || !selected} onClick={() => void mutate("duplicate")}>복제</button>
      {editing !== "new" && <button type="button" className={button} disabled={(disabled && editing === null) || saving || !selected} onClick={() => void mutate("delete")}>삭제</button>}
    </div>
    {editing !== null && <form className="mt-5 space-y-4 border-t pt-5" onSubmit={(event) => { event.preventDefault(); void mutate("save"); }}>
      <div className="flex gap-2">
        <button type="button" className={button} disabled={saving} onClick={cancel}>취소</button>
        <button type="submit" className={button} disabled={saving}>{saving ? "저장 중..." : "저장"}</button>
      </div>
      <fieldset disabled={saving} className="space-y-4">
        <label className="block text-sm">이름<input required maxLength={100} className={field} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="block text-sm">설명<input maxLength={500} className={field} value={form.description ?? ""} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        {prompts.map(([key, label]) => <label key={key} className="block text-sm">{label}
          <textarea rows={16} maxLength={30000} required={key === "system_prompt"} className={field} value={form[key] ?? ""} onChange={(event) => setForm({ ...form, [key]: event.target.value })} />
          {key === "title_prompt" && <span className="mt-1 block text-xs text-zinc-500">최종 Draft의 실제 블로그 제목(title)을 만드는 규칙입니다. Topic은 글의 내부 기획 방향이고, Title은 실제 발행 제목입니다.</span>}
        </label>)}
        <div className="grid gap-4 sm:grid-cols-2">
          {numbers.map(([key, label]) => <label key={key} className="block text-sm">{label}
            <input type="number" step={1} min={key.startsWith("keyword_") ? 0 : 1} max={key === "section_count" ? 8 : 2147483647}
              required={key.endsWith("chars")} className={field} value={form[key] ?? ""}
              onChange={(event) => setForm({ ...form, [key]: event.target.value === "" ? null : event.target.valueAsNumber })} />
          </label>)}
        </div>
      </fieldset>
    </form>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
  </section>;
}
