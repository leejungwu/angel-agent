export const dynamic = "force-dynamic";

import Link from "next/link";
import { supabase } from "@/lib/supabase";

type BlogTask = {
  id: string | number;
  product_id: string | number | null;
  keyword: string | null;
  topic: string | null;
  purpose: string | null;
  status: string | null;
  created_at: string | null;
};

export default async function BlogPage() {
  const { data: tasks, error: tasksError } = await supabase
    .from("blog_tasks")
    .select("id, product_id, keyword, topic, purpose, status, created_at")
    .order("created_at", { ascending: false })
    .returns<BlogTask[]>();

  const productNames = new Map<string, string>();
  let errorMessage = tasksError?.message;

  if (!tasksError && tasks?.length) {
    const productIds = [
      ...new Set(tasks.flatMap((task) =>
        task.product_id == null ? [] : [task.product_id]
      )),
    ];

    if (productIds.length) {
      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, name")
        .in("id", productIds)
        .returns<{ id: string | number; name: string | null }[]>();

      errorMessage = productsError?.message;
      for (const product of products ?? []) {
        if (product.name) {
          productNames.set(String(product.id), product.name);
        }
      }
    }
  }

  return (
    <main className="p-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">AI Blog</h1>
        <Link
          href="/content/blog/new"
          className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
        >
          새 블로그 작업
        </Link>
      </div>

      <div className="mt-8">
        {errorMessage ? (
          <p role="alert">DB 오류: {errorMessage}</p>
        ) : !tasks?.length ? (
          <p className="text-zinc-500">아직 생성된 블로그 작업이 없습니다.</p>
        ) : (
          tasks.map((task) => (
            <Link
              key={task.id}
              href={`/content/blog/${task.id}`}
              className="mb-4 block rounded-lg border bg-white p-5 hover:bg-zinc-50"
            >
              <h2 className="text-xl font-bold">
                상품명: {productNames.get(String(task.product_id)) ?? "상품 정보 없음"}
              </h2>
              <p className="mt-1 text-zinc-500">키워드: {task.keyword || "-"}</p>
              <p className="mt-3">주제: {task.topic || "-"}</p>
              <p>목적: {task.purpose || "-"}</p>
              <p>상태: {task.status || "-"}</p>
              <p>
                생성일: {task.created_at
                  ? new Date(task.created_at).toLocaleString("ko-KR", {
                      timeZone: "Asia/Seoul",
                    })
                  : "-"}
              </p>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
