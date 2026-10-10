import { supabase } from "@/lib/supabase";
import { resolve } from "node:path";
import type { BrowserContext } from "playwright";
import {
  launchNaverBlogSession, fillNaverBlogDraft, composeNaverBlogBody,
  NaverBlogInputError, type NaverBlogDraftInput,
} from "@/lib/naver-blog/publisher";

import { createProductAssetDirectory, removeProductAssetDirectory } from "@/lib/naver-blog/product-asset-files";
import { downloadBlogTaskAssetFiles, BlogTaskAssetDownloadError } from "@/lib/naver-blog/blog-task-asset-files";

export const runtime = "nodejs";

// Local, long-running Node server only. Retain the session across dev module reloads
// so an open review browser does not lock the profile against the next request.
type ReviewSession = { context?: BrowserContext; profileDir?: string; busy: boolean };
const serverGlobal = globalThis as typeof globalThis & { naverBlogReviewSession?: ReviewSession };
const session = serverGlobal.naverBlogReviewSession ??= { busy: false };

function toPublisherInput(draft: {
  title: unknown; intro: unknown; sections: unknown; closing: unknown;
}): NaverBlogDraftInput {
  const optionalText = (value: unknown): value is string | null | undefined =>
    value == null || typeof value === "string";
  if (typeof draft.title !== "string" || !draft.title.trim() ||
      !optionalText(draft.intro) || !optionalText(draft.closing)) {
    throw new Error("초안 제목 또는 도입/마무리 형식이 올바르지 않습니다.");
  }
  // Supabase jsonb normally arrives as an array; also validate serialized JSON safely.
  let sections: unknown = draft.sections;
  if (typeof sections === "string") {
    try { sections = JSON.parse(sections); }
    catch { throw new Error("초안 sections JSON을 읽을 수 없습니다."); }
  }
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error("초안 sections는 비어 있지 않은 배열이어야 합니다.");
  }
  const parsedSections = sections.map((section: unknown, index: number) => {
    if (typeof section !== "object" || section === null || Array.isArray(section)) {
      throw new Error(`초안 section ${index + 1} 형식이 올바르지 않습니다.`);
    }
    const item = section as Record<string, unknown>;
    if (!optionalText(item.heading) || typeof item.body !== "string" ||
        (item.imageAssetId != null &&
          (typeof item.imageAssetId !== "number" || !Number.isSafeInteger(item.imageAssetId) || item.imageAssetId <= 0))) {
      throw new Error(`초안 section ${index + 1} 필드 형식이 올바르지 않습니다.`);
    }
    // Upload task images in asset order; section imageAssetId does not control selection.
    return { heading: item.heading ?? null, body: item.body };
  });
  const input: NaverBlogDraftInput = {
    title: draft.title, intro: draft.intro, sections: parsedSections,
    closing: draft.closing, imagePaths: [],
  };
  if (!composeNaverBlogBody(input)) throw new Error("초안 본문이 비어 있습니다.");
  return input;
}

async function getReviewContext(profileDir: string): Promise<BrowserContext> {
  if (session.context) {
    if (session.profileDir !== profileDir) {
      throw new Error("프로필 변경 전 기존 검수 브라우저를 닫아 주세요.");
    }
    return session.context;
  }
  const context = await launchNaverBlogSession(profileDir);
  session.context = context;
  session.profileDir = profileDir;
  context.once("close", () => {
    if (session.context === context) {
      session.context = undefined;
      session.profileDir = undefined;
    }
  });
  return context;
}

