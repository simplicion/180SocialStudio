/**
 * Phase 2 of the video editor overhaul through the whole Director turn: full toolbox (F-20), provenance and locks
 * (F-21), the timeline the model sees (F-15) and truthful history (F-16).
 *
 * Run: npx tsx --test packages/domains/ai/tests/director-phase2.test.ts
 * (requires `packages/video-contracts` to be built: `pnpm --filter @workspace/video-contracts build`)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { MobileAIDirectRequestSchema, MobileEditIR, MobileEditIRSchema, buildDirectorToolDefinitions, editIRFromMobile } from "@workspace/video-contracts";
import { VideoAIDirectorService } from "../src/builders/video-ai-director.service";
import { CreativePlanner } from "../src/builders/creative-planner";
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

function timeline(extra: Partial<MobileEditIR> = {}): MobileEditIR {
  // A generated timeline at least 6 s long, so a 2 s title and a 1 s zoom fit.
  let seed = 21;
  while (randomMobileEditIR(seed).durationMs < 6000) seed++;
  const base = randomMobileEditIR(seed);
  return MobileEditIRSchema.parse({
    ...base,
    captions: [{ id: "title1", kind: "text", startMs: 0, endMs: 2000, text: "Day 1 of the gym", words: [], style: { fontSizePx: 64, textColor: "#EF4444" } }],
    ...extra,
  });
}

function request(ir: MobileEditIR, prompt: string, extra: Record<string, any> = {}) {
  const p = ir.sources[0];
  return MobileAIDirectRequestSchema.parse({ prompt, media: { assetId: p.assetId, durationMs: p.durationMs, width: p.width, height: p.height }, currentEditIR: ir, ...extra });
}

test("F-20: the model is given the update tools", () => {
  const names = new Set(buildDirectorToolDefinitions().map((t) => t.function.name));
  for (const n of ["editText", "updateTextStyle", "retimeItem", "updateOverlay", "setKeyframe", "removeKeyframe", "updateZoom", "updateEffect", "updateMusic", "changeMusicTrack", "setSfxVolume", "setClipVolume", "setCrop", "panClip", "muteTrack", "updateVoiceover", "duplicateClip", "freezeFrame", "replaceClip", "addCaption", "emphasizeWord"]) {
    assert.ok(names.has(n), n);
  }
});

test("F-20: 'make the title bigger' restyles the title in place (no duplicate)", async () => {
  const ir = timeline();
  const { client, calls } = mockClient([{ text: "", toolCalls: [tc("updateTextStyle", { target: "title1", fontSizePx: 110 }), finish("Bigger title.")] }]);
  const res = await director.directMobile(request(ir, "make the title bigger"), { llmClient: client });
  assert.equal(calls.length, 1, "no coverage retry");
  const titles = res.editIR.captions.filter((c) => c.kind === "text");
  assert.equal(titles.length, 1);
  assert.equal(titles[0].id, "title1");
  assert.equal(titles[0].style.fontSizePx, 110);
  assert.equal(titles[0].style.textColor, "#EF4444", "colour kept");
  assert.equal(res.autoApplied, true, "an in-place restyle applies under ASSISTED");
});

test("F-21: a locked title survives a request to change it; the refusal is reported", async () => {
  const ir = timeline({ itemMeta: { title1: { origin: "manual", locked: true } } });
  const { client } = mockClient([{ text: "", toolCalls: [tc("editText", { id: "title1", text: "Day 2" }), tc("updateTextStyle", { target: "all_titles", textColor: "#FFFFFF" }), finish("Done.")] }]);
  const res = await director.directMobile(request(ir, "change the title to Day 2 and make it white"), { llmClient: client });
  assert.deepEqual(res.editIR.captions.find((c) => c.id === "title1"), ir.captions[0]);
  assert.ok((res.violations ?? []).some((v) => /locked title title1/.test(v)), JSON.stringify(res.violations));
  assert.equal(res.autoApplied, false);
});

test("F-21: items the Director adds are marked as its own; the creator's entries are kept", async () => {
  const ir = timeline({ itemMeta: { title1: { origin: "manual" } } });
  const { client } = mockClient([{ text: "", toolCalls: [tc("addZoom", { startSec: 0.5, durationSec: 1, scale: 1.2, targetCoords: { x: 0.5, y: 0.4 } }), finish("Zoom.")] }]);
  const res = await director.directMobile(request(ir, "add a zoom at the start"), { llmClient: client });
  const added = res.editIR.zooms.find((z) => !ir.zooms.some((x) => x.id === z.id))!;
  assert.deepEqual(res.editIR.itemMeta?.[added.id], { origin: "director" });
  assert.deepEqual(res.editIR.itemMeta?.title1, { origin: "manual" });
});

test("F-15: the model sees every item as a JSON line with id, provenance, lock and style", () => {
  const ir = timeline({ itemMeta: { title1: { origin: "manual", locked: true } } });
  const lines = (CreativePlanner as any).describeEditIR(editIRFromMobile(ir), ir.itemMeta) as string[];
  const title = lines.find((l) => l.includes('"id":"title1"'))!;
  assert.ok(title, lines.join("\n"));
  const row = JSON.parse(title.trim());
  assert.equal(row.by, "manual");
  assert.equal(row.locked, true);
  assert.equal(row.color, "#EF4444");
  assert.equal(row.size, 64);
  assert.deepEqual(row.at, [0, 2]);
  assert.ok(lines.some((l) => l.startsWith("- music")), "music lane");
});

test("F-15: a huge timeline is summarised within the budget", () => {
  const ir = timeline({
    captions: Array.from({ length: 400 }, (_, i) => ({ id: `c${i}`, kind: "caption" as const, startMs: i * 10, endMs: i * 10 + 10, text: "word ".repeat(30), words: [{ text: "word", startMs: i * 10, endMs: i * 10 + 10, highlight: false, color: null, scale: 1 }], style: MobileEditIRSchema.shape.captions.element.shape.style.parse({}) })),
  });
  const text = ((CreativePlanner as any).describeEditIR(editIRFromMobile(ir)) as string[]).join("\n");
  assert.ok(text.length < 30000, `${text.length} chars`);
  assert.match(text, /… 340 more/);
});

test("F-16: history says which Director turns landed, which were never applied and which were undone", async () => {
  const ir = timeline();
  const { client, calls } = mockClient([{ text: "", toolCalls: [finish("ok")] }]);
  await director.directMobile(
    request(ir, "and now?", {
      history: [
        { role: "user", content: "add music" },
        { role: "assistant", content: "Added lofi music.", status: "applied", appliedOps: ['Added background music ("lofi")'] },
        { role: "user", content: "cut the pauses" },
        { role: "assistant", content: "Cut 4 pauses.", status: "proposed_not_applied" },
        { role: "user", content: "add a zoom" },
        { role: "assistant", content: "Added a zoom.", status: "undone" },
      ],
    }),
    { llmClient: client }
  );
  const p = calls[0];
  assert.match(p, /You \(applied\): Added lofi music\. \[changes: Added background music \("lofi"\)\]/);
  assert.match(p, /You \(proposal, NOT applied\): Cut 4 pauses\./);
  assert.match(p, /You \(applied, then UNDONE by the creator\): Added a zoom\./);
});

test("F-20: a freeze frame gets a source entry the phone can resolve", async () => {
  const ir = timeline();
  const { client } = mockClient([{ text: "", toolCalls: [tc("freezeFrame", { timestampSec: 1, durationSec: 1 }), finish("Froze it.")] }]);
  const res = await director.directMobile(request(ir, "freeze the frame at 1s"), { llmClient: client });
  const still = res.editIR.clips.find((c) => c.assetId.startsWith("freeze:"));
  assert.ok(still, JSON.stringify(res.rejectedOperations));
  const src = res.editIR.sources.find((s) => s.assetId === still!.assetId);
  assert.ok(src && src.durationMs >= 600000);
  assert.equal(res.requiresConfirmation, true, "inserting footage is a proposal under ASSISTED");
});
