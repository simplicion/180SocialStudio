/**
 * QA (Prompt A, Section 3c): "make it punchy for TikTok" on the talking-head fixture, through the whole pipeline
 * (scope → playbook → story pass → agent loop → guards → compiler → critic → projection), with a scripted model.
 * Run: npx tsx --test packages/domains/ai/tests/director-qa-full-edit.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { resolve } from "path";
import { MobileAIDirectRequestSchema, MobileEditIRSchema } from "@workspace/video-contracts";
import { VideoAIDirectorService } from "../src/builders/video-ai-director.service";
import type { AIClient, ToolCall } from "../src/kernel/ai-provider.service";

const fixture = JSON.parse(readFileSync(resolve(__dirname, "../../../../scripts/director-eval/fixtures/talking-head-45s.json"), "utf8"));
const media = fixture.request.media;
const words: Array<{ text: string; startMs: number; endMs: number }> = media.transcript.words;
const faceX = 0.5, faceY = 0.36;

let n = 0;
const c = (name: string, args: Record<string, any> = {}): ToolCall => ({ id: `q${++n}`, name, args });

/** A scripted editor: the story cuts the false start, then one sensible move per stage. */
function editor(): AIClient {
  return {
    provider: "claude",
    generate: async () => "",
    generateStream: async () => "",
    generateWithTools: async (prompt, tools) => {
      const names = tools.map((t: any) => t.function?.name ?? t.name);
      if (names.includes("plan_story")) {
        // The false start ("So the biggest mistake ... is sorry let me start that again") is the first line(s) before the clean take.
        const lines = [...prompt.matchAll(/^(L\d+) \[(\d+\.\d+)-(\d+\.\d+)[^\]]*\]\s+(.*)$/gm)].map((m) => ({ id: m[1], text: m[4] }));
        const clean = lines.find((l) => /^The biggest mistake/.test(l.text.replace(/^[^A-Za-z]+/, "")));
        const remove = lines.slice(0, lines.indexOf(clean!)).map((l) => ({ lineId: l.id, reason: "false_start" }));
        return { text: "", toolCalls: [c("plan_story", { hookLineId: clean!.id, remove, roles: [{ lineId: clean!.id, role: "hook" }] })] };
      }
      return { text: "", toolCalls: [] };
    },
    generateAgentTurn: async (_s, messages, tools) => {
      const names = new Set(tools.map((t: any) => t.function?.name ?? t.name));
      const turn = (calls: ToolCall[]) => ({ text: "", toolCalls: calls, stopReason: "tool_use", assistantMessage: { role: "assistant", toolCalls: calls } }) as any;
      if (messages[messages.length - 1]?.role === "tool") return turn([c("stage_done")]);
      if (names.has("removeSilences") && !names.has("autoCaptions")) return turn([c("removeSilences", { minDurationSec: 0.35 }), c("cleanFillers", { fillerTypes: ["um", "like"] }), c("stage_done")]);
      if (names.has("autoCaptions") && !names.has("removeSilences")) return turn([c("autoCaptions", { template: "HORMOZI_BOUNCE" }), c("stage_done")]);
      if (names.has("addZoom")) return turn([c("addZoom", { startSec: 4, durationSec: 1.4, targetType: "FACE", targetCoords: { x: 0.5, y: 0.5 }, scale: 1.3 }), c("addZoom", { startSec: 14, durationSec: 1.4, targetType: "FACE", targetCoords: { x: 0.5, y: 0.5 }, scale: 1.25 }), c("stage_done")]);
      if (names.has("addBackgroundMusic")) return turn([c("addBackgroundMusic", { query: "upbeat hip hop", duckUnderSpeech: true }), c("stage_done")]);
      if (names.has("insertBroll") && !names.has("removeSilences")) return turn([c("stage_done")]);
      return turn([c("finish_edit", { summary: "Punchy edit." }), c("reply_to_creator", { reply: "Tightened it and made it punchy.", phase: "done" })]);
    },
  };
}

/** Source ms of the file still on the timeline inside [a, b]. */
const keptMs = (ir: any, a: number, b: number) => ir.clips.reduce((s: number, x: any) => s + Math.max(0, Math.min(b, x.sourceEndMs) - Math.max(a, x.sourceStartMs)), 0);
/** Timeline ms of a source time (null when cut). */
const toTimeline = (ir: any, t: number) => {
  const x = ir.clips.find((cl: any) => t >= cl.sourceStartMs && t < cl.sourceEndMs);
  return x ? x.timelineStartMs + (t - x.sourceStartMs) / (x.speed || 1) : null;
};

