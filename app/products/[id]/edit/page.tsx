"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function EditProductPage() {
  const params = useParams();
  const id = params.id as string;

  const [name, setName] = useState("");

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
    }

    loadProduct();
  }, [id]);

  return (
    <main className="p-10">
      <h1 className="text-3xl font-bold">상품 수정</h1>
      <p className="mt-4">상품 ID: {id}</p>
      <p className="mt-2">상품명: {name}</p>
    </main>
  );
}