function logFailure(stage: string, error: unknown) {
  console.error("Blog publishing failed", {
    stage,
    type: error instanceof Error ? error.name : "DatabaseError",
    code: typeof error === "object" && error !== null && "code" in error
      ? error.code : undefined,
    message: error instanceof Error ? error.message : undefined,
    cause: error instanceof NaverBlogInputError && error.cause instanceof Error
      ? error.cause.message : undefined,
  });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "유효한 JSON 요청 본문이 필요합니다." }, { status: 400 });
  }

  const draftId = typeof body === "object" && body !== null && "draftId" in body
    ? body.draftId : undefined;
  if (typeof draftId !== "number" || !Number.isSafeInteger(draftId) || draftId <= 0) {
    return Response.json({ error: "draftId는 유효한 숫자여야 합니다." }, { status: 400 });
  }

  let stage = "draft lookup";
  let claimed = false;
  let ownsSession = false;
  let assetDirectory: string | undefined;
  try {
    const { data: draft, error } = await supabase
      .from("blog_drafts")
      .select("id, blog_task_id, title, intro, sections, closing, status, publishing_status, published_url, published_at, publishing_error")
      .eq("id", draftId)
      .maybeSingle();

    if (error) {
      logFailure(stage, error);
      return Response.json({ error: "초안을 조회하지 못했습니다." }, { status: 500 });
    }
    if (!draft) {
      return Response.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });
    }
    if (draft.status !== "approved") {
      return Response.json({ error: "승인된 초안만 발행할 수 있습니다." }, { status: 409 });
    }
    if (draft.publishing_status !== "queued") {
      return Response.json({ error: "발행 대기 등록된 초안만 처리할 수 있습니다." }, { status: 409 });
    }

    if (session.busy) {
      return Response.json({ error: "다른 초안의 네이버 입력이 진행 중입니다. 완료 후 다시 시도해 주세요." }, { status: 409 });
    }
    session.busy = true;
    ownsSession = true;

    stage = "publishing status update";
    const { data: updatedDraft, error: updateError } = await supabase
      .from("blog_drafts")
      .update({
        publishing_status: "publishing",
        publishing_error: null,
      })
      .eq("id", draft.id)
      .eq("status", "approved")
      .eq("publishing_status", "queued")
      .select("id, publishing_status")
      .maybeSingle();

    if (updateError) {
      logFailure(stage, updateError);
      return Response.json({ error: "발행 상태를 변경하지 못했습니다." }, { status: 500 });
    }
    if (!updatedDraft) {
      return Response.json({ error: "초안 상태가 변경되어 발행 처리를 시작할 수 없습니다." }, { status: 409 });
    }
    claimed = true;

    stage = "draft validation";
    const publisherInput = toPublisherInput(draft);
    stage = "publisher configuration";
    const profileDir = process.env.NAVER_BLOG_PROFILE_DIR?.trim();
    const writeUrl = process.env.NAVER_BLOG_WRITE_URL?.trim();
    if (!profileDir || !writeUrl) {
      throw new Error("NAVER_BLOG_PROFILE_DIR와 NAVER_BLOG_WRITE_URL을 서버 환경변수로 설정하세요.");
    }
    const url = new URL(writeUrl);
    if (url.protocol !== "https:" || url.hostname !== "blog.naver.com") {
      throw new Error("NAVER_BLOG_WRITE_URL은 네이버 블로그 HTTPS 글쓰기 URL이어야 합니다.");
    }
    stage = "blog task assets download";
    assetDirectory = await createProductAssetDirectory(draftId);
    publisherInput.imagePaths = await downloadBlogTaskAssetFiles(draft.blog_task_id, assetDirectory);
    console.log("publisher image count:", publisherInput.imagePaths.length);
    stage = "browser launch";
    const context = await getReviewContext(resolve(profileDir));
    const page = await context.newPage();
    stage = "editor input";
    const result = await fillNaverBlogDraft(publisherInput, { page, writeUrl: url.href });
    console.log("publisher imagesUploaded", result.imagesUploaded);
    if (result.imagesUploaded !== publisherInput.imagePaths.length) {
      throw new Error("다운로드된 이미지 수와 업로드된 이미지 수가 다릅니다.");
    }
    // Keep the context AND page open for a person to review/publish manually.
    // Input completion is review readiness, not publication.
    stage = "review status update";
    const { data: reviewDraft, error: reviewError } = await supabase
      .from("blog_drafts")
      .update({ publishing_status: "ready_for_review", publishing_error: null })
      .eq("id", draft.id)
      .eq("status", "approved")
      .eq("publishing_status", "publishing")
      .select("id, publishing_status")
      .maybeSingle();
    if (reviewError) logFailure(stage, reviewError);
    if (reviewError || !reviewDraft) {
      throw new Error("입력 완료 후 검수 대기 상태를 저장하지 못했습니다.");
    }
    return Response.json({
      ok: true,
      draftId: reviewDraft.id,
      publishingStatus: "ready_for_review",
      result: "ready_for_review",
      published: false,
    });
  } catch (error) {
    const failureStage = error instanceof NaverBlogInputError ? error.stage : stage;
    logFailure(failureStage, error);
    if (claimed) {
      const publishingError = error instanceof NaverBlogInputError
        ? `네이버 초안 자동입력 실패 (${error.stage}). 서버 로그를 확인해 주세요.`
        : `${stage}: ${stage === "draft validation" || stage === "publisher configuration" || stage === "review status update" || stage === "blog task assets download"
          ? (error instanceof Error ? error.message : "검증 실패")
          : "네이버 입력 준비 중 오류가 발생했습니다. 서버 로그를 확인해 주세요."}`;
      try {
        const { data: failedDraft, error: failureError } = await supabase
          .from("blog_drafts")
          .update({ publishing_status: "failed", publishing_error: publishingError })
          .eq("id", draftId)
          .eq("publishing_status", "publishing")
          .select("id")
          .maybeSingle();
        if (failureError || !failedDraft) logFailure("failure status update", failureError ?? new Error("Draft state changed"));
      } catch (failureError) {
        logFailure("failure status update", failureError);
      }
    }
    return Response.json({ error: error instanceof BlogTaskAssetDownloadError ? error.message : "발행 처리 중 오류가 발생했습니다." }, { status: 500 });
  } finally {
    try {
      if (assetDirectory) await removeProductAssetDirectory(assetDirectory);
    } catch (error) {
      logFailure("temporary asset cleanup", error);
    } finally {
      if (ownsSession) session.busy = false;
    }
  }
}
