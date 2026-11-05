/**
 * Scope eval (editor overhaul Phase 3.4): does the Director understand the request, and change ONLY what it asks?
 *
 * Each case: a prompt, a timeline (a hand-edited one, or a raw clip), the expected mode, and the parts of the timeline
 * the request may change. Everything else must come back unchanged.
 *
 * Mocked mode (CI, default): the planner is a scripted model that does the right thing AND an over-eager "viral
 * pass" on top (regenerate captions, replace the music, reframe, cut pauses, add zooms / text / B-roll / effects).
 * The scope step must keep every one of those extras off a scoped request.
 *   npx tsx --test packages/domains/ai/tests/director-scope-eval.test.ts
 *
 * Live mode: the same cases with a real model (keys from the environment), reporting scope accuracy.
 *   AI_DIRECTOR_LIVE=1 AI_DIRECTOR_LIVE_PROVIDER=claude ANTHROPIC_API_KEY=... npx tsx --test packages/domains/ai/tests/director-scope-eval.test.ts
 *   Target before release: ≥ 95% mode accuracy and 0 forbidden changes.
 *
 * (requires `packages/video-contracts` to be built: `pnpm --filter @workspace/video-contracts build`)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileAIDirectRequestSchema, MobileEditIR, MobileEditIRSchema } from "@workspace/video-contracts";
import { VideoAIDirectorService, MobileDirectResult } from "../src/builders/video-ai-director.service";
import type { AIClient, ToolCallResponse } from "../src/kernel/ai-provider.service";

const director = VideoAIDirectorService.getInstance();
const tc = (name: string, args: Record<string, any>) => ({ id: `t_${name}_${Math.random().toString(36).slice(2, 7)}`, name, args });

// ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────────

/** 12 s of speech; "um" at 2.0 s, "gym" at 6.4 s, a pause at 8.0-9.0 s. */
const WORDS = (() => {
  const text = "so here is the um thing about going to the gym every single day and why it matters more than you think".split(" ");
  const out: Array<{ text: string; startMs: number; endMs: number }> = [];
  let t = 200;
  for (const w of text) {
    if (t >= 8000 && t < 9000) t = 9000;
    out.push({ text: w, startMs: t, endMs: t + 260 });
    t += 300;
  }
  return out;
})();
const GYM_SEC = WORDS.find((w) => w.text === "gym")!.startMs / 1000;
const MEDIA = { assetId: "primary", durationMs: 12000, width: 1080, height: 1920, fps: 30, transcript: { words: WORDS }, silences: [{ startMs: 8000, endMs: 9000 }] };

const clip = (id: string, a: number, b: number) => ({ id, assetId: "primary", sourceStartMs: a, sourceEndMs: b, timelineStartMs: a, timelineEndMs: b, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null });
const captionAt = (id: string, i: number) => {
  const ws = WORDS.slice(i * 4, i * 4 + 4);
  return { id, kind: "caption", startMs: ws[0].startMs, endMs: ws[ws.length - 1].endMs, text: ws.map((w) => w.text).join(" "), words: ws.map((w) => ({ text: w.text, startMs: w.startMs, endMs: w.endMs })), style: { textColor: "#FFFFFF" } };
};

