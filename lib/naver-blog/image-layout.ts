import type { BlogBody } from "../blog-generation/body";

function splitParagraph(text: string): string[] | null {
  const sentenceEnds = [...text.matchAll(/[.!?。！？]["'”’)]*\s+/g)].map((match) => match.index + match[0].length);
  const boundaries = sentenceEnds.length ? sentenceEnds
    : [...text.matchAll(/\s+/g)].map((match) => match.index + match[0].length);
  const valid = boundaries.filter((index) => text.slice(0, index).trim() && text.slice(index).trim());
  if (!valid.length) return null;
  const middle = valid.reduce((best, index) => Math.abs(index - text.length / 2) < Math.abs(best - text.length / 2) ? index : best);
  return [text.slice(0, middle).trimEnd(), text.slice(middle).trimStart()];
}

export function planBlogImages<T extends BlogBody>(draft: T, imageCount: number): { draft: T; beforeParagraphs: number[] } {
  if (!Number.isSafeInteger(imageCount) || imageCount < 0) throw new Error("Invalid image count");
  if (!imageCount) return { draft, beforeParagraphs: [] };
  const fields = [draft.intro, ...draft.sections.flatMap((section) => [section.heading, section.body]), draft.closing];
  const prose = new Set([0, ...draft.sections.map((_, index) => 2 + index * 2), fields.length - 1]);
  const lines = () => fields.flatMap((value, field) => (value ?? "").trim().split(/\r\n|\r|\n/)
    .map((text, line) => ({ text, field, line })).filter(({ text }) => text.trim()));

  // Add only the paragraph breaks needed for text/image alternation; never split a heading or word.
  while (lines().filter(({ field }) => prose.has(field)).length < imageCount + 1) {
    const candidate = lines().filter(({ field }) => prose.has(field))
      .map((line) => ({ ...line, parts: splitParagraph(line.text) }))
      .filter((line) => line.parts).sort((a, b) => b.text.length - a.text.length)[0];
    if (!candidate) break;
    const value = (fields[candidate.field] ?? "").trim().split(/\r\n|\r|\n/);
    value.splice(candidate.line, 1, ...candidate.parts!);
    fields[candidate.field] = value.join("\n");
  }
  const paragraphs = lines();
  if (!paragraphs.length) throw new Error("Image placement requires body text");
  const boundaries = paragraphs.flatMap(({ field }, index) => prose.has(field) && index + 1 < paragraphs.length ? [index + 1] : []);
  // shortcut: indivisible short prose requires balanced image groups, add more prose to obtain full alternation.
  if (!boundaries.length) boundaries.push(0);
  return {
    draft: {
      ...draft, intro: fields[0],
      sections: draft.sections.map((section, index) => ({
        ...section, heading: fields[1 + index * 2], body: fields[2 + index * 2] ?? "",
      })),
      closing: fields.at(-1),
    },
    beforeParagraphs: Array.from({ length: imageCount }, (_, index) => boundaries[Math.floor((index + 0.5) * boundaries.length / imageCount)]),
  };
}
