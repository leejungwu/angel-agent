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

async function cancelPreviousDraft(page: Page, frame: Frame, timeoutMs: number): Promise<void> {
  // Allow the optional resume dialog to arrive after the editor frame loads.
  const deadline = Date.now() + Math.min(timeoutMs, 5_000);
  do {
    for (const scope of [frame, page]) {
      const message = await firstVisible(scope.getByText(/작성 중인 글이 있습니다\./));
      if (!message) continue;
      console.log("작성 중인 글 모달 감지");
      // Find the nearest message ancestor containing Cancel, keeping the click
      // inside this dialog rather than matching another page-level Cancel.
      const modal = message.locator("xpath=ancestor::*[.//*[normalize-space(.)='취소']][1]");
      const cancel = await firstVisible(modal.getByText("취소", { exact: true }));
      if (!cancel) throw new Error("작성 중인 글 모달의 취소 버튼을 찾지 못했습니다.");
      await cancel.click({ timeout: timeoutMs });
      console.log("이전 작성글 이어쓰기 취소");
      await message.waitFor({ state: "hidden", timeout: timeoutMs });
      await modal.waitFor({ state: "hidden", timeout: timeoutMs });
      console.log("작성 중인 글 모달 처리 완료");
      return;
    }
    await new Promise((done) => setTimeout(done, 100));
  } while (Date.now() < deadline);
}

async function selectIndividualPhotos(page: Page, frame: Frame, timeoutMs: number): Promise<boolean> {
  // The attachment dialog can be mounted inside the editor frame or on the Page.
  for (const scope of [frame, page]) {
    const title = await firstVisible(scope.getByText("사진 첨부 방식", { exact: true }));
    if (!title) continue;
    console.log("사진 첨부 방식 선택창 감지");
    const option = scope.getByText("개별사진", { exact: true });
    await option.first().waitFor({ state: "visible", timeout: timeoutMs });
    const visibleOption = await firstVisible(option);
    if (!visibleOption) throw new Error("개별사진 선택지를 찾지 못했습니다.");
    await visibleOption.click({ timeout: timeoutMs });
    console.log("개별사진 선택");
    await title.waitFor({ state: "hidden", timeout: timeoutMs });
    await visibleOption.waitFor({ state: "hidden", timeout: timeoutMs });
    console.log("사진 첨부 방식 선택 완료");
    return true;
  }
  return false;
}

const BODY_PARAGRAPHS = ".se-component.se-text .se-text-paragraph";

function contentLines(values: (string | null | undefined)[]): string[] {
  return values.flatMap((value) => (value?.trim() ?? "").split(/\r\n|\r|\n/))
    .map(normalizeEditorText).filter(Boolean);
}

async function findInlineImagePosition(frame: Frame, draft: NaverBlogDraftInput, imageIndex: number) {
  const paragraphs = frame.locator(BODY_PARAGRAPHS);
  const texts = (await paragraphs.allTextContents()).map((text, index) => ({ text: normalizeEditorText(text), index }))
    .filter((paragraph) => paragraph.text);
  const section = draft.sections[imageIndex];
  const label = `${imageIndex + 1}/${draft.imagePaths?.length ?? 0}`;
  console.log(section
    ? `대상 section: ${imageIndex + 1}/${draft.sections.length} - ${normalizeEditorText(section.heading ?? "").slice(0, 40)}`
    : "대상 section: closing 직전 (남은 이미지)");
  const lines = section ? contentLines([section.heading, section.body]) : contentLines([draft.closing]);
  if (!lines.length || (section && !section.heading?.trim())) {
    throw new Error(`inline image ${section ? "section heading" : "closing"} not found at ${label}`);
  }
  const headingLines = section ? contentLines([section.heading]) : lines;
  if (!texts.some((_, index) => headingLines.every((line, offset) => texts[index + offset]?.text === line))) {
    throw new Error(`inline image ${section ? "section heading" : "closing"} not found at ${label}`);
  }
  console.log(section ? "section heading 발견" : "closing 발견");
  const matches = texts.flatMap((_, index) =>
    lines.every((line, offset) => texts[index + offset]?.text === line) ? [index] : []);
  // Full heading/body matching disambiguates repeated headings. Identical sections
  // are resolved in draft order; unrelated duplicate matches fail safely.
  const identicalSections = section ? draft.sections.filter((candidate) =>
    JSON.stringify(contentLines([candidate.heading, candidate.body])) === JSON.stringify(lines)).length : 1;
  const occurrence = section ? draft.sections.slice(0, imageIndex).filter((candidate) =>
    JSON.stringify(contentLines([candidate.heading, candidate.body])) === JSON.stringify(lines)).length : 0;
  if (matches.length !== identicalSections) {
    throw new Error(`inline image section end not found at ${label} (matches: ${matches.length}, expected: ${identicalSections})`);
  }
  const index = texts[matches[occurrence] + (section ? lines.length - 1 : 0)].index;
  console.log("section 끝 위치 발견");
  return { paragraph: paragraphs.nth(index), index, before: !section };
}