/** A timeline the creator already worked on: own title and zoom, plus the Director's captions, music, B-roll... */
const EDITED: MobileEditIR = MobileEditIRSchema.parse({
  schemaVersion: "mobile-editir/1", projectId: "eval",
  canvas: { aspect: "9:16", width: 1080, height: 1920, fps: 30, background: "#000000" },
  durationMs: 12000,
  sources: [{ assetId: "primary", durationMs: 12000, width: 1080, height: 1920 }],
  clips: [clip("c0", 0, 6000), clip("c1", 6000, 12000)],
  overlays: [{ id: "b1", kind: "broll", timelineStartMs: 4000, timelineEndMs: 6000, sourceStartMs: 0, source: { kind: "url", url: "https://cdn.test/gym.mp4", query: "gym" }, fit: "cover", opacity: 1, muted: true }],
  captions: [
    { id: "t1", kind: "text", startMs: 0, endMs: 2000, text: "Gym truth", words: [], style: { fontSizePx: 64, textColor: "#EF4444", positionY: 0.3 } },
    captionAt("cap1", 0), captionAt("cap2", 1), captionAt("cap3", 2),
  ],
  zooms: [
    { id: "z1", startMs: 5000, endMs: 6500, scale: 1.6, centerX: 0.5, centerY: 0.4, rampMs: 200 },
    { id: "z2", startMs: 9500, endMs: 10500, scale: 1.3, centerX: 0.5, centerY: 0.4, rampMs: 200 },
  ],
  effects: [{ id: "fx1", type: "shake", startMs: 7000, endMs: 7500, intensity: 0.8 }],
  audio: {
    originalTrack: { volumeDb: 0 },
    music: [{ id: "m1", timelineStartMs: 0, timelineEndMs: 12000, sourceStartMs: 0, source: { kind: "url", url: "https://cdn.test/mine.mp3", query: "lofi" }, volumeDb: -14, fadeInMs: 500, fadeOutMs: 1000, duck: { enabled: true, duckDb: -12, attackMs: 120, releaseMs: 350 } }],
    speechRangesMs: [],
    sfx: [{ id: "s1", timelineStartMs: 3000, durationMs: 500, source: { kind: "url", url: "https://cdn.test/pop.mp3" }, volumeDb: -6 }],
  },
  itemMeta: { t1: { origin: "manual" }, z1: { origin: "manual" }, cap1: { origin: "director" }, cap2: { origin: "director" }, cap3: { origin: "director" }, z2: { origin: "director" }, b1: { origin: "director" }, m1: { origin: "director" } },
});

/** A raw clip: nothing edited yet. */
const RAW: MobileEditIR = MobileEditIRSchema.parse({ ...EDITED, clips: [clip("c0", 0, 12000)], overlays: [], captions: [], zooms: [], effects: undefined, itemMeta: undefined, audio: { originalTrack: { volumeDb: 0 }, music: [], speechRangesMs: [] } });

// ── What may change ──────────────────────────────────────────────────────────────────────────────────

type LaneName = "clips" | "captions" | "titles" | "zooms" | "overlays" | "effects" | "sfx" | "voiceovers" | "music" | "originalTrack" | "canvas";
const LANES: Record<LaneName, (ir: MobileEditIR) => unknown[]> = {
  clips: (ir) => ir.clips,
  captions: (ir) => ir.captions.filter((c) => c.kind !== "text"),
  titles: (ir) => ir.captions.filter((c) => c.kind === "text"),
  zooms: (ir) => ir.zooms,
  overlays: (ir) => ir.overlays,
  effects: (ir) => ir.effects ?? [],
  sfx: (ir) => ir.audio.sfx ?? [],
  voiceovers: (ir) => ir.audio.voiceovers ?? [],
  music: (ir) => ir.audio.music,
  originalTrack: (ir) => [ir.audio.originalTrack],
  canvas: (ir) => [ir.canvas],
};
// A cut moves items, and shortens the captions it runs through (their words and text): neither is a forbidden change.
const TIME_KEYS = new Set(["startMs", "endMs", "timelineStartMs", "timelineEndMs", "words", "text", "sourceStartMs", "sourceEndMs", "durationMs"]);
const untimed = (x: any) => (x && typeof x === "object" ? Object.fromEntries(Object.entries(x).filter(([k]) => !TIME_KEYS.has(k))) : x);

