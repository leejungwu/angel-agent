import Link from "next/link";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type AnalysisRun = {
  id: string;
  status: string;
  review_count: number;
  model: string | null;
  schema_version: string | null;
  result: unknown;
  created_at: string;
};
type ProductVoc = {
  id: string | number;
  name: string | null;
  brand: string | null;
  reviews: { count: number }[];
  latest: AnalysisRun[];
  completed: AnalysisRun[];
};
const previewCategories = [
  ["pain_points", "고객 문제"], ["desires", "고객 욕구"], ["purchase_motivations", "구매 이유"],
] as const;

function productState(product: ProductVoc) {
  const count = product.reviews[0]?.count ?? 0;
  const latest = product.latest[0];
  const completed = product.completed[0];
  const needsAnalysis = count > 0 && (!completed || completed.review_count < count);
  if (!count) return { count, needsAnalysis, priority: 5, label: "리뷰 없음" };
  if (latest?.status === "failed") return { count, needsAnalysis, priority: 2, label: "최근 분석 실패" };
  if (latest?.status === "processing" || latest?.status === "pending") {
    return { count, needsAnalysis, priority: 3, label: latest.status === "processing" ? "분석 중" : "분석 대기" };
  }
  if (completed && completed.review_count < count) return { count, needsAnalysis, priority: 0, label: "새 리뷰 있음 · 재분석 필요" };
  if (!completed) return { count, needsAnalysis, priority: 1, label: "VOC 분석 필요" };
  return { count, needsAnalysis, priority: 4,
    label: completed.review_count === count ? "최신 분석 완료" : "분석 완료" };
}

function previewInsights(result: unknown, key: string): { text: string; estimated_mentions: number | null }[] {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return [];
  const items = (result as Record<string, unknown>)[key];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown) => {
    if (typeof item !== "object" || item === null) return [];
    const insight = item as Record<string, unknown>;
    if (typeof insight.text !== "string" || !insight.text.trim()) return [];
    const mentions = typeof insight.estimated_mentions === "number" && Number.isSafeInteger(insight.estimated_mentions) && insight.estimated_mentions >= 0
      ? insight.estimated_mentions : null;
    return [{ text: insight.text, estimated_mentions: mentions }];
  }).sort((a, b) => (b.estimated_mentions ?? -1) - (a.estimated_mentions ?? -1)).slice(0, 3);
}

function analysisDate(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
}

export default async function VocDashboardPage() {
  const products: ProductVoc[] = [];
  let cursor: string | number | undefined;
  let failed = false;
  // Embed counts and limit each analysis relation to one row per product.
  // A separate completed alias retains the last successful insights when the
  // latest attempt failed/is processing, and supports the stale-review check.
  // Keyset pages avoid the API row cap without issuing per-product requests.
  while (true) {
    let query = supabase.from("products").select(`
      id, name, brand, reviews(count),
      latest:voc_analysis_runs(id, status, review_count, model, schema_version, result, created_at),
      completed:voc_analysis_runs(id, status, review_count, model, schema_version, result, created_at)
    `).eq("completed.status", "completed")
      .order("id", { ascending: true })
      .order("created_at", { ascending: false, referencedTable: "latest" })
      .order("id", { ascending: false, referencedTable: "latest" })
      .limit(1, { referencedTable: "latest" })
      .order("created_at", { ascending: false, referencedTable: "completed" })
      .order("id", { ascending: false, referencedTable: "completed" })
      .limit(1, { referencedTable: "completed" }).limit(500);
    if (cursor !== undefined) query = query.gt("id", cursor);
    const { data, error } = await query.returns<ProductVoc[]>();
    if (error) {
      console.error("VOC dashboard lookup failed", { code: error.code });
      failed = true;
      break;
    }
    if (!data?.length) break;
    products.push(...data);
    cursor = data[data.length - 1].id;
  }

  if (failed) return <main className="p-6 sm:p-10">
    <h1 className="text-3xl font-bold">VOC Dashboard</h1>
    <p role="alert" className="mt-6 text-red-600">VOC 정보를 조회하지 못했습니다. 잠시 후 다시 확인해주세요.</p>
  </main>;

  const sorted = products.map((product) => ({ product, state: productState(product) }))
    .sort((a, b) => a.state.priority - b.state.priority ||
      (BigInt(a.product.id) < BigInt(b.product.id) ? -1 : BigInt(a.product.id) > BigInt(b.product.id) ? 1 : 0));
  const summaries = [
    ["전체 상품", products.length],
    ["전체 리뷰", sorted.reduce((sum, { state }) => sum + state.count, 0)],
    ["VOC 분석 완료", products.filter((product) => product.completed.length > 0).length],
    ["분석 필요", sorted.filter(({ state }) => state.needsAnalysis).length],
  ] as const;

  return (
    <main className="min-w-0 p-6 sm:p-10">
      <h1 className="text-3xl font-bold">VOC Dashboard</h1>
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summaries.map(([label, count]) => <div key={label} className="rounded-lg border bg-white p-4">
          <p className="text-sm text-zinc-500">{label}</p>
          <p className="mt-2 text-2xl font-bold">{count.toLocaleString()}</p>
        </div>)}
      </div>
      {!sorted.length ? <p className="mt-8 text-zinc-500">등록된 상품이 없습니다.</p> : (
        <div className="mt-8 grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          {sorted.map(({ product, state }) => {
            const latest = product.latest[0];
            const completed = product.completed[0];
            return <article key={product.id} className="min-w-0 rounded-lg border bg-white p-5">
              <h2 className="break-words text-xl font-bold">{product.name || "-"}</h2>
              <p className="mt-1 break-words text-sm text-zinc-500">{product.brand || "-"} · 상품 #{product.id}</p>
              <p className="mt-4 text-sm">리뷰: {state.count.toLocaleString()}개</p>
              <p className="mt-1 text-sm font-medium">분석 상태: {state.label}</p>
              <p className="mt-1 text-sm text-zinc-500">최근 분석: {analysisDate(latest?.created_at)}</p>
              {latest && <p className="mt-1 break-words text-xs text-zinc-500">
                분석 리뷰 {latest.review_count.toLocaleString()}개 · {latest.model || "-"} · {latest.schema_version || "-"}
              </p>}
              {completed && <div className="mt-5 space-y-4 border-t pt-4">
                {latest?.id !== completed.id && <p className="text-xs text-zinc-500">최근 완료 결과 · {analysisDate(completed.created_at)}</p>}
                {previewCategories.map(([key, label]) => {
                  const insights = previewInsights(completed.result, key);
                  return <section key={key}>
                    <h3 className="text-sm font-semibold">{label}</h3>
                    {!insights.length ? <p className="mt-1 text-sm text-zinc-500">분석 결과 없음</p> : (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                        {insights.map((insight, index) => <li key={index} className="break-words">{insight.text}</li>)}
                      </ul>
                    )}
                  </section>;
                })}
              </div>}
              <Link href={`/products/${product.id}`} className="button-link mt-5 inline-block rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50">
                상품 VOC 보기
              </Link>
            </article>;
          })}
        </div>
      )}
    </main>
  );
}
