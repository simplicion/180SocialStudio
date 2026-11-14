/**
 * AI Director turn log (quality-fix plan, Phase 0): one structured record per Director turn, so it is visible which
 * model planned the edit, whether the offline rule-based planner stood in for it (and why), and which post-model
 * filter removed which operations.
 *
 * Pure and dependency-free: the Director fills it, `directMobile` prints it as one log line and stores it on the
 * final `TimelineChanged` run event, and `summarizeDirectorTurns` aggregates stored records for the report.
 */

export type DirectorDropFilter =
  | "beat_snap"
  | "renderer_gate"
  | "destructive_guard"
  | "scope"
  | "item_locks"
  | "validator"
  | "compiler";

/** Why the rule-based planner made an edit the model was asked to make (null = not a fallback). */
export type DirectorFallbackCode =
  | "no_key"
  | "llm_disabled"
  | "no_tool_calling"
  | "timeout"
  | "budget"
  | "llm_error"
  | "empty_response"
  | "invalid_output"
  | "unknown";

export interface DirectorOpDrop {
  filter: DirectorDropFilter;
  /** Operation type, e.g. "insertBroll". */
  op: string;
  count: number;
  /** The filter's own note (truncated). */
  reason?: string;
}

export interface DirectorTurnLog {
  runId: string;
  intent: "edit" | "greet";
  scopeMode: string | null;
  provider: string | null;
  model: string | null;
  plannerSource: string;
  plannerReason: string;
  /** Set when an edit turn was planned by the offline rules instead of the model. */
  fallback: { code: DirectorFallbackCode; reason: string } | null;
  llmCalls: number;
  ops: {
    /** Operations the planner returned. */
    planned: number;
    /** Operations sent to the compiler: after PlanExpander expansion (one planned op can become several) and every filter. */
    afterFilters: number;
    /** Compiled changes (after expansion: one planned op can be several changes). */
    applied: number;
    /** Changes the compiler refused. */
    rejected: number;
    dropped: number;
  };
  drops: DirectorOpDrop[];
  repairRounds: number;
  criticScore: number | null;
  latencyMs: number;
  /** A ShotLog (vision pass) was part of the context. */
  vision?: boolean;
  /** The style playbook (Phase 6): which one, and how many of its targets the edit met. */
  style?: { playbookId: string; version: string; met: number; total: number } | null;
  /** The agent loop (Phase 4): turns, stages done, why it stopped, whether the coverage stage ran, rejections fed back. */
  agent?: { turns: number; stages: string[]; stopped: string; coverageRetry: boolean; feedback: number } | null;
  /** The story pass (Phase 3) of a whole edit: what it cut, or why it did not run. */
  story?: { applied: true; removedLines: number; removedSec: number; hookLineId: string; hookMoved: boolean } | { applied: false; reason: string } | null;
}

const MAX_REASON = 200;

const clip = (s: string, n = MAX_REASON) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Operation-type counts dropped between two lists (a filter that only rewrites an op is not a drop). */
export function droppedByType(before: Array<{ type?: string }>, after: Array<{ type?: string }>): Array<{ op: string; count: number }> {
  const count = (ops: Array<{ type?: string }>) => {
    const m = new Map<string, number>();
    for (const o of ops) m.set(String(o?.type ?? "unknown"), (m.get(String(o?.type ?? "unknown")) ?? 0) + 1);
    return m;
  };
  const a = count(before);
  const b = count(after);
  const out: Array<{ op: string; count: number }> = [];
  for (const [op, n] of a) {
    const d = n - (b.get(op) ?? 0);
    if (d > 0) out.push({ op, count: d });
  }
  return out;
}

/** Collects drops while the Director runs its filters. */
export class DirectorDropRecorder {
  readonly drops: DirectorOpDrop[] = [];

  /** Records what `filter` removed going from `before` to `after`; returns `after` for chaining. */
  record<T extends { type?: string }>(filter: DirectorDropFilter, before: T[], after: T[], notes?: string[] | string): T[] {
    const reason = Array.isArray(notes) ? notes.filter(Boolean).join("; ") : notes;
    for (const d of droppedByType(before, after)) {
      this.drops.push({ filter, op: d.op, count: d.count, ...(reason ? { reason: clip(reason) } : {}) });
    }
    return after;
  }

