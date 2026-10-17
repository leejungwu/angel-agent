"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import type { RecommendationResult } from "@/lib/blog-keywords/recommendation";
import { recommendationTaskUrl } from "@/lib/blog-keywords/shared";

export default function RecommendationForm({ products, initialProductId }: { products: { id: string | number; name: string }[]; initialProductId: string }) {
  const [productId, setProductId] = useState(initialProductId);
  const [count, setCount] = useState("5");
  const [result, setResult] = useState<RecommendationResult | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");

  async function recommend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !productId) return;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/blog/keywords/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: Number(productId), count: Number(count) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "추천 요청에 실패했습니다.");
      setResult(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "추천 요청에 실패했습니다.");
    } finally { setBusy(false); }
  }

  return <>
    <p className="mt-4 text-sm text-zinc-600">미사용 키워드 중 최대 200개 후보를 분석합니다. 추천 점수는 AI의 상대적 기획 평가이며, 검색 순위나 성과를 보장하지 않습니다. 광고 경쟁도는 블로그 SEO 난이도가 아닙니다.</p>
    <form onSubmit={recommend} className="my-6">
      <fieldset disabled={busy} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">Product<select required aria-label="추천 Product" value={productId} onChange={event => { setProductId(event.target.value); setResult(null); setError(""); }} className="rounded border bg-white p-2"><option value="">Product 선택</option>{products.map(product => <option key={product.id} value={String(product.id)}>{product.name}</option>)}</select></label>
        <label className="flex flex-col gap-1">추천 개수<select aria-label="추천 개수" value={count} onChange={event => { setCount(event.target.value); setResult(null); }} className="rounded border bg-white p-2"><option value="5">5개</option><option value="10">10개</option></select></label>
        <button disabled={!productId || busy} className="rounded border bg-white px-4 py-2 disabled:opacity-50">{busy ? "추천 중…" : "AI 추천 받기"}</button>
      </fieldset>
    </form>
    {busy && <p role="status">키워드 후보를 분석하고 있습니다.</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {result && <>
      <p role="status" className="mb-4">후보 {result.candidateCount}개 중 {result.recommendations.length}개 추천. 추천만으로 키워드 상태는 바뀌지 않습니다.</p>
      {!result.recommendations.length && <p>미사용 키워드가 없습니다. Keyword Pool에서 Product와 키워드를 확인하세요.</p>}
      <div className="grid gap-4">{result.recommendations.map(item => <article key={item.keywordId} className="rounded-xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{item.keyword}</h2><Link href={recommendationTaskUrl(productId, item)} className="whitespace-nowrap rounded border px-3 py-2">작업 생성</Link></div>
        <p className="my-3 text-sm text-zinc-600">검색량 {item.searchVolume === null ? "데이터 없음" : item.searchVolume.toLocaleString("ko-KR")} · 추천 점수 {item.score} · 제품 관련성 {item.relevanceScore} · 기획 기회 {item.opportunityScore}</p>
        <dl className="grid gap-2">{[["검색 의도", item.searchIntent], ["추천 이유", item.reason], ["추천 주제", item.suggestedTopic], ["추천 각도", item.suggestedAngle]].map(([label, value]) => <div key={label}><dt className="font-medium">{label}</dt><dd className="whitespace-pre-wrap text-zinc-700">{value}</dd></div>)}</dl>
      </article>)}</div>
    </>}
  </>;
}
