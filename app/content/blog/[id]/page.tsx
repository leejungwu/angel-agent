export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import GenerateBlogDraft, { type Draft } from "./GenerateBlogDraft";
import DeleteBlogTaskButton from "../DeleteBlogTaskButton";
import EditBlogTask from "./EditBlogTask";

type BlogTask = {
  id: string | number;
  product_id: string | number | null;
  keyword: string | null;
  topic: string | null;
  purpose: string | null;
  instructions: string | null;
  status: string | null;
  created_at: string | null;
};

type Product = {
  name: string | null;
  brand: string | null;
};

export default async function BlogTaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data: task, error: taskError } = await supabase
    .from("blog_tasks")
    .select("id, product_id, keyword, topic, purpose, instructions, status, created_at")
    .eq("id", id)
    .maybeSingle()
    .returns<BlogTask>();

  // Invalid numeric or UUID identifiers cannot refer to an existing task.
  if (taskError?.code === "22P02" || (!taskError && !task)) {
    notFound();
  }

  let product: Product | null = null;
  let errorMessage = taskError?.message;

  if (task && !taskError && task.product_id != null) {
    const { data, error } = await supabase
      .from("products")
      .select("name, brand")
      .eq("id", task.product_id)
      .maybeSingle()
      .returns<Product>();

    product = data;
    errorMessage = error?.message;
  }

  let initialDraft: Draft | null = null;
  let draftErrorMessage: string | undefined;

  if (task && !errorMessage) {
    const { data, error } = await supabase
      .from("blog_drafts")
      .select("id, title, intro, sections, closing, status, model, created_at")
      .eq("blog_task_id", task.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
      .returns<Draft>();

    initialDraft = data;
    draftErrorMessage = error?.message;
  }

  return (
    <main className="p-10">
      <div className="flex max-w-2xl items-center justify-between">
        <h1 className="text-3xl font-bold">블로그 작업 상세</h1>
        {task && !taskError && <DeleteBlogTaskButton taskId={task.id} redirectToList />}
      </div>

      <div className="mt-8 max-w-2xl rounded-xl border bg-white p-6">
        {errorMessage ? (
          <p role="alert">DB 오류: {errorMessage}</p>
        ) : task ? (
          <>
            <p>상품명: {product?.name || "-"}</p>
            <p className="mt-2">브랜드: {product?.brand || "-"}</p>
            <EditBlogTask
              key={task.id}
              taskId={task.id}
              initialFields={{
                keyword: task.keyword,
                topic: task.topic,
                purpose: task.purpose,
                instructions: task.instructions,
              }}
            />
            <p className="mt-2">상태: {task.status || "-"}</p>
            <p className="mt-2">
              생성일: {task.created_at
                ? new Date(task.created_at).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })
                : "-"}
            </p>
          </>
        ) : null}
      </div>
      {draftErrorMessage && (
        <p role="alert" className="mt-4 text-red-600">
          초안 조회 오류: {draftErrorMessage}
        </p>
      )}
      {task && !errorMessage && (
        <GenerateBlogDraft
          key={`${task.id}:${initialDraft?.id ?? "none"}`}
          taskId={Number(task.id)}
          initialDraft={initialDraft}
        />
      )}
    </main>
  );
}
