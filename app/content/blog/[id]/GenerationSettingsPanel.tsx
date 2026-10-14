"use client";

import { BLOG_TEMPLATE_OPTIONS, BLOG_TONE_OPTIONS, BLOG_PRODUCT_EXPOSURE_OPTIONS, BLOG_CTA_OPTIONS, BLOG_GENERATION_LIMITS, type BlogGenerationSettings } from "@/lib/blog-generation/settings";

export default function GenerationSettingsPanel({ value, onChange, onSave, disabled, message }: {
  value: BlogGenerationSettings; onChange: (settings: BlogGenerationSettings) => void;
  onSave: () => void; disabled: boolean; message: string;
}) {
  const control = "mt-2 block w-full rounded-lg border bg-white px-3 py-2";
  const numberValue = (number: number) => Number.isFinite(number) ? number : "";
  return <details className="mb-5 rounded-xl border bg-white p-5">
    <summary className="cursor-pointer font-semibold">콘텐츠 설정</summary>
    <p className="mt-3 text-sm text-zinc-500">이 작업의 생성·재생성에 사용합니다. 생성할 때 화면의 설정을 함께 저장합니다.</p>
    <fieldset disabled={disabled} className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="text-sm">글 유형<select className={control} value={value.template} onChange={(e) => onChange({ ...value, template: e.target.value as BlogGenerationSettings["template"] })}>
        {BLOG_TEMPLATE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      <label className="text-sm">문체<select className={control} value={value.tone} onChange={(e) => onChange({ ...value, tone: e.target.value as BlogGenerationSettings["tone"] })}>
        {BLOG_TONE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === "natural" ? "자연스러운 후기체" : option.label}</option>)}
      </select></label>
      <label className="text-sm">목표 글자 수<input className={control} type="number" min={BLOG_GENERATION_LIMITS.targetLength.min} max={BLOG_GENERATION_LIMITS.targetLength.max} step={1} value={numberValue(value.targetLength)} onChange={(e) => onChange({ ...value, targetLength: e.target.valueAsNumber })} /></label>
      <label className="text-sm">소제목 수<input className={control} type="number" min={BLOG_GENERATION_LIMITS.sectionCount.min} max={BLOG_GENERATION_LIMITS.sectionCount.max} step={1} value={numberValue(value.sectionCount)} onChange={(e) => onChange({ ...value, sectionCount: e.target.valueAsNumber })} /></label>
      <label className="text-sm sm:col-span-2">메인 키워드<input className={control} maxLength={BLOG_GENERATION_LIMITS.mainKeyword} value={value.mainKeyword ?? ""} onChange={(e) => onChange({ ...value, mainKeyword: e.target.value })} /></label>
      <label className="text-sm">키워드 최소 사용 횟수<input className={control} type="number" min={0} max={BLOG_GENERATION_LIMITS.keywordUsage.max} step={1} value={numberValue(value.keywordUsage.min)} onChange={(e) => onChange({ ...value, keywordUsage: { ...value.keywordUsage, min: e.target.valueAsNumber } })} /></label>
      <label className="text-sm">키워드 최대 사용 횟수<input className={control} type="number" min={0} max={BLOG_GENERATION_LIMITS.keywordUsage.max} step={1} value={numberValue(value.keywordUsage.max)} onChange={(e) => onChange({ ...value, keywordUsage: { ...value.keywordUsage, max: e.target.valueAsNumber } })} /></label>
      <label className="text-sm">제품 노출 강도<select className={control} value={value.productExposure} onChange={(e) => onChange({ ...value, productExposure: e.target.value as BlogGenerationSettings["productExposure"] })}>
        {BLOG_PRODUCT_EXPOSURE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      <label className="text-sm">마무리 안내 (CTA)<select className={control} value={value.cta} onChange={(e) => onChange({ ...value, cta: e.target.value as BlogGenerationSettings["cta"] })}>
        {BLOG_CTA_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.value === "closing" ? "마지막에만" : option.label}</option>)}
      </select></label>
      <label className="text-sm sm:col-span-2">콘텐츠 설정 추가 지시<textarea className={`${control} min-h-24`} maxLength={BLOG_GENERATION_LIMITS.additionalInstructions} value={value.additionalInstructions ?? ""} onChange={(e) => onChange({ ...value, additionalInstructions: e.target.value })} /></label>
      <p className="text-xs text-zinc-500 sm:col-span-2">후기형도 실제 경험을 지어내지 않습니다. 메인 키워드가 없으면 횟수를 강제하지 않습니다. 작업 상세의 추가 지시와 고정 사실성 규칙을 유지합니다.</p>
      <button type="button" onClick={onSave} className="rounded-lg border px-4 py-2 text-sm sm:col-span-2">콘텐츠 설정 저장</button>
    </fieldset>
    <p role="status" className="mt-3 text-sm text-zinc-600">{message}</p>
  </details>;
}
