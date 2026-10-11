import { z } from "zod";
import { RationalTimeSchema, TimeRangeSchema } from "./time";
import { VideoClipSchema, CameraEventSchema, CaptionSegmentSchema, TransformSchema } from "./edit-ir.schema";

/**
 * Atomic Transactional Commands (Executed by Command Engine)
 */
export const AddClipCommandSchema = z.object({
  type: z.literal("ADD_CLIP"),
  trackId: z.string().uuid(),
  clip: VideoClipSchema,
});

export const RemoveClipCommandSchema = z.object({
  type: z.literal("REMOVE_CLIP"),
  trackId: z.string().uuid(),
  clipId: z.string().uuid(),
});

export const TrimClipCommandSchema = z.object({
  type: z.literal("TRIM_CLIP"),
  clipId: z.string().uuid(),
  newSourceRange: TimeRangeSchema,
  newTimelineRange: TimeRangeSchema,
});

export const SplitClipCommandSchema = z.object({
  type: z.literal("SPLIT_CLIP"),
  clipId: z.string().uuid(),
  splitTime: RationalTimeSchema,
});

export const MoveClipCommandSchema = z.object({
  type: z.literal("MOVE_CLIP"),
  clipId: z.string().uuid(),
  targetTrackId: z.string().uuid(),
  newTimelineStart: RationalTimeSchema,
});

export const SetTransformCommandSchema = z.object({
  type: z.literal("SET_TRANSFORM"),
  clipId: z.string().uuid(),
  transform: TransformSchema,
});

export const AddCameraEventCommandSchema = z.object({
  type: z.literal("ADD_CAMERA_EVENT"),
  event: CameraEventSchema,
});

export const RemoveCameraEventCommandSchema = z.object({
  type: z.literal("REMOVE_CAMERA_EVENT"),
  eventId: z.string().uuid(),
});

export const AddCaptionCommandSchema = z.object({
  type: z.literal("ADD_CAPTION"),
  caption: CaptionSegmentSchema,
});

export const ApplyStyleCommandSchema = z.object({
  type: z.literal("APPLY_STYLE"),
  preset: z.enum(["MRBEAST_FAST", "ALI_ABDAAL_CLEAN", "HORMOZI_PUNCH", "SAAS_DEMO", "CUSTOM"]),
  pacingMultiplier: z.number().optional(),
  zoomAggressiveness: z.number().optional(),
});

export const EditCommandSchema = z.discriminatedUnion("type", [
  AddClipCommandSchema,
  RemoveClipCommandSchema,
  TrimClipCommandSchema,
  SplitClipCommandSchema,
  MoveClipCommandSchema,
  SetTransformCommandSchema,
  AddCameraEventCommandSchema,
  RemoveCameraEventCommandSchema,
  AddCaptionCommandSchema,
  ApplyStyleCommandSchema,
]);

export type EditCommand = z.infer<typeof EditCommandSchema>;

/**
 * Command Transaction Wrapper (Supports Atomic Batch & Reversible Undo)
 */
export const CommandTransactionSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.number(),
  source: z.enum(["USER_MANUAL", "AI_DIRECTOR", "AUTOMATION_PRESET"]),
  commands: z.array(EditCommandSchema),
  inverseCommands: z.array(EditCommandSchema).describe("Computed rollback commands for undo"),
});

export type CommandTransaction = z.infer<typeof CommandTransactionSchema>;
