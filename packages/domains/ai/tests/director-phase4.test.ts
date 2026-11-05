/**
 * Phase 4 of the video editor overhaul: the Director analyses every clip, not only the first (audit F-10).
 *
 * Run: npx tsx --test packages/domains/ai/tests/director-phase4.test.ts
 * (requires `packages/video-contracts` to be built: `pnpm --filter @workspace/video-contracts build`)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileAIDirectRequestSchema, MobileEditIRSchema } from "@workspace/video-contracts";
import { VideoAIDirectorService } from "../src/builders/video-ai-director.service";
import type { AIClient, ToolCallResponse } from "../src/kernel/ai-provider.service";

const director = VideoAIDirectorService.getInstance();
const tc = (name: string, args: Record<string, any>) => ({ id: `t_${name}_${Math.random().toString(36).slice(2, 7)}`, name, args });
const finish = () => tc("finish_edit", { summary: "done" });

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

/** Words spread over a 4 s take, starting at 200 ms. */
const take = (text: string) => text.split(" ").map((t, i) => ({ text: t, startMs: 200 + i * 400, endMs: 200 + i * 400 + 300 }));
const WORDS = {
  primary: take("welcome back to the channel today"),
  take2: take("so um this is the second take"),
  take3: take("and that is how you do it"),
};
const UM = WORDS.take2.find((w) => w.text === "um")!;

/** Three 4 s clips, one per source file, on a 16:9 canvas (each file is 1920x1080). */
function timeline(canvas: "16:9" | "9:16" = "16:9") {
  const ids = ["primary", "take2", "take3"] as const;
  return MobileEditIRSchema.parse({
    schemaVersion: "mobile-editir/1", projectId: "p4",
    canvas: canvas === "16:9" ? { aspect: "16:9", width: 1920, height: 1080, fps: 30, background: "#000000" } : { aspect: "9:16", width: 1080, height: 1920, fps: 30, background: "#000000" },
    durationMs: 12000,
    sources: ids.map((assetId) => ({ assetId, durationMs: 4000, width: 1920, height: 1080 })),
    clips: ids.map((assetId, i) => ({ id: `c${i}`, assetId, sourceStartMs: 0, sourceEndMs: 4000, timelineStartMs: i * 4000, timelineEndMs: (i + 1) * 4000, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null })),
    overlays: [], captions: [], zooms: [],
    audio: { originalTrack: { volumeDb: 0 }, music: [], speechRangesMs: [] },
  });
}

const descriptor = (assetId: keyof typeof WORDS, extra: Record<string, any> = {}) => ({ assetId, durationMs: 4000, width: 1920, height: 1080, transcript: { words: WORDS[assetId] }, ...extra });

function request(prompt: string, opts: { list?: boolean; extra?: Record<string, any>; canvas?: "16:9" | "9:16" } = {}) {
  return MobileAIDirectRequestSchema.parse({
    prompt,
    media: descriptor("primary"),
    ...(opts.list === false ? {} : { mediaList: [descriptor("take2"), descriptor("take3")] }),
    currentEditIR: timeline(opts.canvas),
    ...opts.extra,
  });
}

test("F-10: 'remove the fillers' cuts the 'um' in clip 2 (a different source file)", async () => {
  const { client, calls } = mockClient([{ text: "", toolCalls: [tc("cleanFillers", { fillerTypes: ["um"] }), finish()] }]);
  const res = await director.directMobile(request("remove the filler words"), { llmClient: client });
  assert.match(calls[0], /:um\b/, "clip 2's words reach the planner");
  const cut = 12000 - res.editIR.durationMs;
  assert.ok(cut >= UM.endMs - UM.startMs - 5 && cut < 1000, `about the length of "um" was cut (${cut} ms)`);
  const take2 = res.editIR.clips.filter((c) => c.assetId === "take2");
  assert.equal(take2.length, 2, "clip 2 was split around the filler");
  assert.ok(take2[0].sourceEndMs <= UM.startMs + 5 && take2[1].sourceStartMs >= UM.endMs - 5);
  assert.ok(res.editIR.clips.filter((c) => c.assetId !== "take2").every((c) => c.sourceEndMs - c.sourceStartMs === 4000), "the other clips are untouched");
});

