"use client";

import { useRef, useState } from "react";
import type { KinPreset, MentionLevel } from "@/lib/kin/presets";

type Props = {
  initialPresets: KinPreset[];
  selectedId: string;
  disabled: boolean;
  onSelect: (preset: KinPreset | null) => void;
  onBusy: (busy: boolean) => void;
};
export default function KinPresetControl({ initialPresets, selectedId, disabled, onSelect, onBusy }: Props) {
  const [presets, setPresets] = useState(initialPresets);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [level, setLevel] = useState<MentionLevel | "">("");
  const [paragraphCount, setParagraphCount] = useState("");
  const [minChars, setMinChars] = useState("");
  const [maxChars, setMaxChars] = useState("");
  const [keywords, setKeywords] = useState("");
  const [maxMentions, setMaxMentions] = useState("");
  const [bannedPhrases, setBannedPhrases] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const selected = presets.find((preset) => preset.id === selectedId);
  function openEditor(preset?: KinPreset) {
    setEditing(preset?.id ?? "new");
    setName(preset?.name ?? ""); setDescription(preset?.description ?? "");
    setInstructions(preset?.instructions ?? ""); setLevel(preset?.default_product_mention_level ?? "");
    setParagraphCount(String(preset?.paragraph_count ?? ""));
    setMinChars(String(preset?.min_chars ?? "")); setMaxChars(String(preset?.max_chars ?? ""));
    setKeywords(preset?.keywords.join("\n") ?? ""); setMaxMentions(String(preset?.max_keyword_mentions_per_paragraph ?? ""));
    setBannedPhrases(preset?.banned_phrases.join("\n") ?? "");
    setError(""); onBusy(true);
  }
  function closeEditor() { setEditing(null); onBusy(false); }
  async function mutate(remove = false, duplicate = false) {
    if (inFlight.current) return;
    if (remove && !confirm("이 프리셋을 삭제할까요? 기존 작업과 초안은 유지됩니다.")) return;
    const id = remove || duplicate ? selectedId : editing;
    if (!id) return;
    inFlight.current = true; setSaving(true); setError(""); onBusy(true);
    try {
      const response = await fetch(id === "new" ? "/api/kin/presets" : `/api/kin/presets/${id}${duplicate ? "/duplicate" : ""}`, {
        method: remove ? "DELETE" : id === "new" || duplicate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        ...(remove || duplicate ? {} : { body: JSON.stringify({ name, description, instructions, default_product_mention_level: level || null,
          paragraph_count: paragraphCount ? Number(paragraphCount) : null,
          min_chars: minChars ? Number(minChars) : null, max_chars: maxChars ? Number(maxChars) : null,
          keywords: keywords.split(/[,\n]/), max_keyword_mentions_per_paragraph: maxMentions ? Number(maxMentions) : null,
          banned_phrases: bannedPhrases.split(/[,\n]/),
        }) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "프리셋을 저장하지 못했습니다.");
      if (remove) {
        setPresets((items) => items.filter((preset) => preset.id !== id)); onSelect(null);
      } else {
        setPresets((items) => [...items.filter((preset) => preset.id !== data.preset.id), data.preset]);
        onSelect(data.preset);
      }
      setEditing(null); onBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "프리셋 처리에 실패했습니다.");
      if (remove || duplicate) onBusy(false);
    } finally { inFlight.current = false; setSaving(false); }
  }
  const field = "mt-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2";
  const button = "rounded-lg border bg-white px-3 py-2 text-sm disabled:opacity-50";
  return <section className="rounded-lg border bg-white p-6">
    <label className="block text-sm font-medium">답변 스타일
      <select className={field} value={selectedId} disabled={disabled || saving || editing !== null}
        onChange={(event) => onSelect(presets.find((preset) => preset.id === event.target.value) ?? null)}>
        <option value="">기본 스타일</option>
        {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
    </label>
    {selected?.description && <p className="mt-2 text-xs text-zinc-500">{selected.description}</p>}
    <div className="mt-3 flex gap-2">
      <button type="button" className={button} disabled={disabled || saving || editing !== null} onClick={() => openEditor()}>+ 새 프리셋</button>
      <button type="button" className={button} disabled={disabled || saving || !selected || editing !== null} onClick={() => openEditor(selected)}>편집</button>
      <button type="button" className={button} disabled={disabled || saving || !selected || editing !== null} onClick={() => void mutate(false, true)}>복제</button>
      <button type="button" className={button} disabled={disabled || saving || !selected || editing !== null} onClick={() => void mutate(true)}>삭제</button>
    </div>
    {editing !== null && <form className="mt-5 space-y-4 border-t pt-5" onSubmit={(event) => { event.preventDefault(); void mutate(); }}>
      <fieldset disabled={saving} className="space-y-4">
        <label className="block text-sm">이름<input required maxLength={100} className={field} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="block text-sm">설명<input maxLength={500} className={field} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="block text-sm">프롬프트 지침<textarea required rows={7} maxLength={6000} className={field} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
        <p className="text-xs text-zinc-500">반복 사용할 문체·구조·키워드 배치 지침입니다. 안전·사실성 규칙은 항상 우선합니다.</p>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block text-sm">문단 수<input type="number" min={2} max={5} step={1} className={field} value={paragraphCount} onChange={(event) => setParagraphCount(event.target.value)} /></label>
          <label className="block text-sm">최소 글자 수<input type="number" min={1} max={2147483647} step={1} className={field} value={minChars} onChange={(event) => setMinChars(event.target.value)} /></label>
          <label className="block text-sm">최대 글자 수<input type="number" min={Number(minChars) || 1} max={2147483647} step={1} className={field} value={maxChars} onChange={(event) => setMaxChars(event.target.value)} /></label>
        </div>
        <label className="block text-sm">추천 키워드<textarea rows={3} className={field} value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="쉼표 또는 줄바꿈으로 구분" /></label>
        <label className="block text-sm">문단별 키워드 최대 사용 횟수<input type="number" min={1} max={3} step={1} className={field} value={maxMentions} onChange={(event) => setMaxMentions(event.target.value)} /></label>
        <label className="block text-sm">금지 표현<textarea rows={3} className={field} value={bannedPhrases} onChange={(event) => setBannedPhrases(event.target.value)} placeholder="쉼표 또는 줄바꿈으로 구분" /></label>
        <label className="block text-sm">기본 제품 언급 수준
          <select className={field} value={level} onChange={(event) => setLevel(event.target.value as MentionLevel | "")}>
            <option value="">변경하지 않음</option><option value="none">언급 안 함</option>
            <option value="relevant">관련 있을 때만 언급</option><option value="direct">직접 소개</option>
          </select>
        </label>
        <div className="flex gap-2">
          <button type="submit" className={button} disabled={saving || !name.trim() || !instructions.trim()}>{saving ? "저장 중..." : "저장"}</button>
          <button type="button" className={button} onClick={closeEditor}>취소</button>
        </div>
      </fieldset>
    </form>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
  </section>;
}
