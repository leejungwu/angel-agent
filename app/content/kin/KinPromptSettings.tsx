"use client";

import { useRef, useState } from "react";
import type { KinPromptSettings as Settings } from "@/lib/kin/prompts";

export default function KinPromptSettings({ disabled = false }: { disabled?: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  async function load() {
    if (inFlight.current || settings) return;
    inFlight.current = true; setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/kin/prompt-settings", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "공통 프롬프트 조회 실패");
      setSettings(data.settings);
    } catch (error) { setMessage(error instanceof Error ? error.message : "조회 실패"); }
    finally { inFlight.current = false; setLoading(false); }
  }
  async function save() {
    if (inFlight.current || !settings) return;
    inFlight.current = true; setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/kin/prompt-settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "공통 프롬프트 저장 실패");
      setSettings(data.settings); setMessage("공통 프롬프트를 저장했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "저장 실패"); }
    finally { inFlight.current = false; setLoading(false); }
  }
  return <details className="rounded-lg border bg-white p-6" onToggle={(event) => { if (event.currentTarget.open) void load(); }}>
    <summary className="cursor-pointer font-semibold">공통 프롬프트 설정</summary>
    <p className="mt-3 text-sm text-zinc-600">여기에 저장된 공통 프롬프트가 모든 KIN 답변 생성에 적용됩니다.</p>
    <p className="mt-2 text-xs text-zinc-500">공통 프롬프트는 모든 답변 공통, 프리셋은 선택한 답변 스타일, 추가 지시는 이번 질문에만 적용됩니다. 출력 계약·제품 언급 정책을 지키며 이번 질문 추가 지시, 프리셋, 공통 프롬프트 순으로 적용합니다.</p>
    {settings && <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={disabled || loading} className="space-y-4">
        <label className="block text-sm">시스템 / 사실성 지시
          <textarea rows={18} required maxLength={30000} value={settings.system_prompt} onChange={(event) => setSettings({ ...settings, system_prompt: event.target.value })}
            className="mt-2 w-full rounded-lg border px-3 py-2" />
        </label>
        <label className="block text-sm">공통 스타일 지시
          <textarea rows={18} maxLength={30000} value={settings.common_style_prompt} onChange={(event) => setSettings({ ...settings, common_style_prompt: event.target.value })}
            className="mt-2 w-full rounded-lg border px-3 py-2" />
        </label>
        <button type="submit" className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">{loading ? "저장 중..." : "저장"}</button>
      </fieldset>
    </form>}
    {loading && !settings && <p role="status" className="mt-3 text-sm">불러오는 중...</p>}
    {message && <p role="status" className="mt-3 text-sm text-zinc-600">{message}</p>}
  </details>;
}
