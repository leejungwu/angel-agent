import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: product, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", Number(id))
    .single();

  if (error || !product) {
    notFound();
  }

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">{product.name}</h1>
      <p className="mt-2 text-zinc-500">{product.brand}</p>

      <div className="mt-8 max-w-2xl rounded-xl border bg-white p-6">
        <p>판매가: {product.selling_price?.toLocaleString()}원</p>
        <p className="mt-2">원가: {product.cost_price?.toLocaleString()}원</p>
        <p className="mt-2">USP: {product.usp}</p>
      </div>
    </main>
  );
}