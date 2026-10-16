import { supabase } from "@/lib/supabase";
import { parseFinalizeMode, parsePublicationSchedule } from "./schedule";
import { BLOG_TASK_ASSET_BUCKET, isBlogTaskAssetPath } from "../blog-task-assets";
import { parsePublicationSnapshot, PublicationJobError, type PublicationJob } from "./publication-jobs";

export const PUBLICATION_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function getPublicationJob(id: string): Promise<PublicationJob> {
  if (!PUBLICATION_JOB_ID.test(id)) throw new PublicationJobError("Job ID를 확인해 주세요.");
  const { data, error } = await supabase.from("blog_publication_jobs").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Job 조회 실패");
  if (!data) throw new PublicationJobError("발행 작업이 없습니다.", 404);
  return { ...data, execution_snapshot: parsePublicationSnapshot(data.execution_snapshot) };
}

export async function listExtensionPublicationJobs() {
  const { data, error } = await supabase.from("blog_publication_jobs").select("id,blog_task_id,blog_draft_id,status,execution_snapshot,publish_mode,scheduled_at,finalize_mode")
    .in("status", ["queued", "failed"]).order("created_at", { ascending: false }).order("id", { ascending: false });
  if (error) throw new Error("Job 목록 조회 실패");
  return (data ?? []).map(row => {
    const snapshot = parsePublicationSnapshot(row.execution_snapshot);
    return { ...parsePublicationSchedule({ publishMode: row.publish_mode, scheduledAt: row.scheduled_at }), finalizeMode: parseFinalizeMode(row.finalize_mode, row.publish_mode), id: row.id, taskId: row.blog_task_id, draftId: row.blog_draft_id, status: row.status, title: snapshot.title, imageCount: snapshot.images.length };
  });
}

export async function listReservationRechecks() {
  const { data, error } = await supabase.from("blog_publication_jobs")
    .select("id,blog_task_id,blog_draft_id,execution_snapshot,status,publish_mode,finalize_mode,scheduled_at,reservation_confirmed_at")
    .eq("status", "inserted").eq("publish_mode", "scheduled").eq("finalize_mode", "auto").is("reservation_confirmed_at", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false });
  if (error) throw new Error("예약 확인 필요 목록 조회 실패");
  return (data ?? []).map(row => {
    const snapshot = parsePublicationSnapshot(row.execution_snapshot);
    return { id: row.id, taskId: row.blog_task_id, draftId: row.blog_draft_id, title: snapshot.title, imageCount: snapshot.images.length,
      status: row.status, publishMode: row.publish_mode, finalizeMode: row.finalize_mode, scheduledAt: row.scheduled_at, reservationConfirmedAt: row.reservation_confirmed_at };
  });
}

// Adapt frozen blocks, never current Draft/Task assets or a newly computed image plan.
export async function publicationJobToExtensionTask(job: PublicationJob, signed = false) {
  const snapshot = parsePublicationSnapshot(job.execution_snapshot);
  const images = await Promise.all(snapshot.images.map(async (image, index) => {
    if (!isBlogTaskAssetPath(job.blog_task_id, image.storagePath)) throw new Error("Job 사진 경로 불일치");
    let insertOffset = 0;
    for (const block of snapshot.blocks) {
      if (block.type === "image" && block.index === index) break;
      if (block.type === "text") insertOffset += block.text.length;
    }
    let signedUrl = "";
    if (signed) {
      const { data, error } = await supabase.storage.from(BLOG_TASK_ASSET_BUCKET).createSignedUrl(image.storagePath, 600);
      if (error || !data?.signedUrl) throw new Error("사진 URL 발급 실패");
      signedUrl = data.signedUrl;
    }
    return { id: image.assetId, index, insertOffset, insertPrefix: snapshot.bodyText.slice(0, insertOffset), signedUrl, expiresIn: signed ? 600 : 0 };
  }));
  return {
    ...parsePublicationSchedule({ publishMode: job.publish_mode, scheduledAt: job.scheduled_at }),
    finalizeMode: parseFinalizeMode(job.finalize_mode, job.publish_mode),
    reservationConfirmedAt: job.reservation_confirmed_at ?? null,
    id: job.blog_task_id, draftId: job.blog_draft_id, jobId: job.id, attemptNo: job.attempt_no,
    status: job.status, title: snapshot.title, bodyText: snapshot.bodyText, images,
    blocks: snapshot.blocks.map(block => block.type === "text" ? block : { ...images[block.index], type: "image" as const }),
  };
}

