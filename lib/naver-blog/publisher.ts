// Node.js automation module. Do not import into Client Components.
import { stat } from "node:fs/promises";
import { chromium, type BrowserContext, type Page, type Locator, type Frame } from "playwright";

export type NaverBlogDraftInput = {
  title: string;
  intro?: string | null;
  sections: { heading?: string | null; body: string }[];
  closing?: string | null;
  imagePaths?: string[];
};
export type NaverBlogDraft = NaverBlogDraftInput;

// Verified mainFrame selectors; change editor DOM selectors here only.
export const NAVER_EDITOR_SELECTORS = {
  title: ".se-title-text",
  body: ".se-component.se-text .se-module-text",
  bodyComponent: ".se-component.se-text",
  photoButton: ".se-image-toolbar-button",
  photoButtonFallback: ".se-toolbar-item.se-toolbar-item-image",
  fileInput: 'input[type="file"]',
  imageComponent: ".se-component.se-image",
  image: "img",
};

type FailureStage = "browser_launch_failed" | "editor_open_failed" |
  "draft_validation_failed" | "title_input_failed" | "body_input_failed" | "photo_upload_failed";

export class NaverBlogInputError extends Error {
  constructor(public readonly stage: FailureStage, cause: unknown) {
    super(stage, { cause });
    this.name = "NaverBlogInputError";
  }
}

/** Reuse a dedicated profile already logged in manually, never Chrome's main profile.
 * The caller owns the context. Do not use the same profile in two contexts at once.
 */
export async function launchNaverBlogSession(
  userDataDir: string,
  channel: "chrome" | "chromium" = "chrome",
): Promise<BrowserContext> {
  try {
    if (!userDataDir.trim()) throw new Error("A dedicated profile directory is required.");
    return await chromium.launchPersistentContext(userDataDir, {
      channel, headless: false, timeout: 30_000,
    });
  } catch (error) {
    throw new NaverBlogInputError("browser_launch_failed", error);
  }
}

export function composeNaverBlogBody(draft: NaverBlogDraftInput): string {
  const text = (value?: string | null) => value?.trim() ?? "";
  return [
    text(draft.intro),
    ...draft.sections.map((section) =>
      [text(section.heading), text(section.body)].filter(Boolean).join("\n")),
    text(draft.closing),
  ].filter(Boolean).join("\n\n");
}

async function inputNaverBlogBody(page: Page, draft: NaverBlogDraftInput) {
  // Each group is intro, one section, or closing. Empty groups add no Enter keys.
  const groups = [
    [draft.intro],
    ...draft.sections.map((section) => [section.heading, section.body]),
    [draft.closing],
  ].map((group) => group.map((text) => text?.trim() ?? "").filter(Boolean))
    .filter((group) => group.length > 0);

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    if (groupIndex > 0) {
      await page.keyboard.press("Enter");
      await page.keyboard.press("Enter");
    }
    for (let blockIndex = 0; blockIndex < groups[groupIndex].length; blockIndex++) {
      // Heading and body are separated by one actual paragraph break.
      if (blockIndex > 0) await page.keyboard.press("Enter");
      const lines = groups[groupIndex][blockIndex].split(/\r\n|\r|\n/);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        // Internal line breaks also need keyboard events in SmartEditor.
        if (lineIndex > 0) await page.keyboard.press("Enter");
        if (lines[lineIndex]) await page.keyboard.insertText(lines[lineIndex]);
      }
    }
  }
}

export async function findNaverBlogEditorFrame(page: Page, timeoutMs = 30_000): Promise<Frame> {
  const deadline = Date.now() + timeoutMs;
  do {
    const frames = page.frames().filter((frame) => frame !== page.mainFrame());
    const editor = frames.find((frame) => frame.name() === "mainFrame")
      ?? frames.find((frame) => frame.url().includes("PostWriteForm.naver"));
    if (editor) return editor;
    await new Promise((done) => setTimeout(done, 100));
  } while (Date.now() < deadline);
  throw new Error("블로그 글쓰기 mainFrame을 찾지 못했습니다.");
}

async function firstVisible(locator: Locator): Promise<Locator | null> {
  for (let index = 0, count = await locator.count(); index < count; index++) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) return candidate;
  }
  return null;
}

