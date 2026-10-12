export const dynamic = "force-dynamic";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default async function PublishingPreparationPage() {
  const { data: drafts, error } = await supabase.from("blog_drafts")
    .select("id,blog_task_id,title,model,created_at").eq("status", "approved")
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  return <main className="p-10">
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-3xl font-bold">네이버 발행 준비</h1>
      <Link href="/content/blog" className="rounded-lg border bg-white px-4 py-2 text-sm">블로그 작업 목록</Link>
    </div>
    <p className="mt-3 text-zinc-500">승인한 초안의 제목·본문을 복사하고 사진을 내려받아 네이버에서 직접 발행하세요.</p>
    <div className="mt-8 space-y-4">
      {error ? <p role="alert">초안을 조회하지 못했습니다.</p> : !drafts?.length ? <p className="text-zinc-500">승인된 초안이 없습니다.</p>
        : drafts.map((draft) => <article key={draft.id} className="rounded-xl border bg-white p-5">
          <h2 className="text-xl font-bold">{draft.title || "제목 없음"}</h2>
          <p className="mt-2 text-sm text-zinc-500">작업 #{draft.blog_task_id} · {draft.model || "모델 정보 없음"}</p>
          <Link href={`/content/blog/${draft.blog_task_id}/prepare?draftId=${draft.id}`} className="mt-4 inline-block rounded-lg bg-black px-4 py-2 text-sm text-white">발행 준비 보기</Link>
        </article>)}
    </div>
  </main>;
}
