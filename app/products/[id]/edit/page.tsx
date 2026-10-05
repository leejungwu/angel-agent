"use client";

import { useParams, useRouter } from "next/navigation"; 
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function EditProductPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [usp, setUsp] = useState("");
  const [targetCustomer, setTargetCustomer] = useState("");
  const [customerProblem, setCustomerProblem] = useState("");
  const [notes, setNotes] = useState("");

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
    setTargetCustomer(data.target_customer ?? "");
    setCustomerProblem(data.customer_problem ?? "");
    setNotes(data.notes ?? "");
    }

    loadProduct();
  }, [id]);

  async function updateProduct() {
    const { data, error } = await supabase
    .from("products")
    .update({
        name: name,
        brand: brand,
        selling_price: Number(sellingPrice),
        cost_price: Number(costPrice),
        usp: usp,
        target_customer: targetCustomer,
        customer_problem: customerProblem,
        notes: notes,
    })
    .eq("id", Number(id))
    .select()
    .single();

    if (error) {
    alert(error.message);
    return;
    }

  alert(`수정 완료: ${data.name}`);
  router.push(`/products/${id}`);
  router.refresh();
}

    async function deleteProduct() {
        const confirmed = confirm("정말 이 상품을 삭제하시겠습니까?");

    if (!confirmed) {
        return;
    }

    const { data, error } = await supabase
    .from("products")
    .delete()
    .eq("id", Number(id))
    .select()
    .single();

    if (error) {
        alert(error.message);
        return;
    }

    alert(`삭제 완료: ${data.name}`);
    router.push("/products");
    router.refresh();
    }

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

        
          <div>
            <label htmlFor="target-customer" className="mb-2 block text-sm font-medium">
              타겟 고객
            </label>
            <textarea
              id="target-customer"
              className="min-h-28 w-full rounded-lg border px-4 py-3"
              value={targetCustomer}
              onChange={(e) => setTargetCustomer(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="customer-problem" className="mb-2 block text-sm font-medium">
              고객 문제
            </label>
            <textarea
              id="customer-problem"
              className="min-h-28 w-full rounded-lg border px-4 py-3"
              value={customerProblem}
              onChange={(e) => setCustomerProblem(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="notes" className="mb-2 block text-sm font-medium">
              제품 메모
            </label>
            <textarea
              id="notes"
              className="min-h-28 w-full rounded-lg border px-4 py-3"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>


            <button
                className="rounded-lg bg-black px-5 py-3 font-medium text-white"
                onClick={updateProduct} 
            >
                수정
            </button>

            <button
                onClick={deleteProduct}
                className="rounded-lg border border-red-500 px-4 py-2 text-red-500"
                >
                삭제
            </button>
        </div>
      </div>
    </div>
  </main>
);
}
