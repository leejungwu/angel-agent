export type BlogExecutionBlock<Image extends { index: number }> = { type: "text"; text: string } | (Image & { type: "image" });

export function createBlogExecutionBlocks<Image extends { index: number; insertOffset: number }>(bodyText: string, images: Image[]): BlogExecutionBlock<Image>[] {
  const blocks: BlogExecutionBlock<Image>[] = [];
  let cursor = 0;
  const indexes = new Set<number>();
  for (const image of images) {
    const offset = image.insertOffset;
    if (!Number.isSafeInteger(offset) || offset < cursor || offset > bodyText.length ||
      !Number.isSafeInteger(image.index) || image.index < 0 || indexes.has(image.index) ||
      (offset > 0 && /[\uD800-\uDBFF]/.test(bodyText[offset - 1]) && /[\uDC00-\uDFFF]/.test(bodyText[offset] ?? ""))) throw new Error("사진 배치 순서/위치가 유효하지 않습니다.");
    indexes.add(image.index);
    if (offset > cursor) blocks.push({ type: "text", text: bodyText.slice(cursor, offset) });
    blocks.push({ ...image, type: "image" });
    cursor = offset;
  }
  if (cursor < bodyText.length) blocks.push({ type: "text", text: bodyText.slice(cursor) });
  return blocks;
}

