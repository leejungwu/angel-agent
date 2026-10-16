import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { AD_PLATFORMS, AD_MEDIA_TYPES, type AdReference } from "@/lib/ads/references";
export const dynamic = "force-dynamic";

export default async function AdReferencesPage() {
  const [{ data, error }, { data: products, error: productError }] = await Promise.all([
    supabase.from("ad_references").select("*").order("created_at", { ascending: false }).order("id"),
    supabase.from("products").select("id,name"),
  ]);
  const productNames = new Map((products ?? []).map(product => [String(product.id), product.name]));
  return <main className="p-10">
    <div className="flex items-center justify-between"><div><h1 className="text-3xl font-bold">Ads · Reference</h1><p className="mt-2 text-zinc-500">참고할 광고와 소재를 저장합니다.</p></div>
      <Link href="/ads/references/new" className="rounded-lg bg-black px-4 py-3 text-white">광고 Reference 등록</Link></div>
    {error || productError ? <p role="alert" className="mt-6 text-red-600">목록 조회에 실패했습니다. DB migration과 연결 상태를 확인하세요.</p>
      : !data?.length ? <p className="mt-6">등록된 광고 Reference가 없습니다.</p>
        : <div className="mt-6 grid gap-4">{(data as AdReference[]).map(reference => <Link key={reference.id} href={`/ads/references/${reference.id}`} className="rounded-xl border bg-white p-5 hover:bg-zinc-50">
          <h2 className="text-xl font-bold">{reference.title}</h2><p>{reference.brand_name} · {AD_PLATFORMS[reference.platform]} · {AD_MEDIA_TYPES[reference.media_type]}</p>
          <p className="mt-2 text-sm">Product: {reference.product_id ? productNames.get(String(reference.product_id)) ?? "연결 상품 확인 필요" : "연결 없음"}</p>
          <p className="text-sm">태그: {reference.tags.join(", ") || "없음"}</p>
          {reference.asset_storage_path && <p className="text-sm">첨부: {reference.original_file_name}</p>}
          <p className="mt-2 text-sm text-zinc-500">등록 {new Date(reference.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
        </Link>)}</div>}
  </main>;
}
