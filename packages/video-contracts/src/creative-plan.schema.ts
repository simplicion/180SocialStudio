import { VIDEO_EFFECT_TYPES, TRANSITION_TYPES } from "./edit-ir.schema";
import { z } from "zod";
import { RationalTimeSchema, TimeRangeSchema } from "./time";
import { CAPTION_TEMPLATE_IDS, CAPTION_ANIMATIONS } from "./caption-templates";
import { SpringConfigSchema, TextEnterSchema, TextExitSchema, TextLoopSchema } from "./edit-ir.schema";

/** Fonts the phone renders and exports (mirrors CaptionFonts.exportFamilies in the Flutter app). */
export const EDITOR_FONTS = ["Inter", "Anton", "Montserrat", "Poppins", "Syne", "Outfit", "Roboto", "Bebas Neue"] as const;
/** How an inserted overlay sits on screen. fullscreen/fit replace the picture (cutaway); pip/sticker float above it. */
export const OVERLAY_LAYOUTS = ["fullscreen", "fit", "pip", "sticker"] as const;
/** Entrance animation for a floating overlay (keyframes; same maths as the editor's "Animation in" chips). */
export const LAYER_ENTRANCES = ["none", "zoom_in", "slide_left", "slide_up", "fade", "spin"] as const;
/** Timeline items the Director can remove by id, by time, or all of a kind. */
export const REMOVABLE_ITEM_KINDS = ["caption", "title", "zoom", "broll", "effect", "sfx"] as const;
const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/**
 * High-Level Creative Intent
 */
export const CreativeIntentSchema = z.object({
  platform: z.enum(["instagram", "youtube", "tiktok", "general"]).default("general"),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5"]).default("16:9"),
  resolution: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  targetDuration: z.number().positive().optional(),
  // Kept in sync with `DirectorStyleKey` (director-style-resolver.ts) and `DirectorStylePreset`
  // (edit-ir.schema.ts) — the deterministic planner assigns its resolved style key straight into
  // this field, so a narrower enum here makes CreativePlanValidator reject a valid plan outright.
  stylePreset: z
    .enum([
      "MRBEAST_FAST",
      "ALI_ABDAAL_CLEAN",
      "HORMOZI_PUNCH",
      "SAAS_DEMO",
      "CUSTOM",
      "MINIMALIST_CLEAN",
      "DAN_KOE_MINIMALIST",
      "HORMOZI_VIRAL",
      "INSTAGRAM_AESTHETIC",
      "DOCUMENTARY_DEEPDIVE",
      "MAGNATES_MEDIA_MYSTERY",
      "VOX_EXPLAINER",
      "IMAN_GADZHI_CINEMATIC",
    ])
    .default("CUSTOM"),
  energy: z.enum(["high", "medium", "calm"]).default("medium"),
  pacing: z.enum(["fast-natural", "cinematic", "dynamic", "relaxed"]).default("dynamic"),
  captionStyle: z.string().default("HORMOZI_BOUNCE"),
  audioStyle: z.string().default("VOICE_PRIORITY_DUCKED"),
  visualStyle: z.string().default("CLEAN_ATTENTION"),
});

export type CreativeIntent = z.infer<typeof CreativeIntentSchema>;

/**
 * User-Specified Explicit Constraints
 */
export const UserConstraintsSchema = z.object({
  doNotRemoveIntro: z.boolean().default(false),
  keepEnding: z.boolean().default(false),
  protectedTimeRanges: z.array(z.object({ startSec: z.number(), durationSec: z.number() })).default([]),
  doNotAddMusic: z.boolean().default(false),
  useUploadedBrollOnly: z.boolean().default(true),
  lockedTrackIds: z.array(z.string()).default([]),
  preserveVoiceAudio: z.boolean().default(true),
  /** Director preservation locks by track kind (see director-constraints.ts); enforced by CreativePlanValidator. */
  lockedTracks: z.array(z.enum(["music", "captions", "broll", "sfx", "effects", "text"])).default([]).optional(),
});

export type UserConstraints = z.infer<typeof UserConstraintsSchema>;

/**
 * Creative Semantic Operations (Typed Discriminated Union)
 */
export const RemoveRangeOpSchema = z.object({
  type: z.literal("removeRange"),
  trackId: z.string().optional(),
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  ripple: z.boolean().default(true),
  reason: z.string(),
});

