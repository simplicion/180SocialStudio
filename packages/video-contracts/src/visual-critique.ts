import { z } from "zod";
import type { MobileEditIR } from "./mobile-edit-ir";
import { fenceUntrusted, sanitizeInlineUntrusted } from "./untrusted-content";

/**
 * Visual critic (AI Director quality-fix plan, Phase 5): the Director looks at its own result.
 *
 * After a turn changes the timeline, the server lists CHECKPOINTS (timeline ms + what should be on screen). With the
 * creator's vision consent the phone renders a fast low-res proxy of the applied timeline, grabs a still at each
 * checkpoint and sends them to `POST /media-editor/vision/critique` (memory only, like the vision pass). A vision
 * model scores them against a fixed rubric; the phone then asks the Director for a repair turn with the issues
 * (`visualCritique` on the request), at most VISUAL_MAX_ROUNDS times.
 */

const ms = z.number().int().nonnegative().max(4 * 60 * 60 * 1000);

export const CHECKPOINT_KINDS = ["hook", "cut_before", "cut_after", "zoom", "broll", "title", "caption"] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export const VisualCheckpointSchema = z.object({
  tMs: ms,
  kind: z.enum(CHECKPOINT_KINDS),
  /** What should be on screen there (caption text, zoom, B-roll query, title): context for the critic. */
  label: z.string().max(300),
  /** Timeline item ids the frame shows (caption / zoom / overlay ids), so repairs can target them. */
  refs: z.array(z.string().max(128)).max(8).default([]),
});
export type VisualCheckpoint = z.infer<typeof VisualCheckpointSchema>;

export const VISUAL_ISSUE_KINDS = [
  "weak_hook",
  "caption_over_face",
  "caption_unreadable",
  "caption_in_ui_zone",
  "zoom_crops_head",
  "subject_out_of_frame",
  "broll_irrelevant",
  "broll_jarring",
  "jump_cut",
  "color_inconsistent",
  "pacing",
  "title_unreadable",
  "other",
] as const;
export const VISUAL_SEVERITIES = ["critical", "major", "minor"] as const;

export const VisualIssueSchema = z.object({
  kind: z.enum(VISUAL_ISSUE_KINDS).catch("other"),
  severity: z.enum(VISUAL_SEVERITIES).catch("minor"),
  /** Timeline ms of the frame that shows it. */
  atMs: ms,
  /** Item ids involved (from the checkpoint), when known. */
  refs: z.array(z.string().max(128)).max(8).default([]),
  description: z.string().trim().min(1).max(300),
  /** The fix in plain editing terms ("move the captions to the lower third", "zoom less on the face"). */
  fix: z.string().trim().max(300).default(""),
});
export type VisualIssue = z.infer<typeof VisualIssueSchema>;

export const VisualCritiqueSchema = z.object({
  /** 0..10, the rubric overall. */
  score: z.number().min(0).max(10),
  issues: z.array(VisualIssueSchema).max(20).default([]),
  /** One plain sentence for the creator. */
  summary: z.string().max(300).default(""),
  /** provider/model that looked. */
  model: z.string().max(120).default(""),
  frameCount: z.number().int().nonnegative().max(60).default(0),
});
export type VisualCritique = z.infer<typeof VisualCritiqueSchema>;

/** On the Director request: this turn repairs what the visual check found (round 1 or 2). */
export const VisualRepairRequestSchema = z.object({
  round: z.number().int().min(1).max(2),
  critique: VisualCritiqueSchema,
});
export type VisualRepairRequest = z.infer<typeof VisualRepairRequestSchema>;

export const VISUAL_MAX_ROUNDS = 2;
export const MAX_CHECKPOINTS = 40;
/** Issues worth a repair turn (minor ones are only reported). */
export const isRepairable = (i: Pick<VisualIssue, "severity">) => i.severity === "critical" || i.severity === "major";

const clip = (s: string, n = 80) => sanitizeInlineUntrusted(s, n);

/**
 * Where to look at a timeline: the hook (0, 1 s, 2.5 s), 200 ms either side of every cut, the middle of every zoom,
 * B-roll / sticker overlay and title, and a few captions. Merged within 150 ms, capped at MAX_CHECKPOINTS (hook and
 * cuts first). Each checkpoint says what should be visible there.
 */
