"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function EditProductPage() {
  const params = useParams();
  const id = params.id as string;

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [usp, setUsp] = useState("");

  useEffect(() => {
  async function loadProduct() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("id", Number(id))
      .single();

    if (error) {
      console.error(error);
      return;
    }

    setName(data.name ?? "");
    setBrand(data.brand ?? "");
    setSellingPrice(
        data.selling_price !== null ? String(data.selling_price) : ""
    );
    setCostPrice(
        data.cost_price !== null ? String(data.cost_price) : ""
    );
    setUsp(data.usp ?? "");
    }

    loadProduct();
  }, [id]);

return (
  <main className="p-10">
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold">상품 수정</h1>
      <p className="mt-2 text-sm text-zinc-500">
        상품 ID: {id}
      </p>

      <div className="mt-8 rounded-xl border bg-white p-6">
        <div className="flex flex-col gap-5">

          <div>
            <label className="mb-2 block text-sm font-medium">
              상품명
            </label>
            <input
              className="w-full rounded-lg border px-4 py-3"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              브랜드
            </label>
            <input
              className="w-full rounded-lg border px-4 py-3"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              판매가
            </label>
            <input
              type="number"
              className="w-full rounded-lg border px-4 py-3"
              value={sellingPrice}
              onChange={(e) => setSellingPrice(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              원가
            </label>
            <input
              type="number"
              className="w-full rounded-lg border px-4 py-3"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">
              USP
            </label>
            <textarea
              className="min-h-28 w-full rounded-lg border px-4 py-3"
              value={usp}
              onChange={(e) => setUsp(e.target.value)}
            />
          </div>

          <button
            className="rounded-lg bg-black px-5 py-3 font-medium text-white"
          >
            수정 저장
          </button>

        </div>
      </div>
    </div>
  </main>
);
}