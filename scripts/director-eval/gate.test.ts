/** Run: npx tsx --test scripts/director-eval/gate.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { baselineOf, gate } from "./gate";

const row = (id: string, passed: string[], failed: string[] = [], extra: Record<string, unknown> = {}) => ({
  id, ok: true, plannerSource: "llm",
  checks: [...passed.map((c) => ({ check: c, pass: true })), ...failed.map((c) => ({ check: c, pass: false }))],
  checksPassed: passed.length, checksTotal: passed.length + failed.length, ...extra,
});
const report = (rows: any[], extra: Record<string, unknown> = {}) => ({
  summary: { at: "t", requestedProvider: "replay", checksPassed: rows.reduce((n, r) => n + (r.checksPassed ?? 0), 0), checksTotal: rows.reduce((n, r) => n + (r.checksTotal ?? 0), 0), ...extra },
  rows,
});

test("replay: a check that passed in the baseline and fails now is a regression; new passes are notes", () => {
  const base = baselineOf(report([row("a", ["captions", "cut 1-2 ms"]), row("b", ["music"])]));
  assert.equal(gate(report([row("a", ["captions", "cut 1-2 ms"]), row("b", ["music"])]), base, "replay").ok, true);
  const worse = gate(report([row("a", ["captions"], ["cut 1-2 ms"]), row("b", ["music"])]), base, "replay");
  assert.equal(worse.ok, false);
  assert.match(worse.problems.join(), /a: checks that passed before now fail: cut 1-2 ms/);
  const better = gate(report([row("a", ["captions", "cut 1-2 ms", "zooms on the subject"]), row("b", ["music"])]), base, "replay");
  assert.equal(better.ok, true);
  assert.match(better.notes.join(), /now passes zooms on the subject/);
  assert.equal(gate(report([row("a", ["captions", "cut 1-2 ms"])]), base, "replay").ok, false, "a missing fixture fails");
  assert.equal(gate(report([{ id: "a", ok: false, error: "recording out of date" }, row("b", ["music"])]), base, "replay").ok, false);
});

test("live: a median judge drop beyond the threshold fails; offline-rules turns fail; no baseline passes with a note", () => {
  const base = { ...baselineOf(report([row("a", ["captions"], [], { judge: { score: 8 } })], { medianJudge: 8 })) };
  assert.equal(gate(report([row("a", ["captions"], [], { judge: { score: 7.5 } })], { medianJudge: 7.5 }), base, "live", 1).ok, true);
  const drop = gate(report([row("a", ["captions"], [], { judge: { score: 6 } })], { medianJudge: 6 }), base, "live", 1);
  assert.equal(drop.ok, false);
  assert.match(drop.problems.join(), /median judge score 6\/10 dropped/);
  const rules = gate(report([row("a", ["captions"], [], { plannerSource: "deterministic" })], { medianJudge: 8 }), base, "live", 1);
  assert.match(rules.problems.join(), /offline rules/);
  const first = gate(report([row("a", ["captions"])], { medianJudge: 7 }), null, "live");
  assert.equal(first.ok, true);
  assert.match(first.notes.join(), /no baseline yet/);
});
