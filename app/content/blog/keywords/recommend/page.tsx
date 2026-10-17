import Link from "next/link";
import { supabase } from "@/lib/supabase";
import RecommendationForm from "./RecommendationForm";
import { readKeywordAISettings } from "@/lib/blog-keywords/ai-settings";
import { BLOG_MODEL_OPTIONS } from "@/lib/blog-generation/models";

export const dynamic = "force-dynamic";
export default async function KeywordRecommendationPage({ searchParams }: { searchParams: Promise<{ productId?: string | string[] }> }) {
  const params = await searchParams;
  let modelLabel = "-", settingsError = "";
  try {
    const settings = await readKeywordAISettings();
    modelLabel = BLOG_MODEL_OPTIONS.openai.find(model => model.value === settings.recommendationModel)?.label ?? "-";
  } catch (cause) { settingsError = cause instanceof Error ? cause.message : "AI 모델 설정 조회 실패"; }
  const { data, error } = await supabase.from("products").select("id,name").order("name");
  const products = data ?? [];
  const initialProductId = typeof params.productId === "string" && products.some(product => String(product.id) === params.productId) ? params.productId : "";
  return <main className="p-10">
    <div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-3xl font-bold">AI 키워드 추천</h1><Link href="/content/blog/keywords" className="underline">Keyword Pool</Link></div>
    <p className="mt-2 text-xs text-zinc-500">현재 추천 모델: {modelLabel}</p>
    {error || settingsError ? <p role="alert" className="mt-6 text-red-600">{settingsError || "Product 목록 조회에 실패했습니다."}</p> : <RecommendationForm products={products} initialProductId={initialProductId} />}
  </main>;
}
