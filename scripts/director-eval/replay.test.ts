/** Run: npx tsx --test scripts/director-eval/replay.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { recordingClient, replayClient, type RecordedCall } from "./replay";
import { judgeEdit, median } from "./judge";
import { createRequire } from "module";
import { resolve } from "path";

const aiRequire = createRequire(resolve(__dirname, "../../packages/domains/ai/package.json"));

const tools = (...names: string[]) => names.map((name) => ({ type: "function", function: { name, parameters: {} } }));

test("record → replay returns the same answers in order; a changed conversation is reported as a stale recording", async () => {
  const real: any = {
    provider: "claude",
    model: "claude-opus-5-5",
    generate: async () => "",
    generateStream: async () => "",
    generateWithTools: async () => ({ text: "", toolCalls: [{ id: "1", name: "plan_story", args: { hookLineId: "L1", remove: [], roles: [] } }] }),
    generateAgentTurn: async () => ({ text: "", toolCalls: [{ id: "2", name: "finish_edit", args: { summary: "ok" } }], stopReason: "tool_use", assistantMessage: { role: "assistant" } }),
  };
  const sink = { calls: [] as RecordedCall[] };
  const rec = recordingClient(real, sink);
  await rec.generateWithTools!("p", tools("plan_story"), {});
  await rec.generateAgentTurn!("s", [], tools("removeSilences", "stage_done"), {});
  assert.deepEqual(sink.calls.map((c) => [c.method, c.tools]), [["generateWithTools", "plan_story"], ["generateAgentTurn", "removeSilences,stage_done"]]);

  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  writeFileSync(join(dir, "fx.json"), JSON.stringify({ source: "recorded", fixture: "fx", provider: "claude", model: "m", at: "t", calls: sink.calls }));
  const r = replayClient({ id: "fx", reference: {}, request: {} }, dir);
  assert.equal(r.source, "recorded");
  const a = await r.client.generateWithTools!("anything", tools("plan_story"), {});
  assert.equal(a.toolCalls![0].name, "plan_story");
  await assert.rejects(r.client.generateWithTools!("x", tools("classify_request"), {}), /recording out of date at call #2/);
  const fresh = replayClient({ id: "fx", reference: {}, request: {} }, dir);
  await fresh.client.generateWithTools!("x", tools("plan_story"), {});
  await fresh.client.generateAgentTurn!("s", [], tools("removeSilences", "stage_done"), {});
  await assert.rejects(fresh.client.generateAgentTurn!("s", [], tools("autoCaptions"), {}), /does not have; re-record/);
});

test("without a recording the scripted policy answers (labelled)", () => {
  const r = replayClient({ id: "none", reference: { checks: {} }, request: {} }, mkdtempSync(join(tmpdir(), "rec-")));
  assert.equal(r.source, "scripted");
});

test("the judge maps item numbers back to the reference and clamps the score", async () => {
  const fixture = { description: "d", request: { prompt: "make it punchy" }, reference: { mustDo: ["cut the false start", "captions"], mustNotDo: ["cut the CTA"] } };
  const seen: any[] = [];
  const client: any = {
    provider: "claude",
    generateWithTools: async (prompt: string, _t: any, options: any) => {
      seen.push({ prompt, options });
      return { text: "", toolCalls: [{ id: "j", name: "record_judgement", args: { score: 12, mustDo: [{ item: 1, met: true }, { item: 2, met: false }, { item: 9, met: true }], mustNotDo: [{ item: 1, violated: false }], notes: "Captions missing." } }] };
    },
  };
  const { editIRFromMobileMedia } = aiRequire("@workspace/video-contracts");
  const res = { ast: editIRFromMobileMedia({ assetId: "primary", durationMs: 5000, width: 1080, height: 1920, fps: 30 }, "p"), editIR: {}, reply: "Done" };
  const j = await judgeEdit(client, "claude-sonnet-5-5", fixture, res);
  assert.equal(j.score, 10);
  assert.deepEqual(j.mustDo, [{ item: "cut the false start", met: true }, { item: "captions", met: false }]);
  assert.equal(seen[0].options.model, "claude-sonnet-5-5");
  assert.match(seen[0].prompt, /A skilled editor MUST/);
});

test("median", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});
