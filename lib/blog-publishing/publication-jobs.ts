import { supabase } from "@/lib/supabase";
import { parsePublicationSchedule, type PublishMode } from "./schedule";
import { isBlogTaskAssetPath, type BlogTaskAsset } from "../blog-task-assets";
import { orderedTaskImages } from "./downloads";
import { prepareBlogPost } from "./preparation";
import { createBlogExecutionBlocks, type BlogExecutionBlock } from "./blocks";

export type PublicationImage = { assetId: string | number; storagePath: string; fileName: string; sortOrder: number };
export type PublicationSnapshot = {
  version: 1;
  title: string;
  bodyText: string;
  blocks: BlogExecutionBlock<{ index: number }>[];
  images: PublicationImage[];
};
export type PublicationJob = {
  id: string;
  blog_task_id: string | number;
  blog_draft_id: string | number;
  status: "queued" | "inserting" | "inserted" | "published" | "failed";
  execution_snapshot: PublicationSnapshot;
  attempt_no: number;
  publish_mode: PublishMode;
  scheduled_at: string | null;
  created_at: string;
  started_at: string | null;
  inserted_at: string | null;
  published_at: string | null;
  published_url: string | null;
  error_message: string | null;
};

export class PublicationJobError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const PUBLICATION_INSERTING_STALE_MS = 10 * 60 * 1000;
export function isStalePublicationInserting(job: Pick<PublicationJob, "status" | "started_at">, now = Date.now()): boolean {
  if (job.status !== "inserting" || !job.started_at) return false;
  const started = Date.parse(job.started_at);
  return Number.isFinite(started) && Number.isFinite(now) && now - started >= PUBLICATION_INSERTING_STALE_MS;
}