export function critiqueCheckpoints(ir: MobileEditIR, max = MAX_CHECKPOINTS): VisualCheckpoint[] {
  const end = Math.max(0, ir.durationMs - 50);
  const at = (t: number) => Math.min(end, Math.max(0, Math.round(t)));
  const raw: Array<{ tMs: number; kind: CheckpointKind; priority: number }> = [];
  for (const t of [0, 1000, 2500]) if (t <= end) raw.push({ tMs: at(t === 0 ? 100 : t), kind: "hook", priority: 0 });
  const cuts = ir.clips.slice(1).map((c) => c.timelineStartMs).filter((t) => t > 300 && t < end - 300);
  for (const t of cuts.slice(0, 12)) {
    raw.push({ tMs: at(t - 200), kind: "cut_before", priority: 1 }, { tMs: at(t + 200), kind: "cut_after", priority: 1 });
  }
  for (const z of ir.zooms) raw.push({ tMs: at(z.startMs + Math.min((z.endMs - z.startMs) / 2, (z.rampMs || 300) + 200)), kind: "zoom", priority: 2 });
  for (const o of ir.overlays) raw.push({ tMs: at((o.timelineStartMs + o.timelineEndMs) / 2), kind: "broll", priority: 2 });
  const titles = ir.captions.filter((c) => c.kind === "text");
  const speech = ir.captions.filter((c) => c.kind !== "text");
  for (const c of titles) raw.push({ tMs: at((c.startMs + c.endMs) / 2), kind: "title", priority: 2 });
  const step = Math.max(1, Math.floor(speech.length / 4));
  for (let i = 0; i < speech.length && i / step < 4; i += step) raw.push({ tMs: at((speech[i].startMs + speech[i].endMs) / 2), kind: "caption", priority: 3 });

  raw.sort((a, b) => a.priority - b.priority || a.tMs - b.tMs);
  const kept: Array<{ tMs: number; kind: CheckpointKind }> = [];
  for (const r of raw) {
    if (kept.length >= max) break;
    if (kept.some((k) => Math.abs(k.tMs - r.tMs) < 150)) continue;
    kept.push(r);
  }
  kept.sort((a, b) => a.tMs - b.tMs);
  return kept.map(({ tMs, kind }) => {
    const parts: string[] = [];
    const refs: string[] = [];
    for (const c of ir.captions) {
      if (tMs < c.startMs || tMs >= c.endMs) continue;
      parts.push(c.kind === "text" ? `title "${clip(c.text)}"` : `caption "${clip(c.text, 60)}"`);
      refs.push(c.id);
    }
    for (const z of ir.zooms) {
      if (tMs < z.startMs || tMs >= z.endMs) continue;
      parts.push(`zoom ${z.scale.toFixed(2)}x on (${z.centerX.toFixed(2)},${z.centerY.toFixed(2)})`);
      refs.push(z.id);
    }
    for (const o of ir.overlays) {
      if (tMs < o.timelineStartMs || tMs >= o.timelineEndMs) continue;
      const q = (o.source as any).query;
      parts.push(`${(o as any).layout && (o as any).layout !== "fullscreen" ? `${(o as any).layout} ` : ""}B-roll${q ? ` "${clip(q, 60)}"` : ""}`);
      refs.push(o.id);
    }
    const what = kind === "cut_before" ? "just before a cut" : kind === "cut_after" ? "just after a cut" : kind === "hook" ? "the opening (hook)" : kind;
    return VisualCheckpointSchema.parse({ tMs, kind, label: `${what}${parts.length ? `: ${parts.join("; ")}` : ""}`.slice(0, 300), refs: refs.slice(0, 8) });
  });
}

/** The repair turn's instruction for the Director (issues fenced: the critic's text came from looking at user media). */
export function visualRepairInstruction(request: string, r: VisualRepairRequest): string {
  const issues = r.critique.issues.filter(isRepairable);
  const lines = issues.map((i) => `- ${(i.atMs / 1000).toFixed(1)} s, ${i.severity} ${i.kind}${i.refs.length ? ` (items ${i.refs.join(", ")})` : ""}: ${i.description}${i.fix ? ` Fix: ${i.fix}` : ""}`);
  return [
    `A visual check looked at stills of the edit you made (round ${r.round}; score ${r.critique.score.toFixed(1)}/10). Fix ONLY these problems, with the fewest changes, using the update tools on the items named. Times are seconds on the CURRENT timeline. Do not undo or remove anything the creator asked for; keep the story cut as it is.`,
    fenceUntrusted("vision", lines.join("\n"), { maxChars: 6000 }).block,
    `The creator's original request: ${JSON.stringify(request).slice(0, 600)}`,
  ].join("\n");
}
