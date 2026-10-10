export type BlogBody = {
  intro?: string | null;
  sections: { heading?: string | null; body: string }[];
  closing?: string | null;
};

export const BLOG_BODY_TARGET_CHARS = 1500;
export const BLOG_BODY_MIN_CHARS = 1200;
export const BLOG_BODY_MAX_CHARS = 1800;

export function checkBlogBodyLength(draft: BlogBody) {
  // Count Unicode characters, including spaces but excluding layout line breaks and field-edge whitespace.
  const characters = [draft.intro, ...draft.sections.flatMap((section) => [section.heading, section.body]), draft.closing]
    .reduce<number>((total, text) => total + Array.from((text ?? "").trim().replace(/\r\n|\r|\n/g, "")).length, 0);
  const status = characters < BLOG_BODY_MIN_CHARS ? "too_short"
    : characters > BLOG_BODY_MAX_CHARS ? "too_long" : "ok";
  return { characters, status };
}
