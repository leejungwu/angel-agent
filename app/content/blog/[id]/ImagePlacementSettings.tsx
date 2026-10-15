"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { resolveBlogImagePlacementSettings } from "@/lib/blog-publishing/image-placement-settings";

export default function ImagePlacementSettings({ taskId, initialSettings }: { taskId: string | number; initialSettings?: unknown }) {
  const router = useRouter();
  const [settings, setSettings] = useState(() => resolveBlogImagePlacementSettings(initialSettings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch(`/api/blog/tasks/${taskId}/image-placement`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "사진 배치 설정을 저장하지 못했습니다.");
      setSettings(resolveBlogImagePlacementSettings(result.settings)); setSaved(true); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "사진 배치 설정을 저장하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="my-5 rounded-lg border p-4">
    <h3 className="font-medium">사진 배치 설정</h3>
    <p className="mt-2 text-sm text-zinc-500">기본값은 현재 방식인 균등 배치입니다. 사진 순서는 업로드 순서를 유지합니다.</p>
    <fieldset disabled={busy} className="mt-3 space-y-2 text-sm">
      {([
        ["pinFirstAfterIntro", "첫 사진을 도입부 뒤에 배치"],
        ["pinLastBeforeClosing", "마지막 사진을 마무리 직전에 배치"],
        ["allowParagraphSplit", "문단이 부족하면 본문 자동 분할"],
      ] as const).map(([key, label]) => <label key={key} className="flex items-center gap-2">
        <input type="checkbox" checked={settings[key]} onChange={event => { setSettings({ ...settings, [key]: event.target.checked }); setSaved(false); }} />{label}
      </label>)}
      <button type="submit" className="mt-2 rounded-lg border px-4 py-2 disabled:opacity-50">{busy ? "저장 중..." : "저장"}</button>
    </fieldset>
    {saved && <p role="status" className="mt-3 text-sm text-zinc-600">설정을 저장했습니다. 새로 등록하는 발행 작업에 적용되며 기존 대기열은 바뀌지 않습니다.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
  </form>;
}
