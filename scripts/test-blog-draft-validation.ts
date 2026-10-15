import assert from "node:assert/strict";
import { isDraft } from "../lib/blog-generation/schema";

const draft = { title: "제목", intro: "도입", sections: [{ heading: "제목", body: "본문", imageAssetId: null }], closing: "마무리" };
assert.equal(isDraft(draft), true);
for (const empty of ["", " \n\t "]) {
  for (const key of ["title", "intro", "closing"]) assert.equal(isDraft({ ...draft, [key]: empty }), false, `${key} must not be blank`);
  for (const key of ["heading", "body"]) assert.equal(isDraft({ ...draft, sections: [{ ...draft.sections[0], [key]: empty }] }), false, `${key} must not be blank`);
}
assert.equal(isDraft({ ...draft, sections: [] }), false);
assert.equal(isDraft({ ...draft, sections: [{ ...draft.sections[0], imageAssetId: "1" }] }), false);
console.log("PASS: non-empty Draft fields and unchanged section contract");
