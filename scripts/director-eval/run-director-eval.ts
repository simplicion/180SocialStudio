/**
 * AI Director eval harness (quality-fix plan, Phase 0).
 *
 * Runs `directMobile` on every fixture in ./fixtures against a configured LLM and writes a report (JSON + Markdown)
 * with the planner source, provider/model, operations, drops by filter, warnings, critic score and the fixture's
 * machine checks. Report only: nothing here gates CI yet (Phase 7).
 *
 *   npx tsx scripts/director-eval/run-director-eval.ts --provider claude [--model <id>] [--fixture talking-head-45s]
 *       [--env apps/180-social-studio-backend/.env] [--out scripts/director-eval/reports]
 *
 * --provider none disables the LLM (the rule-based planner's baseline). Keys come from the environment
 * (ANTHROPIC_API_KEY / CLAUDE_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY / GOOGLE_API_KEY), optionally loaded from
 * --env. The provider service may fall back to another provider with a key: the report shows the one that ran.
 * Stock B-roll / SFX lookups are off (no network besides the LLM); music uses the built-in catalogue.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { join, resolve } from "path";
import { VideoAIDirectorService } from "../../packages/domains/ai/src/builders/video-ai-director.service";
import type { AIClient } from "../../packages/domains/ai/src/kernel/ai-provider.service";

// The schema from the same module instance the Director uses.
const aiRequire = createRequire(resolve(__dirname, "../../packages/domains/ai/package.json"));
const { MobileAIDirectRequestSchema } = aiRequire("@workspace/video-contracts");

type Checks = {
  shouldCutSourceMs?: Array<[number, number]>;
  mustKeepSourceMs?: Array<[number, number]>;
  captions?: boolean;
  minZooms?: number;
  maxZooms?: number;
  music?: boolean;
  targetAspect?: string;
  maxDurationMs?: number;
  shouldDropAssets?: string[];
  mustKeepAssets?: string[];
};
type Fixture = { id: string; title: string; description: string; request: any; reference: { mustDo: string[]; mustNotDo: string[]; checks: Checks } };

function args() {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? a[i + 1] : undefined;
  };
  return {
    provider: get("provider") || process.env.AI_DIRECTOR_PROVIDER || process.env.AI_PROVIDER || "claude",
    model: get("model"),
    fixture: get("fixture"),
    env: get("env"),
    out: get("out") || join(__dirname, "reports"),
  };
}

/** Minimal KEY=VALUE loader (no override of variables already set). */
function loadEnv(path: string) {
  if (!existsSync(path)) throw new Error(`--env file not found: ${path}`);
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

async function makeClient(provider: string): Promise<AIClient | null> {
  if (provider === "none") return null;
  const { AIProviderService } = await import("../../packages/domains/ai/src/kernel/ai-provider.service");
  const client = await AIProviderService.getInstance().getClient({
    aiProvider: provider,
    claudeKey: process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    geminiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    groqKey: process.env.GROQ_API_KEY,
  } as any, { purpose: "director" });
  if (!client) throw new Error(`no API key in the environment for provider "${provider}" (or any fallback)`);
  return client;
}

/** Timeline ms covered by clips of `assetId` overlapping source [a, b]. */
function keptMs(editIR: any, assetId: string, a: number, b: number): number {
  let n = 0;
  for (const c of editIR.clips || []) {
    if (c.assetId !== assetId) continue;
    n += Math.max(0, Math.min(b, c.sourceEndMs) - Math.max(a, c.sourceStartMs));
  }
  return n;
}

function runChecks(f: Fixture, editIR: any) {
  const c = f.reference.checks;
  const primary = f.request.media?.assetId || "primary";
  const out: Array<{ check: string; pass: boolean; detail: string }> = [];
  const add = (check: string, pass: boolean, detail: string) => out.push({ check, pass, detail });
  for (const [a, b] of c.shouldCutSourceMs || []) {
    const k = keptMs(editIR, primary, a, b);
    add(`cut ${a}-${b} ms`, k <= (b - a) * 0.2, `${k} of ${b - a} ms still on the timeline`);
  }
  for (const [a, b] of c.mustKeepSourceMs || []) {
    const k = keptMs(editIR, primary, a, b);
    add(`keep ${a}-${b} ms`, k >= (b - a) * 0.8, `${k} of ${b - a} ms kept`);
  }
  const speechCaptions = (editIR.captions || []).filter((x: any) => x.role !== "title");
  if (c.captions) add("captions", speechCaptions.length > 0, `${speechCaptions.length} caption(s)`);
  const zooms = (editIR.zooms || []).length;
  if (c.minZooms !== undefined) add(`zooms >= ${c.minZooms}`, zooms >= c.minZooms, `${zooms} zoom(s)`);
  if (c.maxZooms !== undefined) add(`zooms <= ${c.maxZooms}`, zooms <= c.maxZooms, `${zooms} zoom(s)`);
  if (c.music) add("music", (editIR.audio?.music || []).length > 0, `${(editIR.audio?.music || []).length} bed(s)`);
  if (c.targetAspect) add(`aspect ${c.targetAspect}`, editIR.canvas?.aspect === c.targetAspect, `canvas ${editIR.canvas?.aspect}`);
  if (c.maxDurationMs !== undefined) add(`duration <= ${c.maxDurationMs} ms`, editIR.durationMs <= c.maxDurationMs, `${editIR.durationMs} ms`);
  for (const id of c.shouldDropAssets || []) {
    const n = (editIR.clips || []).filter((x: any) => x.assetId === id).length;
    add(`drop ${id}`, n === 0, `${n} clip(s) of ${id}`);
  }
  for (const id of c.mustKeepAssets || []) {
    const n = (editIR.clips || []).filter((x: any) => x.assetId === id).length;
    add(`keep ${id}`, n > 0, `${n} clip(s) of ${id}`);
  }
  return out;
}

async function main() {
  const opt = args();
  if (opt.env) loadEnv(resolve(opt.env));
  const dir = join(__dirname, "fixtures");
  const fixtures: Fixture[] = readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((n) => JSON.parse(readFileSync(join(dir, n), "utf8")))
    .filter((f) => !opt.fixture || f.id === opt.fixture);
  if (!fixtures.length) throw new Error(`no fixtures${opt.fixture ? ` named ${opt.fixture}` : ""} in ${dir} (run build-fixtures.ts)`);

  const client = await makeClient(opt.provider);
  const director = VideoAIDirectorService.getInstance();
  const rows: any[] = [];
  for (const f of fixtures) {
    const started = Date.now();

    try {
      const request = MobileAIDirectRequestSchema.parse(f.request);
      const res = await director.directMobile(request, { llmClient: client, ...(opt.model ? { llmModel: opt.model } : {}) });
      const checks = runChecks(f, res.editIR);
      const opCounts: Record<string, number> = {};
      for (const o of res.operations as any[]) opCounts[o.type] = (opCounts[o.type] ?? 0) + 1;
      rows.push({
        id: f.id,
        title: f.title,
        ok: true,
        plannerSource: res.plannerSource,
        plannerReason: res.plannerReason,
        fallback: res.plannerFallback ?? null,
        provider: res.turnLog.provider,
        model: res.turnLog.model,
        llmCalls: res.llmCalls,
        latencyMs: Date.now() - started,
        phase: res.phase,
        reply: res.reply,
        operations: opCounts,
        ops: res.turnLog.ops,
        drops: res.turnLog.drops,
        appliedOperations: res.appliedOperations,
        rejectedOperations: res.rejectedOperations,
        warnings: res.warnings,
        critic: { score: res.critique.score, repairRounds: res.critique.repairRounds, issues: res.critique.issues.map((i: any) => `${i.severity}: ${i.title}`) },
        timeline: {
          durationMs: res.editIR.durationMs,
          sourceDurationMs: f.request.currentEditIR?.durationMs ?? f.request.media.durationMs,
          clips: res.editIR.clips.length,
          captions: res.editIR.captions.length,
          zooms: res.editIR.zooms.length,
          overlays: res.editIR.overlays.length,
          music: res.editIR.audio.music.length,
          aspect: res.editIR.canvas.aspect,
        },
        checks,
        checksPassed: checks.filter((c) => c.pass).length,
        checksTotal: checks.length,
        reference: f.reference,
      });
      console.log(`▶ ${f.id}: ${res.plannerSource}${res.plannerFallback ? ` (fallback: ${res.plannerFallback.code})` : ""}, checks ${checks.filter((c) => c.pass).length}/${checks.length}`);
    } catch (err: any) {
      rows.push({ id: f.id, title: f.title, ok: false, error: String(err?.message || err).slice(0, 500), latencyMs: Date.now() - started });
      console.log(`▶ ${f.id}: ERROR ${String(err?.message || err).slice(0, 200)}`);
    }
  }

  const ran = rows.filter((r) => r.ok);
  const summary = {
    at: new Date().toISOString(),
    requestedProvider: opt.provider,
    requestedModel: opt.model ?? null,
    fixtures: rows.length,
    errors: rows.length - ran.length,
    deterministic: ran.filter((r) => r.plannerSource === "deterministic").length,
    fallbacks: ran.filter((r) => r.fallback).length,
    checksPassed: ran.reduce((n, r) => n + r.checksPassed, 0),
    checksTotal: ran.reduce((n, r) => n + r.checksTotal, 0),
    avgCriticScore: ran.length ? Math.round(ran.reduce((n, r) => n + (r.critic.score ?? 0), 0) / ran.length) : null,
    opsDropped: ran.reduce((n, r) => n + (r.ops?.dropped ?? 0), 0),
  };

  mkdirSync(opt.out, { recursive: true });
  const stamp = summary.at.replace(/[:.]/g, "-");
  const base = join(opt.out, `${stamp}-${opt.provider}`);
  writeFileSync(`${base}.json`, JSON.stringify({ summary, rows }, null, 2));
  writeFileSync(`${base}.md`, markdown(summary, rows));
  console.log(`\n${summary.fixtures} fixture(s): ${summary.deterministic} deterministic (${summary.fallbacks} fallback), checks ${summary.checksPassed}/${summary.checksTotal}, avg critic ${summary.avgCriticScore}`);
  console.log(`report: ${base}.md`);
}

function markdown(summary: any, rows: any[]): string {
  const L: string[] = [];
  L.push(`# AI Director eval: ${summary.at}`, "");
  L.push(`Requested provider: \`${summary.requestedProvider}\`${summary.requestedModel ? `, model \`${summary.requestedModel}\`` : ""}`, "");
  L.push(`| fixture | planner | provider/model | LLM calls | ops planned → applied (dropped) | critic | checks | latency |`, `|---|---|---|---|---|---|---|---|`);
  for (const r of rows) {
    if (!r.ok) {
      L.push(`| ${r.id} | ERROR | | | | | | ${r.latencyMs} ms |`);
      continue;
    }
    L.push(`| ${r.id} | ${r.plannerSource}${r.fallback ? ` (${r.fallback.code})` : ""} | ${r.provider ?? "-"}/${r.model ?? "default"} | ${r.llmCalls} | ${r.ops.planned} → ${r.ops.applied} (${r.ops.dropped}) | ${r.critic.score} | ${r.checksPassed}/${r.checksTotal} | ${r.latencyMs} ms |`);
  }
  L.push("", `**Totals:** ${summary.deterministic}/${summary.fixtures - summary.errors} deterministic, ${summary.fallbacks} fallback(s), checks ${summary.checksPassed}/${summary.checksTotal}, ops dropped ${summary.opsDropped}, errors ${summary.errors}.`, "");
  for (const r of rows) {
    L.push(`## ${r.title} (\`${r.id}\`)`, "");
    if (!r.ok) {
      L.push(`Error: ${r.error}`, "");
      continue;
    }
    L.push(`- Planner: ${r.plannerSource}: ${r.plannerReason}`);
    L.push(`- Reply: ${r.reply}`);
    L.push(`- Operations: ${Object.entries(r.operations).map(([k, v]) => `${k}×${v}`).join(", ") || "none"}`);
    L.push(`- Timeline: ${r.timeline.sourceDurationMs} → ${r.timeline.durationMs} ms, ${r.timeline.clips} clips, ${r.timeline.captions} captions, ${r.timeline.zooms} zooms, ${r.timeline.overlays} overlays, ${r.timeline.music} music, ${r.timeline.aspect}`);
    if (r.drops.length) L.push(`- Dropped: ${r.drops.map((d: any) => `${d.op}×${d.count} by ${d.filter}${d.reason ? ` (${d.reason})` : ""}`).join("; ")}`);
    if (r.critic.issues.length) L.push(`- Critic (${r.critic.score}, ${r.critic.repairRounds} repair rounds): ${r.critic.issues.slice(0, 6).join("; ")}`);
    L.push("", "| check | result | detail |", "|---|---|---|");
    for (const c of r.checks) L.push(`| ${c.check} | ${c.pass ? "pass" : "FAIL"} | ${c.detail} |`);
    L.push("", "Reference (a good edit must):", ...r.reference.mustDo.map((x: string) => `- ${x}`), "", "Must not:", ...r.reference.mustNotDo.map((x: string) => `- ${x}`), "");
    if (r.warnings.length) L.push("<details><summary>Warnings</summary>", "", ...r.warnings.map((w: string) => `- ${w}`), "", "</details>", "");
  }
  return L.join("\n");
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
