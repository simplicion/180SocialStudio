import { z } from "zod";
import { MobileMediaDescriptorSchema, MobileEditIRSchema } from "./mobile-edit-ir";
import { DirectorConstraintsSchema } from "./director-constraints";

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
  currentEditIR: MobileEditIRSchema.nullable().optional(),
  /** Preservation locks (ms on the current timeline). Enforced: operations that break them are dropped (`violations`). */
  constraints: DirectorConstraintsSchema.optional(),
  /** Device QA of the last export of `currentEditIR`; fed to the critic. */
  lastExportQa: LastExportQaSchema.optional(),
}).superRefine((v, ctx) => {
  const greet = v.intent === "greet" || (!v.prompt && (v.projectId || v.calendarPieceId || v.postId));
  if (!v.prompt && !greet) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt"], message: "prompt is required (1..2000 chars) unless intent is \"greet\"" });
  }
});

export type MobileAIDirectRequest = z.infer<typeof MobileAIDirectRequestSchema>;

export type PlannerSource = "llm" | "deterministic";
