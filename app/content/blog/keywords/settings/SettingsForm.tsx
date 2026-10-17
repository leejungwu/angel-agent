"use client";
import { useState } from "react";
import type { KeywordAISettings } from "@/lib/blog-keywords/ai-settings";
import { BLOG_MODEL_OPTIONS } from "@/lib/blog-generation/models";

export default function SettingsForm({ initial }: { initial: KeywordAISettings }) {
  const [settings, setSettings] = useState(initial), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/blog/keywords/ai-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "저장 실패");
      setSettings(data.settings); setMessage("저장 완료");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장 실패"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-6">
    <section className="rounded-xl border bg-white p-5">
      <h2 className="text-xl font-semibold"><label htmlFor="relevance-criteria">제품 연관도 평가 기준</label></h2>
      <label className="my-3 flex items-center gap-2">평가 모델<select aria-label="연관도 평가 모델" value={settings.relevanceModel} disabled={busy} onChange={event => { setSettings({ ...settings, relevanceModel: event.target.value }); setMessage(""); }} className="rounded border p-2">{BLOG_MODEL_OPTIONS.openai.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}</select></label>
      <p className="my-2 text-sm">키워드가 선택 Product와 얼마나 자연스럽게 연결되는지 0~100 점수로 평가할 때 사용하는 기준입니다.</p>
      <p className="my-2 text-sm text-amber-800">기준을 변경하면 기존 연관도 점수는 이전 기준으로 표시되며 재평가가 필요합니다.</p>
      <p className="my-2 text-sm text-zinc-600">모델만 변경하면 기존 점수와 기준 버전은 유지됩니다. 필요하면 평가된 키워드 재평가를 실행하세요.</p>
      <textarea id="relevance-criteria" required maxLength={30000} rows={16} value={settings.relevance_criteria} disabled={busy} onChange={event => { setSettings({ ...settings, relevance_criteria: event.target.value }); setMessage(""); }} className="w-full rounded border p-3" />
    </section>
    <section className="rounded-xl border bg-white p-5">
      <h2 className="text-xl font-semibold"><label htmlFor="recommendation-criteria">키워드 추천 기준</label></h2>
      <label className="my-3 flex items-center gap-2">추천 모델<select aria-label="키워드 추천 모델" value={settings.recommendationModel} disabled={busy} onChange={event => { setSettings({ ...settings, recommendationModel: event.target.value }); setMessage(""); }} className="rounded border p-2">{BLOG_MODEL_OPTIONS.openai.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}</select></label>
      <p className="my-2 text-sm">AI 추천 5/10개를 고를 때 제품 관련성, 검색량, 검색 의도, 기존 콘텐츠 중복 등을 어떻게 판단할지 정합니다.</p>
      <textarea id="recommendation-criteria" required maxLength={30000} rows={10} value={settings.recommendation_criteria} disabled={busy} onChange={event => { setSettings({ ...settings, recommendation_criteria: event.target.value }); setMessage(""); }} className="w-full rounded border p-3" />
    </section>
    <button disabled={busy} className="rounded border px-4 py-2 disabled:opacity-50">{busy ? "저장 중…" : "저장"}</button>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="text-red-600">{error}</p>}
  </form>;
}