async function verifyInlineImageOrder(
  frame: Frame, draft: NaverBlogDraftInput, imageIndex: number,
  previousImages: { element: Awaited<ReturnType<Locator["elementHandles"]>>[number]; sources: string }[],
  anchor: { heading: string; headingFound: boolean; endFound: boolean; bodyEndIndex?: number },
) {
  return frame.evaluate(({ draft, imageIndex, previousImages, anchor, paragraphsSelector, imageSelector }) => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    const paragraphs = [...document.querySelectorAll(paragraphsSelector)]
      .map((element) => ({ element, text: normalize(element.textContent ?? "") })).filter(({ text }) => text);
    const resolveHeading = (heading: string, index: number) => {
      const expected = normalize(heading);
      if (!expected) return null;
      const occurrence = draft.sections.slice(0, index).filter((section) =>
        normalize(section.heading ?? "") === expected).length;
      const exact = paragraphs.filter(({ text }) => text === expected);
      if (exact[occurrence]) return exact[occurrence].element;
      // Uploads may merge paragraphs or replace text wrappers. Resolve the
      // saved heading independently of the section body's paragraph layout.
      const containing = paragraphs.filter(({ text }) => text.includes(expected));
      if (containing[occurrence]) return containing[occurrence].element;
      const components = [...document.querySelectorAll(".se-component.se-text")]
        .filter((element) => normalize(element.textContent ?? "").includes(expected));
      return components.length === 1 ? components[0] : null;
    };
    const sources = (element: Element) => JSON.stringify([...element.querySelectorAll("img")]
      .map((image) => image.getAttribute("src") ?? ""));
    const images = [...document.querySelectorAll(imageSelector)];
    // Prefer element identity. Source signatures also recognize existing images
    // if SmartEditor replaced their wrappers; consume duplicate signatures once.
    const remaining = [...previousImages];
    const added = images.filter((image) => {
      let index = remaining.findIndex((previous) => previous.element === image);
      if (index < 0) index = remaining.findIndex((previous) => previous.sources === sources(image));
      if (index < 0) return true;
      remaining.splice(index, 1);
      return false;
    });
    const target = resolveHeading(anchor.heading, imageIndex);
    const hasNext = imageIndex + 1 < draft.sections.length;
    const next = hasNext ? resolveHeading(draft.sections[imageIndex + 1].heading ?? "", imageIndex + 1) : null;
    const image = added.length === 1 ? added[0] : null;
    const follows = (first: Element, second: Element) =>
      !!(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
    const section = draft.sections[imageIndex];
    const bodyEnd = anchor.bodyEndIndex === undefined ? null
      : document.querySelectorAll(paragraphsSelector)[anchor.bodyEndIndex];
    const verifiedBeforeUpload = anchor.headingFound && anchor.endFound;
    const ordered = section
      ? verifiedBeforeUpload && (!hasNext || !!image && !!next && follows(image, next)) &&
        !!bodyEnd && !!image && follows(bodyEnd, image)
      : !!target && !!image && follows(image, target);
    const nodes = [...document.querySelectorAll("*")];
    return {
      valid: images.length === previousImages.length + 1 && remaining.length === 0 && !!ordered,
      sectionHeadingDOMIndex: target ? nodes.indexOf(target) : -1,
      insertedImageDOMIndex: image ? nodes.indexOf(image) : -1,
      nextSectionHeadingDOMIndex: next ? nodes.indexOf(next) : -1,
      beforeImageCount: previousImages.length, afterImageCount: images.length,
      addedImageCount: added.length,
    };
  }, { draft, imageIndex, previousImages, anchor, paragraphsSelector: BODY_PARAGRAPHS,
    imageSelector: NAVER_EDITOR_SELECTORS.imageComponent });
}