test("full edit 'make it punchy for TikTok': every Prompt A 3c condition holds on the returned timeline", async () => {
  const [info, warn] = [console.info, console.warn];
  console.info = () => {};
  console.warn = () => {};
  let res: any;
  try {
    res = await VideoAIDirectorService.getInstance().directMobile(
      MobileAIDirectRequestSchema.parse({ ...fixture.request, prompt: "make it punchy for TikTok" }),
      { llmClient: editor() }
    );
  } finally {
    console.info = info;
    console.warn = warn;
  }
  const ir = res.editIR;
  assert.equal(res.plannerSource, "llm");
  assert.equal(res.scope.mode, "full_edit");
  MobileEditIRSchema.parse(ir); // the renderer's own contract (no overlapping music beds, valid ranges)

  // Pauses removed, no clipped words: every word is fully on the timeline or fully cut.
  assert.ok(ir.durationMs < media.durationMs - 5000, `pauses and the false start cut (${media.durationMs} → ${ir.durationMs} ms)`);
  for (const w of words) {
    const k = keptMs(ir, w.startMs, w.endMs);
    assert.ok(k === 0 || k >= w.endMs - w.startMs - 5, `"${w.text}" at ${w.startMs} is half-cut (${k} ms kept) ${JSON.stringify(ir.clips.filter((x:any)=>x.sourceEndMs>w.startMs-800&&x.sourceStartMs<w.endMs+800).map((x:any)=>[x.sourceStartMs,x.sourceEndMs]))}`);
  }
  // The false start is gone (story pass).
  assert.ok(keptMs(ir, words[0].startMs, words[0].endMs) === 0, "the false start's first word is cut");

  // Captions on every spoken line: every kept word lies inside a speech caption.
  const caps = ir.captions.filter((x: any) => x.kind !== "text");
  assert.ok(caps.length > 0);
  for (const w of words) {
    if (keptMs(ir, w.startMs, w.endMs) === 0) continue;
    const t = toTimeline(ir, w.startMs + 1)!;
    assert.ok(caps.some((x: any) => t >= x.startMs - 60 && t <= x.endMs + 60), `word "${w.text}" at ${Math.round(t)} ms has no caption`);
  }

  // The hook starts at (or within 0.5 s of) the very start: no dead air before the first spoken word.
  const firstKept = words.find((w) => keptMs(ir, w.startMs, w.endMs) > 0)!;
  assert.ok(toTimeline(ir, firstKept.startMs + 1)! <= 500, `first word at ${Math.round(toTimeline(ir, firstKept.startMs + 1)!)} ms`);
  assert.match(firstKept.text, /^The$/, "the video opens on the clean take");

  // Zooms on the face (the face track, not the model's 0.5/0.5).
  assert.ok(ir.zooms.length >= 1);
  for (const z of ir.zooms) assert.ok(Math.hypot(z.centerX - faceX, z.centerY - faceY) < 0.12, `zoom at ${z.startMs} centred on (${z.centerX},${z.centerY})`);

  // Music ducked under speech.
  assert.equal(ir.audio.music.length, 1);
  assert.equal(ir.audio.music[0].duck?.enabled, true, "music ducks under speech");

  // Nothing past the end.
  const ends = [
    ...ir.captions.map((x: any) => x.endMs), ...ir.zooms.map((x: any) => x.endMs), ...ir.overlays.map((x: any) => x.timelineEndMs),
    ...ir.audio.music.map((x: any) => x.timelineEndMs),
  ];
  for (const e of ends) assert.ok(e <= ir.durationMs, `an item ends at ${e} ms, past the end (${ir.durationMs})`);
  // At most 4 floating layers at once (the renderer refuses more).
  for (let t = 0; t < ir.durationMs; t += 250) {
    assert.ok(ir.overlays.filter((o: any) => o.layer?.mode === "overlay" && t >= o.timelineStartMs && t < o.timelineEndMs).length <= 4);
  }
  assert.equal(res.style?.playbookId, "fast_hype");
});
