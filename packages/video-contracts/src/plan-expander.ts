import { CreativeEditPlan, CreativeOperation } from "./creative-plan.schema";
import { MediaIntelligenceGraph, TranscriptWordIntelligence, ClassifiedSilence, FaceTrack, MusicBeatTrack } from "./media-intelligence.schema";
import { EditIR } from "./edit-ir.schema";
import { RationalTimeMath } from "./time";
import { resolveCaptionTemplate } from "./caption-templates";
import { captionKeywordIndex } from "./caption-enhance";
import { MediaGraphBuilder } from "./media-graph";
import { MobileMediaDescriptor, MobileFaceSample, mapSourceToTimeline, dominantFaceCenter, cropFor } from "./mobile-edit-ir";

/**
 * PlanExpander turns high-level, transcript-driven operations (removeSilences, cleanFillers,
 * autoCaptions) into concrete primitive operations the EditIRCompiler executes.
 * The graph passed in must be in CURRENT TIMELINE coordinates (see graphFromMobileMedia).
 */
const SILENCE_REASON = /\b(pause|pauses|silen\w*|dead air|quiet|throat|breath\w*|gap|lull|hesitat\w*)\b/i;
const NOT_SILENCE_REASON = /\b(question|interviewer|host|filler|um|uh|you know|repeat\w*|tangent|off[- ]topic|mistake|stumble|retake|section|segment|intro)\b/i;

/**
 * Sticker spots used by the editor (canvas fractions): upper corners, then mid sides (captions sit lower, ~0.7).
 * Returns the one farthest from [face].
 */
export const STICKER_SPOTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0.74, y: 0.22 },
  { x: 0.26, y: 0.22 },
  { x: 0.78, y: 0.46 },
  { x: 0.22, y: 0.46 },
];
export function stickerSpotAwayFrom(face: { x: number; y: number }): { x: number; y: number } {
  let best = STICKER_SPOTS[0];
  let bestD = -1;
  for (const p of STICKER_SPOTS) {
    const d = (p.x - face.x) ** 2 + (p.y - face.y) ** 2;
    if (d > bestD + 1e-9) {
      best = p;
      bestD = d;
    }
  }
  return { ...best };
}

const PHRASE_FILLERS = ["you know", "i mean"];

export class PlanExpander {
  /**
   * `opts.canvas` is the output size the plan renders at: FACE zooms are centred on the detected
   * face (graph.faces), converted from source-frame to canvas coordinates through the fill crop.
   */
  static expand(
    plan: CreativeEditPlan,
    graph: MediaIntelligenceGraph,
    warnings: string[] = [],
    opts: { canvas?: { width: number; height: number } } = {}
  ): CreativeEditPlan {
    const out: CreativeOperation[] = [];
    for (const op of plan.operations) {
      switch (op.type) {
        case "beatAlign": {
          const beats = graph.beats?.beatTimestamps ?? [];
          if (beats.length === 0) warnings.push("beatAlign: no beat analysis for this video, so cuts were not moved");
          out.push({ ...op, beatsSec: beats });
          break;
        }
        case "addSticker": {
          // Default spot: the free corner farthest from the speaker's face (a real run put it on her face).
          const face = op.position ? null : PlanExpander.faceZoomCenter(graph, op.timelineStartSec, op.timelineStartSec + (op.durationSec ?? 2.5), opts.canvas);
          out.push(face ? { ...op, position: stickerSpotAwayFrom(face) } : op);
          break;
        }
        case "removeRange": {
          out.push(...PlanExpander.speechSafeCut(op, graph, warnings));
          break;
        }
        case "removeSilences": {
          const cuts = this.silenceCuts(graph, op.minDurationSec, op.paddingSec);
          if (cuts.length === 0) {
            warnings.push(graph.silences.length === 0
              ? "removeSilences: no silence data (send media.silences or a transcript)"
              : `removeSilences: no pauses of ${op.minDurationSec}s or longer were found`);
          }
          out.push(...cuts);
          break;
        }
        case "cleanFillers": {
          // The creator asked for filler words gone: the phrase fillers the transcript actually has ("you know",
          // "I mean") go too, the same as the manual editor's Clean up tool (a real run kept four "you know"s).
          const cuts = this.fillerCuts(graph, [...new Set([...op.fillerTypes, ...PHRASE_FILLERS])]);
          if (graph.transcript.length === 0) warnings.push("cleanFillers: no transcript supplied");
          out.push(...cuts, op);
          break;
        }
        case "autoCaptions": {
          if (graph.transcript.length === 0) {
            warnings.push("autoCaptions: no transcript supplied, so captions were skipped");
            break;
          }
          out.push({ type: "clearCaptions" }, ...this.captionOps(graph.transcript, op));
          break;
        }
        case "addZoom": {
          const face = (op.targetType ?? "FACE") === "FACE" ? this.faceZoomCenter(graph, op.startSec, op.startSec + op.durationSec, opts.canvas) : null;
          out.push(face ? { ...op, targetCoords: face } : op);
          break;
        }
        default:
          out.push(op);
      }
    }
    return { ...plan, operations: out };
  }

