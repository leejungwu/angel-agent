import { readBlogGenerationSnapshot } from "@/lib/blog-generation/snapshot";

export default function BlogGenerationDetails({ snapshot: value }: { snapshot: unknown }) {
  const snapshot = readBlogGenerationSnapshot(value);
  if (!snapshot) return <p className="mt-2 text-sm text-zinc-500">기존 생성본 · 생성 설정 기록 없음</p>;
  const preset = snapshot.preset;
  return <div className="mt-3 text-sm text-zinc-600">
    <p>프리셋: {preset.name} · {snapshot.provider} / {snapshot.responseModel || snapshot.requestedModel}</p>
    <p className="mt-1">목표 {preset.target_chars}자 · 최소 {preset.min_chars}자 · 최대 {preset.max_chars}자 · 소제목 {preset.section_count ?? "미지정"}개 · 키워드 {preset.keyword_min ?? "미지정"}~{preset.keyword_max ?? "미지정"}회</p>
    <details className="mt-3 rounded-lg border p-3">
      <summary className="cursor-pointer">당시 프리셋 전체 보기</summary>
      {([
        ["system_prompt", "기본/시스템 지시"], ["strategy_prompt", "콘텐츠 전략"],
        ["style_prompt", "문체/카피라이팅"], ["title_prompt", "Title Prompt"], ["article_prompt", "글 구조/목적"],
      ] as const).map(([key, label]) => <label key={key} className="mt-4 block">{label}
        <textarea readOnly rows={10} value={preset[key]} className="mt-2 w-full rounded-lg border bg-zinc-50 px-3 py-2" />
      </label>)}
    </details>
  </div>;
}
