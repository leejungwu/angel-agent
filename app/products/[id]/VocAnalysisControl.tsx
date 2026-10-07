"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { VocInsight, VocResult } from "@/lib/voc/analyze";

export type VocAnalysisRun = {
  id: string;
  status: string;
  review_count: number;
  model: string | null;
  schema_version: string | null;
  result: unknown;
  error_message: string | null;
  created_at: string;
};

const categories: [keyof VocResult, string][] = [
  ["pain_points", "고객 불만 / 문제"], ["desires", "고객 욕구"],
  ["purchase_motivations", "구매 이유"], ["customer_language", "고객 실제 표현"],
  ["objections", "구매 장벽 / 걱정"], ["recurring_keywords", "반복 키워드"],
  ["product_improvements", "제품 개선점"], ["faq_candidates", "FAQ 후보"], ["ad_hooks", "광고 Hook"],
];
const statusLabels: Record<string, string> = {
  pending: "분석 대기", processing: "분석 중", completed: "분석 완료", failed: "VOC 분석 실패",
};
const summaryCategories: [keyof VocResult, string][] = [
  ["pain_points", "핵심 고객 문제"], ["desires", "핵심 고객 욕구"],
  ["purchase_motivations", "주요 구매 이유"], ["objections", "주요 구매 장벽"], ["ad_hooks", "광고 Hook"],
];

// Validate stored JSON at the rendering boundary without importing server AI code.
function readableResult(value: unknown): value is VocResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return categories.every(([key]) => Array.isArray(result[key]) && result[key].every((insight: unknown) => {
    if (typeof insight !== "object" || insight === null) return false;
    const item = insight as Record<string, unknown>;
    return typeof item.text === "string" && (item.estimated_mentions === null ||
      (typeof item.estimated_mentions === "number" && Number.isSafeInteger(item.estimated_mentions) && item.estimated_mentions >= 0)) &&
      Array.isArray(item.evidence) && item.evidence.every((text: unknown) => typeof text === "string");
  }));
}

function InsightRow({ insight, customerLanguage }: { insight: VocInsight; customerLanguage: boolean }) {
  const [showEvidence, setShowEvidence] = useState(false);
  return (
    <li className="break-words text-sm">
      <p className={`whitespace-pre-wrap ${customerLanguage ? "font-semibold text-zinc-900" : "font-medium"}`}>{insight.text}</p>
      {insight.estimated_mentions !== null && <p className="mt-1 text-zinc-500">약 {insight.estimated_mentions.toLocaleString()}회 언급 (모델 추정)</p>}
      {insight.evidence.length > 0 && (
        <>
          <button type="button" onClick={() => setShowEvidence((show) => !show)} aria-expanded={showEvidence}
            className="mt-2 text-sm text-zinc-600 underline underline-offset-2">
            {showEvidence ? "근거 숨기기" : "근거 보기"}
          </button>
          {showEvidence && <ul className="mt-2 list-disc space-y-1 pl-4 text-zinc-600">
            {insight.evidence.slice(0, 3).map((text, index) => <li key={index} className="whitespace-pre-wrap">{text}</li>)}
          </ul>}
        </>
      )}
    </li>
  );
}