  /**
   * Canvas point of the speaker's face during [startSec, endSec] (timeline): the median of the face
   * samples in that window (else the clip-wide dominant face), mapped through the fill crop that
   * toMobileEditIR centres on the dominant face. Null when there is no face track.
   */
  static faceZoomCenter(
    graph: MediaIntelligenceGraph,
    startSec: number,
    endSec: number,
    canvas?: { width: number; height: number }
  ): { x: number; y: number } | null {
    const track = graph.faces[0];
    if (!track) return null;
    const inWindow = track.samples.filter((s) => s.timeSeconds >= startSec - 0.25 && s.timeSeconds <= endSec + 0.25);
    const med = (v: number[]) => {
      const a = [...v].sort((p, q) => p - q);
      const m = a.length >> 1;
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    };
    let x = inWindow.length ? med(inWindow.map((s) => s.x)) : track.averageCoords.x;
    let y = inWindow.length ? med(inWindow.map((s) => s.y)) : track.averageCoords.y;
    const { width: srcW, height: srcH } = graph.technicalMetadata;
    const crop = canvas && srcW > 0 && srcH > 0
      ? cropFor(srcW, srcH, canvas.width, canvas.height, track.averageCoords.x, track.averageCoords.y)
      : null;
    if (crop) {
      x = (x - crop.x) / crop.width;
      y = (y - crop.y) / crop.height;
    }
    const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
    return { x: c(x), y: c(y) };
  }

  /**
   * A cut the model labels as a pause / silence / dead air must not remove words: models misjudge where speech is
   * (a real run trimmed the speaker's first line as "dead air"). Such a cut keeps only the gaps between words
   * (≥ 0.15 s, 40 ms padding). Cuts with any other reason (a question, a filler, a section) are left alone.
   */
  static speechSafeCut(
    op: Extract<CreativeOperation, { type: "removeRange" }>,
    graph: MediaIntelligenceGraph,
    warnings: string[]
  ): CreativeOperation[] {
    const reason = op.reason || "";
    if (!SILENCE_REASON.test(reason) || NOT_SILENCE_REASON.test(reason)) return [op];
    const start = op.startSec;
    const end = op.startSec + op.durationSec;
    const inside = graph.transcript.filter((w) => w.endSeconds > start + 0.02 && w.startSeconds < end - 0.02);
    if (inside.length === 0) return [op];
    const pad = 0.04;
    const gaps: Array<[number, number]> = [];
    let cursor = start;
    for (const w of inside) {
      if (w.startSeconds - pad - cursor >= 0.15) gaps.push([cursor, w.startSeconds - pad]);
      cursor = Math.max(cursor, w.endSeconds + pad);
    }
    if (end - cursor >= 0.15) gaps.push([cursor, end]);
    warnings.push(`removeRange ${start.toFixed(2)}s-${end.toFixed(2)}s ("${reason.slice(0, 60)}") covered ${inside.length} spoken word(s); only the silence around them was cut`);
    return gaps.map(([a, b]) => ({ ...op, startSec: round3(a), durationSec: round3(b - a) }));
  }