test("F-10: captions are made for all three clips, from each clip's own words", async () => {
  const { client } = mockClient([{ text: "", toolCalls: [tc("autoCaptions", {}), finish()] }]);
  const res = await director.directMobile(request("add captions"), { llmClient: client });
  const caps = res.editIR.captions.filter((c) => c.kind === "caption");
  for (const [i, src] of (["primary", "take2", "take3"] as const).entries()) {
    const inClip = caps.filter((c) => c.startMs >= i * 4000 && c.startMs < (i + 1) * 4000);
    assert.ok(inClip.length > 0, `captions in clip ${i + 1}`);
    assert.ok(inClip.flatMap((c) => c.words.map((w) => w.text)).some((t) => WORDS[src].some((w) => w.text === t)), `clip ${i + 1} captions use its own words`);
  }
});

test("F-10: speech ranges (music ducking) cover every clip", async () => {
  const { client } = mockClient([{ text: "", toolCalls: [tc("addBackgroundMusic", { query: "calm", duckUnderSpeech: true }), finish()] }]);
  const res = await director.directMobile(request("add calm music"), { llmClient: client });
  const ranges = res.editIR.audio.speechRangesMs;
  for (let i = 0; i < 3; i++) assert.ok(ranges.some(([s, e]) => s < (i + 1) * 4000 && e > i * 4000), `speech in clip ${i + 1}`);
});

test("F-10: each clip's fill crop centres on its own speaker", async () => {
  const faces = (x: number) => [0, 1000, 2000, 3000].map((tMs) => ({ tMs, x, y: 0.4, w: 0.2, h: 0.3 }));
  const req = MobileAIDirectRequestSchema.parse({
    prompt: "make it vertical",
    media: descriptor("primary", { faces: faces(0.3) }),
    mediaList: [descriptor("take2", { faces: faces(0.8) }), descriptor("take3")],
    currentEditIR: timeline("16:9"),
  });
  const { client } = mockClient([{ text: "", toolCalls: [tc("reframeSubject", { targetAspect: "9:16" }), finish()] }]);
  const res = await director.directMobile(req, { llmClient: client });
  const centre = (i: number) => res.editIR.clips[i].crop!.x + res.editIR.clips[i].crop!.width / 2;
  assert.ok(Math.abs(centre(0) - 0.3) < 0.02, `clip 1 framed on its speaker (${centre(0)})`);
  assert.ok(Math.abs(centre(1) - 0.8) < 0.02 || res.editIR.clips[1].crop!.x + res.editIR.clips[1].crop!.width >= 0.999, `clip 2 framed on its speaker (${centre(1)})`);
});

test("F-10: an older client (no mediaList) gets captions where it has words, and is told about the rest", async () => {
  const { client } = mockClient([{ text: "", toolCalls: [tc("autoCaptions", {}), finish()] }]);
  const res = await director.directMobile(request("add captions", { list: false }), { llmClient: client });
  const caps = res.editIR.captions.filter((c) => c.kind === "caption");
  assert.ok(caps.every((c) => c.startMs < 4000), "only the primary clip has words");
  assert.ok(res.warnings.some((w) => /clip source take2 has no transcript/.test(w)), JSON.stringify(res.warnings));
});

test("F-10: a clip still being transcribed is reported and the planner is told not to guess", async () => {
  const { client, calls } = mockClient([{ text: "", toolCalls: [tc("autoCaptions", {}), finish()] }]);
  const req = MobileAIDirectRequestSchema.parse({
    prompt: "add captions",
    media: descriptor("primary"),
    mediaList: [descriptor("take2"), { assetId: "take3", durationMs: 4000, width: 1920, height: 1080 }],
    analysisPending: ["take3"],
    currentEditIR: timeline(),
  });
  const res = await director.directMobile(req, { llmClient: client });
  assert.ok(res.warnings.some((w) => /take3 is still being transcribed/.test(w)));
  assert.match(calls[0], /still transcribing clip source\(s\) take3/);
});
