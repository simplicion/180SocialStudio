/**
 * Captions v2 render inputs on the mobile IR: optional caption `language` and IR `faceBoxes` (additive).
 * Run: npx tsx --test packages/video-contracts/tests/caption-render-inputs.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileCaptionSchema, MobileEditIRSchema } from "../src/mobile-edit-ir";

const caption = { id: "c1", startMs: 0, endMs: 1000, text: "istanbul" };

test("caption language is optional and kept when present", () => {
  assert.equal(MobileCaptionSchema.parse(caption).language, undefined);
  assert.equal(MobileCaptionSchema.parse({ ...caption, language: "tr" }).language, "tr");
  assert.throws(() => MobileCaptionSchema.parse({ ...caption, language: "" }));
});

test("faceBoxes is optional on the IR, validated as canvas fractions, and survives a parse", () => {
  const shape = MobileEditIRSchema.shape.faceBoxes;
  assert.equal(shape.parse(undefined), undefined);
  const boxes = [{ tMs: 500, x: 0.5, y: 0.35, w: 0.3, h: 0.2 }];
  assert.deepEqual(shape.parse(boxes), boxes);
  assert.throws(() => shape.parse([{ tMs: 0, x: 1.5, y: 0.3, w: 0.1, h: 0.1 }]));
});
