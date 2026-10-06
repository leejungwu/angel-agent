import DeleteProductButton from "./DeleteProductButton";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Image from "next/image";
import UploadProductAssets from "./UploadProductAssets";

type ProductAsset = {
  id: string | number;
  file_name: string | null;
  storage_path: string;
  alt_text: string | null;
  is_primary: boolean;
  sort_order: number;
};

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

  const { data: assets, error: assetsError } = await supabase
    .from("product_assets")
    .select("id, file_name, storage_path, alt_text, is_primary, sort_order")
    .eq("product_id", product.id)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .returns<ProductAsset[]>();

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
      <section className="mt-8 max-w-2xl rounded-xl border bg-white p-6">
        <h2 className="text-xl font-bold">Product Assets</h2>
        <UploadProductAssets productId={product.id} />
        {assetsError ? (
          <p role="alert" className="mt-4 text-red-600">
            상품 이미지 조회 오류: {assetsError.message}
          </p>
        ) : !assets?.length ? (
          <p className="mt-4 text-zinc-500">등록된 상품 이미지가 없습니다.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {assets.map((asset) => (
              <li key={asset.id} className="rounded-lg border p-4">
                <Image
                  src={supabase.storage.from("product-assets").getPublicUrl(asset.storage_path).data.publicUrl}
                  alt={asset.alt_text || asset.file_name || "상품 이미지"}
                  width={160}
                  height={120}
                  unoptimized
                  className="mb-3 h-32 w-40 rounded-lg border object-contain"
                />
                <p className="break-words font-medium">파일명: {asset.file_name || "-"}</p>
                <p className="mt-2 break-all">저장 경로: {asset.storage_path}</p>
                <p className="mt-2 whitespace-pre-wrap break-words">대체 텍스트: {asset.alt_text || "-"}</p>
                <p className="mt-2">대표 이미지: {asset.is_primary ? "예" : "아니오"}</p>
                <p className="mt-2">정렬 순서: {asset.sort_order}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
