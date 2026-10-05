import DeleteProductButton from "./DeleteProductButton";
import Link from "next/link";
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
      <div className="flex items-center justify-between max-w-2xl">
        <div>
          <h1 className="text-3xl font-bold">{product.name}</h1>
          <p className="mt-2 text-zinc-500">{product.brand}</p>
        </div>

        <div className="flex gap-2">
        <Link
          href={`/products/${product.id}/edit`}
          className="rounded-lg bg-black px-4 py-2 text-white"
        >
          수정
        </Link>

        <DeleteProductButton id={product.id} />
      </div>
      </div>

      <div className="mt-8 max-w-2xl rounded-xl border bg-white p-6">
        <p>판매가: {product.selling_price?.toLocaleString()}원</p>
        <p className="mt-2">
          원가: {product.cost_price?.toLocaleString()}원
        </p>
        <p className="mt-2">USP: {product.usp}</p>
        <p className="mt-2 whitespace-pre-wrap">
          타겟 고객: {product.target_customer ?? "-"}
        </p>
        <p className="mt-2 whitespace-pre-wrap">
          고객 문제: {product.customer_problem ?? "-"}
        </p>
        <p className="mt-2 whitespace-pre-wrap">
          제품 메모: {product.notes ?? "-"}
        </p>
      </div>
    </main>
  );
}
