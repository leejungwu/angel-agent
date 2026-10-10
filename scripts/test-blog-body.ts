import assert from "node:assert/strict";
import { BLOG_BODY_TARGET_CHARS, BLOG_BODY_MIN_CHARS, BLOG_BODY_MAX_CHARS, checkBlogBodyLength } from "../lib/blog-generation/body";
import { planBlogImages } from "../lib/naver-blog/image-layout";

const body = (length: number) => ({ title: "제목".repeat(1000), intro: "가".repeat(length), sections: [], closing: "" });
assert.equal(BLOG_BODY_TARGET_CHARS, 1500);
assert.equal(BLOG_BODY_MIN_CHARS, 1200);
assert.equal(BLOG_BODY_MAX_CHARS, 1800);
for (const length of [1200, 1500, 1800]) {
  assert.deepEqual(checkBlogBodyLength(body(length)), { characters: length, status: "ok" });
}
assert.equal(checkBlogBodyLength(body(1199)).status, "too_short");
assert.equal(checkBlogBodyLength(body(1801)).status, "too_long");
assert.deepEqual(checkBlogBodyLength({ intro: " 가 나\r\n다 ", sections: [{ heading: " 제목 ", body: "본문\n끝😀" }], closing: " 끝 " }),
  { characters: 11, status: "too_short" });

function paragraphs(draft: ReturnType<typeof planBlogImages>["draft"]) {
  return [draft.intro, ...draft.sections.flatMap((section) => [section.heading, section.body]), draft.closing]
    .flatMap((value) => (value ?? "").trim().split(/\r\n|\r|\n/)).filter((line) => line.trim());
}
for (const sectionCount of [2, 3, 4, 5]) {
  const draft = {
    intro: "독자의 상황을 설명합니다. 선택 기준을 살펴봅니다.",
    sections: Array.from({ length: sectionCount }, (_, index) => ({
      heading: index % 2 ? "" : `소제목 ${index}`,
      body: Array.from({ length: 10 }, (_, line) => `제품의 확인된 정보 ${index}-${line}를 설명합니다.`).join(" "),
    })),
    closing: "",
  };
  const original = JSON.stringify(draft);
  const plan = planBlogImages(draft, 15);
  const lines = paragraphs(plan.draft);
  assert.equal(JSON.stringify(draft), original, "planner must not mutate stored draft");
  assert.equal(plan.beforeParagraphs.length, 15);
  assert.equal(new Set(plan.beforeParagraphs).size, 15, "enough prose must provide distinct boundaries");
  assert.ok(plan.beforeParagraphs[0] < lines.length / 3);
  assert.ok(plan.beforeParagraphs.at(-1)! > lines.length * 2 / 3);
  assert.ok(plan.beforeParagraphs.every((position) => position > 0 && position < lines.length));
  assert.ok(plan.beforeParagraphs.every((position, index, positions) => !index || position >= positions[index - 1]));
  assert.ok(plan.beforeParagraphs.every((position, index, positions) => !index || position - positions[index - 1] <= 3));
  const inserted = lines.flatMap((text, position) => [
    ...plan.beforeParagraphs.flatMap((boundary, image) => boundary === position ? [`image-${image}`] : []), text,
  ]);
  assert.deepEqual(inserted.filter((item) => item.startsWith("image-")), Array.from({ length: 15 }, (_, index) => `image-${index}`));
  assert.equal(lines.join("").replace(/\s/g, ""), paragraphs(draft).join("").replace(/\s/g, ""));
  assert.deepEqual(plan.draft.sections.map((section) => section.heading), draft.sections.map((section) => section.heading));
}

const sparse = { intro: "도입", sections: [{ heading: "", body: "본문" }, { heading: "제목", body: "다음 본문" }], closing: "마무리" };
assert.deepEqual(planBlogImages(sparse, 0), { draft: sparse, beforeParagraphs: [] });
for (const count of [1, 2]) {
  const plan = planBlogImages(sparse, count);
  assert.deepEqual(plan.draft, sparse, "few images must not change existing paragraphs");
  assert.equal(plan.beforeParagraphs.length, count);
  assert.equal(new Set(plan.beforeParagraphs).size, count);
}
const limited = planBlogImages({ intro: "가", sections: [{ body: "나" }, { body: "다" }], closing: "" }, 15);
const buckets = [...new Set(limited.beforeParagraphs)].map((boundary) => limited.beforeParagraphs.filter((value) => value === boundary).length);
assert.ok(Math.max(...buckets) - Math.min(...buckets) <= 1, "unavoidable groups must be evenly distributed");
assert.equal(limited.beforeParagraphs.length, 15);
const repeated = { intro: "같은 문장\r\n\r\n같은 문장", sections: [{ heading: "제목", body: "같은 문장\n같은 문장" }], closing: "같은 문장" };
const repeatedPlan = planBlogImages(repeated, 2);
assert.deepEqual(repeatedPlan.draft, repeated);
assert.equal(new Set(repeatedPlan.beforeParagraphs).size, 2);
const full = { intro: "도입 문장. ".repeat(30), sections: [{ heading: "", body: "본문 문장. ".repeat(30) }], closing: "마무리 문장. ".repeat(30) };
const fullPlan = planBlogImages(full, 15);
assert.equal(new Set(fullPlan.beforeParagraphs).size, 15);
const fullLines = paragraphs(fullPlan.draft);
assert.ok(fullPlan.beforeParagraphs.some((position) => fullLines[position - 1].includes("도입")));
assert.ok(fullPlan.beforeParagraphs.some((position) => fullLines[position - 1].includes("마무리")));
assert.deepEqual(planBlogImages({ intro: "한문단", sections: [], closing: "" }, 3).beforeParagraphs, [0, 0, 0]);
assert.throws(() => planBlogImages({ sections: [], closing: "" }, 1));
assert.throws(() => planBlogImages(sparse, -1));
assert.throws(() => planBlogImages(sparse, 1.5));
console.log("PASS: Blog body length, 2–5 sections / 15 images, empty anchors, order, spread and sparse images");