export const RippleDeleteOpSchema = z.object({
  type: z.literal("rippleDelete"),
  clipId: z.string().min(1).describe("Id of the main-track clip to delete (see 'main clips')."),
  reason: z.string().default("creator asked"),
});

export const TrimClipOpSchema = z.object({
  type: z.literal("trimClip"),
  clipId: z.string().min(1).describe("Id of the main-track clip to trim."),
  startTrimSec: z.number().nonnegative().default(0).describe("Timeline seconds to remove from the clip's head."),
  endTrimSec: z.number().nonnegative().default(0).describe("Timeline seconds to remove from the clip's tail."),
});

export const SplitClipOpSchema = z.object({
  type: z.literal("splitClip"),
  clipId: z.string().min(1).describe("Id of the main-track clip to split."),
  splitTimeSec: z.number().nonnegative().describe("Timeline second (inside the clip) to split at."),
});

export const MoveClipOpSchema = z.object({
  type: z.literal("moveClip"),
  clipId: z.string().min(1).describe("Id of the main-track clip to move."),
  targetTimelineStartSec: z
    .number()
    .nonnegative()
    .describe("Point on the current timeline where the clip is inserted (0 = the very start, the total duration = the end). Snaps to the nearest clip boundary."),
});

export const DuplicateClipOpSchema = z.object({
  type: z.literal("duplicateClip"),
  clipId: z.string(),
  targetTimelineStartSec: z.number().nonnegative(),
});

export const ReplaceClipOpSchema = z.object({
  type: z.literal("replaceClip"),
  clipId: z.string(),
  replacementAssetId: z.string(),
});

export const InsertBrollOpSchema = z.object({
  type: z.literal("insertBroll"),
  // "stock" (or any id not in the asset registry) when the clip comes from `stockQuery`/`sourceUrl`.
  assetId: z.string().default("stock"),
  /** Stock-footage search phrase (e.g. "gym workout"). Resolved to a URL server-side when possible. */
  stockQuery: z.string().min(1).max(120).optional(),
  /** Direct HTTPS video URL for the overlay. */
  sourceUrl: z.string().url().optional(),
  timelineStartSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  sourceStartSec: z.number().nonnegative().default(0),
  cropMode: z.enum(["center", "face_track"]).default("center"),
  /** "image" = a still photo held for durationSec (needs sourceUrl or an image asset; no stock search). */
  mediaType: z.enum(["video", "image"]).optional(),
  /** Default "fullscreen" (cutaway). pip/sticker float above the speaker. */
  layout: z.enum(OVERLAY_LAYOUTS).optional(),
  /** pip/sticker centre as canvas fractions from the top-left. */
  position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  /** pip/sticker size relative to the largest fit inside the frame (pip ≈ 0.35-0.5, sticker ≈ 0.2-0.3). */
  scale: z.number().min(0.1).max(1).optional(),
  rotation: z.number().min(-180).max(180).optional(),
  animationIn: z.enum(LAYER_ENTRANCES).optional(),
  /** Keep the overlay clip's own sound (default muted). */
  keepAudio: z.boolean().optional(),
  /** Footage shot on a green / blue screen: key the background out so the main video shows behind it. */
  greenScreen: z.enum(["green", "blue"]).optional(),
  /** pip / sticker shape: a circle (face cam) or rounded corners. */
  shape: z.enum(["circle", "rounded"]).optional(),
  reason: z.string().optional(),
});

export const AddEffectOpSchema = z.object({
  type: z.literal("addEffect"),
  effect: z.enum(VIDEO_EFFECT_TYPES),
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive().max(30),
  intensity: z.number().min(0).max(1).default(0.6),
  reason: z.string().optional(),
});

export const AddCaptionOpSchema = z.object({
  type: z.literal("addCaption"),
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  text: z.string(),
  highlightColor: z.string().optional(),
  textColor: z.string().optional(),
  words: z.array(
    z.object({
      word: z.string(),
      startSec: z.number().nonnegative(),
      endSec: z.number().nonnegative(),
      highlight: z.boolean().default(false),
      color: z.string().optional(),
      scale: z.number().default(1.0),
    })
  ),
  stylePreset: z.string().default("HORMOZI_BOUNCE"),
  /** Caption template id (caption-templates.ts): supplies font, weight, outline, pill and glow. */
  template: z.string().optional(),
  fontSize: z.number().min(16).max(200).optional(),
  position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  uppercase: z.boolean().optional(),
  animation: z.enum(CAPTION_ANIMATIONS).optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().min(0).max(20).optional(),
  background: z.string().optional(),
});