/** Lanes outside `touch` that changed. When the cuts may change, items may move or be cut away, but not change. */
function forbiddenChanges(before: MobileEditIR, after: MobileEditIR, touch: LaneName[]): string[] {
  const out: string[] = [];
  const cuts = touch.includes("clips");
  for (const lane of Object.keys(LANES) as LaneName[]) {
    if (touch.includes(lane)) continue;
    const b = LANES[lane](before) as any[];
    const a = LANES[lane](after) as any[];
    if (!cuts) {
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push(lane);
      continue;
    }
    if (lane === "canvas" || lane === "originalTrack") {
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push(lane);
      continue;
    }
    const byId = new Map(b.map((x) => [x.id, x]));
    for (const x of a) {
      const y = byId.get(x.id);
      if (!y) { out.push(`${lane}: added ${x.id}`); continue; }
      if (JSON.stringify(untimed(x)) !== JSON.stringify(untimed(y))) out.push(`${lane}: changed ${x.id}`);
    }
  }
  return out;
}

// ── Cases ────────────────────────────────────────────────────────────────────────────────────────────

interface Case {
  prompt: string;
  timeline: "edited" | "raw";
  mode: "modify_existing" | "add_new" | "full_edit" | "question" | "ambiguous";
  /** Lanes the request may change. */
  touch: LaneName[];
  /** What a good model would call. */
  script: Array<ReturnType<typeof tc>>;
  check?: (res: MobileDirectResult, before: MobileEditIR) => void;
}

const sameMusicSource = (res: MobileDirectResult) => assert.deepEqual(res.editIR.audio.music[0]?.source, EDITED.audio.music[0].source, "the creator's music track is kept");

