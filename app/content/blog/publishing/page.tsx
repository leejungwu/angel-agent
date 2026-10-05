export const dynamic = "force-dynamic";

import Link from "next/link";
import { supabase } from "@/lib/supabase";

type ApprovedDraft = {
  id: string | number;
  blog_task_id: string | number;
  product_id: string | number | null;
  title: string | null;
  status: string;
  model: string | null;
  created_at: string | null;
};

type TaskInfo = {
  id: string | number;
  keyword: string | null;
  topic: string | null;
  purpose: string | null;
};

export default async function PublishingQueuePage() {
  const { data: drafts, error } = await supabase
    .from("blog_drafts")
    .select("id, blog_task_id, product_id, title, status, model, created_at")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .returns<ApprovedDraft[]>();

  let errorMessage = error?.message;
  const productNames = new Map<string, string>();
  const tasksById = new Map<string, TaskInfo>();

  if (!error && drafts?.length) {
    const productIds = [...new Set(drafts.flatMap((draft) =>
      draft.product_id == null ? [] : [draft.product_id]))];
    const taskIds = [...new Set(drafts.map((draft) => draft.blog_task_id))];

    const [productsResult, tasksResult] = await Promise.all([
      productIds.length
        ? supabase.from("products").select("id, name").in("id", productIds)
            .returns<{ id: string | number; name: string | null }[]>()
        : Promise.resolve({ data: [], error: null }),
      supabase.from("blog_tasks").select("id, keyword, topic, purpose")
        .in("id", taskIds).returns<TaskInfo[]>(),
    ]);

    errorMessage = productsResult.error?.message || tasksResult.error?.message;
    for (const product of productsResult.data ?? []) {
      if (product.name) productNames.set(String(product.id), product.name);
    }
    for (const task of tasksResult.data ?? []) {
      tasksById.set(String(task.id), task);
    }
  }

  return (
    <main className="p-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Publishing Queue</h1>
        <Link href="/content/blog" className="rounded-lg border bg-white px-4 py-2 text-sm font-medium">
          블로그 작업 목록
        </Link>
      </div>

      <div className="mt-8">
        {errorMessage ? (
          <p role="alert">DB 오류: {errorMessage}</p>
        ) : !drafts?.length ? (
          <p className="text-zinc-500">발행 대기 중인 승인 초안이 없습니다.</p>
        ) : drafts.map((draft) => {
          const task = tasksById.get(String(draft.blog_task_id));
          return (
            <Link
              key={draft.id}
              href={`/content/blog/${draft.blog_task_id}`}
              className="mb-4 block rounded-lg border bg-white p-5 hover:bg-zinc-50"
            >
              <h2 className="text-xl font-bold">{draft.title || "-"}</h2>
              <p className="mt-1 text-zinc-500">
                상품명: {productNames.get(String(draft.product_id)) ?? "상품 정보 없음"}
              </p>
              <p className="mt-3">키워드: {task?.keyword || "-"}</p>
              <p>주제: {task?.topic || "-"}</p>
              <p>목적: {task?.purpose || "-"}</p>
              <p>상태: {draft.status}</p>
              <p>모델: {draft.model || "-"}</p>
              <p>
                생성일: {draft.created_at
                  ? new Date(draft.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
                  : "-"}
              </p>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
