export const dynamic = "force-dynamic";
import Link from "next/link";
import { formatScheduledAt } from "@/lib/blog-publishing/schedule";
import { supabase } from "@/lib/supabase";
import { isStalePublicationInserting, parsePublicationSnapshot, type PublicationJob } from "@/lib/blog-publishing/publication-jobs";
import RemovePublicationJob from "./RemovePublicationJob";
import PublicationJobTransition from "./PublicationJobTransition";

const STATUS_LABELS: Record<PublicationJob["status"], string> = {
  queued: "발행 대기", inserting: "네이버 입력 중", inserted: "네이버 입력 완료", published: "발행 완료", failed: "입력 실패",
};
function date(value: string | null) {
  return value ? new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-";
}

export default async function PublishingQueuePage() {
  const { data, error } = await supabase.from("blog_publication_jobs")
    .select("id,blog_task_id,blog_draft_id,status,publish_mode,scheduled_at,finalize_mode,execution_snapshot,created_at,started_at,inserted_at,published_at,published_url,error_message")
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  return <main className="p-10">
    <div className="flex items-center justify-between gap-4">
      <h1 className="text-3xl font-bold">발행 대기열</h1>
      <Link href="/content/blog" className="rounded-lg border bg-white px-4 py-2 text-sm">블로그 작업 목록</Link>
    </div>
    <p className="mt-3 text-zinc-500">등록 당시의 제목·본문·사진이 고정된 작업입니다. Extension에서 발행 대기 Job을 선택해 입력하세요. 최종 검수·발행은 네이버에서 직접 진행합니다.</p>
    <div className="mt-8 space-y-4">
      {error ? <p role="alert">발행 대기열을 조회하지 못했습니다. DB migration 적용 상태를 확인해 주세요.</p>
        : !data?.length ? <p className="text-zinc-500">등록된 발행 작업이 없습니다.</p>
          : data.map(job => {
            const staleInserting = isStalePublicationInserting(job);
            let snapshot;
            try { snapshot = parsePublicationSnapshot(job.execution_snapshot); }
            catch { return <article key={job.id} className="rounded-xl border bg-white p-5"><p role="alert">Job {job.id}: 저장된 실행 자료를 확인할 수 없습니다.</p></article>; }
            return <article key={job.id} className="rounded-xl border bg-white p-5">
              <h2 className="text-xl font-bold">{snapshot.title}</h2>
              <p className="mt-2 text-sm text-zinc-500">Task #{job.blog_task_id} · Draft #{job.blog_draft_id} · {staleInserting ? "입력이 중단된 것으로 보입니다" : STATUS_LABELS[job.status as PublicationJob["status"]] ?? "상태 확인 필요"} · 사진 {snapshot.images.length}장</p>
              <p className="mt-2 text-sm">{job.publish_mode === "scheduled" && job.scheduled_at ? `예약 발행 · ${formatScheduledAt(job.scheduled_at)} (한국 시간)` : "일반 발행"}</p>
              <p className="mt-1 text-sm">최종 동작: {job.finalize_mode === "auto" ? "자동 예약 등록" : "직접 확인"}</p>
              <dl className="mt-3 space-y-1 text-sm text-zinc-500">
                <div><dt className="inline">Queue 등록: </dt><dd className="inline">{date(job.created_at)}</dd></div>
                <div><dt className="inline">네이버 입력 완료: </dt><dd className="inline">{date(job.inserted_at)}</dd></div>
                <div><dt className="inline">발행 완료: </dt><dd className="inline">{date(job.published_at)}</dd></div>
              </dl>
              {job.error_message && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-red-600">{job.error_message}</p>}
              {job.status === "published" && job.published_url && (
                /^https?:\/\//i.test(job.published_url)
                  ? <a href={job.published_url} target="_blank" rel="noopener noreferrer" className="mt-3 block break-all text-sm underline">{job.published_url}</a>
                  : <p className="mt-3 break-all text-sm text-zinc-500">{job.published_url}</p>
              )}
              {job.status === "queued" && <RemovePublicationJob jobId={job.id} />}
              {(job.status === "inserted" || job.status === "failed") && <PublicationJobTransition jobId={job.id} status={job.status} />}
              {staleInserting && <PublicationJobTransition jobId={job.id} status="inserting" />}
            </article>;
          })}
    </div>
  </main>;
}
