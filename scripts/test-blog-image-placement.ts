import assert from "node:assert/strict";
import { planBlogImages } from "../lib/blog-publishing/image-layout";
import { prepareBlogPost } from "../lib/blog-publishing/preparation";
import { DEFAULT_BLOG_IMAGE_PLACEMENT_SETTINGS as defaults, resolveBlogImagePlacementSettings, parseBlogImagePlacementSettings } from "../lib/blog-publishing/image-placement-settings";

const draft = { intro: "도입 하나. 도입 둘.", sections: [{ heading: "첫 제목", body: "본문 하나. 본문 둘. 본문 셋. 본문 넷." }, { heading: "둘 제목", body: "설명 하나. 설명 둘." }], closing: "마무리 하나. 마무리 둘." };
// Captured from the pre-settings algorithm; keep these expectations independent of future planner changes.
const golden = [
  { count: 1, draft, beforeParagraphs: [3] },
  { count: 2, draft, beforeParagraphs: [1, 5] },
  { count: 5, draft: { ...draft, sections: [{ ...draft.sections[0], body: "본문 하나. 본문 둘.\n본문 셋. 본문 넷." }, draft.sections[1]], closing: "마무리 하나.\n마무리 둘." }, beforeParagraphs: [1, 3, 4, 6, 7] },
  { count: 10, draft: { ...draft, intro: "도입 하나.\n도입 둘.", sections: [{ ...draft.sections[0], body: "본문 하나.\n본문 둘.\n본문 셋.\n본문 넷." }, { ...draft.sections[1], body: "설명 하나.\n설명 둘." }], closing: "마무리\n하나.\n마무리 둘." }, beforeParagraphs: [1, 2, 4, 5, 6, 7, 9, 10, 11, 12] },
];
for (const { count, ...expected } of golden) {
  assert.deepEqual(planBlogImages(draft, count), expected);
  assert.deepEqual(planBlogImages(draft, count, defaults), expected);
  assert.deepEqual(planBlogImages(draft, count, null), expected);
}
for (const invalid of [null, undefined, "bad", [], 1, { allowParagraphSplit: "false" }]) assert.deepEqual(resolveBlogImagePlacementSettings(invalid), defaults);
assert.deepEqual(resolveBlogImagePlacementSettings({ pinFirstAfterIntro: true }), { ...defaults, pinFirstAfterIntro: true });
assert.deepEqual(resolveBlogImagePlacementSettings({ pinFirstAfterIntro: true, allowParagraphSplit: 0 }), { ...defaults, pinFirstAfterIntro: true });
assert.throws(() => parseBlogImagePlacementSettings({ allowParagraphSplit: "false" }));
assert.throws(() => parseBlogImagePlacementSettings({ status: "approved" }));

for (const count of [0, 1, 2, 5, 10]) {
  for (const pinFirstAfterIntro of [false, true]) for (const pinLastBeforeClosing of [false, true]) for (const allowParagraphSplit of [false, true]) {
    const settings = { pinFirstAfterIntro, pinLastBeforeClosing, allowParagraphSplit };
    const original = JSON.stringify(draft);
    const plan = planBlogImages(draft, count, settings);
    assert.equal(plan.beforeParagraphs.length, count);
    assert.deepEqual([...plan.beforeParagraphs].sort((a, b) => a - b), plan.beforeParagraphs);
    assert.equal(JSON.stringify(draft), original);
    if (!allowParagraphSplit && count) assert.deepEqual(plan.draft, draft);
    const lines = [plan.draft.intro, ...plan.draft.sections.flatMap(s => [s.heading, s.body]), plan.draft.closing].flatMap(value => (value ?? "").split(/\r\n|\r|\n/)).filter(value => value.trim());
    const introEnd = (plan.draft.intro ?? "").split(/\r\n|\r|\n/).filter(value => value.trim()).length;
    const closingStart = lines.length - (plan.draft.closing ?? "").split(/\r\n|\r|\n/).filter(value => value.trim()).length;
    if (count >= 2 && pinFirstAfterIntro) assert.equal(plan.beforeParagraphs[0], introEnd);
    if (count >= 2 && pinLastBeforeClosing) assert.equal(plan.beforeParagraphs.at(-1), closingStart);
    if (count === 1) assert.deepEqual(plan, planBlogImages(draft, 1, { allowParagraphSplit }));
    const prepared = prepareBlogPost({ ...draft, title: "제목" }, count, settings);
    assert.deepEqual(prepared.blocks.filter(block => block.type === "image").map(block => block.imageIndex), Array.from({ length: count }, (_, i) => i));
  }
}
assert.ok(planBlogImages(draft, 10).draft.intro.includes("\n"));
for (const field of ["intro", "closing"] as const) {
  const missing = { ...draft, [field]: "" };
  const pin = field === "intro" ? { pinFirstAfterIntro: true } : { pinLastBeforeClosing: true };
  assert.deepEqual(planBlogImages(missing, 10, pin), planBlogImages(missing, 10));
}
const noRoom = { intro: "도입", sections: [], closing: "마무리" };
assert.deepEqual(planBlogImages(noRoom, 10, { pinFirstAfterIntro: true, pinLastBeforeClosing: true, allowParagraphSplit: false }).beforeParagraphs, Array(10).fill(1));
const headingOnly = { intro: "", sections: [{ heading: "소제목", body: "" }], closing: "마무리" };
assert.deepEqual(planBlogImages(headingOnly, 2, { pinLastBeforeClosing: true, allowParagraphSplit: false }), planBlogImages(headingOnly, 2, { allowParagraphSplit: false }));
console.log("PASS: default golden compatibility, resolver, split toggle, first/last pins, fallback, all images and order 0/1/2/5/10.");
