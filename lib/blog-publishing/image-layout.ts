import type { BlogBody } from "../blog-generation/body";

// 사진 배치 설정: 균등 배치를 기본으로 하고, 부족한 본문 문단은 분할합니다.
// 새로운 위치 규칙은 chooseImagePositions()에서만 구현하면 됩니다.
const IMAGE_PLACEMENT_RULE = {
  strategy: "even",
  allowParagraphSplit: true,
};

type BlogParagraph = { text: string; field: number; line: number; isProse: boolean };

function splitParagraph(text: string): string[] | null {
  const sentenceEnds = [...text.matchAll(/[.!?。！？]["'”’)]*\s+/g)].map((match) => match.index + match[0].length);
  const boundaries = sentenceEnds.length ? sentenceEnds
    : [...text.matchAll(/\s+/g)].map((match) => match.index + match[0].length);
  const valid = boundaries.filter((index) => text.slice(0, index).trim() && text.slice(index).trim());
  if (!valid.length) return null;
  const middle = valid.reduce((best, index) => Math.abs(index - text.length / 2) < Math.abs(best - text.length / 2) ? index : best);
  return [text.slice(0, middle).trimEnd(), text.slice(middle).trimStart()];
}

function getBlogParagraphs(fields: (string | null | undefined)[], proseFields: Set<number>): BlogParagraph[] {
  return fields.flatMap((value, field) => (value ?? "").trim().split(/\r\n|\r|\n/)
    .map((text, line) => ({ text, field, line, isProse: proseFields.has(field) }))
    .filter(({ text }) => text.trim()));
}

/** 반환값은 각 사진을 삽입할 문단 앞의 index입니다. 사진 순서는 유지합니다. */
function chooseImagePositions(paragraphs: BlogParagraph[], imageCount: number): number[] {
  if (!paragraphs.length) throw new Error("Image placement requires body text");

  // 본문 뒤에 배치하되 마지막 문단 뒤는 제외합니다. 소제목 뒤에는 배치하지 않습니다.
  const boundaries = paragraphs.flatMap(({ isProse }, index) =>
    isProse && index + 1 < paragraphs.length ? [index + 1] : []);
  // 나눌 수 없는 한 문단뿐이라면 기존처럼 그 문단 앞에 사진을 모읍니다.
  if (!boundaries.length) boundaries.push(0);

  switch (IMAGE_PLACEMENT_RULE.strategy) {
    case "even":
      // 가능한 경계를 균등하게 선택합니다. 사진이 더 많으면 같은 경계를 공유합니다.
      return Array.from({ length: imageCount }, (_, index) =>
        boundaries[Math.floor((index + 0.5) * boundaries.length / imageCount)]);
    default:
      throw new Error(`Unsupported image placement strategy: ${IMAGE_PLACEMENT_RULE.strategy}`);
  }
}

export function planBlogImages<T extends BlogBody>(draft: T, imageCount: number): { draft: T; beforeParagraphs: number[] } {
  if (!Number.isSafeInteger(imageCount) || imageCount < 0) throw new Error("Invalid image count");
  if (!imageCount) return { draft, beforeParagraphs: [] };
  const fields = [draft.intro, ...draft.sections.flatMap((section) => [section.heading, section.body]), draft.closing];
  const prose = new Set([0, ...draft.sections.map((_, index) => 2 + index * 2), fields.length - 1]);

  // Add only the paragraph breaks needed for text/image alternation; never split a heading or word.
  while (IMAGE_PLACEMENT_RULE.allowParagraphSplit && getBlogParagraphs(fields, prose).filter(({ isProse }) => isProse).length < imageCount + 1) {
    const candidate = getBlogParagraphs(fields, prose).filter(({ isProse }) => isProse)
      .map((line) => ({ ...line, parts: splitParagraph(line.text) }))
      .filter((line) => line.parts).sort((a, b) => b.text.length - a.text.length)[0];
    if (!candidate) break;
    const value = (fields[candidate.field] ?? "").trim().split(/\r\n|\r|\n/);
    value.splice(candidate.line, 1, ...candidate.parts!);
    fields[candidate.field] = value.join("\n");
  }
  const beforeParagraphs = chooseImagePositions(getBlogParagraphs(fields, prose), imageCount);
  return {
    draft: {
      ...draft, intro: fields[0],
      sections: draft.sections.map((section, index) => ({
        ...section, heading: fields[1 + index * 2], body: fields[2 + index * 2] ?? "",
      })),
      closing: fields.at(-1),
    },
    beforeParagraphs,
  };
}
