import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import KeywordImport from "./KeywordImport";
import KeywordActions from "./KeywordActions";
import PageSizeSelect from "./PageSizeSelect";
import RelevanceEvaluation from "./RelevanceEvaluation";
import { readKeywordAISettings } from "@/lib/blog-keywords/ai-settings";
import { pendingRelevanceFilter, isStaleRelevance } from "@/lib/blog-keywords/relevance-filter";
import { BLOG_MODEL_OPTIONS } from "@/lib/blog-generation/models";
export const dynamic = "force-dynamic";
type Params = Record<string, string | string[] | undefined>;
const sorts = {
  search_volume_desc: { label: "검색량 높은 순", column: "search_volume", ascending: false },
  search_volume_asc: { label: "검색량 낮은 순", column: "search_volume", ascending: true },
  created_at_desc: { label: "최근 등록 순", column: "created_at", ascending: false },
  created_at_asc: { label: "오래된 등록 순", column: "created_at", ascending: true },
  keyword_asc: { label: "키워드 가나다순", column: "keyword", ascending: true },
  relevance_desc: { label: "연관도 높은 순", column: "product_relevance_score", ascending: false },
  relevance_asc: { label: "연관도 낮은 순", column: "product_relevance_score", ascending: true },
};
export default async function BlogKeywordsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  let criteriaVersion = 0, settingsError = "", relevanceModelLabel = "-", recommendationModelLabel = "-";
  try {
    const settings = await readKeywordAISettings();
    criteriaVersion = settings.relevance_version;
    relevanceModelLabel = BLOG_MODEL_OPTIONS.openai.find(model => model.value === settings.relevanceModel)?.label ?? "-";
    recommendationModelLabel = BLOG_MODEL_OPTIONS.openai.find(model => model.value === settings.recommendationModel)?.label ?? "-";
  }
  catch (cause) { settingsError = cause instanceof Error ? cause.message : "AI 기준 설정 조회 실패"; }
  const text = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const productId = /^\d+$/.test(text("product")) && Number.isSafeInteger(Number(text("product"))) ? text("product") : "";
  const status = ["unused", "used", "excluded"].includes(text("status")) ? text("status") : "";
  const relevance = ["evaluated", "unevaluated", "80", "60", "under40"].includes(text("relevance")) ? text("relevance") : "";
  const search = text("q").trim().slice(0, 200);
  const requestedSort = text("sort") === "volume" ? "search_volume_desc" : text("sort") === "recent" ? "created_at_desc" : text("sort");
  const sort = Object.hasOwn(sorts, requestedSort) ? requestedSort as keyof typeof sorts : "search_volume_desc";
  const pageSize = ["15", "30", "50"].includes(text("pageSize")) ? Number(text("pageSize")) : 30;
  const requestedPage = /^\d+$/.test(text("page")) && Number.isSafeInteger(Number(text("page"))) ? Math.max(1, Number(text("page"))) : 1;
  const filteredQuery = (head = false) => {
    let query = supabase.from("blog_keywords").select("id,product_id,keyword,status,search_volume,competition,source,source_filename,created_at,product_relevance_score,product_relevance_reason,product_relevance_criteria_version", { count: "exact", head });
    if (productId) query = query.eq("product_id", productId);
    if (status) query = query.eq("status", status);
    if (search) query = query.ilike("keyword", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
    if (relevance === "unevaluated") query = query.or(pendingRelevanceFilter(criteriaVersion));
    if (relevance && relevance !== "unevaluated") query = query.eq("product_relevance_criteria_version", criteriaVersion);
    if (relevance && settingsError) query = query.eq("product_relevance_criteria_version", -1);
    if (relevance === "evaluated") query = query.not("product_relevance_score", "is", null);
    if (relevance === "80" || relevance === "60") query = query.gte("product_relevance_score", Number(relevance));
    if (relevance === "under40") query = query.lt("product_relevance_score", 40);
    return query;
  };
  const [total, products] = await Promise.all([filteredQuery(true), supabase.from("products").select("id,name").order("name")]);
  const count = total.count ?? 0, totalPages = Math.max(1, Math.ceil(count / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const pageUrl = (number: number) => {
    const target = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") target.set(key, value);
      else if (Array.isArray(value)) value.forEach(item => target.append(key, item));
    }
    target.set("page", String(number));
    target.set("pageSize", String(pageSize));
    return `/content/blog/keywords?${target}`;
  };
  if (!total.error && text("page") && text("page") !== String(page)) redirect(pageUrl(page));
  const ordering = sorts[sort];
  const result = total.error ? total : await filteredQuery().order(ordering.column, { ascending: ordering.ascending, nullsFirst: false }).order("id").range((page - 1) * pageSize, page * pageSize - 1);
  const pages = [...new Set([1, ...Array.from({ length: 5 }, (_, i) => page - 2 + i).filter(number => number >= 1 && number <= totalPages), totalPages])].sort((a, b) => a - b);
  const productNames = new Map((products.data ?? []).map(product => [String(product.id), product.name]));
  return <main className="p-10"><div className="flex items-center justify-between"><h1 className="text-3xl font-bold">Blog Keyword Pool</h1><div className="flex gap-4"><Link href="/content/blog/keywords/settings" className="underline">AI 기준 설정</Link><Link href="/content/blog" className="underline">블로그 작업</Link></div></div>
    {settingsError && <p role="alert" className="my-3 text-red-600">{settingsError}</p>}
    <KeywordImport products={products.data ?? []} />
    <RelevanceEvaluation products={products.data ?? []} modelLabel={relevanceModelLabel} />
    <section aria-label="AI 추천" className="my-6 rounded-xl border bg-white p-5">
      <h2 className="text-lg font-semibold">AI 추천</h2>
      <p className="mt-2 text-xs text-zinc-500">현재 추천 모델: {recommendationModelLabel}</p>
      <p className="my-2 text-sm text-zinc-600">직접 탐색할 때 참고할 보조 기능입니다. AI 추천은 현재 기준으로 연관도 평가가 완료된 키워드를 사용합니다. 미사용 후보의 저장된 연관도와 검색량·검색 의도·기존 글 중복·다양성을 종합해 추천합니다.</p>
      <Link href={`/content/blog/keywords/recommend${productId ? `?productId=${productId}` : ""}`} className="inline-block rounded border px-4 py-2">AI 추천 5개 보기</Link>
    </section>
    <section aria-label="Keyword Pool 직접 탐색" className="mt-8 rounded-xl border bg-white p-5">
    <h2 className="text-xl font-semibold">Keyword Pool 직접 탐색</h2>
    <p className="mt-2 text-sm text-zinc-600">검색량과 저장된 연관도를 기준으로 사람이 직접 후보를 고르는 메인 목록입니다. 필터로 좁힌 뒤 작업을 생성하세요.</p>
    <form className="my-5 flex flex-wrap gap-3">
      <input type="hidden" name="page" value="1" />
      <select aria-label="Product 필터" name="product" defaultValue={productId} className="rounded border p-2"><option value="">전체 Product</option>{(products.data ?? []).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
      <input aria-label="키워드 검색" name="q" defaultValue={search} placeholder="키워드 검색" className="rounded border p-2" />
      <select aria-label="상태 필터" name="status" defaultValue={status} className="rounded border p-2"><option value="">전체 상태</option><option value="unused">미사용</option><option value="used">사용완료</option><option value="excluded">제외</option></select>
      <select aria-label="연관도 필터" name="relevance" defaultValue={relevance} className="rounded border p-2"><option value="">전체 연관도</option><option value="evaluated">현재 기준 평가됨</option><option value="unevaluated">미평가/기준변경 필요</option><option value="80">80 이상</option><option value="60">60 이상</option><option value="under40">40 미만</option></select>
      <select aria-label="정렬" name="sort" defaultValue={sort} className="rounded border p-2">{Object.entries(sorts).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}</select>
      <PageSizeSelect key={pageSize} pageSize={pageSize} />
      <button className="rounded border bg-white px-3 py-2">조회</button>
    </form>
    {result.error || products.error ? <p role="alert">Keyword Pool 조회 실패. migration과 연결 상태를 확인하세요.</p> : <>
      <p className="mb-3">총 {count.toLocaleString("ko-KR")}개 · {page} / {totalPages}페이지 · 현재 {count ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, count)}개</p>
      <div className="overflow-auto"><table className="w-full bg-white text-sm"><thead><tr>{["키워드", "Product", "상태", "검색량", "연관도", "경쟁도", "출처", "등록일", "작업"].map(label => <th key={label} className="p-3 text-left">{label}</th>)}</tr></thead><tbody>{(result.data ?? []).map(row => <tr key={row.id} className="border-t">
        <td className="p-3">{row.keyword}</td><td>{productNames.get(String(row.product_id)) ?? "-"}</td><td>{{ unused: "미사용", used: "사용완료", excluded: "제외" }[row.status as string] ?? row.status}</td><td>{row.search_volume ?? "-"}</td><td title={row.product_relevance_reason ?? undefined}>{row.product_relevance_score ?? "-"}{row.product_relevance_score != null && (!criteriaVersion || isStaleRelevance(row.product_relevance_score, row.product_relevance_criteria_version, criteriaVersion)) && <span className="ml-1 text-xs text-amber-800">이전 기준으로 평가됨</span>}</td><td>{row.competition ?? "-"}</td><td>{row.source || row.source_filename || "-"}</td><td>{new Date(row.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</td><td className="p-3"><KeywordActions id={row.id} productId={row.product_id} status={row.status} /></td>
      </tr>)}</tbody></table></div>
      {!result.data?.length && <p className="mt-4">키워드가 없습니다.</p>}
      <nav aria-label="키워드 페이지" className="mt-4 flex flex-wrap items-center gap-2">
        {([["처음", 1], ["이전", page - 1]] as const).map(([label, number]) => page === 1 ? <span key={label} aria-disabled="true" className="rounded border px-3 py-2 text-zinc-400">{label}</span> : <Link key={label} href={pageUrl(number)} className="rounded border px-3 py-2">{label}</Link>)}
        {pages.map((number, index) => <span key={number} className="inline-flex items-center gap-2">
          {index > 0 && number - pages[index - 1] > 1 && <span>…</span>}
          <Link href={pageUrl(number)} aria-label={`${number}페이지`} aria-current={number === page ? "page" : undefined} className={`rounded border px-3 py-2 ${number === page ? "bg-zinc-900 font-semibold text-white" : "bg-white"}`}>{number}</Link>
        </span>)}
        {([["다음", page + 1], ["마지막", totalPages]] as const).map(([label, number]) => page === totalPages ? <span key={label} aria-disabled="true" className="rounded border px-3 py-2 text-zinc-400">{label}</span> : <Link key={label} href={pageUrl(number)} className="rounded border px-3 py-2">{label}</Link>)}
        <span className="text-sm text-zinc-500">총 {totalPages}페이지</span>
      </nav>
    </>}
    </section>
  </main>;
}
