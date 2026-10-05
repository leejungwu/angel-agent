// Node.js automation module. Do not import into Client Components.
import { chromium, type BrowserContext, type Page, type Locator, type Frame } from "playwright";

export type NaverBlogDraft = {
  title: string;
  intro: string;
  sections: { heading: string; body: string }[];
  closing: string;
};

export type NaverEditorSelectors = {
  frame: string | null;
  ready: string;
  title: string;
  body: string;
};

// Starter selectors only: verify against the logged-in editor before live use.
// Override frame with e.g. "iframe#mainFrame" when the editor is inside an iframe.
export const NAVER_EDITOR_SELECTORS: NaverEditorSelectors = {
  frame: null,
  ready: ".se-editor",
  title: '.se-title-text [contenteditable="true"]',
  body: '.se-component.se-text [contenteditable="true"]',
};

type FailureStage = "browser_launch_failed" | "editor_open_failed" |
  "title_input_failed" | "body_input_failed";

export class NaverBlogInputError extends Error {
  constructor(public readonly stage: FailureStage, cause: unknown) {
    super(stage, { cause });
    this.name = "NaverBlogInputError";
  }
}

/** Reuse a dedicated profile already logged in manually; never use Chrome's main profile.
 * The caller owns this context and must eventually close it. Keep it open to inspect input.
 * Use channel "chrome" for installed Chrome, or "chromium" for Playwright Chromium.
 * Do not launch two contexts with the same profile directory at once.
 */
export async function launchNaverBlogSession(
  userDataDir: string,
  channel: "chrome" | "chromium" = "chrome",
): Promise<BrowserContext> {
  try {
    if (!userDataDir.trim()) throw new Error("A dedicated profile directory is required.");
    return await chromium.launchPersistentContext(userDataDir, {
      channel,
      headless: false,
      timeout: 30_000,
    });
  } catch (error) {
    throw new NaverBlogInputError("browser_launch_failed", error);
  }
}

export function composeNaverBlogBody(draft: NaverBlogDraft): string {
  return [
    draft.intro,
    ...draft.sections.map((section) => `${section.heading}\n${section.body}`),
    draft.closing,
  ].join("\n\n");
}

function editorLocator(page: Page, selectors: NaverEditorSelectors, selector: string, frame?: Frame): Locator {
  if (frame) return frame.locator(selector).first();
  return selectors.frame
    ? page.frameLocator(selectors.frame).locator(selector).first()
    : page.locator(selector).first();
}

function findTitleInput(page: Page, selectors: NaverEditorSelectors, frame?: Frame): Locator {
  return editorLocator(page, selectors, selectors.title, frame);
}

function findBodyInput(page: Page, selectors: NaverEditorSelectors, frame?: Frame): Locator {
  return editorLocator(page, selectors, selectors.body, frame);
}

/** Pass a Page from an already logged-in context, including launchNaverBlogSession().
 * writeUrl must be the account's Naver Blog writing URL. No login or publish actions occur.
 * The page stays open on success/failure; the caller manages the session lifetime.
 */
export async function fillNaverBlogDraft(
  draft: NaverBlogDraft,
  options: {
    page: Page;
    writeUrl: string;
    selectors?: Partial<NaverEditorSelectors>;
    timeoutMs?: number;
    editorFrame?: Frame;
    skipNavigation?: boolean;
  },
): Promise<{ ok: true; titleFilled: true; bodyFilled: true; published: false }> {
  const { page, writeUrl, timeoutMs = 30_000 } = options;
  const selectors = { ...NAVER_EDITOR_SELECTORS, ...options.selectors };

  try {
    const url = new URL(writeUrl);
    if (url.protocol !== "https:" || url.hostname !== "blog.naver.com") {
      throw new Error("A Naver Blog HTTPS writing URL is required.");
    }
    if (!options.skipNavigation) {
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    }
    await editorLocator(page, selectors, selectors.ready, options.editorFrame)
      .waitFor({ state: "visible", timeout: timeoutMs });
  } catch (error) {
    throw new NaverBlogInputError("editor_open_failed", error);
  }

  try {
    const title = findTitleInput(page, selectors, options.editorFrame);
    await title.fill(draft.title, { timeout: timeoutMs });
  } catch (error) {
    throw new NaverBlogInputError("title_input_failed", error);
  }

  try {
    const body = findBodyInput(page, selectors, options.editorFrame);
    await body.fill(composeNaverBlogBody(draft), { timeout: timeoutMs });
  } catch (error) {
    throw new NaverBlogInputError("body_input_failed", error);
  }

  // Deliberately stop here: do not click the final publish button or report DB publication.
  return { ok: true, titleFilled: true, bodyFilled: true, published: false };
}