export async function transitionPublicationJob(id: string, input: { action?: unknown; publishedUrl?: unknown }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new PublicationJobError("Job ID가 올바르지 않습니다.");
  if (input.action !== "publish" && input.action !== "retry" && input.action !== "recover") throw new PublicationJobError("허용되지 않는 상태 변경입니다.");
  let recovery: { started_at: string; attempt_no: number } | undefined;
  if (input.action === "recover") {
    const { data, error } = await supabase.from("blog_publication_jobs").select("status,started_at,attempt_no").eq("id", id).maybeSingle();
    if (error) throw new Error("Publication Job 복구 상태 조회 실패");
    if (!data || !isStalePublicationInserting(data)) throw new PublicationJobError("입력 시작 후 10분 이상 지난 입력 중 Job만 복구할 수 있습니다.", 409);
    recovery = { started_at: data.started_at, attempt_no: data.attempt_no };
  }
  let publishedUrl: string | null = null;
  if (input.action === "publish" && input.publishedUrl != null) {
    if (typeof input.publishedUrl !== "string") throw new PublicationJobError("발행 URL은 http/https 주소로 입력해 주세요.");
    const value = input.publishedUrl.trim();
    if (value) {
      try {
        const url = new URL(value);
        if (!/^https?:\/\//i.test(value) || /\s/.test(value) || !["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error();
        publishedUrl = value;
      } catch { throw new PublicationJobError("발행 URL은 http/https 주소로 입력해 주세요."); }
    }
  }
  // Whitelist execution fields only; snapshot, ownership and attempt_no never change here.
  const changes = input.action === "publish"
    ? { status: "published", published_at: new Date().toISOString(), published_url: publishedUrl, error_message: null }
    : { status: "queued", error_message: null, started_at: null, inserted_at: null };
  let query = supabase.from("blog_publication_jobs").update(changes)
    .eq("id", id).eq("status", input.action === "publish" ? "inserted" : input.action === "recover" ? "inserting" : "failed");
  // Do not recover a completed execution or a newer claim after the stale read.
  if (recovery) query = query.eq("started_at", recovery.started_at).eq("attempt_no", recovery.attempt_no);
  const { data, error } = await query.select("id,status").maybeSingle();
  if (error) throw new Error("Publication Job 상태 저장 실패");
  if (!data && recovery) throw new PublicationJobError("입력 상태가 변경되어 복구하지 않았습니다. 목록을 새로고침하세요.", 409);
  if (!data) throw new PublicationJobError(input.action === "publish" ? "네이버 입력 완료 상태의 Job만 발행 완료로 기록할 수 있습니다." : "입력 실패 상태의 Job만 다시 대기열로 보낼 수 있습니다.", 409);
  return data;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}
export function isPublicationSourceId(value: unknown): value is string | number {
  return (typeof value === "string" && /^[1-9]\d*$/.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
}
function nonempty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }

export function parsePublicationSnapshot(value: unknown): PublicationSnapshot {
  const fail = () => { throw new Error("Publication snapshot 형식이 유효하지 않습니다."); };
  if (!record(value) || !keys(value, ["version", "title", "bodyText", "blocks", "images"]) ||
    value.version !== 1 || !nonempty(value.title) || !nonempty(value.bodyText) ||
    !Array.isArray(value.blocks) || !Array.isArray(value.images)) return fail();
  const ids = new Set<string>(), paths = new Set<string>();
  let previousOrder = -Infinity;
  for (const image of value.images) {
    if (!record(image) || !keys(image, ["assetId", "storagePath", "fileName", "sortOrder"]) ||
      !isPublicationSourceId(image.assetId) || !nonempty(image.storagePath) || !nonempty(image.fileName) ||
      !Number.isSafeInteger(image.sortOrder) || (image.sortOrder as number) < previousOrder) return fail();
    const taskId = image.storagePath.match(/^tasks\/([1-9]\d*)\//)?.[1];
    if (!taskId || !isBlogTaskAssetPath(taskId, image.storagePath) || ids.has(String(image.assetId)) || paths.has(image.storagePath)) return fail();
    ids.add(String(image.assetId)); paths.add(image.storagePath); previousOrder = image.sortOrder as number;
  }
  let text = "", imageIndex = 0;
  for (const block of value.blocks) {
    if (!record(block)) return fail();
    if (block.type === "text" && keys(block, ["type", "text"]) && nonempty(block.text)) text += block.text;
    else if (block.type === "image" && keys(block, ["type", "index"]) && block.index === imageIndex && imageIndex < value.images.length) imageIndex++;
    else return fail();
  }
  if (text !== value.bodyText || imageIndex !== value.images.length) return fail();
  // Return a detached, whitelisted JSON value, never a mutable DB/request reference.
  return JSON.parse(JSON.stringify(value)) as PublicationSnapshot;
}

function parsedJob(row: PublicationJob): PublicationJob {
  const schedule = parsePublicationSchedule({ publishMode: row.publish_mode, scheduledAt: row.scheduled_at });
  return { ...row, publish_mode: schedule.publishMode, scheduled_at: schedule.scheduledAt, execution_snapshot: parsePublicationSnapshot(row.execution_snapshot) };
}

export async function createPublicationJob({ taskId, draftId, publishMode, scheduledAt }: { taskId: string | number; draftId: string | number; publishMode?: unknown; scheduledAt?: unknown }): Promise<PublicationJob & { alreadyExists: boolean }> {
  if (!isPublicationSourceId(taskId) || !isPublicationSourceId(draftId)) throw new PublicationJobError("작업/초안 ID가 유효하지 않습니다.");
  const existing = await supabase.from("blog_publication_jobs").select("*").eq("blog_task_id", taskId).eq("blog_draft_id", draftId).maybeSingle();
  if (existing.error) throw new Error("기존 Publication Job을 조회하지 못했습니다.");
  // An existing job keeps the originally approved data, even after source edits.
  if (existing.data) return { ...parsedJob(existing.data), alreadyExists: true };
  let schedule;
  try { schedule = parsePublicationSchedule({ publishMode, scheduledAt }, true); }
  catch (error) { throw new PublicationJobError(error instanceof Error ? error.message : "예약 시간을 확인해 주세요."); }
  const [task, draftResult, assets] = await Promise.all([
    supabase.from("blog_tasks").select("id,image_placement_settings").eq("id", taskId).maybeSingle(),
    supabase.from("blog_drafts").select("id,title,intro,sections,closing,status").eq("id", draftId).eq("blog_task_id", taskId).maybeSingle(),
    supabase.from("blog_task_assets").select("id,storage_path,file_name,sort_order").eq("blog_task_id", taskId)
      .order("sort_order", { ascending: true }).order("id", { ascending: true }),
  ]);
  if (task.error || draftResult.error || assets.error) throw new Error("발행 자료를 조회하지 못했습니다.");
  if (!task.data) throw new PublicationJobError("작업이 없습니다.", 404);
  if (!draftResult.data) throw new PublicationJobError("해당 작업의 초안이 없습니다.", 404);
  const draft = draftResult.data;
  if (draft.status !== "approved") throw new PublicationJobError("승인된 초안만 등록할 수 있습니다.", 403);
  let sections: unknown = draft.sections;
  if (typeof sections === "string") {
    try { sections = JSON.parse(sections); } catch { throw new PublicationJobError("초안 본문 형식을 확인해 주세요."); }
  }
  if (!nonempty(draft.title) || (draft.intro != null && typeof draft.intro !== "string") ||
    (draft.closing != null && typeof draft.closing !== "string") || !Array.isArray(sections) ||
    !sections.every(s => record(s) && typeof s.body === "string" && (s.heading == null || typeof s.heading === "string"))) {
    throw new PublicationJobError("초안 제목·본문 형식을 확인해 주세요.");
  }
  const ordered = orderedTaskImages(taskId, (assets.data ?? []) as BlogTaskAsset[]);
  const prepared = prepareBlogPost({ title: draft.title, intro: draft.intro, sections, closing: draft.closing }, ordered.length, task.data.image_placement_settings);
  const snapshot = parsePublicationSnapshot({
    version: 1, title: prepared.title, bodyText: prepared.executionBodyText,
    blocks: createBlogExecutionBlocks(prepared.executionBodyText, ordered.map((_, index) => ({ index, insertOffset: prepared.imageInsertOffsets[index] })))
      .map(block => block.type === "text" ? block : { type: "image", index: block.index }),
    images: ordered.map(asset => ({ assetId: asset.id, storagePath: asset.storage_path, fileName: asset.file_name, sortOrder: asset.sort_order })),
  });
  const result = await supabase.from("blog_publication_jobs").insert({ blog_task_id: taskId, blog_draft_id: draftId, execution_snapshot: snapshot, publish_mode: schedule.publishMode, scheduled_at: schedule.scheduledAt }).select("*").maybeSingle();
  if (result.error?.code === "23505") {
    const winner = await supabase.from("blog_publication_jobs").select("*").eq("blog_task_id", taskId).eq("blog_draft_id", draftId).maybeSingle();
    if (!winner.error && winner.data) return { ...parsedJob(winner.data), alreadyExists: true };
  }
  if (result.error || !result.data) throw new Error("Publication Job을 저장하지 못했습니다.");
  return { ...parsedJob(result.data), alreadyExists: false };
}

// All Job states protect their referenced images; there is intentionally no status filter.
export async function isAssetReferencedByPublicationJob(reference: { assetId?: string | number; storagePath?: string }): Promise<boolean> {
  if (reference.assetId === undefined && reference.storagePath === undefined) throw new Error("사진 참조가 필요합니다.");
  const candidates: Record<string, unknown>[] = [];
  if (reference.assetId !== undefined) {
    if (!isPublicationSourceId(reference.assetId)) throw new Error("사진 ID가 유효하지 않습니다.");
    candidates.push({ assetId: String(reference.assetId) });
    if (Number.isSafeInteger(Number(reference.assetId))) candidates.push({ assetId: Number(reference.assetId) });
  }
  if (reference.storagePath !== undefined) {
    const taskId = reference.storagePath.match(/^tasks\/([1-9]\d*)\//)?.[1];
    if (!taskId || !isBlogTaskAssetPath(taskId, reference.storagePath)) throw new Error("사진 경로가 유효하지 않습니다.");
    candidates.push({ storagePath: reference.storagePath });
  }
  for (const image of candidates) {
    const result = await supabase.from("blog_publication_jobs").select("id").contains("execution_snapshot", { images: [image] }).limit(1).maybeSingle();
    if (result.error) throw new Error("사진의 Publication Job 참조를 확인하지 못했습니다.");
    if (result.data) return true;
  }
  return false;
}
