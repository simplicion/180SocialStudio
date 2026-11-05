import { z } from "zod";
import { MobileMediaDescriptorSchema, MobileEditIRSchema } from "./mobile-edit-ir";
import { DirectorConstraintsSchema } from "./director-constraints";

/** Renderer features a client may advertise (Phase 6): moving crops, J/L cuts, text rotation / scale, several music beds. */
export const RENDERER_CAPABILITIES = ["cropKeyframes", "jlCut", "textTransform", "multiMusic"] as const;
export type RendererCapability = (typeof RENDERER_CAPABILITIES)[number];

/**
 * Operations adjusted to what the client can render: a feature it lacks is downgraded (a tracking reframe becomes a
 * static one, text keeps no rotation) or refused with the reason. Returns the operations and one note per change.
 */
export function gateRendererFeatures<T extends { type: string; [k: string]: any }>(ops: T[], caps: readonly string[] | undefined): { ops: T[]; notes: string[] } {
  const has = new Set(caps ?? []);
  const notes: string[] = [];
  const out: T[] = [];
  for (const op of ops) {
    if (op.type === "reframeSubject" && op.mode === "track" && !has.has("cropKeyframes")) {
      notes.push("this app version cannot render a moving crop yet, so the framing is static");
      out.push({ ...op, mode: "static" });
      continue;
    }
    if (op.type === "jlCut" && !has.has("jlCut")) {
      notes.push("this app version cannot render J/L cuts yet");
      continue;
    }
    if ((op.type === "updateTextStyle" || op.type === "addText") && (op.rotationDeg !== undefined || op.scale !== undefined) && !has.has("textTransform")) {
      const { rotationDeg: _r, scale: _s, ...rest } = op;
      notes.push("this app version cannot rotate or scale text yet");
      if (Object.keys(rest).some((k) => !["type", "target", "id"].includes(k))) out.push(rest as T);
      continue;
    }
    if (op.type === "addBackgroundMusic" && (op.startSec !== undefined || op.durationSec !== undefined) && !has.has("multiMusic")) {
      notes.push("this app version plays one music track for the whole video");
      continue;
    }
    out.push(op);
  }
  return { ops: out, notes: [...new Set(notes)] };
}

const qaMs = z.number().int().nonnegative().max(4 * 60 * 60 * 1000);
const qaRange = z.tuple([qaMs, qaMs]);

/**
 * Quick QA of the last export, measured on the device after rendering (`currentEditIR` is the timeline that was
 * exported). The director's critic compares it with that timeline (duration, size, audio, black/frozen frames).
 */
export const LastExportQaSchema = z.object({
  durationMs: qaMs,
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  fps: z.number().positive().max(240).optional(),
  hasAudio: z.boolean(),
  audioChannels: z.number().int().min(0).max(16).optional(),
  blackRangesMs: z.array(qaRange).max(500),
  frozenRangesMs: z.array(qaRange).max(500),
  integratedLufs: z.number().min(-100).max(10).optional(),
  clippingPct: z.number().min(0).max(100).optional(),
});
export type LastExportQa = z.infer<typeof LastExportQaSchema>;

/** Chat turn supplied by the client (oldest first). */
export const DirectorHistoryTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(4000),
  /**
   * Assistant turns (added 2026-11, Phase 2.4): what became of the turn on the phone. "proposed_not_applied" = the
   * creator never applied it, "undone" = applied then undone. Absent = unknown (older clients).
   */
  status: z.enum(["applied", "proposed_not_applied", "undone"]).optional(),
  /** The changes the turn made, as the server reported them (`appliedOperations`). */
  appliedOps: z.array(z.string().max(300)).max(30).optional(),
});

export type DirectorHistoryTurn = z.infer<typeof DirectorHistoryTurnSchema>;

/**
 * POST /media-editor/ai-direct — mobile form (client supplies its own media analysis).
 * Contract doc: docs/social-studio-mobile/AI_DIRECTOR_CONTRACT.md §2.1
 */
export const MobileAIDirectRequestSchema = z.object({
  /**
   * The command. May be empty only for `intent:"greet"` (the opening turn); otherwise 1..2000 chars.
   */
  prompt: z.string().trim().max(2000).default(""),
  /** "greet" = opening turn: brand-aware greeting + a proposal that requires confirmation. */
  intent: z.enum(["edit", "greet"]).optional(),
  history: z.array(DirectorHistoryTurnSchema).max(20).optional(),
  /**
   * Social project id (brand consciousness is loaded from it) and, when no currentEditIR is sent,
   * the id echoed as `editIR.projectId`. An id the server cannot resolve to a project of the
   * caller's company is ignored for brand purposes (a warning is returned).
   */
  projectId: z.string().min(1).max(128).optional(),
  /** Calendar piece being edited: script, hook, platform and target length are loaded from it. */
  calendarPieceId: z.string().min(1).max(128).optional(),
  /** Social post being edited (its calendar piece and project are followed when set). */
  postId: z.string().min(1).max(128).optional(),
  media: MobileMediaDescriptorSchema,
  /**
   * The analysis of EVERY source on the timeline (added 2026-11, editor overhaul Phase 4), keyed by `assetId`. `media`
   * stays the primary source (older clients send only it); an entry here for the same assetId replaces it.
   */
  mediaList: z.array(MobileMediaDescriptorSchema).max(20).optional(),
  /** Sources whose on-device analysis (transcript ...) is still running: the Director says so instead of guessing. */
  analysisPending: z.array(z.string().min(1).max(128)).max(20).optional(),
  /**
   * Beats of the music bed(s) on the TIMELINE (ms), measured on the phone from the downloaded track (added 2026-11,
   * Phase 6.4). A whole edit places zooms, B-roll and effects on them.
   */
  musicBeatsMs: z.array(z.number().int().nonnegative()).max(5000).optional(),
  /**
   * What this phone's renderer can draw (added 2026-11, Phase 6). The Director only uses features listed here, so an
   * older app never gets a timeline it would export differently from what it previews. Absent = none of them.
   */
  rendererCapabilities: z.array(z.enum(RENDERER_CAPABILITIES)).max(20).optional(),
  currentEditIR: MobileEditIRSchema.nullable().optional(),
  /** Preservation locks (ms on the current timeline). Enforced: operations that break them are dropped (`violations`). */
  constraints: DirectorConstraintsSchema.optional(),
  /** Device QA of the last export of `currentEditIR`; fed to the critic. */
  lastExportQa: LastExportQaSchema.optional(),
  /**
   * The phone's timeline revision `currentEditIR` was taken at (added 2026-11). Echoed back as `baseRevision`, so a
   * response that arrives after newer manual edits is merged onto them instead of replacing them.
   */
  baseRevision: z.number().int().nonnegative().optional(),
}).superRefine((v, ctx) => {
  const greet = v.intent === "greet" || (!v.prompt && (v.projectId || v.calendarPieceId || v.postId));
  if (!v.prompt && !greet) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt"], message: "prompt is required (1..2000 chars) unless intent is \"greet\"" });
  }
});

export type MobileAIDirectRequest = z.infer<typeof MobileAIDirectRequestSchema>;

export type PlannerSource = "llm" | "deterministic";