export const StyleCaptionOpSchema = z.object({
  type: z.literal("styleCaption"),
  preset: z.string().describe(`Caption template id (${CAPTION_TEMPLATE_IDS.join(", ")}) for a full restyle, or a basic preset name.`),
  highlightColor: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const EmphasizeWordOpSchema = z.object({
  type: z.literal("emphasizeWord"),
  captionId: z.string(),
  wordIndex: z.number().int().nonnegative(),
  color: z.string().default("#00FF88"),
  scale: z.number().default(1.2),
});

export const AddZoomOpSchema = z.object({
  type: z.literal("addZoom"),
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  targetType: z.enum(["FACE", "CURSOR", "OBJECT", "SCREEN_ROI", "MANUAL"]).default("FACE"),
  targetCoords: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  scale: z.number().min(1.0).max(4.0).default(1.3),
  springConfig: SpringConfigSchema.optional(),
  motionBlur: z.boolean().default(true),
  reason: z.string().optional(),
});

export const ReframeSubjectOpSchema = z.object({
  type: z.literal("reframeSubject"),
  targetAspect: z.enum(["9:16", "16:9", "1:1", "4:5"]),
  trackingSubjectId: z.string().optional(),
  smoothingFactor: z.number().min(0).max(1).default(0.85),
});

export const ChangeAspectRatioOpSchema = z.object({
  type: z.literal("changeAspectRatio"),
  targetAspect: z.enum(["9:16", "16:9", "1:1", "4:5"]),
  /** Output size; defaults to the standard size for the aspect (e.g. 1080x1920 for 9:16). */
  width: z.number().int().positive().max(8192).optional(),
  height: z.number().int().positive().max(8192).optional(),
  /** "fill" = crop the footage to fill the frame; "fit" = show the whole frame on `background`. */
  mode: z.enum(["fill", "fit"]).optional().describe('"fill" (default) crops to fill the frame; "fit" shows the whole frame on `background`.'),
  background: z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/).optional(),
});

/** Well-known track id for the main footage's own audio (mobile `audio.originalTrack`). */
export const ORIGINAL_AUDIO_TRACK_ID = "original";

export const AdjustVolumeOpSchema = z.object({
  type: z.literal("adjustVolume"),
  trackId: z
    .string()
    .min(1)
    .describe(`"original" = the video's own sound (voice), "music" = the background music bed, or an exact audio track id.`),
  volumeDb: z.number().min(-60).max(12).describe("Absolute gain in dB (0 = unchanged level, -6 = about half as loud, -60 = mute)."),
});

/** Rotate and/or mirror main-track footage. At least one of rotationDeg / flipH must be given. */
export const RotateClipOpSchema = z.object({
  type: z.literal("rotateClip"),
  clipId: z.string().min(1).default("all").describe('Main-track clip id, or "all".'),
  rotationDeg: z
    .number()
    .int()
    .refine((v) => v === 0 || v === 90 || v === 180 || v === 270, { message: "rotationDeg must be 0, 90, 180 or 270" })
    .optional()
    .describe("Absolute clockwise rotation: 0, 90, 180 or 270."),
  flipH: z.boolean().optional().describe("true = mirror horizontally, false = not mirrored."),
});

export const DuckAudioOpSchema = z.object({
  type: z.literal("duckAudio"),
  duckDb: z.number().default(-18.0),
  attackMs: z.number().default(120),
  releaseMs: z.number().default(350),
});

export const NormalizeAudioOpSchema = z.object({
  type: z.literal("normalizeAudio"),
  targetLufs: z.number().default(-14.0),
});

export const AddTransitionOpSchema = z.object({
  type: z.literal("addTransition"),
  // "*" = every cut boundary on the main track.
  fromClipId: z.string().default("*"),
  toClipId: z.string().default("*"),
  transitionType: z.enum(TRANSITION_TYPES),
  durationSec: z.number().positive().default(0.3),
});

export const BeatAlignOpSchema = z.object({
  type: z.literal("beatAlign"),
  targetTrackId: z.string().default("main"),
  snapToleranceSec: z.number().positive().max(1).default(0.25),
  /** Beat times on the CURRENT timeline (seconds), from the on-device beat analysis (filled in by PlanExpander). */
  beatsSec: z.array(z.number().nonnegative()).max(5000).optional(),
});

/**
 * CapCut-style speed-ramp presets: [share of the clip's source, speed] per part. The clip is split into these parts,
 * each with its own constant speed (mirrored by TimelineOps.speedRampPresets in the Flutter app).
 */
export const SPEED_RAMP_PRESETS: Record<string, Array<[number, number]>> = {
  montage: [[0.33, 2], [0.34, 1], [0.33, 2]],
  hero: [[0.35, 1], [0.3, 0.4], [0.35, 1]],
  bullet: [[0.4, 1], [0.2, 0.3], [0.4, 2]],
  flash_in: [[0.25, 3], [0.75, 1]],
  flash_out: [[0.75, 1], [0.25, 3]],
};

export const SpeedRampOpSchema = z.object({
  type: z.literal("speedRamp"),
  clipId: z.string().min(1),
  preset: z.enum(["montage", "hero", "bullet", "flash_in", "flash_out"]),
  reason: z.string().optional(),
});

export const ChangeSpeedOpSchema = z.object({
  type: z.literal("changeSpeed"),
  // "all" = the whole main track.
  clipId: z.string().default("all"),
  speedMultiplier: z.number().min(0.25).max(4).default(1.0),
});

export const FreezeFrameOpSchema = z.object({
  type: z.literal("freezeFrame"),
  clipId: z.string(),
  timestampSec: z.number().nonnegative(),
  durationSec: z.number().positive().default(1.5),
});

export const AddImageOpSchema = z.object({
  type: z.literal("addImage"),
  assetId: z.string(),
  sourcePath: z.string(),
  timelineStartSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  scale: z.number().default(1.0),
});

export const AddTextOpSchema = z.object({
  type: z.literal("addText"),
  text: z.string(),
  timelineStartSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  style: z.record(z.any()).optional(),
  fontFamily: z.enum(EDITOR_FONTS).optional(),
  color: hexColor.optional(),
  strokeColor: hexColor.optional(),
  backgroundColor: hexColor.optional(),
  uppercase: z.boolean().optional(),
  glow: z.boolean().optional(),
  enter: TextEnterSchema.optional(),
  exit: TextExitSchema.optional(),
  loop: TextLoopSchema.optional(),
});

export const AddStickerOpSchema = z.object({
  type: z.literal("addSticker"),
  /** One emoji (drawn on the phone; nothing is downloaded). */
  emoji: z.string().min(1).max(16).refine((e) => /\p{Extended_Pictographic}/u.test(e), "must be an emoji"),
  timelineStartSec: z.number().nonnegative(),
  durationSec: z.number().positive().max(10).default(2.5),
  /** Centre as canvas fractions from the top-left (default upper right, away from a centred face). */
  position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  scale: z.number().min(0.1).max(0.6).optional(),
  rotation: z.number().min(-45).max(45).optional(),
  animationIn: z.enum(LAYER_ENTRANCES).default("zoom_in"),
  /** "3d": a 3D sticker from the Fluent Emoji library found by [name] (falls back to the emoji on the phone). */
  style: z.enum(["emoji", "3d"]).default("emoji"),
  /** English name for the 3D library, e.g. "rocket", "money bag", "thumbs up". */
  name: z.string().trim().min(1).max(40).regex(/^[a-zA-Z][a-zA-Z0-9 '&-]*$/).optional(),
  reason: z.string().optional(),
});

export const AddNarrationOpSchema = z.object({
  type: z.literal("addNarration"),
  /** What the AI voice says (spoken on the creator's phone by its text-to-speech engine). */
  text: z.string().trim().min(1).max(400),
  timelineStartSec: z.number().nonnegative(),
  reason: z.string().optional(),
});

/** Heavy on-device processing the phone runs after the turn (reverse / stabilise a clip, cut out an overlay). */
export const ProcessFootageOpSchema = z.object({
  type: z.literal("processFootage"),
  action: z.enum(["reverse", "stabilize", "remove_background"]),
  /** Main clip id (reverse / stabilize) or overlay id from the B-roll list (remove_background). */
  targetId: z.string().min(1),
  reason: z.string().optional(),
});

export const CleanVoiceOpSchema = z.object({
  type: z.literal("cleanVoice"),
  /** Main-track clip id, or "all". */
  clipId: z.string().min(1).default("all"),
  enabled: z.boolean().default(true),
  reason: z.string().optional(),
});

export const FadeClipAudioOpSchema = z.object({
  type: z.literal("fadeClipAudio"),
  /** Main-track clip id, or "all". */
  clipId: z.string().min(1).default("all"),
  fadeInSec: z.number().min(0).max(5).default(0),
  fadeOutSec: z.number().min(0).max(5).default(0),
  reason: z.string().optional(),
});

export const RemoveItemOpSchema = z.object({
  type: z.literal("removeItem"),
  kind: z.enum(REMOVABLE_ITEM_KINDS),
  /** Exact item id from the timeline summary. */
  id: z.string().min(1).optional(),
  /** Remove the items of that kind on screen at this timeline second. With neither id nor atSec: all of that kind. */
  atSec: z.number().nonnegative().optional(),
  reason: z.string().optional(),
});

export const ApplyFilterOpSchema = z.object({
  type: z.literal("applyFilter"),
  clipId: z.string().optional(),
  preset: z.string().optional(),
  brightness: z.number().optional(),
  contrast: z.number().optional(),
  saturation: z.number().optional(),
  /** Stops, -1..1 is the useful range. */
  exposure: z.number().min(-2).max(2).optional(),
  /** -1 cool … +1 warm. */
  temperature: z.number().min(-1).max(1).optional(),
  /** -1 green … +1 magenta. */
  tint: z.number().min(-1).max(1).optional(),
  /** Edge darkening 0..1. */
  vignette: z.number().min(0).max(1).optional(),
  reason: z.string().optional(),
});

export const DetachAudioOpSchema = z.object({
  type: z.literal("detachAudio"),
  clipId: z.string(),
  reason: z.string().optional(),
});

export const SelectTakeOpSchema = z.object({
  type: z.literal("selectTake"),
  candidateSegmentIndex: z.number().int().nonnegative(),
  reason: z.string(),
});

export const ReorderSegmentOpSchema = z.object({
  type: z.literal("reorderSegment"),
  segmentStartSec: z.number().nonnegative().describe("Start of the part to move, in timeline seconds as it is now."),
  segmentDurationSec: z.number().positive(),
  newStartSec: z
    .number()
    .nonnegative()
    .describe("Point on the current timeline where the part is inserted (0 = the very start, the total duration = the end). Snaps to the nearest clip boundary."),
  reason: z.string().default("creator asked"),
});

export const AutoSoundDesignOpSchema = z.object({
  type: z.literal("autoSoundDesign"),
  includeWhooshes: z.boolean().default(true),
  includePops: z.boolean().default(true),
  includeSubDrops: z.boolean().default(true),
  gainDb: z.number().default(-6.0),
  reason: z.string().optional(),
});

export const AddSoundEffectOpSchema = z.object({
  type: z.literal("addSoundEffect"),
  timelineStartSec: z.number().nonnegative().describe("Timeline second to place the sound effect."),
  sfxType: z
    .enum(["whoosh", "pop", "sub_drop", "riser", "impact", "glitch", "bell"])
    .default("whoosh")
    .describe("Type of sound effect: whoosh (transitions/zooms), pop (UI/captions), sub_drop (bass impact), riser (tension build), impact (heavy beat), glitch (digital hit), bell (notification/ding)."),
  sourceUrl: z.string().url().optional().describe("Direct HTTPS audio URL if sourcing from a sound library."),
  volumeDb: z.number().min(-40).max(6).default(-8.0).describe("Volume in dB (-8dB default)."),
  reason: z.string().optional().describe("Why this sound effect was placed (e.g. 'punctuate punch-in zoom')."),
});

export const CleanFillersOpSchema = z.object({
  type: z.literal("cleanFillers"),
  // Deliberately excludes ambiguous words like "like" / "you know" unless the caller asks for them.
  fillerTypes: z.array(z.string()).default(["um", "uh", "uhm", "umm", "er", "erm", "ah", "hmm"]),
  reason: z.string().optional(),
});

export const AsynchronousSplitOpSchema = z.object({
  type: z.literal("asynchronousSplit"),
  clipId: z.string(),
  splitType: z.enum(["J_CUT", "L_CUT"]),
  offsetSec: z.number().default(0.4),
  reason: z.string().optional(),
});


/**
 * Remove every silence (from the media graph) at least `minDurationSec` long, keeping
 * `paddingSec` of air on each side so cuts never clip a word. Expanded into `removeRange`
 * ops by PlanExpander before compilation.
 */
export const RemoveSilencesOpSchema = z.object({
  type: z.literal("removeSilences"),
  minDurationSec: z.number().min(0.15).max(10).default(0.5),
  paddingSec: z.number().min(0).max(0.5).default(0.1),
  reason: z.string().optional(),
});

/**
 * Word-synced kinetic captions generated from the transcript. Expanded into
 * `clearCaptions` + `addCaption` ops by PlanExpander.
 */
export const AutoCaptionsOpSchema = z.object({
  type: z.literal("autoCaptions"),
  stylePreset: z.enum(["HORMOZI_BOUNCE", "ALI_ABDAAL_CLEAN", "MINIMAL_SUBTITLE", "BOLD_CENTER"]).default("HORMOZI_BOUNCE"),
  /**
   * A creator look (font, outline, colours, motion). Colours, uppercase and animation given next to it
   * override the template; left out, the template's own values apply (PlanExpander.captionOps).
   */
  template: z.enum(CAPTION_TEMPLATE_IDS).optional().describe("Creator caption template. Set it when a look is named (MrBeast, Hormozi, Ali Abdaal, neon, cinematic ...)."),
  textColor: z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/).optional(),
  highlightColor: z.string().regex(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/).optional(),
  wordsPerCaption: z.number().int().min(1).max(8).default(3),
  fontSize: z.number().min(16).max(200).optional(),
  position: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  uppercase: z.boolean().optional(),
  animation: z.enum(CAPTION_ANIMATIONS).optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().min(0).max(20).optional(),
  background: z.string().optional(),
  /** Highlight one key word per caption (a number, else its longest content word). Default on. */
  autoEmphasis: z.boolean().optional().describe("Highlight one key word per caption. On unless set to false."),
  reason: z.string().optional(),
});

/**
 * Converts the speech captions to another language, or to Roman letters (Hinglish). The compiler does not
 * apply it: the director service runs the translation after compiling, because it needs the AI provider.
 */
export const TranslateCaptionsOpSchema = z.object({
  type: z.literal("translateCaptions"),
  targetLanguage: z.string().regex(/^[a-z]{2}$/).describe("ISO-639-1 code of the caption language wanted, e.g. en, hi, ta, es."),
  script: z.enum(["native", "roman"]).default("native").describe("roman = Latin letters (Hinglish and similar); native = the language's own script."),
  reason: z.string().optional(),
});

/** Removes existing speech captions (role "caption") before new ones are added. */
export const ClearCaptionsOpSchema = z.object({
  type: z.literal("clearCaptions"),
});

/** Background music bed, optionally ducked under speech. */
export const AddBackgroundMusicOpSchema = z.object({
  type: z.literal("addBackgroundMusic"),
  /** Mood / genre keywords used to pick a track when no URL is known (e.g. "upbeat energetic pop"). */
  query: z.string().min(1).max(120),
  sourceUrl: z.string().url().optional(),
  volumeDb: z.number().min(-40).max(0).default(-16),
  duckUnderSpeech: z.boolean().default(true),
  duckDb: z.number().min(-40).max(0).default(-12),
  fadeInSec: z.number().min(0).max(10).default(0.5),
  fadeOutSec: z.number().min(0).max(10).default(1.0),
  reason: z.string().optional(),
});

export const CreativeOperationSchema = z.discriminatedUnion("type", [
  RemoveRangeOpSchema,
  RippleDeleteOpSchema,
  TrimClipOpSchema,
  SplitClipOpSchema,
  MoveClipOpSchema,
  DuplicateClipOpSchema,
  ReplaceClipOpSchema,
  InsertBrollOpSchema,
  AddCaptionOpSchema,
  StyleCaptionOpSchema,
  TranslateCaptionsOpSchema,
  EmphasizeWordOpSchema,
  AddZoomOpSchema,
  AddEffectOpSchema,
  ReframeSubjectOpSchema,
  ChangeAspectRatioOpSchema,
  AdjustVolumeOpSchema,
  RotateClipOpSchema,
  DuckAudioOpSchema,
  NormalizeAudioOpSchema,
  AddTransitionOpSchema,
  BeatAlignOpSchema,
  ChangeSpeedOpSchema,
  FreezeFrameOpSchema,
  AddImageOpSchema,
  AddTextOpSchema,
  RemoveItemOpSchema,
  FadeClipAudioOpSchema,
  AddStickerOpSchema,
  AddNarrationOpSchema,
  CleanVoiceOpSchema,
  SpeedRampOpSchema,
  ProcessFootageOpSchema,
  ApplyFilterOpSchema,
  DetachAudioOpSchema,
  SelectTakeOpSchema,
  ReorderSegmentOpSchema,
  AutoSoundDesignOpSchema,
  AddSoundEffectOpSchema,
  CleanFillersOpSchema,
  AsynchronousSplitOpSchema,
  RemoveSilencesOpSchema,
  AutoCaptionsOpSchema,
  ClearCaptionsOpSchema,
  AddBackgroundMusicOpSchema,
]);

export type CreativeOperation = z.infer<typeof CreativeOperationSchema>;

/**
 * Intermediate Creative Edit Plan
 */
export const CreativeEditPlanSchema = z.object({
  version: z.literal("1.0.0").default("1.0.0"),
  intent: CreativeIntentSchema,
  constraints: UserConstraintsSchema.default({
    doNotRemoveIntro: false,
    keepEnding: false,
    protectedTimeRanges: [],
    doNotAddMusic: false,
    useUploadedBrollOnly: true,
    lockedTrackIds: [],
    preserveVoiceAudio: true,
  }),
  target: z.string().optional(),
  selectedSegments: z.array(z.object({ startSec: z.number(), durationSec: z.number() })).default([]),
  removedSegments: z.array(z.object({ startSec: z.number(), durationSec: z.number(), reason: z.string() })).default([]),
  reorderedSegments: z.array(z.object({ originalStartSec: z.number(), newStartSec: z.number(), durationSec: z.number() })).default([]),
  brollPlan: z.array(z.object({ assetId: z.string(), startSec: z.number(), durationSec: z.number(), topic: z.string() })).default([]),
  captionPlan: z.array(z.object({ startSec: z.number(), durationSec: z.number(), text: z.string() })).default([]),
  operations: z.array(CreativeOperationSchema).default([]),
  confidence: z.number().min(0).max(1).default(0.9),
  explanation: z.string(),
  requiresConfirmation: z.boolean().default(false),
  confirmationDetails: z
    .object({
      whatFound: z.string(),
      whatWillChange: z.string(),
      assumptions: z.string(),
    })
    .optional(),
});

export type CreativeEditPlan = z.infer<typeof CreativeEditPlanSchema>;

/**
 * Conversational Project Memory & State
 */
export const DirectorStateSchema = z.object({
  intent: CreativeIntentSchema,
  preferences: z.record(z.any()).default({}),
  constraints: UserConstraintsSchema,
  priorDecisions: z.array(z.string()).default([]),
  currentStyle: z.string().default("MRBEAST_FAST"),
  currentTarget: z.string().default("instagram_reel"),
  appliedOperations: z.array(z.string()).default([]),
});

export type DirectorState = z.infer<typeof DirectorStateSchema>;

/**
 * Timeline Context (Sent compactly to AI Planner)
 */
export const TimelineContextSchema = z.object({
  projectDurationSec: z.number().nonnegative(),
  tracksCount: z.number().int().nonnegative(),
  clipsCount: z.number().int().nonnegative(),
  assetIds: z.array(z.string()),
  selectedRange: z
    .object({
      startSec: z.number().nonnegative(),
      endSec: z.number().nonnegative(),
      trackIds: z.array(z.string()),
      clipIds: z.array(z.string()),
    })
    .optional(),
  selectedClipId: z.string().nullable().optional(),
  currentAspect: z.enum(["16:9", "9:16", "1:1", "4:5"]),
  currentResolution: z.object({ width: z.number(), height: z.number() }),
  currentPlayheadSec: z.number().nonnegative(),
  existingCaptionsCount: z.number().int().nonnegative().default(0),
  existingEffects: z.array(z.string()).default([]),
  existingAudioTracks: z.array(z.string()).default([]),
  lockedTrackIds: z.array(z.string()).default([]),
  userConstraints: UserConstraintsSchema,
  directorPreferences: z.record(z.any()).default({}),
});

export type TimelineContext = z.infer<typeof TimelineContextSchema>;
