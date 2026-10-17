import Link from "next/link";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import KeywordImport from "./KeywordImport";
import KeywordActions from "./KeywordActions";
export const dynamic = "force-dynamic";
type Params = Record<string, string | string[] | undefined>;
const sorts = {
  search_volume_desc: { label: "검색량 높은 순", column: "search_volume", ascending: false },
  search_volume_asc: { label: "검색량 낮은 순", column: "search_volume", ascending: true },
  created_at_desc: { label: "최근 등록 순", column: "created_at", ascending: false },
  created_at_asc: { label: "오래된 등록 순", column: "created_at", ascending: true },
  keyword_asc: { label: "키워드 가나다순", column: "keyword", ascending: true },
  ad_count_desc: { label: "광고수 높은 순", column: "ad_count", ascending: false },
};
export default async function BlogKeywordsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const text = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const productId = /^\d+$/.test(text("product")) && Number.isSafeInteger(Number(text("product"))) ? text("product") : "";
  const status = ["unused", "used", "excluded"].includes(text("status")) ? text("status") : "";
  const search = text("q").trim().slice(0, 200);
  const requestedSort = text("sort") === "volume" ? "search_volume_desc" : text("sort") === "recent" ? "created_at_desc" : text("sort");
  const sort = Object.hasOwn(sorts, requestedSort) ? requestedSort as keyof typeof sorts : "search_volume_desc";
  const requestedPage = /^\d+$/.test(text("page")) && Number.isSafeInteger(Number(text("page"))) ? Math.max(1, Number(text("page"))) : 1;
  const filteredQuery = (head = false) => {
    let query = supabase.from("blog_keywords").select("id,product_id,keyword,status,search_volume,competition,ad_count,source,source_filename,created_at", { count: "exact", head });
    if (productId) query = query.eq("product_id", productId);
    if (status) query = query.eq("status", status);
    if (search) query = query.ilike("keyword", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
    return query;
  };
  const [total, products] = await Promise.all([filteredQuery(true), supabase.from("products").select("id,name").order("name")]);
  const count = total.count ?? 0, totalPages = Math.max(1, Math.ceil(count / 50));
  const page = Math.min(requestedPage, totalPages);
  const pageUrl = (number: number) => {
    const target = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") target.set(key, value);
      else if (Array.isArray(value)) value.forEach(item => target.append(key, item));
    }
    target.set("page", String(number));
    return `/content/blog/keywords?${target}`;
  };
  if (!total.error && text("page") && text("page") !== String(page)) redirect(pageUrl(page));
  const ordering = sorts[sort];
  const result = total.error ? total : await filteredQuery().order(ordering.column, { ascending: ordering.ascending, nullsFirst: false }).order("id").range((page - 1) * 50, page * 50 - 1);
  const pages = [...new Set([1, ...Array.from({ length: 5 }, (_, i) => page - 2 + i).filter(number => number >= 1 && number <= totalPages), totalPages])].sort((a, b) => a - b);
  const productNames = new Map((products.data ?? []).map(product => [String(product.id), product.name]));
  return <main className="p-10"><div className="flex items-center justify-between"><h1 className="text-3xl font-bold">Blog Keyword Pool</h1><Link href="/content/blog" className="underline">블로그 작업</Link></div>
    <KeywordImport products={products.data ?? []} />
    <form className="my-5 flex flex-wrap gap-3">
      <input type="hidden" name="page" value="1" />
      <select aria-label="Product 필터" name="product" defaultValue={productId} className="rounded border p-2"><option value="">전체 Product</option>{(products.data ?? []).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
      <input aria-label="키워드 검색" name="q" defaultValue={search} placeholder="키워드 검색" className="rounded border p-2" />
      <select aria-label="상태 필터" name="status" defaultValue={status} className="rounded border p-2"><option value="">전체 상태</option><option value="unused">미사용</option><option value="used">사용완료</option><option value="excluded">제외</option></select>
      <select aria-label="정렬" name="sort" defaultValue={sort} className="rounded border p-2">{Object.entries(sorts).map(([value, option]) => <option key={value} value={value}>{option.label}</option>)}</select>
      <button className="rounded border bg-white px-3 py-2">조회</button>
    </form>
    {result.error || products.error ? <p role="alert">Keyword Pool 조회 실패. migration과 연결 상태를 확인하세요.</p> : <>
      <p className="mb-3">총 {count.toLocaleString("ko-KR")}개 · {page} / {totalPages}페이지 · 현재 {count ? (page - 1) * 50 + 1 : 0}–{Math.min(page * 50, count)}개</p>
      <div className="overflow-auto"><table className="w-full bg-white text-sm"><thead><tr>{["키워드", "Product", "상태", "검색량", "경쟁도", "광고수", "출처", "등록일", "작업"].map(label => <th key={label} className="p-3 text-left">{label}</th>)}</tr></thead><tbody>{(result.data ?? []).map(row => <tr key={row.id} className="border-t">
        <td className="p-3">{row.keyword}</td><td>{productNames.get(String(row.product_id)) ?? "-"}</td><td>{{ unused: "미사용", used: "사용완료", excluded: "제외" }[row.status as string] ?? row.status}</td><td>{row.search_volume ?? "-"}</td><td>{row.competition ?? "-"}</td><td>{row.ad_count ?? "-"}</td><td>{row.source || row.source_filename || "-"}</td><td>{new Date(row.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</td><td className="p-3"><KeywordActions id={row.id} productId={row.product_id} status={row.status} /></td>
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
  </main>;
}
