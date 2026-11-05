/**
 * Phase 6 through a Director turn: beat-aware placement on the music bed (6.4).
 * Run: npx tsx --test packages/domains/ai/tests/director-phase6.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileAIDirectRequestSchema } from "@workspace/video-contracts";
import { VideoAIDirectorService, snapToBeats } from "../src/builders/video-ai-director.service";
import type { AIClient } from "../src/kernel/ai-provider.service";

const director = VideoAIDirectorService.getInstance();
const tc = (name: string, args: Record<string, any>) => ({ id: `t_${name}_${Math.random().toString(36).slice(2, 7)}`, name, args });
const client = (calls: any[]): AIClient => ({
  provider: "claude",
  generate: async () => { throw new Error("unused"); },
  generateStream: async () => { throw new Error("unused"); },
  generateWithTools: async () => ({ text: "", toolCalls: calls }),
});
const media = { durationMs: 10000, width: 1080, height: 1920, transcript: { words: [{ text: "hello", startMs: 200, endMs: 500 }] } };

test("snapToBeats moves starts within 150 ms onto the nearest beat, and leaves others", () => {
  const r = snapToBeats([{ type: "addZoom", startSec: 1.9 }, { type: "insertBroll", timelineStartSec: 5.0 }, { type: "addText", timelineStartSec: 2.0 }], [2000, 4500]);
  assert.equal((r.ops[0] as any).startSec, 2);
  assert.equal((r.ops[1] as any).timelineStartSec, 5.0, "500 ms away: not moved");
  assert.equal((r.ops[2] as any).timelineStartSec, 2.0, "titles are not beat-placed");
  assert.equal(r.moved, 1);
});

test("a whole edit puts the zoom on the music's beat; a scoped edit does not move anything", async () => {
  const full = await director.directMobile(
    MobileAIDirectRequestSchema.parse({ prompt: "edit this for reels", media, musicBeatsMs: [3000, 3500, 4000] }),
    { llmClient: client([tc("addZoom", { startSec: 3.42, durationSec: 1, scale: 1.3, targetCoords: { x: 0.5, y: 0.4 } }), tc("finish_edit", { summary: "ok" })]) }
  );
  assert.equal(full.editIR.zooms[0].startMs, 3500);
  assert.ok(full.warnings.some((w) => /on the music's beat/.test(w)));
  const scoped = await director.directMobile(
    MobileAIDirectRequestSchema.parse({ prompt: "add a zoom at 3.4s", media, musicBeatsMs: [3000, 3500, 4000] }),
    { llmClient: client([tc("addZoom", { startSec: 3.42, durationSec: 1, scale: 1.3, targetCoords: { x: 0.5, y: 0.4 } }), tc("finish_edit", { summary: "ok" })]) }
  );
  assert.equal(scoped.editIR.zooms[0].startMs, 3420, "the creator asked for that moment");
});

test("an app that cannot render a feature never gets it; one that can, does", async () => {
  const twoClips = {
    schemaVersion: "mobile-editir/1", projectId: "p", canvas: { aspect: "9:16", width: 1080, height: 1920, fps: 30, background: "#000000" },
    durationMs: 10000, sources: [{ assetId: "primary", durationMs: 12000, width: 1080, height: 1920 }],
    clips: [
      { id: "c0", assetId: "primary", sourceStartMs: 0, sourceEndMs: 5000, timelineStartMs: 0, timelineEndMs: 5000, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null },
      { id: "c1", assetId: "primary", sourceStartMs: 6000, sourceEndMs: 11000, timelineStartMs: 5000, timelineEndMs: 10000, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null },
    ],
    overlays: [], captions: [], zooms: [], audio: { originalTrack: { volumeDb: 0 }, music: [], speechRangesMs: [] },
  };
  const ask = (caps?: string[]) =>
    director.directMobile(
      MobileAIDirectRequestSchema.parse({ prompt: "add a J-cut on the second clip", media: { ...media, durationMs: 12000 }, currentEditIR: twoClips, ...(caps ? { rendererCapabilities: caps } : {}) }),
      { llmClient: client([tc("jlCut", { clipId: "c1", leadMs: 250 }), tc("finish_edit", { summary: "ok" })]) }
    );
  const old = await ask();
  assert.equal(old.editIR.clips[1].audioLeadMs, undefined);
  assert.ok(old.warnings.some((w) => /cannot render J\/L cuts/.test(w)));
  const capable = await ask(["jlCut"]);
  assert.equal(capable.editIR.clips[1].audioLeadMs, 250);
});
