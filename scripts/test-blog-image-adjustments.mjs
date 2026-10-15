import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { resolve } from "node:path";
import ts from "typescript";

function load(file, mocks = {}) {
  const filename = resolve(file), mod = new Module(filename), original = createRequire(filename);
  mod.filename = filename; mod.require = name => name in mocks ? mocks[name] : original(name);
  mod._compile(ts.transpileModule(readFileSync(filename, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
  return mod.exports;
}
const base = load("lib/blog-task-assets.ts");
const edit = load("lib/blog-task-assets/edit.ts", { "../blog-task-assets": base });
const legacy = { crop: { x: 0, y: 0, width: 1, height: 1 }, brightness: 110, watermark: { text: "", position: "bottom-right", opacity: 0.5, fontSize: 32 }, blurRegions: [] };
const settings = edit.parseImageEdit(legacy);
assert.deepEqual([settings.contrast, settings.saturation, settings.temperature, settings.sharpness, settings.filter], [100, 100, 0, 0, "none"]);
assert.deepEqual(settings.border, { enabled: false, width: 0, color: "#000000" });
for (const patch of [{ contrast: 49 }, { contrast: 151 }, { saturation: -1 }, { saturation: 201 }, { temperature: 101 }, { sharpness: -1 }, { filter: "unknown" }, { border: { enabled: true, width: 31, color: "#000000" } }, { border: { color: "red" } }]) assert.throws(() => edit.parseImageEdit({ ...settings, ...patch }));
for (const filter of ["none", "vivid", "warm", "cool", "grayscale", "high-contrast"]) {
  const preset = edit.applyImagePreset(settings, filter);
  assert.equal(preset.filter, filter); assert.deepEqual(preset.crop, settings.crop);
  assert.deepEqual(edit.parseImageEdit(preset), preset);
}
assert.equal(edit.applyImagePreset(settings, "none").brightness, 100);
assert.ok(edit.applyImagePreset(settings, "warm").temperature > 0);
assert.ok(edit.applyImagePreset(settings, "cool").temperature < 0);
assert.equal(edit.applyImagePreset(settings, "grayscale").saturation, 0);
assert.ok(edit.applyImagePreset(settings, "high-contrast").contrast > 100);
assert.ok(edit.applyImagePreset(settings, "vivid").sharpness > 0);
const manual = { ...edit.applyImagePreset(settings, "high-contrast"), contrast: 105 };
assert.equal(edit.parseImageEdit(manual).contrast, 105);
const pixels = new Uint8ClampedArray([80, 100, 120, 77]);
assert.equal(edit.adjustImagePixels(pixels, 1, 1, 0, 0), pixels, "Neutral adjustments must not touch pixels");
const warm = edit.adjustImagePixels(pixels, 1, 1, 100, 0), cool = edit.adjustImagePixels(pixels, 1, 1, -100, 0);
assert.ok(warm[0] > pixels[0] && warm[2] < pixels[2]);
assert.ok(cool[0] < pixels[0] && cool[2] > pixels[2]);
assert.equal(warm[3], 77); assert.equal(cool[3], 77);
const flat = new Uint8ClampedArray(Array.from({ length: 9 }, () => [100, 100, 100, 255]).flat());
assert.deepEqual(edit.adjustImagePixels(flat, 3, 3, 0, 100), flat);
const detail = flat.slice(); detail.set([120, 120, 120, 255], 16);
const sharp = edit.adjustImagePixels(detail, 3, 3, 0, 100);
assert.ok(sharp[16] > detail[16] && sharp[16] < 160, "Sharpen is bounded to avoid excessive halos");
assert.equal(detail[16], 120, "Never mutate original pixels");
console.log("PASS: legacy defaults, validation, six presets/manual override, neutral pixels, warm/cool channels, bounded sharpen/alpha preservation.");
