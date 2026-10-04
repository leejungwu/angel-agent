"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function DeleteProductButton({
  id,
}: {
  id: number;
}) {
    const router = useRouter();

    async function deleteProduct() {
  const confirmed = confirm("정말 이 상품을 삭제하시겠습니까?");

  if (!confirmed) {
    return;
  }

  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", id);

  if (error) {
    alert(error.message);
    return;
  }

  alert("상품이 삭제되었습니다.");
  router.push("/products");
  router.refresh();
}

  return (
    <button
    onClick={deleteProduct}
    className="rounded-lg border border-red-500 px-4 py-2 text-red-500"
    >
    삭제
    </button>
  );
}