/**
 * Phase 1 of the video editor overhaul: the Director never destroys manual work (audit F-03, F-05, F-07, F-09).
 *
 * Run: npx tsx --test packages/domains/ai/tests/director-phase1.test.ts
 * (requires `packages/video-contracts` to be built: `pnpm --filter @workspace/video-contracts build`)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileAIDirectRequestSchema, MobileEditIR, MobileEditIRSchema } from "@workspace/video-contracts";
import { VideoAIDirectorService } from "../src/builders/video-ai-director.service";
import { missingRequestedOperations, mergeCoverageOperations } from "../src/builders/creative-planner";
import type { AIClient, ToolCallResponse } from "../src/kernel/ai-provider.service";
import { randomMobileEditIR } from "../../../video-contracts/tests/support/random-mobile-ir";

const director = VideoAIDirectorService.getInstance();
const tc = (name: string, args: Record<string, any>) => ({ id: `t_${name}_${Math.random().toString(36).slice(2, 7)}`, name, args });
const finish = (summary: string) => tc("finish_edit", { summary });

function mockClient(responses: ToolCallResponse[]) {
  const calls: string[] = [];
  const client: AIClient = {
    provider: "claude",
    generate: async () => { throw new Error("unused"); },
    generateStream: async () => { throw new Error("unused"); },
    generateWithTools: async (prompt) => {
      calls.push(prompt);
      const next = responses.shift();
      if (!next) throw new Error("mock LLM: no more scripted responses");
      return next;
    },
  };
  return { client, calls };
}

const words = Array.from({ length: 30 }, (_, i) => ({ text: i % 7 === 3 ? "um" : `word${i}`, startMs: 200 + i * 300, endMs: 200 + i * 300 + 240 }));

function requestFor(ir: MobileEditIR, prompt: string, extra: Record<string, any> = {}) {
  const primary = ir.sources[0];
  return MobileAIDirectRequestSchema.parse({
    prompt,
    media: { assetId: primary.assetId, durationMs: primary.durationMs, width: primary.width, height: primary.height, fps: 30, transcript: { words } },
    currentEditIR: ir,
    ...extra,
  });
}

const noSpeech = (m: MobileEditIR) => ({ ...m, audio: { ...m.audio, speechRangesMs: [] } });

test("F-05 property: a Director turn with zero operations returns currentEditIR unchanged (200 seeds)", async () => {
  for (let seed = 1; seed <= 200; seed++) {
    const ir = randomMobileEditIR(seed);
    // Stock music queries are resolved by the server (a pending query, not a choice): left out of the identity check.
    if (ir.audio.music.some((m) => m.source.kind === "stock_query")) continue;
    const req = requestFor(ir, "hello there");
    const { client } = mockClient([{ text: "", toolCalls: [finish("Nothing to change.")] }]);
    const res = await director.directMobile(req, { llmClient: client });
    assert.deepEqual(noSpeech(MobileEditIRSchema.parse(res.editIR)), noSpeech(req.currentEditIR!), `seed ${seed}`);
  }
});

test("F-03: a timeline with music and SFX from the phone is accepted (was 400 INVALID_REQUEST) and kept", async () => {
  const base = randomMobileEditIR(9);
  const ir = MobileEditIRSchema.parse({
    ...base,
    audio: {
      ...base.audio,
      music: [{ id: "m1", timelineStartMs: 0, timelineEndMs: base.durationMs, sourceStartMs: 0, source: { kind: "asset", assetId: "my_song" }, volumeDb: -18, fadeInMs: 0, fadeOutMs: 500, duck: { enabled: true, duckDb: -12, attackMs: 120, releaseMs: 350 } }],
      sfx: [{ id: "s1", timelineStartMs: 0, source: { kind: "file", path: "/storage/emulated/0/pop.wav" }, volumeDb: 0 }],
    },
  });
  const req = requestFor(ir, "add a zoom at the start");
  const { client } = mockClient([{ text: "", toolCalls: [tc("addZoom", { startSec: 0.2, durationSec: 1, scale: 1.2, targetCoords: { x: 0.5, y: 0.4 } }), finish("Zoomed.")] }]);
  const res = await director.directMobile(req, { llmClient: client });
  assert.deepEqual(res.editIR.audio.music, req.currentEditIR!.audio.music);
  assert.deepEqual(res.editIR.audio.sfx, req.currentEditIR!.audio.sfx);
});

test("F-07: edits of existing items do not trigger the coverage retry", () => {
  const modify = [
    "make the music quieter",
    "the music is too loud",
    "lower the music a bit",
    "make the title bigger",
    "change the title text to Day 1",
    "the zoom at 5s is too strong",
    "fix the transition at 10s",
    "make the captions yellow",
    "move the captions higher",
  ];
  for (const p of modify) assert.deepEqual(missingRequestedOperations(p, [], true), [], p);
  // Asks for something new still count.
  assert.equal(missingRequestedOperations("add captions and some music", [], true).length, 2);
  assert.equal(missingRequestedOperations("cut the pauses and add yellow captions", ["removeSilences"], true).length, 1);
});

test("F-07: 'make the music quieter' is one LLM call and the creator's track is kept", async () => {
  const base = randomMobileEditIR(4);
  const ir = MobileEditIRSchema.parse({
    ...base,
    audio: { ...base.audio, music: [{ id: "m1", timelineStartMs: 0, timelineEndMs: base.durationMs, sourceStartMs: 0, source: { kind: "url", url: "https://cdn.example.com/mine.mp3" }, volumeDb: -12, fadeInMs: 400, fadeOutMs: 900, duck: { enabled: true, duckDb: -10, attackMs: 100, releaseMs: 300 } }] },
  });
  const { client, calls } = mockClient([{ text: "", toolCalls: [tc("adjustVolume", { trackId: "music", volumeDb: -20 }), finish("Lowered the music.")] }]);
  const res = await director.directMobile(requestFor(ir, "make the music quieter"), { llmClient: client });
  assert.equal(calls.length, 1, "no coverage retry pushing addBackgroundMusic");
  const m = res.editIR.audio.music[0];
  assert.equal(m.id, "m1");
  assert.deepEqual(m.source, ir.audio.music[0].source);
  assert.equal(m.volumeDb, -20);
  assert.equal(m.fadeOutMs, 900);
});

test("F-07: a coverage retry that answers with only the missing op keeps the first plan's ops", async () => {
  const base = randomMobileEditIR(6);
  const ir = MobileEditIRSchema.parse({ ...base, captions: [] });
  const { client, calls } = mockClient([
    { text: "", toolCalls: [tc("addZoom", { startSec: 0.5, durationSec: 1, scale: 1.3, targetCoords: { x: 0.5, y: 0.4 } }), finish("Zoom.")] },
    { text: "", toolCalls: [tc("addSticker", { emoji: "🔥", timelineStartSec: 1, durationSec: 2 }), finish("Sticker.")] },
  ]);
  const res = await director.directMobile(requestFor(ir, "add a zoom and a sticker"), { llmClient: client });
  assert.equal(calls.length, 2);
  const types = res.operations.map((o) => o.type);
  assert.ok(types.includes("addZoom"), `zoom kept: ${types}`);
  assert.ok(types.includes("addSticker"), `sticker added: ${types}`);
});

test("F-07: mergeCoverageOperations unions by (type, target, moment)", () => {
  const a = [{ type: "addZoom", startSec: 1.1 }, { type: "removeSilences" }];
  const b = [{ type: "addZoom", startSec: 1.2 }, { type: "addText", text: "Hi", timelineStartSec: 0 }];
  assert.deepEqual(mergeCoverageOperations(a, b).map((o: any) => o.type), ["addZoom", "removeSilences", "addText"]);
});

test("F-01/F-02: baseRevision is echoed so the phone can merge a late response", async () => {
  const ir = randomMobileEditIR(12);
  const { client } = mockClient([{ text: "", toolCalls: [finish("ok")] }]);
  const res = await director.directMobile(requestFor(ir, "hello", { baseRevision: 41 }), { llmClient: client });
  assert.equal(res.baseRevision, 41);
});

test("F-09: the offline director's edit is always a proposal", async () => {
  const ir = MobileEditIRSchema.parse({ ...randomMobileEditIR(13), captions: [] });
  const res = await director.directMobile(requestFor(ir, "add captions"), { llmClient: null });
  assert.equal(res.plannerSource, "deterministic");
  assert.equal(res.autoApplied, false);
  if (res.operations.length) assert.equal(res.requiresConfirmation, true);
});