  static silenceCuts(graph: MediaIntelligenceGraph, minDurationSec: number, paddingSec: number): CreativeOperation[] {
    const total = graph.technicalMetadata.durationSeconds;
    const ops: CreativeOperation[] = [];
    for (const s of graph.silences) {
      if (s.durationSeconds < minDurationSec) continue;
      const atStart = s.startSeconds <= 0.05;
      const atEnd = s.startSeconds + s.durationSeconds >= total - 0.05;
      const start = atStart ? 0 : s.startSeconds + paddingSec;
      const end = atEnd ? total : s.startSeconds + s.durationSeconds - paddingSec;
      if (end - start < 0.1) continue;
      ops.push({
        type: "removeRange",
        startSec: round3(start),
        durationSec: round3(end - start),
        ripple: true,
        reason: atStart ? "leading silence" : atEnd ? "trailing silence" : `pause (${s.durationSeconds.toFixed(2)}s)`,
      });
    }
    return ops;
  }

  static fillerCuts(graph: MediaIntelligenceGraph, fillerTypes: string[]): CreativeOperation[] {
    const words = graph.transcript;
    // Unicode-aware: keep letters, combining marks, digits and apostrophes (curly ones folded to ').
    const norm = (w: string) => w.normalize("NFC").toLowerCase().replace(/[‘’ʼ]/gu, "'").replace(/[^\p{L}\p{M}\p{N}']/gu, "");
    const patterns = fillerTypes.map((f) => f.toLowerCase().split(/\s+/).map(norm)).filter((p) => p.length > 0 && p[0]);
    const ops: CreativeOperation[] = [];
    for (let i = 0; i < words.length; i++) {
      for (const pat of patterns) {
        if (i + pat.length > words.length) continue;
        if (!pat.every((p, k) => norm(words[i + k].word) === p)) continue;
        const first = words[i];
        const last = words[i + pat.length - 1];
        // Extend into the following gap (up to 150ms) so the cut lands in silence.
        const next = words[i + pat.length];
        const end = next ? Math.min(next.startSeconds, last.endSeconds + 0.15) : last.endSeconds;
        ops.push({
          type: "removeRange",
          startSec: round3(first.startSeconds),
          durationSec: round3(Math.max(0.05, end - first.startSeconds)),
          ripple: true,
          reason: `filler word "${pat.join(" ")}"`,
        });
        i += pat.length - 1;
        break;
      }
    }
    return ops;
  }

  static captionOps(words: TranscriptWordIntelligence[], op: Extract<CreativeOperation, { type: "autoCaptions" }>): CreativeOperation[] {
    const ops: CreativeOperation[] = [];
    let chunk: TranscriptWordIntelligence[] = [];
    // Explicit op values win, then the template's, then the classic defaults.
    const tpl = resolveCaptionTemplate(op.template);
    const textColor = op.textColor ?? tpl?.style.textColor ?? "#FFFFFF";
    const highlightColor = op.highlightColor ?? tpl?.style.highlightColor ?? "#FFE600";
    const uppercase = op.uppercase ?? tpl?.style.uppercase ?? false;
    const animation = op.animation ?? tpl?.style.animation ?? "word_pop";
    const flush = () => {
      if (chunk.length === 0) return;
      const start = chunk[0].startSeconds;
      const end = Math.max(chunk[chunk.length - 1].endSeconds, start + 0.3);
      // Auto emphasis: one key word per caption, unless the transcript already marks one.
      const key = op.autoEmphasis !== false && !chunk.some((w) => w.isEmphasis) ? captionKeywordIndex(chunk.map((w) => w.word)) : null;
      const shown = chunk.map((w) => (uppercase ? w.word.toUpperCase() : w.word));
      const text = shown.join(" ");
      ops.push({
        type: "addCaption",
        startSec: round3(start),
        durationSec: round3(end - start),
        text,
        textColor,
        highlightColor,
        stylePreset: op.stylePreset,
        ...(tpl ? { template: tpl.id } : {}),
        words: chunk.map((w, i) => ({
          word: shown[i],
          startSec: round3(w.startSeconds),
          endSec: round3(Math.max(w.endSeconds, w.startSeconds + 0.02)),
          highlight: !!w.isEmphasis || i === key,
          scale: animation === "word_pop" ? 1.15 : 1.0,
          ...(w.isEmphasis || i === key ? { color: highlightColor } : {}),
        })),
        ...(op.fontSize ? { fontSize: op.fontSize } : {}),
        ...(op.position ? { position: op.position } : {}),
        uppercase,
        animation,
        ...(op.strokeColor ? { strokeColor: op.strokeColor } : {}),
        ...(op.strokeWidth !== undefined ? { strokeWidth: op.strokeWidth } : {}),
        ...(op.background ? { background: op.background } : {}),
      } as CreativeOperation);
      chunk = [];
    };
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const prev = chunk[chunk.length - 1];
      if (prev && (w.startSeconds - prev.endSeconds > 0.6 || /[.!?。！？।؟]$/u.test(prev.word))) flush();
      chunk.push(w);
      if (chunk.length >= op.wordsPerCaption) flush();
    }
    flush();
    return ops;
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Builds a MediaIntelligenceGraph for a mobile client's clip, expressed in the CURRENT timeline
 * coordinates of `editIR` (source moments that were already cut away are dropped).
 * Silences come from the client, or are derived from transcript gaps (>= 0.5s) when omitted.
 */
export function graphFromMobileMedia(media: MobileMediaDescriptor, editIR: EditIR): MediaIntelligenceGraph {
  const assetId = media.assetId || "primary";
  const timelineDur = RationalTimeMath.toSeconds(editIR.meta.totalDuration);
  const srcDur = media.durationMs / 1000;
  const srcWords = (media.transcript?.words || [])
    .filter((w) => w.text.trim() && w.endMs >= w.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  // Emphasis heuristic identical to the server transcriber: noticeably longer-than-median words.
  const durs = srcWords.map((w) => w.endMs - w.startMs).filter((d) => d > 0).sort((a, b) => a - b);
  const median = durs.length ? durs[Math.floor(durs.length / 2)] : 0;

  const words: TranscriptWordIntelligence[] = [];
  srcWords.forEach((w, idx) => {
    const s = mapSourceToTimeline(editIR, assetId, w.startMs / 1000);
    const e = mapSourceToTimeline(editIR, assetId, w.endMs / 1000);
    if (s == null || e == null || e < s) return;
    const d = w.endMs - w.startMs;
    const isEmphasis = median > 0 && d > median * 1.6 && w.text.replace(/[^\p{L}\p{M}\p{N}]/gu, "").length > 3;
    words.push({
      id: `w_${idx}`,
      word: w.text.trim(),
      startSeconds: round3(s),
      endSeconds: round3(e),
      confidence: 0.95,
      isEmphasis,
      emphasisScore: isEmphasis ? 0.8 : 0.2,
      energyScore: 0.5,
    });
  });

  let srcSilences: Array<{ start: number; end: number }> = (media.silences || []).map((s) => ({ start: s.startMs / 1000, end: s.endMs / 1000 }));
  if (!media.silences && srcWords.length > 0) {
    const gaps: Array<{ start: number; end: number }> = [];
    if (srcWords[0].startMs >= 300) gaps.push({ start: 0, end: srcWords[0].startMs / 1000 });
    for (let i = 1; i < srcWords.length; i++) {
      const gap = srcWords[i].startMs - srcWords[i - 1].endMs;
      if (gap >= 500) gaps.push({ start: srcWords[i - 1].endMs / 1000, end: srcWords[i].startMs / 1000 });
    }
    const lastEnd = srcWords[srcWords.length - 1].endMs / 1000;
    if (srcDur - lastEnd >= 0.3) gaps.push({ start: lastEnd, end: srcDur });
    srcSilences = gaps;
  }

  const silences: ClassifiedSilence[] = [];
  srcSilences.forEach((g, idx) => {
    const s = mapSourceToTimeline(editIR, assetId, g.start);
    const e = mapSourceToTimeline(editIR, assetId, g.end);
    if (s == null || e == null || e - s < 0.1) return;
    const dur = e - s;
    const classification = s <= 0.05 ? "START_SILENCE" : e >= timelineDur - 0.05 ? "END_SILENCE" : dur >= 0.5 ? "DEAD_AIR" : "SHORT_NATURAL_PAUSE";
    silences.push({
      id: `sil_${idx}`,
      timeRange: { start: RationalTimeMath.fromSeconds(s), duration: RationalTimeMath.fromSeconds(dur) },
      startSeconds: round3(s),
      durationSeconds: round3(dur),
      averageDecibels: -45,
      classification,
      recommendation: classification === "SHORT_NATURAL_PAUSE" ? "KEEP" : "REMOVE",
      confidence: 0.9,
      contextReason: classification === "DEAD_AIR" ? "pause between phrases" : classification.toLowerCase().replace("_", " "),
    });
  });

  const faces = faceTrackFromMobile(media.faces, editIR, assetId);
  const beats = beatTrackFromMobile(media.beatsMs, editIR, assetId);

  return MediaGraphBuilder.build({
    assetId,
    technicalMetadata: {
      durationSeconds: timelineDur,
      width: media.width,
      height: media.height,
      fps: media.fps || 30,
      hasAudio: true,
      isVariableFrameRate: false,
      fileSizeBytes: 0,
      sha256Hash: "client-supplied",
    },
    transcript: words,
    silences,
    ...(faces ? { faces: [faces] } : {}),
    ...(beats ? { beats } : {}),
  });
}

/** The client face samples as one primary-speaker FaceTrack in timeline seconds (largest face per sample). */
function faceTrackFromMobile(samples: MobileFaceSample[] | undefined, editIR: EditIR, assetId: string): FaceTrack | null {
  const center = dominantFaceCenter(samples);
  if (!samples?.length || !center) return null;
  const largest = new Map<number, MobileFaceSample>();
  for (const f of samples) {
    const cur = largest.get(f.tMs);
    if (!cur || f.w * f.h > cur.w * cur.h) largest.set(f.tMs, f);
  }
  const points: FaceTrack["samples"] = [];
  for (const f of [...largest.values()].sort((a, b) => a.tMs - b.tMs)) {
    const t = mapSourceToTimeline(editIR, assetId, f.tMs / 1000);
    if (t == null) continue;
    points.push({ timeSeconds: round3(t), subjectId: "speaker_1", x: f.x, y: f.y, width: f.w, height: f.h, confidence: 0.9, isPrimarySpeaker: true });
  }
  return { subjectId: "speaker_1", label: "speaker_1", isPrimarySpeaker: true, averageCoords: center, samples: points };
}

/** Client beat times (source ms) as a MusicBeatTrack in timeline seconds; bpm from the median beat gap. */
function beatTrackFromMobile(beatsMs: number[] | undefined, editIR: EditIR, assetId: string): MusicBeatTrack | null {
  if (!beatsMs?.length) return null;
  const src = [...beatsMs].sort((a, b) => a - b);
  const beatTimestamps: number[] = [];
  for (const b of src) {
    const t = mapSourceToTimeline(editIR, assetId, b / 1000);
    if (t != null) beatTimestamps.push(round3(t));
  }
  const gaps = src.slice(1).map((b, i) => b - src[i]).filter((g) => g > 0).sort((a, b) => a - b);
  const gap = gaps.length ? gaps[gaps.length >> 1] : 0;
  const bpm = gap > 0 ? Math.round(60000 / gap) : 0;
  return {
    hasMusic: src.length >= 4,
    ...(bpm >= 40 && bpm <= 240 ? { bpm } : {}),
    confidence: src.length >= 8 ? 0.6 : 0.3,
    beatTimestamps,
    downbeatTimestamps: [],
    energyCurve: [],
  };
}
