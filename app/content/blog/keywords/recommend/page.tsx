import Link from "next/link";
import { supabase } from "@/lib/supabase";
import RecommendationForm from "./RecommendationForm";

export const dynamic = "force-dynamic";
export default async function KeywordRecommendationPage({ searchParams }: { searchParams: Promise<{ productId?: string | string[] }> }) {
  const params = await searchParams;
  const { data, error } = await supabase.from("products").select("id,name").order("name");
  const products = data ?? [];
  const initialProductId = typeof params.productId === "string" && products.some(product => String(product.id) === params.productId) ? params.productId : "";
  return <main className="p-10">
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-bold">AI 키워드 추천</h1><Link href="/content/blog/keywords" className="underline">Keyword Pool</Link></div>
    {error ? <p role="alert" className="mt-6 text-red-600">Product 목록 조회에 실패했습니다.</p> : <RecommendationForm products={products} initialProductId={initialProductId} />}
  </main>;
}
