import assert from "node:assert/strict";
import { parsePresetConfig } from "../lib/kin/presets";
import { ANSWER_SCHEMA } from "../lib/kin/generate";

const { minLength, maxLength } = ANSWER_SCHEMA.properties.answer;
for (const invalid of [{ min_chars: minLength - 1 }, { min_chars: maxLength + 1 }, { max_chars: maxLength + 1 }, { max_chars: minLength - 1 }, { min_chars: 600, max_chars: 500 }]) {
  assert.throws(() => parsePresetConfig(invalid));
}
for (const count of [minLength, maxLength]) {
  assert.equal(parsePresetConfig({ min_chars: count, max_chars: count }).min_chars, count);
}
assert.equal(parsePresetConfig({}).min_chars, null);
console.log("PASS: KIN preset lengths match output schema bounds");
