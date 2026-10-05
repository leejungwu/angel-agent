import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
import type { Frame } from "playwright";
import {
  launchNaverBlogSession, findNaverBlogEditorFrame, fillNaverBlogDraft,
  NAVER_EDITOR_SELECTORS, NaverBlogInputError, type NaverBlogDraftInput,
} from "../lib/naver-blog/publisher";

// Set NAVER_BLOG_PROFILE_DIR, NAVER_BLOG_WRITE_URL and NAVER_BLOG_TEST_IMAGE locally.
// npm.cmd run test:naver-blog
async function printSelectorCounts(frame: Frame) {
  const counts: Record<string, number> = {};
  for (const selector of Object.values(NAVER_EDITOR_SELECTORS)) {
    counts[selector] = await frame.locator(selector).count();
  }
  console.log("mainFrame selector count:", counts);
}

async function main() {
  const imageEnv = process.env.NAVER_BLOG_TEST_IMAGE?.trim();
  if (!imageEnv) throw new Error("NAVER_BLOG_TEST_IMAGE에 테스트 이미지 1장의 경로를 설정하세요.");
  const imagePath = resolve(imageEnv);
  try {
    if (!(await stat(imagePath)).isFile()) throw new Error("파일이 아닙니다.");
  } catch {
    throw new Error(`테스트 이미지 파일이 없거나 읽을 수 없습니다: ${imagePath}`);
  }
  const profileDir = process.env.NAVER_BLOG_PROFILE_DIR?.trim();
  const writeUrl = process.env.NAVER_BLOG_WRITE_URL?.trim();
  if (!profileDir || !writeUrl) throw new Error("NAVER_BLOG_PROFILE_DIR와 NAVER_BLOG_WRITE_URL을 설정하세요.");
  const url = new URL(writeUrl);
  if (url.protocol !== "https:" || url.hostname !== "blog.naver.com") {
    throw new Error("네이버 블로그 HTTPS 글쓰기 URL을 사용하세요.");
  }
  if (!stdin.isTTY) throw new Error("Enter 확인이 가능한 로컬 터미널에서 실행하세요.");

  const draft: NaverBlogDraftInput = {
    title: "ANGEL AGENT 제목 입력 테스트",
    intro: "자동입력 테스트 도입 문장입니다.",
    sections: [
      { heading: "첫 번째 섹션", body: "ANGEL AGENT 본문 입력 테스트" },
      { heading: "두 번째 섹션", body: "섹션 사이 빈 문단을 확인하는 테스트입니다." },
    ],
    closing: "자동입력 테스트 마무리 문장입니다.",
    imagePaths: [imagePath],
  };
  const context = await launchNaverBlogSession(resolve(profileDir));
  const terminal = createInterface({ input: stdin, output: stdout });
  let frame: Frame | undefined;
  try {
    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await terminal.question("로그인된 빈 글쓰기 화면을 확인하세요. 제목/본문/사진 입력 테스트를 시작하려면 Enter를 누르세요. 최종 발행은 하지 않습니다.\n");
    frame = await findNaverBlogEditorFrame(page);
    console.log("에디터 프레임:", { name: frame.name(), url: frame.url() });
    await printSelectorCounts(frame);
    const result = await fillNaverBlogDraft(draft, { page, writeUrl, skipNavigation: true });
    console.log("제목/본문/사진 입력 검증 완료:", result);
    console.log("화면에서 도입·각 섹션·마무리 사이 빈 문단과 heading/body 사이 줄바꿈을 확인하세요.");
  } catch (error) {
    process.exitCode = 1;
    if (error instanceof NaverBlogInputError) console.error("입력 검증 실패:", error.stage, error.cause);
    else console.error("입력 검증 실패:", error);
    if (frame) {
      try { await printSelectorCounts(frame); }
      catch (diagnosticError) { console.error("count 진단 실패:", diagnosticError); }
    }
  } finally {
    try {
      await terminal.question("화면 확인을 마쳤으면 Enter를 눌러 브라우저를 종료하세요.\n");
    } finally {
      terminal.close();
      await context.close();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
