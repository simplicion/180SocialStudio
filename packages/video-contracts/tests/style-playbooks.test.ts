/**
 * Style playbooks (AI Director quality-fix plan, Phase 6).
 * Run: npx tsx --test packages/video-contracts/tests/style-playbooks.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { editIRFromMobile, MobileEditIRSchema } from "../src/mobile-edit-ir";
import {
  CALM_EDUCATIONAL,
  choosePlaybook,
  FAST_HYPE,
  longestStaticSec,
  measurePlaybook,
  playbookPromptLines,
  playbookStageBriefs,
  STYLE_PLAYBOOKS,
} from "../src/style-playbooks";
import { critiqueDirectorEdit } from "../src/director-critic";

const clip = (id: string, a: number, b: number) => ({ id, assetId: "primary", sourceStartMs: a, sourceEndMs: b, timelineStartMs: a, timelineEndMs: b, speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null });
function mobile(durationMs: number, cutsEveryMs: number, extra: Record<string, unknown> = {}) {
  const clips = [];
  for (let t = 0; t < durationMs; t += cutsEveryMs) clips.push(clip(`c${t}`, t, Math.min(durationMs, t + cutsEveryMs)));
  return MobileEditIRSchema.parse({
    schemaVersion: "mobile-editir/1", projectId: "p",
    canvas: { aspect: "9:16", width: 1080, height: 1920, fps: 30, background: "#000000" },
    durationMs, sources: [{ assetId: "primary", durationMs, width: 1080, height: 1920 }], clips,
    overlays: [], captions: [], zooms: [], audio: { originalTrack: { volumeDb: 0 }, music: [], speechRangesMs: [] },
    ...extra,
  });
}
const edit = (m: ReturnType<typeof mobile>) => editIRFromMobile(m);

test("choosing: the creator's words first (content before energy), then the clip, the brand, the canvas", () => {
  assert.equal(choosePlaybook({ prompt: "make it punchy" }).playbook.id, "fast_hype");
  assert.equal(choosePlaybook({ prompt: "make it a punchy travel vlog with music" }).playbook.id, "cinematic_vlog");
  assert.equal(choosePlaybook({ prompt: "clean this tutorial up" }).playbook.id, "calm_educational");
  assert.equal(choosePlaybook({ prompt: "turn this podcast into a short" }).playbook.id, "podcast_clip");
  assert.equal(choosePlaybook({ prompt: "edit this for reels", speakers: 2 }).playbook.id, "podcast_clip");
  assert.equal(choosePlaybook({ prompt: "edit this", screenRecording: true }).playbook.id, "calm_educational");
  assert.equal(choosePlaybook({ prompt: "edit this", brandPacing: "fast", aspect: "16:9" }).playbook.id, "fast_hype");
  assert.equal(choosePlaybook({ prompt: "edit this", aspect: "9:16" }).playbook.id, "fast_hype");
  assert.equal(choosePlaybook({ prompt: "edit this", aspect: "16:9" }).playbook.id, "calm_educational");
  assert.match(choosePlaybook({ prompt: "make it punchy" }).reason, /"punchy"/);
});

test("the prompt carries only the chosen playbook, with numbers and an example", () => {
  const text = playbookPromptLines(FAST_HYPE).join("\n");
  assert.match(text, /fast and punchy/);
  assert.match(text, /every 3 s/);
  assert.match(text, /zooms 2-6\/min at 1\.15-1\.45x/);
  assert.match(text, /template SPOTLIGHT_WORD/);
  assert.match(text, /Example of a great edit/);
  for (const other of STYLE_PLAYBOOKS.filter((p) => p.id !== "fast_hype")) assert.ok(!text.includes(other.label), `no ${other.id}`);
  const briefs = playbookStageBriefs(CALM_EDUCATIONAL);
  assert.match(briefs.cleanup, /0\.6 s/);
  assert.match(briefs.captions, /GLASS_PILL/);
});

test("longest static stretch: cuts, zoom edges, overlays and titles all count as change", () => {
  const ir = edit(mobile(12000, 4000, { zooms: [{ id: "z", startMs: 5000, endMs: 7000, scale: 1.3, centerX: 0.5, centerY: 0.4, rampMs: 200 }] }));
  assert.equal(longestStaticSec(ir), 4);
  assert.equal(longestStaticSec(edit(mobile(12000, 12000))), 12);
});

test("measure: a fast-cut edit meets the fast targets and misses the calm ones", () => {
  const ir = edit(mobile(30000, 2500, {
    zooms: [5000, 12000, 20000].map((t, i) => ({ id: `z${i}`, startMs: t, endMs: t + 1200, scale: 1.3, centerX: 0.5, centerY: 0.4, rampMs: 200 })),
  }));
  const fast = measurePlaybook(ir, FAST_HYPE);
  const byMetric = (r: typeof fast, m: string) => r.checks.find((c) => c.metric === m)!;
  assert.equal(byMetric(fast, "cuts per minute").ok, true);
  assert.equal(byMetric(fast, "zooms per minute").ok, true);
  assert.equal(byMetric(fast, "longest static stretch (s)").ok, true);
  const calm = measurePlaybook(ir, CALM_EDUCATIONAL);
  assert.equal(byMetric(calm, "cuts per minute").ok, false, "22 cuts/min is too busy for calm");
  assert.ok(calm.met < calm.total);
  const short = measurePlaybook(edit(mobile(10000, 2500)), FAST_HYPE);
  assert.ok(!short.checks.some((c) => c.metric === "cuts per minute"), "no rates on a 10 s video");
});

test("the critic reports missed targets as style issues (static stretch = warning, rates = suggestions)", () => {
  const m = mobile(30000, 15000);
  const report = measurePlaybook(edit(m), FAST_HYPE);
  const crit = critiqueDirectorEdit({ editIR: m, playbookReport: report });
  const style = crit.issues.filter((i) => i.id.startsWith("style:"));
  assert.ok(style.some((i) => /static stretch/.test(i.title) && i.severity === "WARNING"));
  assert.ok(style.some((i) => /cuts per minute/.test(i.title) && i.severity === "SUGGESTION"));
  assert.ok(style.every((i) => !crit.repairable.includes(i.id)), "never auto-repaired");
  const without = critiqueDirectorEdit({ editIR: m });
  assert.ok(crit.score < without.score);
});

test("whole-edit asks that also name features to add are whole edits; changes to existing items stay scoped", async () => {
  const { classifyDirectorIntentOffline } = await import("../src/director-intent");
  const mode = (p: string) => classifyDirectorIntentOffline(p).mode;
  assert.equal(mode("clean this tutorial up and add captions"), "full_edit");
  assert.equal(mode("make it a punchy travel vlog with music"), "full_edit");
  assert.equal(mode("turn this into a vertical clip for shorts with captions"), "full_edit");
  assert.deepEqual(classifyDirectorIntentOffline("make it a punchy travel vlog with music").targets.map((t) => t.kind), ["music"], "the named feature stays an explicit ask");
  assert.equal(mode("clean it up and make the music quieter"), "modify_existing");
  assert.equal(mode("make the captions bigger"), "modify_existing");
  assert.equal(mode("add captions"), "add_new");
});