async function readInlineSection(frame: Frame, draft: NaverBlogDraftInput, imageIndex: number) {
  return frame.evaluate(({ draft, imageIndex, selector }) => {
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    const paragraphs = [...document.querySelectorAll(selector)];
    const texts = paragraphs.map((element) => element.textContent ?? "");
    const findHeading = (heading: string, occurrence: number) => {
      const expected = normalize(heading);
      if (!expected) return -1;
      const lines = heading.trim().split(/\r\n|\r|\n/).map(normalize).filter(Boolean);
      const nonempty = texts.map((text, index) => ({ text: normalize(text), index })).filter(({ text }) => text);
      const exact = nonempty.filter((_, index) => lines.every((line, offset) => nonempty[index + offset]?.text === line));
      if (exact[occurrence]) return exact[occurrence].index;
      return nonempty.filter(({ text }) => text.includes(expected))[occurrence]?.index ?? -1;
    };
    const section = draft.sections[imageIndex];
    if (!section) throw new Error("Section required for insertion boundary");
    const occurrence = (index: number) => draft.sections.slice(0, index).filter((candidate) =>
      normalize(candidate.heading ?? "") === normalize(draft.sections[index].heading ?? "")).length;
    const start = findHeading(section.heading ?? "", occurrence(imageIndex));
    const next = draft.sections[imageIndex + 1];
    const boundary = next ? findHeading(next.heading ?? "", occurrence(imageIndex + 1))
      : draft.closing?.trim() ? findHeading(draft.closing, 0) : paragraphs.length;
    if (start < 0 || boundary <= start) throw new Error("Section DOM range not found");
    const endIndex = texts.map((text, index) => ({ text, index }))
      .filter(({ text, index }) => index >= start && index < boundary && text.trim()).at(-1)?.index;
    if (endIndex === undefined) throw new Error("Section last paragraph not found");
    // No whitespace normalization: preserve the original section text exactly.
    return { text: texts.slice(start, boundary).filter((text) => text.trim()).join(""), endIndex, boundary };
  }, { draft, imageIndex, selector: BODY_PARAGRAPHS });
}