export async function recordPublicationResult(id: string, attemptNo: number, outcome: "inserted" | "failed", errorMessage?: string) {
  if (!PUBLICATION_JOB_ID.test(id) || !Number.isSafeInteger(attemptNo) || attemptNo < 1) throw new PublicationJobError("실행 번호를 확인해 주세요.");
  const { data, error } = await supabase.from("blog_publication_jobs")
    .update(outcome === "inserted" ? { status: outcome, inserted_at: new Date().toISOString(), error_message: null }
      : { status: outcome, error_message: errorMessage?.trim().slice(0, 1000) || "네이버 입력 실패" })
    .eq("id", id).eq("status", "inserting").eq("attempt_no", attemptNo).select("id").maybeSingle();
  if (error) throw new Error("Job 결과 기록 실패");
  if (data) return { applied: true, alreadyApplied: false };
  const current = await getPublicationJob(id);
  return { applied: false, alreadyApplied: current.attempt_no === attemptNo && current.status === outcome };
}

export async function claimPublicationJob(id: string, publisher: "blocks" | "legacy") {
  const job = await getPublicationJob(id);
  if (job.status !== "queued") throw new PublicationJobError("발행 대기 상태의 Job만 실행할 수 있습니다. 목록을 새로고침하세요.", 409);
  if (publisher === "legacy" && job.execution_snapshot.images.length > 3) throw new PublicationJobError("사진 3장 초과 Job은 V3 순차 입력을 사용하세요.", 409);
  if (!Number.isSafeInteger(job.attempt_no) || job.attempt_no < 0 || job.attempt_no >= Number.MAX_SAFE_INTEGER) throw new Error("실행 번호 오류");
  const attemptNo = job.attempt_no + 1;
  const { data, error } = await supabase.from("blog_publication_jobs")
    .update({ status: "inserting", attempt_no: attemptNo, started_at: new Date().toISOString(), error_message: null })
    .eq("id", id).eq("status", "queued").eq("attempt_no", job.attempt_no).select("*").maybeSingle();
  if (error) throw new Error("Job 선점 실패");
  if (!data) throw new PublicationJobError("다른 실행이 이미 Job을 선점했습니다. 목록을 새로고침하세요.", 409);
  try { return await publicationJobToExtensionTask(data, true); }
  catch {
    await recordPublicationResult(id, attemptNo, "failed", "실행 사진 URL 또는 snapshot 준비 실패");
    throw new PublicationJobError("실행 사진 URL 또는 snapshot을 준비하지 못했습니다. Job 상태를 확인하세요.", 500);
  }
}

export async function recordReservationConfirmation(id: string, attemptNo: number) {
  if (!PUBLICATION_JOB_ID.test(id) || !Number.isSafeInteger(attemptNo) || attemptNo < 1) throw new PublicationJobError("실행 번호를 확인해 주세요.");
  const eligible = (job: PublicationJob) => job.status === "inserted" && job.publish_mode === "scheduled" &&
    job.finalize_mode === "auto" && !!job.scheduled_at && job.attempt_no === attemptNo;
  const job = await getPublicationJob(id);
  if (!eligible(job)) throw new PublicationJobError("현재 실행의 자동 예약 입력 완료 Job만 예약 등록을 확인할 수 있습니다.", 409);
  if (job.reservation_confirmed_at) return { confirmedAt: job.reservation_confirmed_at, alreadyConfirmed: true };
  const confirmedAt = new Date().toISOString();
  const { data, error } = await supabase.from("blog_publication_jobs")
    .update({ reservation_confirmed_at: confirmedAt })
    .eq("id", id).eq("status", "inserted").eq("attempt_no", attemptNo)
    .eq("publish_mode", "scheduled").eq("finalize_mode", "auto").eq("scheduled_at", job.scheduled_at)
    .is("reservation_confirmed_at", null).select("reservation_confirmed_at").maybeSingle();
  if (error) throw new Error("예약 등록 확인 기록 실패");
  if (data) return { confirmedAt: data.reservation_confirmed_at, alreadyConfirmed: false };
  const current = await getPublicationJob(id);
  if (eligible(current) && current.reservation_confirmed_at) return { confirmedAt: current.reservation_confirmed_at, alreadyConfirmed: true };
  throw new PublicationJobError("Job 실행 상태가 변경되어 예약 확인을 기록하지 않았습니다.", 409);
}