function normalizeEditorText(value: string): string {
  return value.replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

async function verifyText(
  locator: Locator,
  expected: string,
  timeoutMs: number,
  paragraphs: string[] = [],
) {
  const normalizedExpected = normalizeEditorText(expected);
  const normalizedParagraphs = paragraphs.map(normalizeEditorText).filter(Boolean);
  let actual = "";
  let missingParagraphs = normalizedParagraphs;
  const deadline = Date.now() + timeoutMs;
  do {
    // textContent avoids layout-dependent innerText differences in SmartEditor.
    actual = normalizeEditorText((await locator.allTextContents()).join("\n"));
    if (normalizedExpected && actual.includes(normalizedExpected)) return;
    missingParagraphs = normalizedParagraphs.filter((paragraph) => !actual.includes(paragraph));
    // Require ALL nonempty paragraphs, never a partial or unconditional pass.
    if (normalizedParagraphs.length > 0 && missingParagraphs.length === 0) return;
    await new Promise((done) => setTimeout(done, 100));
  } while (Date.now() < deadline);
  console.error("입력 검증 실패:", {
    expectedNormalized: normalizedExpected,
    actualNormalizedTextContent: actual,
    missingParagraphs,
  });
  throw new Error("에디터에서 입력한 내용을 확인하지 못했습니다.");
}

async function uploadImage(page: Page, frame: Frame, imagePath: string, timeoutMs: number) {
  const images = frame.locator(NAVER_EDITOR_SELECTORS.image);
  const components = frame.locator(NAVER_EDITOR_SELECTORS.imageComponent);
  const before = { images: await images.count(), components: await components.count() };
  const button = await firstVisible(frame.locator(NAVER_EDITOR_SELECTORS.photoButton))
    ?? await firstVisible(frame.locator(NAVER_EDITOR_SELECTORS.photoButtonFallback));
  if (!button) throw new Error("사진 버튼을 찾지 못했습니다.");

  // A mainFrame button emits filechooser on its owning Page.
  const chooserPromise = page.waitForEvent("filechooser", { timeout: 5_000 }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") return null;
    throw error;
  });
  // Observe rejection even if clicking fails before awaiting the chooser.
  void chooserPromise.catch(() => {});
  await button.click({ timeout: timeoutMs });
  const chooser = await chooserPromise;
  if (chooser) {
    await chooser.setFiles(imagePath, { timeout: timeoutMs });
  } else {
    const input = frame.locator(NAVER_EDITOR_SELECTORS.fileInput).first();
    await input.waitFor({ state: "attached", timeout: timeoutMs });
    await input.setInputFiles(imagePath, { timeout: timeoutMs });
  }

  const deadline = Date.now() + timeoutMs;
  do {
    if (await components.count() > before.components || await images.count() > before.images) {
      console.log("사진 업로드 성공:", imagePath);
      return;
    }
    await new Promise((done) => setTimeout(done, 250));
  } while (Date.now() < deadline);
  throw new Error(`이미지 컴포넌트 또는 img count 증가를 확인하지 못했습니다: ${imagePath}`);
}

/** Input into a blank editor using an already logged-in Page.
 * The page/context ALWAYS stay open on success and failure for human inspection/publication.
 * The caller owns their lifetime. No login, final publish click or DB status update occurs.
 */
export async function fillNaverBlogDraft(
  draft: NaverBlogDraftInput,
  options: {
    page: Page;
    writeUrl: string;
    timeoutMs?: number;
    imageTimeoutMs?: number;
    skipNavigation?: boolean;
  },
): Promise<{ ok: true; titleFilled: true; bodyFilled: true; imagesUploaded: number; published: false }> {
  const { page, writeUrl, timeoutMs = 30_000, imageTimeoutMs = 60_000 } = options;
  const bodyText = composeNaverBlogBody(draft);
  try {
    if (!draft.title.trim() || !bodyText) throw new Error("제목과 본문은 비어 있을 수 없습니다.");
    // Validate all files before editing, avoiding partial input for a missing image.
    for (const path of draft.imagePaths ?? []) {
      if (!path.trim() || !(await stat(path)).isFile()) throw new Error(`이미지 파일이 아닙니다: ${path}`);
    }
  } catch (error) {
    throw new NaverBlogInputError("draft_validation_failed", error);
  }

  let frame: Frame;
  try {
    const url = new URL(writeUrl);
    if (url.protocol !== "https:" || url.hostname !== "blog.naver.com") {
      throw new Error("A Naver Blog HTTPS writing URL is required.");
    }
    if (!options.skipNavigation) await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    frame = await findNaverBlogEditorFrame(page, timeoutMs);
    await frame.locator(NAVER_EDITOR_SELECTORS.title).first().waitFor({ state: "visible", timeout: timeoutMs });
  } catch (error) {
    throw new NaverBlogInputError("editor_open_failed", error);
  }

  try {
    const title = frame.locator(NAVER_EDITOR_SELECTORS.title).first();
    const placeholder = await firstVisible(title.getByText("제목", { exact: true }));
    await (placeholder ?? title).click({ timeout: timeoutMs });
    await page.keyboard.insertText(draft.title);
    await verifyText(title, draft.title, timeoutMs);
    console.log("제목 입력 성공");
  } catch (error) {
    throw new NaverBlogInputError("title_input_failed", error);
  }

  try {
    const body = frame.locator(NAVER_EDITOR_SELECTORS.body).first();
    await body.click({ timeout: timeoutMs });
    await inputNaverBlogBody(page, draft);
    const bodyAreas = frame.locator(NAVER_EDITOR_SELECTORS.body);
    console.log("본문 실제 textContent:", (await bodyAreas.allTextContents()).join("\n"));
    const paragraphs = [
      draft.intro,
      ...draft.sections.flatMap((section) => [section.heading, section.body]),
      draft.closing,
    ].flatMap((value) => (value ?? "").split(/\r?\n/)).filter((value) => value.trim());
    await verifyText(bodyAreas, bodyText, timeoutMs, paragraphs);
    console.log("본문 입력 성공");
  } catch (error) {
    throw new NaverBlogInputError("body_input_failed", error);
  }

  let imagesUploaded = 0;
  try {
    for (const path of draft.imagePaths ?? []) {
      await uploadImage(page, frame, path, imageTimeoutMs);
      imagesUploaded++;
    }
  } catch (error) {
    throw new NaverBlogInputError("photo_upload_failed", error);
  }
  return { ok: true, titleFilled: true, bodyFilled: true, imagesUploaded, published: false };
}