const CASES: Case[] = [
  // Change what is there.
  { prompt: "make the music quieter", timeline: "edited", mode: "modify_existing", touch: ["music"], script: [tc("updateMusic", { volumeDb: -24 })], check: (r) => { sameMusicSource(r); assert.equal(r.editIR.audio.music[0].volumeDb, -24); } },
  { prompt: "the music is too loud", timeline: "edited", mode: "modify_existing", touch: ["music"], script: [tc("updateMusic", { volumeDb: -22 })], check: sameMusicSource },
  { prompt: "lower the music a bit", timeline: "edited", mode: "modify_existing", touch: ["music"], script: [tc("adjustVolume", { trackId: "music", volumeDb: -20 })], check: sameMusicSource },
  { prompt: "turn the music down", timeline: "edited", mode: "modify_existing", touch: ["music"], script: [tc("updateMusic", { volumeDb: -22 })], check: sameMusicSource },
  { prompt: "mute the music", timeline: "edited", mode: "modify_existing", touch: ["music"], script: [tc("muteTrack", { track: "music", muted: true })], check: sameMusicSource },
  { prompt: "stop ducking the music", timeline: "edited", mode: "modify_existing", touch: ["music"], script: [tc("updateMusic", { duck: false })], check: (r) => assert.equal(r.editIR.audio.music[0].duck.enabled, false) },
  { prompt: "make the title bigger", timeline: "edited", mode: "modify_existing", touch: ["titles"], script: [tc("updateTextStyle", { target: "t1", fontSizePx: 110 })], check: (r) => { const t = r.editIR.captions.filter((c) => c.kind === "text"); assert.equal(t.length, 1); assert.equal(t[0].style.fontSizePx, 110); } },
  { prompt: "make the title white", timeline: "edited", mode: "modify_existing", touch: ["titles"], script: [tc("updateTextStyle", { target: "t1", textColor: "#FFFFFF" })] },
  { prompt: "change the title to Day 1", timeline: "edited", mode: "modify_existing", touch: ["titles"], script: [tc("editText", { id: "t1", text: "Day 1" })], check: (r) => assert.equal(r.editIR.captions.find((c) => c.id === "t1")!.text, "Day 1") },
  { prompt: "move the title higher", timeline: "edited", mode: "modify_existing", touch: ["titles"], script: [tc("updateTextStyle", { target: "t1", positionY: 0.15 })] },
  { prompt: "make the captions yellow", timeline: "edited", mode: "modify_existing", touch: ["captions"], script: [tc("updateTextStyle", { target: "all_captions", textColor: "#FFE600" })], check: (r) => assert.deepEqual(r.editIR.captions.filter((c) => c.kind === "caption").map((c) => c.text), EDITED.captions.filter((c) => c.kind === "caption").map((c) => c.text), "caption texts unchanged") },
  { prompt: "captions bigger", timeline: "edited", mode: "modify_existing", touch: ["captions"], script: [tc("styleCaption", { fontSize: 80 })] },
  { prompt: "fix the typo in the first caption, it should say gym", timeline: "edited", mode: "modify_existing", touch: ["captions"], script: [tc("editText", { id: "cap1", text: "so here is gym" })] },
  { prompt: "the zoom at 5s is too strong", timeline: "edited", mode: "modify_existing", touch: ["zooms"], script: [tc("updateZoom", { id: "z1", scale: 1.15 })], check: (r) => { assert.equal(r.editIR.zooms.length, 2); assert.equal(r.editIR.zooms.find((z) => z.id === "z1")!.scale, 1.15); } },
  { prompt: "soften the zooms", timeline: "edited", mode: "modify_existing", touch: ["zooms"], script: [tc("updateZoom", { id: "z1", scale: 1.2 }), tc("updateZoom", { id: "z2", scale: 1.1 })] },
  { prompt: "remove the zoom at 5s", timeline: "edited", mode: "modify_existing", touch: ["zooms"], script: [tc("removeItem", { kind: "zoom", atSec: 5.5 })], check: (r) => assert.deepEqual(r.editIR.zooms.map((z) => z.id), ["z2"]) },
  { prompt: "make the b-roll shorter", timeline: "edited", mode: "modify_existing", touch: ["overlays"], script: [tc("retimeItem", { kind: "broll", id: "b1", durationSec: 1 })] },
  { prompt: "move the b-roll to 8s", timeline: "edited", mode: "modify_existing", touch: ["overlays"], script: [tc("retimeItem", { kind: "broll", id: "b1", startSec: 8 })], check: (r) => assert.equal(r.editIR.overlays[0].timelineStartMs, 8000) },
  { prompt: "make the sound effect quieter", timeline: "edited", mode: "modify_existing", touch: ["sfx"], script: [tc("setSfxVolume", { id: "s1", volumeDb: -20 })] },
  { prompt: "make the shake effect weaker", timeline: "edited", mode: "modify_existing", touch: ["effects"], script: [tc("updateEffect", { id: "fx1", intensity: 0.3 })] },
  { prompt: "my voice is too quiet", timeline: "edited", mode: "modify_existing", touch: ["originalTrack"], script: [tc("adjustVolume", { trackId: "original", volumeDb: 4 })], check: (r) => assert.equal(r.editIR.audio.originalTrack.volumeDb, 4) },
  { prompt: "make it black and white", timeline: "edited", mode: "modify_existing", touch: ["clips", "effects"], script: [tc("applyFilter", { preset: "NOIR_BW", saturation: 0 })] },
  { prompt: "rotate it", timeline: "edited", mode: "modify_existing", touch: ["clips"], script: [tc("rotateClip", { clipId: "all", rotationDeg: 90 })] },
  // Add something specific.
  { prompt: "add a zoom on the punchline", timeline: "edited", mode: "add_new", touch: ["zooms"], script: [tc("addZoom", { startSec: 10.6, durationSec: 1, scale: 1.3, targetCoords: { x: 0.5, y: 0.4 } })], check: (r) => assert.ok(r.editIR.zooms.length >= 3 && ["z1", "z2"].every((id) => r.editIR.zooms.some((z) => z.id === id)), "zoom added, existing zooms kept") },
  { prompt: "add a sticker at 3s", timeline: "edited", mode: "add_new", touch: ["overlays"], script: [tc("addSticker", { emoji: "🔥", timelineStartSec: 3, durationSec: 2 })] },
  { prompt: "add a whoosh at 4s", timeline: "edited", mode: "add_new", touch: ["sfx"], script: [tc("addSoundEffect", { sfxType: "whoosh", timelineStartSec: 4 })] },
  { prompt: "add a flash effect at 7s", timeline: "edited", mode: "add_new", touch: ["effects"], script: [tc("addEffect", { effect: "flash", startSec: 7, durationSec: 0.3 })] },
  {
    prompt: "add b-roll when I talk about the gym", timeline: "edited", mode: "add_new", touch: ["overlays"],
    script: [tc("insertBroll", { stockQuery: "gym workout", timelineStartSec: GYM_SEC, durationSec: 2 })],
    check: (r) => assert.ok(r.editIR.overlays.some((o) => o.id !== "b1" && Math.abs(o.timelineStartMs / 1000 - GYM_SEC) <= 1), "B-roll within ±1 s of 'gym'"),
  },
  { prompt: "put a title saying Day 1 at the start", timeline: "edited", mode: "add_new", touch: ["titles"], script: [tc("addText", { text: "Day 1", timelineStartSec: 0, durationSec: 2 })] },
  { prompt: "add a crossfade between the clips", timeline: "edited", mode: "add_new", touch: ["clips"], script: [tc("addTransition", { transitionType: "CROSSFADE", durationSec: 0.3 })] },
  { prompt: "add a voiceover saying link in bio at 10s", timeline: "edited", mode: "add_new", touch: ["voiceovers"], script: [tc("addNarration", { text: "link in bio", timelineStartSec: 10 })] },
  { prompt: "add some background music", timeline: "edited", mode: "add_new", touch: ["music"], script: [tc("addBackgroundMusic", { query: "upbeat" })], check: sameMusicSource },
  { prompt: "add captions but don't touch the music", timeline: "edited", mode: "add_new", touch: ["captions"], script: [tc("autoCaptions", { highlightColor: "#FFE600" })], check: sameMusicSource },
  // The cuts.
  { prompt: "remove the pauses", timeline: "edited", mode: "modify_existing", touch: ["clips"], script: [tc("removeSilences", { minDurationSec: 0.5 })], check: (r) => assert.ok(r.editIR.durationMs < 12000) },
  { prompt: "cut the first 2 seconds", timeline: "edited", mode: "modify_existing", touch: ["clips"], script: [tc("removeRange", { startSec: 0, durationSec: 2, reason: "asked" })], check: (r) => assert.ok(r.editIR.durationMs <= 10000, "the first 2 s are cut") },
  { prompt: "remove the filler words", timeline: "edited", mode: "modify_existing", touch: ["clips"], script: [tc("cleanFillers", { fillerTypes: ["um"] })] },
  { prompt: "speed it up to 1.2x", timeline: "edited", mode: "modify_existing", touch: ["clips"], script: [tc("changeSpeed", { clipId: "all", speedMultiplier: 1.2 })] },
  { prompt: "freeze the frame at 3s", timeline: "edited", mode: "modify_existing", touch: ["clips"], script: [tc("freezeFrame", { timestampSec: 3, durationSec: 1 })] },
  // Whole-video asks.
  { prompt: "edit this for reels", timeline: "raw", mode: "full_edit", touch: Object.keys(LANES) as LaneName[], script: [tc("removeSilences", {}), tc("autoCaptions", {})], check: (r) => assert.ok(r.editIR.captions.length > 0) },
  { prompt: "make it viral", timeline: "raw", mode: "full_edit", touch: Object.keys(LANES) as LaneName[], script: [tc("autoCaptions", {})] },
  { prompt: "make it punchy for TikTok", timeline: "raw", mode: "full_edit", touch: Object.keys(LANES) as LaneName[], script: [tc("removeSilences", {})] },
  { prompt: "make it better", timeline: "raw", mode: "full_edit", touch: Object.keys(LANES) as LaneName[], script: [tc("autoCaptions", {})] },
  { prompt: "edit this for reels from scratch, redo everything", timeline: "edited", mode: "full_edit", touch: Object.keys(LANES) as LaneName[], script: [tc("removeSilences", {})] },
  // Whole-video asks over the creator's own work: ask first, change nothing.
  { prompt: "make it better", timeline: "edited", mode: "ambiguous", touch: [], script: [], check: (r) => { assert.equal(r.operations.length, 0); assert.match(r.reply, /edited this by hand/); } },
  { prompt: "edit this for reels", timeline: "edited", mode: "ambiguous", touch: [], script: [] },
  { prompt: "do something", timeline: "edited", mode: "ambiguous", touch: [], script: [], check: (r) => assert.equal(r.phase, "gather") },
  // Questions and small talk: nothing is edited.
  { prompt: "what music would fit this video?", timeline: "edited", mode: "question", touch: [], script: [tc("reply_to_creator", { reply: "Lo-fi would suit it.", phase: "chat", quickReplies: [] })] },
  { prompt: "thanks!", timeline: "edited", mode: "question", touch: [], script: [tc("reply_to_creator", { reply: "Any time!", phase: "chat", quickReplies: [] })] },
];