function VocCategoryCard({ category, label, insights }: { category: keyof VocResult; label: string; insights: VocInsight[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? insights : insights.slice(0, 3);
  return (
    <section className={`min-w-0 rounded-lg border p-4 ${category === "ad_hooks" ? "border-zinc-300 bg-white" : "bg-zinc-50"}`}>
      <h4 className="font-semibold">{label}</h4>
      {!insights.length ? <p className="mt-2 text-sm text-zinc-500">분석 결과 없음</p> : (
        <ul className="mt-3 space-y-4">
          {visible.map((insight, index) => <InsightRow key={index} insight={insight} customerLanguage={category === "customer_language"} />)}
        </ul>
      )}
      {insights.length > 3 && <button type="button" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}
        className="mt-4 rounded border bg-white px-3 py-1.5 text-sm text-zinc-600">
        {expanded ? "접기" : `전체 보기 (${insights.length})`}
      </button>}
    </section>
  );
}

export function VocAnalysisResult({ result }: { result: unknown }) {
  if (!readableResult(result)) return <p role="alert" className="mt-4 text-red-600">저장된 VOC 결과 형식을 확인할 수 없습니다.</p>;
  return (
    <div className="mt-5 min-w-0">
      <section className="rounded-lg border bg-zinc-50 p-4">
        <h4 className="font-bold">핵심 VOC 요약</h4>
        <div className="mt-4 space-y-4">
          {summaryCategories.map(([key, label]) => {
            // Copy before sorting; stable ties preserve source order, nulls come last.
            const top = [...result[key]].sort((a, b) => (b.estimated_mentions ?? -1) - (a.estimated_mentions ?? -1)).slice(0, 3);
            return <div key={key}>
              <h5 className="text-sm font-semibold">{label}</h5>
              {!top.length ? <p className="mt-1 text-sm text-zinc-500">분석 결과 없음</p> : (
                <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
                  {top.map((insight, index) => <li key={index} className="break-words">
                    <p className="whitespace-pre-wrap">{insight.text}</p>
                    {insight.estimated_mentions !== null && <p className="text-zinc-500">약 {insight.estimated_mentions.toLocaleString()}회 언급</p>}
                  </li>)}
                </ol>
              )}
            </div>;
          })}
        </div>
      </section>
      <h4 className="mt-6 font-bold">상세 VOC</h4>
      <div className="mt-3 grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        {categories.map(([key, label]) => <VocCategoryCard key={key} category={key} label={label} insights={result[key]} />)}
      </div>
    </div>
  );
}

export default function VocAnalysisControl({ productId, reviewCount, latestRun, queryError }: {
  productId: number;
  reviewCount: number | null;
  latestRun: VocAnalysisRun | null;
  queryError: string | null;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const processing = analyzing || latestRun?.status === "processing";
  const date = latestRun ? new Date(latestRun.created_at) : null;

  async function startAnalysis() {
    if (inFlight.current || processing || !reviewCount || queryError) return;
    inFlight.current = true;
    setAnalyzing(true);
    setError("");
    try {
      const response = await fetch(`/api/products/${productId}/voc/analyze`, { method: "POST" });
      const result: unknown = await response.json();
      const data = typeof result === "object" && result !== null ? result as Record<string, unknown> : null;
      if (!response.ok || data?.ok !== true) throw new Error(typeof data?.error === "string" ? data.error : "VOC 분석에 실패했습니다.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "VOC 분석에 실패했습니다.");
    } finally {
      inFlight.current = false;
      setAnalyzing(false);
      router.refresh();
    }
  }

  return (
    <div className="mt-6 border-t pt-6" aria-busy={processing}>
      <h3 className="text-lg font-bold">VOC Analysis</h3>
      <button type="button" onClick={startAnalysis}
        disabled={processing || !reviewCount || Boolean(queryError)}
        className="mt-3 rounded-lg bg-black px-4 py-2 text-white disabled:opacity-50">
        {processing ? "분석 중..." : "VOC 분석 시작"}
      </button>
      {reviewCount === 0 && <p className="mt-2 text-sm text-zinc-500">먼저 리뷰를 업로드하세요.</p>}
      {reviewCount === null && <p className="mt-2 text-sm text-zinc-500">리뷰 개수를 확인할 수 없습니다.</p>}
      {processing && <p role="status" className="mt-2 text-sm text-zinc-500">VOC 분석이 진행 중입니다.</p>}
      {queryError && <p role="alert" className="mt-3 text-red-600">{queryError}</p>}
      {error && <p role="alert" className="mt-3 text-red-600">{error}</p>}
      {latestRun ? (
        <div className="mt-4 text-sm text-zinc-600">
          <p className="break-words leading-relaxed">
            <span className="font-medium">{statusLabels[latestRun.status] ?? latestRun.status}</span>
            {" · "}리뷰 {latestRun.review_count.toLocaleString()}개
            {" · "}{latestRun.model || "-"}{" · "}{latestRun.schema_version || "-"}
            {" · "}{date && !Number.isNaN(date.getTime()) ? date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-"}
          </p>
          {latestRun.status === "failed" && <p role="alert" className="whitespace-pre-wrap break-words text-red-600">{latestRun.error_message || "VOC 분석에 실패했습니다. 다시 시도해주세요."}</p>}
        </div>
      ) : !queryError && <p className="mt-4 text-sm text-zinc-500">아직 VOC 분석 결과가 없습니다.</p>}
      {latestRun?.status === "completed" && (
        <div className="mt-5">
          <h3 className="font-bold">최신 분석 결과</h3>
          <VocAnalysisResult key={latestRun.id} result={latestRun.result} />
        </div>
      )}
    </div>
  );
}
