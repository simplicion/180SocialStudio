/**
 * Regression gate for the AI Director eval (quality-fix plan, Phase 7).
 *
 *   npx tsx scripts/director-eval/gate.ts --report <report.json> --mode replay|live [--baseline <file>] [--threshold 1.0] [--update]
 *
 * replay (pull requests; deterministic): fails on any error, any check that passed in the baseline and fails now,
 *   or a lower total. New passes are reported (run with --update to raise the baseline).
 * live (nightly; real model): fails on any error, any turn the offline rules made (a provider problem), a median
 *   judge score more than --threshold below the baseline's, or a check pass rate 10+ points below it. Without a
 *   baseline it passes and says how to create one.
 * --update writes the report as the new baseline (commit it).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

type Row = { id: string; ok: boolean; error?: string; plannerSource?: string; checks?: Array<{ check: string; pass: boolean }>; checksPassed?: number; checksTotal?: number; judge?: { score?: number } | null };
type Report = { summary: any; rows: Row[] };

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const mode = (get("mode") || "replay") as "replay" | "live";
  return {
    report: get("report") || "",
    mode,
    baseline: get("baseline") || join(__dirname, "baselines", `${mode}.json`),
    threshold: Number(get("threshold") ?? 1.0),
    update: a.includes("--update"),
  };
}

/** The part of a report a baseline keeps (small and stable). */
export function baselineOf(r: Report) {
  return {
    at: r.summary.at,
    commit: r.summary.commit ?? null,
    provider: r.summary.requestedProvider,
    medianJudge: r.summary.medianJudge ?? null,
    checksPassed: r.summary.checksPassed,
    checksTotal: r.summary.checksTotal,
    fixtures: Object.fromEntries(
      r.rows.filter((x) => x.ok).map((x) => [x.id, { passed: (x.checks || []).filter((c) => c.pass).map((c) => c.check), judge: x.judge?.score ?? null }])
    ),
  };
}

export function gate(report: Report, baseline: ReturnType<typeof baselineOf> | null, mode: "replay" | "live", threshold = 1.0) {
  const problems: string[] = [];
  const notes: string[] = [];
  for (const r of report.rows) if (!r.ok) problems.push(`${r.id}: ${r.error}`);
  if (mode === "live") {
    const det = report.rows.filter((r) => r.ok && r.plannerSource === "deterministic");
    if (det.length) problems.push(`${det.length} turn(s) were made by the offline rules, not the model (${det.map((r) => r.id).join(", ")}): check the provider, key and model`);
  }
  if (!baseline) {
    notes.push(`no baseline yet: run with --update and commit ${mode}.json`);
    return { ok: problems.length === 0, problems, notes };
  }
  for (const [id, b] of Object.entries(baseline.fixtures)) {
    const row = report.rows.find((r) => r.id === id && r.ok);
    if (!row) {
      problems.push(`${id}: missing from this run`);
      continue;
    }
    const now = new Set((row.checks || []).filter((c) => c.pass).map((c) => c.check));
    const lost = b.passed.filter((c) => !now.has(c));
    const gained = [...now].filter((c) => !b.passed.includes(c));
    if (mode === "replay" && lost.length) problems.push(`${id}: checks that passed before now fail: ${lost.join("; ")}`);
    if (mode === "live" && lost.length) notes.push(`${id}: no longer passes ${lost.join("; ")}`);
    if (gained.length) notes.push(`${id}: now passes ${gained.join("; ")}`);
  }
  if (mode === "replay" && report.summary.checksPassed < baseline.checksPassed) {
    problems.push(`checks passed ${report.summary.checksPassed}/${report.summary.checksTotal}, baseline ${baseline.checksPassed}/${baseline.checksTotal}`);
  }
  if (mode === "live") {
    const m = report.summary.medianJudge;
    if (baseline.medianJudge != null && m != null && m < baseline.medianJudge - threshold) {
      problems.push(`median judge score ${m}/10 dropped more than ${threshold} below the baseline ${baseline.medianJudge}/10`);
    } else if (m != null) notes.push(`median judge score ${m}/10 (baseline ${baseline.medianJudge ?? "none"})`);
    const rate = (p: number, t: number) => (t ? (100 * p) / t : 0);
    const nowRate = rate(report.summary.checksPassed, report.summary.checksTotal);
    const baseRate = rate(baseline.checksPassed, baseline.checksTotal);
    if (nowRate < baseRate - 10) problems.push(`check pass rate ${nowRate.toFixed(0)}% is more than 10 points below the baseline ${baseRate.toFixed(0)}%`);
  }
  return { ok: problems.length === 0, problems, notes };
}

function main() {
  const opt = args();
  if (!opt.report || !existsSync(opt.report)) throw new Error(`--report not found: ${opt.report || "(none)"}`);
  const report: Report = JSON.parse(readFileSync(opt.report, "utf8"));
  if (opt.update) {
    mkdirSync(dirname(opt.baseline), { recursive: true });
    writeFileSync(opt.baseline, JSON.stringify(baselineOf(report), null, 2) + "\n");
    console.log(`baseline written: ${opt.baseline}`);
    return;
  }
  const baseline = existsSync(opt.baseline) ? JSON.parse(readFileSync(opt.baseline, "utf8")) : null;
  const r = gate(report, baseline, opt.mode, opt.threshold);
  for (const n of r.notes) console.log(`note: ${n}`);
  for (const p of r.problems) console.log(`REGRESSION: ${p}`);
  console.log(r.ok ? `gate passed (${opt.mode})` : `gate FAILED (${opt.mode}): ${r.problems.length} problem(s)`);
  if (!r.ok) process.exit(1);
}

if (require.main === module) {
  try {
    main();
  } catch (err: any) {
    console.error(err?.message || err);
    process.exit(1);
  }
}
