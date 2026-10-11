/**
 * Editor parity E1.3: the edit-style fingerprint measures how the creator edited so far and where the raw tail starts,
 * so the Director can "complete this video in my style".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EditIRCompiler } from "../src/edit-ir-compiler";
import { CreativeEditPlanSchema } from "../src/creative-plan.schema";
import { editIRFromMobileMedia, toMobileEditIR, editIRFromMobile } from "../src/mobile-edit-ir";
import { deriveEditStyle, describeEditStyle } from "../src/edit-style";

const media = { assetId: "primary", durationMs: 30000, width: 1080, height: 1920, fps: 30 } as any;
const sources = [{ assetId: "primary", durationMs: 30000, width: 1080, height: 1920 }];

function baseMobile() {
  const r = EditIRCompiler.compile(
    editIRFromMobileMedia(media, "p1"),
    CreativeEditPlanSchema.parse({ intent: { aspectRatio: "9:16", resolution: { width: 1080, height: 1920 } }, operations: [], explanation: "t" }),
  );
  return toMobileEditIR({ editIR: r.updatedEditIR, sources, primaryAssetId: "primary" }).editIR;
}

test("a raw video has no style and no unedited range", () => {
  const f = deriveEditStyle(editIRFromMobile(baseMobile()));
  assert.equal(f.editedUntilSec, 0);
  assert.equal(f.uneditedRange, null);
  assert.match(describeEditStyle(f)[0], /nothing edited yet/);
});

test("a half-edited video reports its style and the raw tail", () => {
  const m = baseMobile();
  for (const [i, s] of [1000, 4000, 7000, 10000].entries()) {
    m.zooms.push({ id: `z${i}`, startMs: s, endMs: s + 1500, scale: 1.3, centerX: 0.5, centerY: 0.4, rampMs: 200 });
  }
  m.overlays.push(
    { id: "pip", kind: "broll", timelineStartMs: 2000, timelineEndMs: 5000, sourceStartMs: 0, source: { kind: "url", url: "https://cdn.test/a.mp4" } as any, fit: "contain", opacity: 1, muted: true, layer: { mode: "overlay", x: 0.7, y: 0.3, scale: 0.4, rotation: 0 } },
    { id: "pip2", kind: "broll", timelineStartMs: 8000, timelineEndMs: 12000, sourceStartMs: 0, source: { kind: "url", url: "https://cdn.test/b.mp4" } as any, fit: "contain", opacity: 1, muted: true, layer: { mode: "overlay", x: 0.3, y: 0.3, scale: 0.4, rotation: 0 } },
  );
  const f = deriveEditStyle(editIRFromMobile(m));
  assert.equal(f.editedUntilSec, 12);
  assert.deepEqual(f.uneditedRange, { fromSec: 12, toSec: 30 });
  assert.equal(f.zoomsPerMin, 20); // 4 zooms in the 12 s edited part
  assert.equal(f.avgZoomScale, 1.3);
  assert.equal(f.brollPerMin, 10);
  assert.equal(f.avgBrollSec, 3.5);
  assert.equal(f.layerShare, 1);
  const lines = describeEditStyle(f);
  assert.match(lines[0], /20 zooms\/min/);
  assert.match(lines[0], /picture-in-picture/);
  assert.match(lines[1], /12s–30s is still unedited/);
});

test("edits that reach the end leave no unedited range", () => {
  const m = baseMobile();
  m.zooms.push({ id: "z", startMs: 0, endMs: 29000, scale: 1.2, centerX: 0.5, centerY: 0.5, rampMs: 0 });
  const f = deriveEditStyle(editIRFromMobile(m));
  assert.equal(f.uneditedRange, null);
  assert.equal(describeEditStyle(f).length, 1);
});