  /** Compiler refusals ("insertBroll: no stock query" style strings). */
  recordRejected(rejected: string[]) {
    for (const r of rejected) {
      const m = /^\s*([A-Za-z][\w]*)\s*[:(]/.exec(r);
      this.drops.push({ filter: "compiler", op: m ? m[1] : "unknown", count: 1, reason: clip(r) });
    }
  }

  get total(): number {
    return this.drops.reduce((n, d) => n + d.count, 0);
  }
}

/**
 * The fallback category of a deterministic planner reason. Returns null when the turn was deterministic by design
 * (the opening proposal, an offline clarifying question) rather than because the model could not be used.
 */
export function classifyPlannerFallback(plannerSource: string, plannerReason: string, intent: "edit" | "greet"): DirectorTurnLog["fallback"] {
  if (plannerSource !== "deterministic" || intent !== "edit") return null;
  const r = plannerReason || "";
  if (/^clarifying question before editing/i.test(r)) return null;
  const code: DirectorFallbackCode =
    /no AI API key|no workspace \(company\) context|could not load AI settings/i.test(r) ? "no_key"
    : /LLM disabled/i.test(r) ? "llm_disabled"
    : /does not support tool calling/i.test(r) ? "no_tool_calling"
    : /^LLM_TIMEOUT/i.test(r) ? "timeout"
    : /call budget/i.test(r) ? "budget"
    : /empty response/i.test(r) ? "empty_response"
    : /failed validation/i.test(r) ? "invalid_output"
    : /failed \(/i.test(r) ? "llm_error"
    : "unknown";
  return { code, reason: clip(r, 300) };
}

/** Provider and model out of a planner label "claude/claude-sonnet-5 tool-calling plan …" (best effort). */
export function providerModelFromReason(reason: string): { provider: string | null; model: string | null } {
  const m = /\(?\b(claude|openai|gemini|groq|grok|custom|deepseek|mistral)(?:\/([\w.:@-]+))?/i.exec(reason || "");
  return { provider: m ? m[1].toLowerCase() : null, model: m?.[2] ?? null };
}

/** The single log line written per turn (grep `[AI Director][turn]`). */
export function formatTurnLogLine(log: DirectorTurnLog): string {
  return `[AI Director][turn] ${JSON.stringify(log)}`;
}

// ─── Report ──────────────────────────────────────────────────────────────────────────────────────

export interface DirectorTurnReport {
  days: number;
  turns: number;
  editTurns: number;
  llmTurns: number;
  deterministicTurns: number;
  /** Edit turns the rule-based planner made because the model could not be used. */
  fallbackTurns: number;
  /** fallbackTurns / editTurns, 0..100 (one decimal). */
  fallbackPct: number;
  fallbackByCode: Record<string, number>;
  /** Most frequent fallback reasons (deduplicated by their first 120 characters). */
  topFallbackReasons: Array<{ reason: string; count: number }>;
  byProviderModel: Array<{ provider: string; model: string; turns: number }>;
  dropsByFilter: Record<string, number>;
  avgLatencyMs: number | null;
  avgOps: { planned: number; applied: number; dropped: number } | null;
}

/**
 * Aggregates stored turn records. Accepts the `turnLog` object of each final TimelineChanged event; records from
 * before Phase 0 (only `plannerSource`) are counted in the totals.
 */
export function summarizeDirectorTurns(records: Array<Partial<DirectorTurnLog> & { plannerSource?: string }>, days: number): DirectorTurnReport {
  const turns = records.filter((r) => r && typeof r.plannerSource === "string");
  const edit = turns.filter((r) => (r.intent ?? "edit") === "edit");
  const fallbacks = edit.filter((r) => r.fallback || (r.fallback === undefined && r.plannerSource === "deterministic"));
  const byCode: Record<string, number> = {};
  const reasons = new Map<string, number>();
  for (const r of fallbacks) {
    const code = r.fallback?.code ?? "unknown";
    byCode[code] = (byCode[code] ?? 0) + 1;
    const key = (r.fallback?.reason ?? r.plannerReason ?? "").slice(0, 120);
    if (key) reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const pm = new Map<string, number>();
  for (const r of turns) {
    if (r.plannerSource !== "llm") continue;
    const k = `${r.provider ?? "unknown"}\u0000${r.model ?? "default"}`;
    pm.set(k, (pm.get(k) ?? 0) + 1);
  }
  const dropsByFilter: Record<string, number> = {};
  for (const r of turns) for (const d of r.drops ?? []) dropsByFilter[d.filter] = (dropsByFilter[d.filter] ?? 0) + (d.count ?? 1);
  const lat = turns.map((r) => r.latencyMs).filter((n): n is number => typeof n === "number" && n >= 0);
  const withOps = turns.filter((r) => r.ops);
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
  return {
    days,
    turns: turns.length,
    editTurns: edit.length,
    llmTurns: turns.filter((r) => r.plannerSource === "llm").length,
    deterministicTurns: turns.filter((r) => r.plannerSource === "deterministic").length,
    fallbackTurns: fallbacks.length,
    fallbackPct: edit.length ? Math.round((fallbacks.length / edit.length) * 1000) / 10 : 0,
    fallbackByCode: byCode,
    topFallbackReasons: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([reason, count]) => ({ reason, count })),
    byProviderModel: [...pm].sort((a, b) => b[1] - a[1]).map(([k, n]) => {
      const [provider, model] = k.split("\u0000");
      return { provider, model, turns: n };
    }),
    dropsByFilter,
    avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null,
    avgOps: withOps.length
      ? { planned: avg(withOps.map((r) => r.ops!.planned)), applied: avg(withOps.map((r) => r.ops!.applied)), dropped: avg(withOps.map((r) => r.ops!.dropped)) }
      : null,
  };
}