async function prepareInlineImageParagraph(
  page: Page, frame: Frame, paragraphIndex: number, before: boolean, timeoutMs: number,
) {
  const paragraphs = frame.locator(BODY_PARAGRAPHS);
  const originalTexts = await paragraphs.allTextContents();
  const paragraph = paragraphs.nth(paragraphIndex);
  await paragraph.click({ timeout: timeoutMs });
  await paragraph.evaluate((element, before) => {
    const selection = element.ownerDocument.getSelection();
    if (!selection) throw new Error("Cannot focus image insertion boundary");
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.collapse(before);
    selection.removeAllRanges();
    selection.addRange(range);
  }, before);
  // A keyboard event updates SmartEditor's selection before the paragraph break.
  await page.keyboard.press(before ? "Home" : "End");
  const atBoundary = await paragraph.evaluate((element, before) => {
    const selection = element.ownerDocument.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer)) return false;
    const prefix = range.cloneRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(range.startContainer, range.startOffset);
    return before ? prefix.toString().length === 0 : prefix.toString() === element.textContent;
  }, before);
  if (!atBoundary) throw new Error("사진 삽입 전 section 문단 경계를 확인하지 못했습니다.");
  await page.keyboard.press("Enter");
  const insertionIndex = paragraphIndex + (before ? 0 : 1);
  await frame.waitForFunction(({ selector, originalCount, insertionIndex }) => {
    const current = document.querySelectorAll(selector);
    return current.length === originalCount + 1 && !!current[insertionIndex] &&
      !(current[insertionIndex].textContent ?? "").trim();
  }, { selector: BODY_PARAGRAPHS, originalCount: originalTexts.length, insertionIndex }, { timeout: timeoutMs });
  const currentTexts = await paragraphs.allTextContents();
  if (JSON.stringify(currentTexts.filter((_, index) => index !== insertionIndex)) !==
      JSON.stringify(originalTexts)) {
    throw new Error("사진 삽입 문단 생성 중 기존 본문이 변경됐습니다.");
  }
  const insertion = paragraphs.nth(insertionIndex);
  await insertion.click({ timeout: timeoutMs });
  await page.keyboard.press("End");
  const focused = await insertion.evaluate((element) => {
    const selection = element.ownerDocument.getSelection();
    return !!selection?.isCollapsed && !!selection.anchorNode && element.contains(selection.anchorNode);
  });
  if (!focused) throw new Error("별도 사진 삽입 문단의 포커스를 확인하지 못했습니다.");
  console.log("section 뒤 별도 사진 삽입 문단 확인 완료");
}

async function insertSectionImages(
  page: Page, frame: Frame, draft: NaverBlogDraftInput, timeoutMs: number, imageTimeoutMs: number,
): Promise<number> {
  const paths = draft.imagePaths ?? [];
  const initialCount = await frame.locator(NAVER_EDITOR_SELECTORS.imageComponent).count();
  let imagesUploaded = 0;
  console.log(`inline images requested: ${paths.length}`);
  try {
    for (const [index, path] of paths.entries()) {
      console.log(`inline image 시작: ${index + 1}/${paths.length}`);
      // Re-query headings/body paragraphs after every image changes the editor DOM.
      const position = await findInlineImagePosition(frame, draft, index);
      const sectionBefore = draft.sections[index] ? await readInlineSection(frame, draft, index) : null;
      // A successful search has already verified both heading and section end.
      const anchor = {
        heading: draft.sections[index]?.heading ?? draft.closing ?? "",
        headingFound: true, endFound: true,
      };
      const previousImages = await Promise.all(
        (await frame.locator(NAVER_EDITOR_SELECTORS.imageComponent).elementHandles()).map(async (element) => ({
          element, sources: await element.evaluate((node) => JSON.stringify([...(node as Element).querySelectorAll("img")]
            .map((image) => image.getAttribute("src") ?? ""))),
        })),
      );
      try {
        try {
          await prepareInlineImageParagraph(page, frame, sectionBefore?.endIndex ?? position.index,
            position.before, timeoutMs);
        } catch {
          throw new Error(`inline image focus failed at ${index + 1}/${paths.length}`);
        }
        console.log("사진 삽입 위치 focus 완료");
        imagesUploaded += await uploadImages(page, frame, [path], imageTimeoutMs, { index, total: paths.length });
        const sectionAfter = sectionBefore ? await readInlineSection(frame, draft, index) : null;
        if (sectionBefore && sectionAfter?.text !== sectionBefore.text) {
          throw new Error(`inline image section body text changed at ${index + 1}/${paths.length}`);
        }
        const deadline = Date.now() + timeoutMs;
        let result;
        do {
          result = await verifyInlineImageOrder(frame, draft, index, previousImages,
            { ...anchor, bodyEndIndex: sectionAfter?.endIndex });
          if (result.valid) break;
          await new Promise((done) => setTimeout(done, 100));
        } while (Date.now() < deadline);
        if (!result.valid) {
          console.error("inline image 위치 검증 실패", result);
          throw new Error(`inline image DOM order verification failed at ${index + 1}/${paths.length}`);
        }
        console.log(`section 사진 삽입 위치 검증 완료: ${index + 1}/${paths.length}`);
      } finally {
        await Promise.all(previousImages.map(({ element }) => element.dispose()));
      }
    }
    if (imagesUploaded !== paths.length ||
        await frame.locator(NAVER_EDITOR_SELECTORS.imageComponent).count() - initialCount !== paths.length) {
      throw new Error("최종 이미지 개수 불일치");
    }
    return imagesUploaded;
  } finally {
    console.log(`inline images uploaded: ${imagesUploaded}`);
  }
}