/** The viral pass an over-eager model adds to every answer. */
const OVER_EAGER = () => [
  tc("autoCaptions", { replaceExisting: true }),
  tc("addBackgroundMusic", { query: "epic trailer", replace: true }),
  tc("reframeSubject", { targetAspect: "16:9" }),
  tc("removeSilences", {}),
  tc("addZoom", { startSec: 0.3, durationSec: 1, scale: 1.4, targetCoords: { x: 0.5, y: 0.4 } }),
  tc("addText", { text: "VIRAL", timelineStartSec: 0, durationSec: 1.5 }),
  tc("insertBroll", { stockQuery: "city skyline", timelineStartSec: 1, durationSec: 1.5 }),
  tc("addEffect", { effect: "shake", startSec: 2, durationSec: 0.4 }),
];

function scripted(responses: ToolCallResponse[]): AIClient {
  return {
    provider: "claude",
    generate: async () => { throw new Error("unused"); },
    generateStream: async () => { throw new Error("unused"); },
    generateWithTools: async () => {
      const next = responses.shift();
      if (!next) throw new Error("mock LLM: no more scripted responses");
      return next;
    },
  };
}

function request(c: Case) {
  return MobileAIDirectRequestSchema.parse({ prompt: c.prompt, media: MEDIA, currentEditIR: c.timeline === "edited" ? EDITED : RAW });
}

