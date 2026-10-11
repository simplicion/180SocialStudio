import test from "node:test";
import assert from "node:assert/strict";
import { EditIRCompiler } from "../src/edit-ir-compiler";
import { CreativeEditPlanSchema } from "../src/creative-plan.schema";
import { editIRFromMobileMedia, toMobileEditIR, editIRFromMobile, MobileEditIRSchema } from "../src/mobile-edit-ir";
import { buildDirectorToolDefinitions } from "../src/director-tools";

const media = { assetId: "primary", durationMs: 10000, width: 1080, height: 1920, fps: 30 } as any;
const sources = [{ assetId: "primary", durationMs: 10000, width: 1080, height: 1920 }];

function compile(operations: any[]) {
  const plan = CreativeEditPlanSchema.parse({
    intent: { aspectRatio: "9:16", resolution: { width: 1080, height: 1920 } },
    operations,
    explanation: "test",
  });
  return EditIRCompiler.compile(editIRFromMobileMedia(media, "p1"), plan);
}

test("addEffect lands on the effect track and reaches the mobile IR; ripple cuts move it", () => {
  const r = compile([
    { type: "addEffect", effect: "flash", startSec: 6, durationSec: 0.4, intensity: 0.8 },
    { type: "removeRange", startSec: 1, durationSec: 2, ripple: true, reason: "cut" },
  ]);
  assert.equal(r.updatedEditIR.tracks.effectTrack?.length, 1);
  const { editIR } = toMobileEditIR({ editIR: r.updatedEditIR, sources, primaryAssetId: "primary" });
  assert.equal(MobileEditIRSchema.safeParse(editIR).success, true);
  assert.equal(editIR.effects?.[0].type, "flash");
  assert.equal(editIR.effects?.[0].startMs, 4000, "moved 2 s earlier by the cut");
  assert.equal(editIR.effects?.[0].intensity, 0.8);
  // Round trip back to EditIR keeps it.
  assert.equal(editIRFromMobile(editIR).tracks.effectTrack?.[0].type, "flash");
});

test("insertBroll mediaType image becomes a photo overlay; images never fall back to stock video search", () => {
  const r = compile([
    { type: "insertBroll", sourceUrl: "https://cdn.test/p.jpg", mediaType: "image", timelineStartSec: 2, durationSec: 2 },
    { type: "insertBroll", stockQuery: "coffee", mediaType: "image", timelineStartSec: 6, durationSec: 2 },
  ]);
  const { editIR } = toMobileEditIR({ editIR: r.updatedEditIR, sources, primaryAssetId: "primary" });
  assert.equal(editIR.overlays.length, 1);
  assert.equal(editIR.overlays[0].mediaType, "image");
  assert.ok(r.rejectedOperations.some((m) => m.includes("insertBroll")));
});

test("no effects -> field omitted (older clients unaffected); the director can call addEffect", () => {
  const { editIR } = toMobileEditIR({ editIR: compile([]).updatedEditIR, sources, primaryAssetId: "primary" });
  assert.equal("effects" in editIR, false);
  assert.ok(buildDirectorToolDefinitions().some((t: any) => (t.function?.name ?? t.name) === "addEffect"));
});
