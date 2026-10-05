import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import type { Frame, Page, Locator } from "playwright";
import { launchNaverBlogSession } from "../lib/naver-blog/publisher";

// Set NAVER_BLOG_PROFILE_DIR and NAVER_BLOG_WRITE_URL in a local terminal.
// npm.cmd run test:naver-blog
const TITLE_TEST = "ANGEL AGENT 제목 입력 테스트";
const BODY_TEST = "ANGEL AGENT 본문 입력 테스트";
const TITLE_BLOCK = ".se-title-text";
const DIAGNOSTIC_SELECTORS = [
  TITLE_BLOCK, ".se-component", ".se-component.se-text",
  ".se-section-text", ".se-module-text", '[contenteditable="true"]',
];
const BODY_CANDIDATES = [
  ".se-component.se-text .se-module-text",
  ".se-component.se-text",
  ".se-section-text",
  ".se-module-text",
];

function findEditorFrame(page: Page): Frame {
  const frames = page.frames().filter((frame) => frame !== page.mainFrame());
  const editor = frames.find((frame) => frame.name() === "mainFrame")
    ?? frames.find((frame) => frame.url().includes("PostWriteForm.naver"));
  if (!editor) throw new Error("블로그 글쓰기 mainFrame을 찾지 못했습니다.");
  return editor;
}

async function printSelectorCounts(frame: Frame) {
  const counts: Record<string, number> = {};
  for (const selector of DIAGNOSTIC_SELECTORS) counts[selector] = await frame.locator(selector).count();
  console.log("mainFrame selector count:", counts);
}

async function firstVisible(locator: Locator): Promise<Locator | null> {
  for (let index = 0, count = await locator.count(); index < count; index++) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) return candidate;
  }
  return null;
}

async function selectBody(frame: Frame): Promise<Locator> {
  let selected: Locator | null = null;
  let selectedSelector: string | null = null;
  for (const selector of BODY_CANDIDATES) {
    const all = frame.locator(selector);
    // Exclude title descendants, the title itself, and wrappers containing the title.
    const bodyOnly = frame.locator(`${selector}:not(.se-title-text):not(.se-title-text *)`)
      .filter({ hasNot: frame.locator(TITLE_BLOCK) });
    const visible = await firstVisible(bodyOnly);
    console.log("본문 후보:", {
      selector, count: await all.count(), excludingTitleCount: await bodyOnly.count(),
      visibleCandidate: visible !== null,
    });
    if (!selected && visible) {
      selected = visible;
      selectedSelector = selector;
    }
  }
  if (!selected) throw new Error("제목 블록 밖의 표시된 본문 후보를 찾지 못했습니다.");
  console.log("선택한 본문 후보:", selectedSelector);
  return selected;
}

async function verifyText(locator: Locator, expected: string, label: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if ((await locator.textContent({ timeout: 2_000 }))?.includes(expected)) {
      console.log(`${label} 입력 성공:`, expected);
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`${label} textContent에서 테스트 문자열을 확인하지 못했습니다.`);
}

async function main() {
  const profileDir = process.env.NAVER_BLOG_PROFILE_DIR?.trim();
  const writeUrl = process.env.NAVER_BLOG_WRITE_URL?.trim();
  if (!profileDir || !writeUrl) throw new Error("NAVER_BLOG_PROFILE_DIR와 NAVER_BLOG_WRITE_URL을 설정하세요.");
  const url = new URL(writeUrl);
  if (url.protocol !== "https:" || url.hostname !== "blog.naver.com") {
    throw new Error("네이버 블로그 HTTPS 글쓰기 URL을 사용하세요.");
  }
  if (!stdin.isTTY) throw new Error("Enter 확인이 가능한 로컬 터미널에서 실행하세요.");

  const context = await launchNaverBlogSession(resolve(profileDir));
  const terminal = createInterface({ input: stdin, output: stdout });
  let frame: Frame | undefined;
  let stage = "editor_open";
  try {
    const page = await context.newPage();
    await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await terminal.question("로그인된 빈 글쓰기 화면을 확인하세요. 제목/본문 클릭 입력 테스트를 시작하려면 Enter를 누르세요. 최종 발행은 하지 않습니다.\n");
    frame = findEditorFrame(page);
    console.log("에디터 프레임:", { name: frame.name(), url: frame.url() });
    await printSelectorCounts(frame);

    stage = "title_input";
    const titleBlock = frame.locator(TITLE_BLOCK).first();
    const titlePlaceholder = titleBlock.getByText("제목", { exact: true });
    const titleTarget = await firstVisible(titlePlaceholder)
      ?? await firstVisible(frame.getByText("제목", { exact: true }));
    if (!titleTarget) throw new Error("표시된 제목 placeholder를 찾지 못했습니다. 빈 글쓰기 화면인지 확인하세요.");
    await titleTarget.click({ timeout: 10_000 });
    await page.keyboard.insertText(TITLE_TEST);
    await verifyText(titleBlock, TITLE_TEST, "제목");

    stage = "body_input";
    const body = await selectBody(frame);
    await body.click({ timeout: 10_000 });
    await page.keyboard.insertText(BODY_TEST);
    await verifyText(body, BODY_TEST, "본문");
    console.log("제목/본문 클릭 입력 검증 완료. 발행 동작은 실행하지 않았습니다.");
  } catch (error) {
    process.exitCode = 1;
    console.error("입력 검증 실패:", stage, error instanceof Error ? error.message : error);
    if (frame) {
      try { await printSelectorCounts(frame); }
      catch (diagnosticError) { console.error("count 진단 실패:", diagnosticError); }
    }
  } finally {
    try {
      if (frame) await terminal.question("화면 확인을 마쳤으면 Enter를 눌러 브라우저를 종료하세요.\n");
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