async function waitForNaverImageUpload(page: Page, frame: Frame, timeoutMs: number) {
  const deadline = Date.now() + Math.min(timeoutMs, 30_000);
  let readySince: number | undefined;
  console.log("Naver 이미지 업로드 완료 대기");
  do {
    let uploading = false;
    for (const scope of [page, frame]) {
      const notice = await firstVisible(scope.getByText(/업로드\s*중에는\s*일부\s*기능을\s*사용할\s*수\s*없습니다/));
      if (notice) {
        uploading = true;
        await notice.waitFor({ state: "hidden", timeout: Math.max(1, deadline - Date.now()) });
      }
    }
    const progress = await firstVisible(frame.locator(NAVER_EDITOR_SELECTORS.imageComponent)
      .locator('[role="progressbar"], [aria-busy="true"]'));
    if (progress) {
      uploading = true;
      await progress.waitFor({ state: "hidden", timeout: Math.max(1, deadline - Date.now()) });
    }
    const button = await firstVisible(frame.locator(NAVER_EDITOR_SELECTORS.photoButton))
      ?? await firstVisible(frame.locator(NAVER_EDITOR_SELECTORS.photoButtonFallback));
    const enabled = button && await button.isEnabled() && await button.evaluate((element) =>
      !element.closest('[disabled], [aria-disabled="true"], [aria-busy="true"]'));
    if (!uploading && enabled) {
      readySince ??= Date.now();
      if (Date.now() - readySince >= 500) {
        console.log("Naver 이미지 업로드 완료");
        return;
      }
    } else readySince = undefined;
    await new Promise((done) => setTimeout(done, 100));
  } while (Date.now() < deadline);
  throw new Error("Naver 이미지 업로드 완료 확인 시간 초과");
}

