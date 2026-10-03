import { supabase } from "@/lib/supabase";

export default async function ProductsPage() {
  const { data: products, error } = await supabase
    .from("products")
    .select("*")
    .order("id", { ascending: true });

  if (error) {
    return (
      <main className="p-10">
        <p>DB 오류: {error.message}</p>
      </main>
    );
  }

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">Products</h1>

      <div className="mt-8">
        {products?.map((product) => (
          <div
            key={product.id}
            className="mb-4 rounded-lg border bg-white p-5"
          >
            <h2 className="text-xl font-bold">{product.name}</h2>
            <p className="mt-1 text-zinc-500">{product.brand}</p>
            <p className="mt-3">
              판매가: {product.selling_price?.toLocaleString()}원
            </p>
            <p>USP: {product.usp}</p>
          </div>
        ))}
      </div>
    </main>
  );
}