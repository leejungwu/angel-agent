"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function NewProductPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [usp, setUsp] = useState("");
  const [targetCustomer, setTargetCustomer] = useState("");
  const [customerProblem, setCustomerProblem] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setLoading(true);

    const { error } = await supabase.from("products").insert({
      name,
      brand,
      selling_price: sellingPrice ? Number(sellingPrice) : null,
      cost_price: costPrice ? Number(costPrice) : null,
      usp,
      target_customer: targetCustomer,
      customer_problem: customerProblem,
      notes,
    });

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    router.push("/products");
    router.refresh();
  }

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">새 상품 등록</h1>

      <div className="mt-8 max-w-2xl rounded-xl border bg-white p-6">
        <div className="flex flex-col gap-5">
          <input
            className="rounded-lg border px-4 py-3"
            placeholder="상품명"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <input
            className="rounded-lg border px-4 py-3"
            placeholder="브랜드"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />

          <input
            type="number"
            className="rounded-lg border px-4 py-3"
            placeholder="판매가"
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
          />

          <input
            type="number"
            className="rounded-lg border px-4 py-3"
            placeholder="원가"
            value={costPrice}
            onChange={(e) => setCostPrice(e.target.value)}
          />

          <textarea
            className="min-h-24 rounded-lg border px-4 py-3"
            placeholder="USP"
            value={usp}
            onChange={(e) => setUsp(e.target.value)}
          />

          <textarea
            className="min-h-24 rounded-lg border px-4 py-3"
            placeholder="타겟 고객"
            aria-label="타겟 고객"
            value={targetCustomer}
            onChange={(e) => setTargetCustomer(e.target.value)}
          />

          <textarea
            className="min-h-24 rounded-lg border px-4 py-3"
            placeholder="고객 문제"
            aria-label="고객 문제"
            value={customerProblem}
            onChange={(e) => setCustomerProblem(e.target.value)}
          />

          <textarea
            className="min-h-24 rounded-lg border px-4 py-3"
            placeholder="제품 메모"
            aria-label="제품 메모"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-black px-5 py-3 text-white"
          >
            {loading ? "등록 중..." : "상품 등록"}
          </button>
        </div>
      </div>
    </main>
  );
}
