"use client";
import { useState, type FormEvent } from "react";
import { BLOG_MODEL_OPTIONS } from "@/lib/blog-generation/models";
import type { BlogGenerationSettings } from "@/lib/blog-generation/settings";

export default function SettingsForm({ initial }: { initial: BlogGenerationSettings }) {
  const [settings, setSettings] = useState(initial), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/blog/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "저장 실패");
      setSettings(data.settings); setMessage("저장 완료");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장 실패"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="space-y-4 rounded-xl border bg-white p-5">
    <h2 className="text-xl font-semibold">Topic 자동 생성</h2>
    <p className="text-sm text-zinc-600">주제를 비워둔 Blog Task는 이 기준을 사용해 Keyword의 검색 의도를 바탕으로 Topic을 한 번 생성하고 저장합니다. 저장된 Topic은 이후 재생성에서도 그대로 사용합니다.</p>
    <label className="flex items-center gap-2">모델<select aria-label="Topic 모델" value={settings.topic_model} disabled={busy} onChange={event => { setSettings({ ...settings, topic_model: event.target.value }); setMessage(""); }} className="rounded border p-2">{BLOG_MODEL_OPTIONS.openai.map(model => <option key={model.value} value={model.value}>{model.label}</option>)}</select></label>
    <label className="block">Topic 생성 기준<textarea aria-label="Topic 생성 기준" rows={16} maxLength={30000} required disabled={busy} value={settings.topic_prompt} onChange={event => { setSettings({ ...settings, topic_prompt: event.target.value }); setMessage(""); }} className="mt-2 w-full rounded border p-3" /></label>
    <button disabled={busy} className="rounded border px-4 py-2 disabled:opacity-50">{busy ? "저장 중…" : "저장"}</button>
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="text-red-600">{error}</p>}
  </form>;
}
