import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { resolve } from "node:path";
import { stat } from "node:fs/promises";
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

async function diagnosePhotoUpload(frame: Frame) {
  const files = frame.locator('input[type="file"]');
  const photoLabels = frame.locator('[aria-label*="사진"]');
  const photoTitles = frame.locator('[title*="사진"]');
  const photoText = frame.getByText("사진", { exact: false });
  const photoClasses = frame.locator(
    '[class*="photo" i], [class*="image" i], [class*="img" i], [class*="picture" i]',
  );
  console.log("mainFrame 사진 업로드 후보 count:", {
    'input[type="file"]': await files.count(),
    button: await frame.locator("button").count(),
    '[role="button"]': await frame.locator('[role="button"]').count(),
    'aria-label에 사진 포함': await photoLabels.count(),
    'title에 사진 포함': await photoTitles.count(),
    '텍스트에 사진 포함': await photoText.count(),
    'class에 photo/image/img/picture 포함': await photoClasses.count(),
  });

  let printed = 0;
  const limit = 30;
  async function printCandidate(element: Locator, label: string, isInput: boolean) {
    const info: Record<string, unknown> = { candidate: label };
    // Read primitive fields only; assemble diagnostic objects in Node.
    info.tagName = await element.evaluate("el => el.tagName", undefined, { timeout: 2_000 }) ?? "[undefined]";
    for (const attribute of ["class", "id", "role", "aria-label", "title"]) {
      info[attribute] = await element.getAttribute(attribute, { timeout: 2_000 });
    }
    info.textContent = (await element.textContent({ timeout: 2_000 }))?.slice(0, 100) ?? null;
    if (isInput) {
      info.type = await element.getAttribute("type", { timeout: 2_000 });
      info.accept = await element.getAttribute("accept", { timeout: 2_000 });
      info.multiple = await element.getAttribute("multiple", { timeout: 2_000 }) !== null;
    }
    console.log("사진 관련 후보:", JSON.stringify(info));
    printed++;
  }

  // File inputs are printed first, explicitly distinguishing hidden upload inputs.
  const fileCount = await files.count();
  let hiddenFileCount = 0;
  for (let index = 0; index < fileCount; index++) {
    const input = files.nth(index);
    const hidden = !await input.isVisible();
    if (hidden) hiddenFileCount++;
    if (printed < limit) {
      await printCandidate(input, hidden ? "숨겨진 파일 input" : "파일 input", true);
    }
  }
  console.log("숨겨진 파일 input 수:", hiddenFileCount);

  // Union deduplicates matches. Ordinary buttons are counted above, never dumped.
  const candidates = photoLabels.or(photoTitles).or(photoText).or(photoClasses)
    .and(frame.locator(':not(input[type="file"])'));
  const count = await candidates.count();
  for (let index = 0; index < count && printed < limit; index++) {
    const element = candidates.nth(index);
    const isInput = await element.and(frame.locator("input")).count() > 0;
    await printCandidate(element, "사진 관련 속성/텍스트/class", isInput);
  }
  console.log("사진 진단 출력 요약:", { printed, limit, totalCandidates: fileCount + count });
}

async function uploadTestImage(page: Page, frame: Frame, imagePath: string) {
  const images = frame.locator('img');
  const components = frame.locator('.se-component.se-image');
  const before = { images: await images.count(), components: await components.count() };
  console.log("업로드 전 본문 이미지 count:", before);

  let fileInput = frame.locator('input[type="file"]');
  if (await fileInput.count() > 0) {
    // Hidden file inputs do not need a click or visibility to receive files.
    await fileInput.first().setInputFiles([imagePath], { timeout: 15_000 });
  } else {
    // The editor creates the upload input or file chooser only after this click.
    const photoButton = await firstVisible(frame.locator('.se-image-toolbar-button'))
      ?? await firstVisible(frame.locator('.se-toolbar-item.se-toolbar-item-image'));
    if (!photoButton) throw new Error("사진 버튼이나 파일 input을 찾지 못했습니다. 사진 DOM 진단을 확인하세요.");

    // Arm the chooser before clicking, so a native file dialog does not require manual input.
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 5_000 }).catch(() => null);
    await photoButton.click({ timeout: 10_000 });
    const chooser = await chooserPromise;
    fileInput = frame.locator('input[type="file"]');
    console.log("사진 버튼 클릭 후 파일 input count:", await fileInput.count());
    if (chooser) {
      await chooser.setFiles([imagePath], { timeout: 15_000 });
    } else {
      await fileInput.first().waitFor({ state: "attached", timeout: 10_000 });
      await fileInput.first().setInputFiles([imagePath], { timeout: 15_000 });
    }
  }

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const imageCount = await images.count();
    const componentCount = await components.count();
    if (componentCount > before.components || imageCount > before.images) {
      console.log("업로드 후 본문 이미지 count:", { images: imageCount, components: componentCount });
      console.log("사진 업로드 성공:", imagePath);
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("이미지 전달 후 60초 안에 이미지 컴포넌트 또는 img count 증가를 확인하지 못했습니다.");
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
    stage = "photo_upload_diagnostics";
    await diagnosePhotoUpload(frame);
    stage = "photo_upload";
    await uploadTestImage(page, frame, imagePath);
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