test(`scope eval (mocked): ${CASES.length} requests are understood and an over-eager model cannot change anything outside them`, async () => {
  assert.ok(CASES.length >= 40);
  let modeHits = 0;
  const failures: string[] = [];
  for (const c of CASES) {
    const before = c.timeline === "edited" ? EDITED : RAW;
    const extras = c.mode === "full_edit" ? [] : OVER_EAGER();
    const client = scripted([{ text: "", toolCalls: [...c.script, ...extras, tc("finish_edit", { summary: "done" })] }]);
    const res = await director.directMobile(request(c), { llmClient: client });
    if (res.scope?.mode === c.mode) modeHits++;
    else failures.push(`${c.prompt}: mode ${res.scope?.mode} (expected ${c.mode})`);
    const forbidden = forbiddenChanges(before, res.editIR, c.touch);
    if (forbidden.length) failures.push(`${c.prompt}: changed ${forbidden.join(", ")}`);
    if (c.mode === "ambiguous" || c.mode === "question") {
      if (res.appliedOperations.length) failures.push(`${c.prompt}: edited on a ${c.mode} turn`);
    }
    try {
      c.check?.(res, before);
    } catch (e: any) {
      failures.push(`${c.prompt}: ${e.message}`);
    }
  }
  const accuracy = modeHits / CASES.length;
  console.log(`scope eval (mocked): mode accuracy ${(accuracy * 100).toFixed(1)}% (${modeHits}/${CASES.length}), ${failures.length} failure(s)`);
  assert.deepEqual(failures, []);
  assert.ok(accuracy >= 0.95);
});

