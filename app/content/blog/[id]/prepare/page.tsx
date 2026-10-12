import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { BlogTaskAsset } from "@/lib/blog-task-assets";
import PreparationPanel from "./PreparationPanel";
import { composeBlogBody } from "@/lib/blog-publishing/preparation";

export const dynamic = "force-dynamic";

export default async function BlogPreparationPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ draftId?: string }>;
}) {
  const { id } = await params;
  const { draftId } = await searchParams;
  if (!/^[1-9]\d*$/.test(id) || (draftId !== undefined && !/^[1-9]\d*$/.test(draftId))) notFound();
  const { data: task, error: taskError } = await supabase.from("blog_tasks").select("id").eq("id", id).maybeSingle();
  if (!task && !taskError) notFound();
  let query = supabase.from("blog_drafts").select("id,title,intro,sections,closing,status").eq("blog_task_id", id);
  if (draftId) query = query.eq("id", draftId);
  const [draftResult, assetResult] = await Promise.all([
    query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("blog_task_assets").select("id,storage_path,file_name,sort_order").eq("blog_task_id", id)
      .order("sort_order", { ascending: true }).order("id", { ascending: true }).returns<BlogTaskAsset[]>(),
  ]);
  const draft = draftResult.data;
  let sections: unknown = draft?.sections;
  try { if (typeof sections === "string") sections = JSON.parse(sections); } catch { sections = null; }
  const valid = draft && typeof draft.title === "string" &&
    (draft.intro == null || typeof draft.intro === "string") && (draft.closing == null || typeof draft.closing === "string") &&
    Array.isArray(sections) && sections.every((section) => section && typeof section.body === "string" && (section.heading == null || typeof section.heading === "string"));
  return <main className="mx-auto max-w-6xl p-10">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-bold">네이버 발행 준비</h1>
      <Link href={`/content/blog/${id}`} className="rounded-lg border bg-white px-4 py-2 text-sm">작업 상세</Link>
    </div>
    {taskError || draftResult.error ? <p role="alert" className="mt-6 text-red-600">발행 준비 자료를 조회하지 못했습니다.</p>
      : !draft ? <p className="mt-6 text-zinc-500">작업 상세에서 AI 초안을 먼저 생성해 주세요.</p>
      : !valid || !composeBlogBody({ intro: draft.intro, sections: sections as { heading?: string; body: string }[], closing: draft.closing }) ? <p role="alert" className="mt-6 text-red-600">초안의 제목·본문 형식을 확인해 주세요.</p>
      : <><p className="mt-3 text-sm text-zinc-500">초안 #{draft.id} · {draft.status === "approved" ? "승인된 초안" : "검수 전 초안"} · 네이버에서 직접 검수하고 발행하세요.</p>
        <PreparationPanel key={draft.id} taskId={id} draft={{ title: draft.title, intro: draft.intro, sections: sections as { heading?: string; body: string }[], closing: draft.closing }} assets={assetResult.data ?? []} assetError={assetResult.error?.message} /></>}
  </main>;
}
