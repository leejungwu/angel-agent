export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import GenerateBlogDraft, { type Draft } from "./GenerateBlogDraft";
import DeleteBlogTaskButton from "../DeleteBlogTaskButton";
import EditBlogTask from "./EditBlogTask";
import BlogTaskAssets from "./BlogTaskAssets";
import type { BlogTaskAsset } from "@/lib/blog-task-assets";
import { BLOG_PRESET_FIELDS, type BlogPreset } from "@/lib/blog-generation/presets";

type BlogTask = {
  id: string | number;
  product_id: string | number | null;
  keyword: string | null;
  topic: string | null;
  instructions: string | null;
  preset_id: string | null;
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
    .select("id, product_id, keyword, topic, instructions, status, created_at, preset_id")
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
  let draftHistory: Draft[] = [];
  let draftErrorMessage: string | undefined;
  let assets: BlogTaskAsset[] = [];
  let assetsErrorMessage: string | undefined;
  let presets: BlogPreset[] = [];
  let presetsErrorMessage: string | undefined;

  if (task && !errorMessage) {
    const { data: presetRows, error: presetsError } = await supabase.from("blog_prompt_presets")
      .select(BLOG_PRESET_FIELDS).order("is_default", { ascending: false }).order("created_at").order("id")
      .returns<BlogPreset[]>();
    presets = presetRows ?? [];
    presetsErrorMessage = presetsError ? "프리셋 조회 실패: DB migration 적용 여부를 확인해 주세요." : undefined;
    const { data: taskAssets, error: assetError } = await supabase.from("blog_task_assets")
      .select("id, storage_path, file_name, sort_order")
      .eq("blog_task_id", task.id)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .returns<BlogTaskAsset[]>();
    assets = taskAssets ?? [];
    assetsErrorMessage = assetError?.message;

    const { data, error } = await supabase
      .from("blog_drafts")
      .select("id, title, intro, sections, closing, status, model, provider, generation_snapshot, created_at")
      .eq("blog_task_id", task.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .returns<Draft[]>();

    draftHistory = data ?? [];
    initialDraft = draftHistory[0] ?? null;
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
      {presetsErrorMessage && <p role="alert" className="mt-4 text-red-600">{presetsErrorMessage}</p>}
      {task && !errorMessage && (
        <BlogTaskAssets taskId={task.id} assets={assets} errorMessage={assetsErrorMessage} />
      )}
      {task && !errorMessage && (
        <GenerateBlogDraft
          key={task.id}
          taskId={Number(task.id)}
          initialDraft={initialDraft}
          initialDrafts={draftHistory}
          initialPresetId={task.preset_id ?? ""}
          initialPresets={presets}
        />
      )}
    </main>
  );
}
