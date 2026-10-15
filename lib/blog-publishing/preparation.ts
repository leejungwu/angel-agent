import type { BlogBody } from "../blog-generation/body";
import { planBlogImages } from "./image-layout";

export type PreparationBlock = { type: "text"; text: string } | { type: "image"; imageIndex: number };

export function composeBlogBody(draft: BlogBody) {
  return [draft.intro?.trim(), ...draft.sections.map((section) =>
    [section.heading?.trim(), section.body.trim()].filter(Boolean).join("\n")), draft.closing?.trim()]
    .filter(Boolean).join("\n\n");
}

export function prepareBlogPost(draft: BlogBody & { title: string }, imageCount: number, settings?: unknown) {
  const plan = planBlogImages(draft, imageCount, settings);
  const paragraphs = [plan.draft.intro, ...plan.draft.sections.flatMap((section) => [section.heading, section.body]), plan.draft.closing]
    .flatMap((value) => (value ?? "").trim().split(/\r\n|\r|\n/)).filter((text) => text.trim());
  const blocks: PreparationBlock[] = [];
  for (let position = 0; position <= paragraphs.length; position++) {
    plan.beforeParagraphs.forEach((boundary, imageIndex) => {
      if (boundary === position) blocks.push({ type: "image", imageIndex });
    });
    if (position < paragraphs.length) blocks.push({ type: "text", text: paragraphs[position] });
  }
  return {
    title: draft.title.trim(), blocks,
    body: composeBlogBody(draft),
    executionBodyText: paragraphs.join("\n\n"),
    imageInsertOffsets: plan.beforeParagraphs.map((boundary) => paragraphs.slice(0, boundary).join("\n\n").length),
    bodyWithMarkers: blocks.map((block) => block.type === "text" ? block.text : `[사진 ${String(block.imageIndex + 1).padStart(2, "0")} 삽입]`).join("\n\n"),
  };
}