async function uploadImages(
  page: Page, frame: Frame, imagePaths: string[], timeoutMs: number,
  inline?: { index: number; total: number },
): Promise<number> {
  if (imagePaths.length === 0) return 0;
  console.log(`사진 일괄 업로드 시작: ${imagePaths.length}개`);
  let stage = "toolbar";
  try {
    const components = frame.locator(NAVER_EDITOR_SELECTORS.imageComponent);
    const before = await components.count();
    console.log(`업로드 전 image component count: ${before}`);
    const acquireChooser = async () => {
      stage = "toolbar";
      const button = await firstVisible(frame.locator(NAVER_EDITOR_SELECTORS.photoButton))
        ?? await firstVisible(frame.locator(NAVER_EDITOR_SELECTORS.photoButtonFallback));
      if (!button) throw new Error("사진 버튼을 찾지 못했습니다.");
      stage = "filechooser";
      const chooserTimeout = inline && inline.index > 0 ? Math.min(timeoutMs, 5_000) : timeoutMs;
      const chooserPromise = page.waitForEvent("filechooser", { timeout: chooserTimeout });
      // Consume both promises before retrying so no previous listener survives.
      const [chooserResult, clickResult] = await Promise.allSettled([
        chooserPromise, button.click({ timeout: chooserTimeout }),
      ]);
      if (chooserResult.status === "rejected" || clickResult.status === "rejected") {
        throw new Error("filechooser acquisition failed");
      }
      return chooserResult.value;
    };
    let chooser;
    try {
      chooser = await acquireChooser();
    } catch {
      if (!inline || inline.index === 0 || stage !== "filechooser") throw new Error("filechooser acquisition failed");
      console.log(`inline image filechooser 재시도: ${inline.index + 1}/${inline.total}`);
      stage = "upload readiness";
      await waitForNaverImageUpload(page, frame, timeoutMs);
      chooser = await acquireChooser();
    }
    console.log("filechooser 획득");
    stage = "setFiles";
    await chooser.setFiles(imagePaths.length === 1 ? imagePaths[0] : imagePaths, { timeout: timeoutMs });
    console.log(`setFiles 완료: ${imagePaths.length}개`);
    stage = "image component count";

    const deadline = Date.now() + timeoutMs;
    let after = before;
    let attachmentModeSelected = false;
    do {
      // Poll alongside DOM growth so an absent dialog is normal and a delayed
      // multi-photo dialog is handled before validating inserted components.
      if (!attachmentModeSelected) {
        attachmentModeSelected = await selectIndividualPhotos(page, frame, timeoutMs);
      }
      after = await components.count();
      if (after >= before + imagePaths.length) {
        console.log(`업로드 후 image component count: ${after}`);
        const imagesUploaded = after - before;
        if (imagesUploaded !== imagePaths.length) {
          throw new Error("이미지 업로드 수 불일치");
        }
        console.log("이미지 DOM 삽입 완료");
        console.log(`image component count 증가: ${before} → ${after}`);
        stage = "upload completion";
        await waitForNaverImageUpload(page, frame, timeoutMs);
        if (await components.count() - before !== imagePaths.length) throw new Error("업로드 완료 후 이미지 개수 불일치");
        console.log(`사진 일괄 업로드 성공: ${imagesUploaded}개`);
        return imagesUploaded;
      }
      await new Promise((done) => setTimeout(done, 250));
    } while (Date.now() < deadline);
    console.log(`업로드 후 image component count: ${after}`);
    throw new Error("이미지 컴포넌트 증가 확인 실패");
  } catch {
    // Keep paths, filenames and Playwright call logs out of server logs.
    if (inline) throw new Error(`inline image ${stage} failed at ${inline.index + 1}/${inline.total}`);
    throw new Error(`Naver batch image upload failed (expected ${imagePaths.length} images)`);
  }
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
    for (const [index, path] of (draft.imagePaths ?? []).entries()) {
      try {
        if (!path.trim() || !(await stat(path)).isFile()) throw new Error("Invalid image");
      } catch {
        throw new Error(`이미지 파일 검증 실패: ${index + 1}/${draft.imagePaths?.length ?? 0}`);
      }
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
    await cancelPreviousDraft(page, frame, timeoutMs);
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
    imagesUploaded = await insertSectionImages(page, frame, draft, timeoutMs, imageTimeoutMs);
  } catch (error) {
    throw new NaverBlogInputError("photo_upload_failed", error);
  }
  if (imagesUploaded !== (draft.imagePaths?.length ?? 0)) {
    throw new NaverBlogInputError("photo_upload_failed", new Error("이미지 업로드 수 불일치"));
  }
  try {
    const paragraphs = [draft.intro, ...draft.sections.flatMap((section) => [section.heading, section.body]), draft.closing]
      .flatMap((value) => (value ?? "").split(/\r?\n/)).filter((value) => value.trim());
    await verifyText(frame.locator(NAVER_EDITOR_SELECTORS.body), bodyText, timeoutMs, paragraphs);
    // Also require original paragraph order, since the existing validator permits
    // all-paragraph presence when module textContent omits paragraph separators.
    await verifyText(frame.locator(BODY_PARAGRAPHS), bodyText, timeoutMs);
  } catch (error) {
    throw new NaverBlogInputError("body_input_failed", error);
  }
  return { ok: true, titleFilled: true, bodyFilled: true, imagesUploaded, published: false };
}