test("scope eval: a scoped turn reports its scope and a plain-language diff", async () => {
  const c = CASES.find((x) => x.prompt === "make the music quieter")!;
  const res = await director.directMobile(request(c), { llmClient: scripted([{ text: "", toolCalls: [...c.script, ...OVER_EAGER(), tc("finish_edit", { summary: "ok" })] }]) });
  assert.deepEqual(res.scope?.targets.map((t) => t.kind), ["music"]);
  assert.equal(res.scope?.source, "offline");
  assert.match(res.diffSummary.text, /music −14 → −24 dB/);
  assert.equal(res.diffSummary.destructive, false);
  assert.ok(res.warnings.some((w) => /left out .*not part of what you asked/.test(w)));
  const cut = CASES.find((x) => x.prompt === "cut the first 2 seconds")!;
  const r2 = await director.directMobile(request(cut), { llmClient: scripted([{ text: "", toolCalls: [...cut.script, tc("finish_edit", { summary: "ok" })] }]) });
  assert.equal(r2.diffSummary.cutSec, 2);
  assert.equal(r2.diffSummary.destructive, true);
});

test("scope eval: an unrecognised request is scoped by the LLM intent call", async () => {
  const res = await director.directMobile(
    MobileAIDirectRequestSchema.parse({ prompt: "la música más bajita por favor", media: MEDIA, currentEditIR: EDITED }),
    {
      llmClient: scripted([
        { text: "", toolCalls: [tc("classify_request", { mode: "modify_existing", targets: [{ kind: "music" }], allowedTools: ["updateMusic"] })] },
        { text: "", toolCalls: [tc("updateMusic", { volumeDb: -24 }), ...OVER_EAGER(), tc("finish_edit", { summary: "ok" })] },
      ]),
    }
  );
  assert.equal(res.scope?.source, "llm");
  assert.deepEqual(forbiddenChanges(EDITED, res.editIR, ["music"]), []);
  assert.equal(res.editIR.audio.music[0].volumeDb, -24);
});

// ── Live mode (opt-in) ───────────────────────────────────────────────────────────────────────────────

const LIVE = process.env.AI_DIRECTOR_LIVE === "1";

test("scope eval (live model)", { skip: !LIVE && "set AI_DIRECTOR_LIVE=1 (and a provider key) to run against a real model" }, async () => {
  const { AIProviderService } = await import("../src/kernel/ai-provider.service");
  const client = await AIProviderService.getInstance().getClient({
    aiProvider: process.env.AI_DIRECTOR_LIVE_PROVIDER || "claude",
    claudeKey: process.env.ANTHROPIC_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    geminiKey: process.env.GEMINI_API_KEY,
  });
  assert.ok(client, "no AI provider key in the environment");
  let modeHits = 0;
  let forbiddenTotal = 0;
  const rows: Array<{ prompt: string; expected: string; got: string; forbidden: string }> = [];
  for (const c of CASES) {
    const before = c.timeline === "edited" ? EDITED : RAW;
    const res = await director.directMobile(request(c), { llmClient: client });
    const forbidden = forbiddenChanges(before, res.editIR, c.touch);
    if (res.scope?.mode === c.mode) modeHits++;
    forbiddenTotal += forbidden.length ? 1 : 0;
    rows.push({ prompt: c.prompt, expected: c.mode, got: `${res.scope?.mode} (${res.scope?.source})`, forbidden: forbidden.join(", ") });
  }
  console.table(rows);
  const accuracy = modeHits / CASES.length;
  console.log(`scope eval (live): mode accuracy ${(accuracy * 100).toFixed(1)}%, ${forbiddenTotal} case(s) with forbidden changes`);
  assert.ok(accuracy >= 0.95, `scope accuracy ${(accuracy * 100).toFixed(1)}% < 95%`);
  assert.equal(forbiddenTotal, 0);
});
