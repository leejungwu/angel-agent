"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { readKeywordAISettings } from "@/lib/blog-keywords/ai-settings";
import { isRelevanceTarget, type RelevanceTarget } from "@/lib/blog-keywords/relevance-filter";
import type { RelevanceBatchResult } from "@/lib/blog-keywords/relevance";

async function readCounts(productId: string) {
  const { relevance_version: version } = await readKeywordAISettings();
  const [evaluated, pending, scored] = await Promise.all([
    supabase.from("blog_keywords").select("id", { count: "exact", head: true }).eq("product_id", productId).not("product_relevance_score", "is", null).eq("product_relevance_criteria_version", version),
    supabase.from("blog_keywords").select("id", { count: "exact", head: true }).eq("product_id", productId).is("product_relevance_score", null),
    supabase.from("blog_keywords").select("id", { count: "exact", head: true }).eq("product_id", productId).not("product_relevance_score", "is", null),
  ]);
  if (evaluated.error || pending.error || scored.error) throw new Error("평가 현황 조회 실패. relevance migration과 연결 상태를 확인하세요.");
  return { evaluated: evaluated.count ?? 0, pending: pending.count ?? 0, stale: Math.max(0, (scored.count ?? 0) - (evaluated.count ?? 0)) };
}
export default function RelevanceEvaluation({ products }: { products: { id: string | number; name: string }[] }) {
  const router = useRouter();
  const [productId, setProductId] = useState("");
  const [counts, setCounts] = useState<{ evaluated: number; pending: number; stale: number } | null>(null);
  const [countError, setCountError] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<RelevanceBatchResult | null>(null);
  const [batchSize, setBatchSize] = useState(50);
  const [reevaluating, setReevaluating] = useState(false);
  const [target, setTarget] = useState<RelevanceTarget>("unevaluated");
  const targetCount = (target === "stale" ? counts?.stale : target === "pending" ? (counts?.pending ?? 0) + (counts?.stale ?? 0) : counts?.pending) ?? 0;
  useEffect(() => {
    if (!productId) return;
    let active = true;
    void readCounts(productId).then(value => { if (active) setCounts(value); })
      .catch(cause => { if (active) setCountError(cause instanceof Error ? cause.message : "평가 현황 조회 실패"); });
    return () => { active = false; };
  }, [productId]);
  async function evaluate(reevaluate = false) {
    if (busy || !productId || !(reevaluate ? counts?.evaluated : targetCount)) return;
    setBusy(true); setReevaluating(reevaluate); setError(""); setResult(null);
    try {
      const response = await fetch("/api/blog/keywords/relevance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: Number(productId), batchSize, ...(reevaluate ? { reevaluate: true } : { target }) }) });
      const data = await response.json();
      if (typeof data.evaluated === "number") setResult(data);
      if (!response.ok) throw new Error(data.error ?? "연관도 평가에 실패했습니다.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "연관도 평가에 실패했습니다."); }
    finally {
      try { setCounts(await readCounts(productId)); setCountError(""); }
      catch (cause) { setCounts(null); setCountError(cause instanceof Error ? cause.message : "평가 현황 조회 실패"); }
      setBusy(false); router.refresh();
    }
  }
  return <section aria-label="AI 연관도 평가" className="my-6 rounded-xl border bg-white p-5">
    <h2 className="text-lg font-semibold">AI 연관도 평가</h2>
    <p className="my-2 text-sm text-zinc-600">탐색을 위한 데이터 준비 단계입니다. 검색 의도를 만족하는 글에서 Product가 핵심 또는 의미 있는 보조 해결책이 되는지 평가합니다. AI 기준 설정에 저장한 기준을 사용합니다. 아래 목록 필터와 별도로 상품을 선택하세요. 검색량은 평가 순서에만 씁니다.</p>
    <label className="mb-3 inline-flex items-center gap-2">평가 Product<select aria-label="연관도 평가 Product" value={productId} disabled={busy} onChange={event => {
      setProductId(event.target.value); setCounts(null); setCountError(""); setError(""); setResult(null); setReevaluating(false);
    }} className="rounded border p-2"><option value="">Product 선택</option>{products.map(product => <option key={product.id} value={String(product.id)}>{product.name}</option>)}</select></label>
    {!productId ? <p className="mb-2 text-sm text-zinc-500">평가할 Product를 선택해 주세요.</p> : countError ? <p role="alert" className="text-red-600">{countError}</p> : !counts ? <p role="status" className="mb-2 text-sm">평가 현황을 불러오는 중…</p> : <p className="mb-2 text-sm">현재 기준 평가 완료 {counts.evaluated.toLocaleString("ko-KR")}개 · 이전 기준 {counts.stale.toLocaleString("ko-KR")}개 · 미평가 {counts.pending.toLocaleString("ko-KR")}개</p>}
    <label className="mr-3 inline-flex items-center gap-2">평가 대상<select aria-label="연관도 평가 대상" value={target} disabled={busy} onChange={event => { if (isRelevanceTarget(event.target.value)) { setTarget(event.target.value); setResult(null); setError(""); } }} className="rounded border p-2"><option value="unevaluated">미평가만</option><option value="stale">이전 기준만</option><option value="pending">미평가 + 이전 기준</option></select></label>
    <label className="mr-3 inline-flex items-center gap-2">평가 개수<select aria-label="연관도 평가 개수" value={batchSize} disabled={busy} onChange={event => setBatchSize(Number(event.target.value))} className="rounded border p-2">{[50, 100, 200].map(size => <option key={size} value={size}>{size}개</option>)}</select></label>
    <button type="button" disabled={busy || !productId || !targetCount} onClick={() => void evaluate()} className="rounded border px-3 py-2 disabled:opacity-50">{busy && !reevaluating ? "AI 평가 중…" : "현재 기준으로 키워드 평가"}</button>
    <div className="mt-4 border-t pt-3">
      <p className="mb-2 text-sm text-zinc-600">기본 평가는 선택한 대상만 처리하며 현재 기준 완료 키워드는 제외합니다. 재평가는 현재 기준으로 평가된 점수·이유를 덮어씁니다. 오래된 평가부터 선택한 개수만 처리합니다.</p>
      <button type="button" disabled={busy || !productId || !counts?.evaluated} onClick={() => void evaluate(true)} className="rounded border px-3 py-2 disabled:opacity-50">{busy && reevaluating ? "재평가 중…" : "평가된 키워드 재평가"}</button>
    </div>
    {busy && <p role="status" className="mt-2 text-sm">50개씩 순차 평가·저장 중입니다. 완료 후 다음 평가를 직접 실행할 수 있습니다.</p>}
    {result && <p role="status" className="mt-2 text-sm">이번 {reevaluating ? "재평가" : "평가"}: 후보 {result.selected}개 · 저장 완료 {result.evaluated}개 · 평가 대상에서 제외되어 건너뜀 {result.skipped}개</p>}
    {error && <p role="alert" className="mt-2 text-red-600">{error} 이전 batch의 저장 결과는 유지됩니다.</p>}
  </section>;
}
