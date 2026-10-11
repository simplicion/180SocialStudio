import {
  EditIR,
  VideoClip,
  CameraEvent,
  CaptionSegment,
  AudioTrack,
} from "./edit-ir.schema";
import {
  CreativeEditPlan,
  CreativeOperation,
  ORIGINAL_AUDIO_TRACK_ID,
  SPEED_RAMP_PRESETS,
} from "./creative-plan.schema";
import { RationalTimeMath } from "./time";
import { resolveCaptionTemplate } from "./caption-templates";
import { captionFontFor } from "./caption-enhance";
import { MediaAssetDescriptor } from "./project.schema";

/** Shortest piece of footage two neighbouring cuts may leave between them (matches the critic's micro-clip rule). */
const MIN_KEPT_SEC = 0.25;

export interface CompilationResult {
  updatedEditIR: EditIR;
  appliedOperations: string[];
  rejectedOperations: string[];
  actionBadges: string[];
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class EditIRCompiler {
  /**
   * Deterministically compiles high-level creative operations into concrete EditIR AST mutations.
   * Invariant: Never alters locked tracks, respects non-destructive undo snapshots.
   */
  static compile(
    baseIR: EditIR,
    plan: CreativeEditPlan,
    availableAssets: MediaAssetDescriptor[] = []
  ): CompilationResult {
    const updated: EditIR = JSON.parse(JSON.stringify(baseIR));
    const appliedOperations: string[] = [];
    const rejectedOperations: string[] = [];
    const actionBadges: string[] = [];

    // 1. Intent-level canvas + style
    if (plan.intent) {
      if (plan.intent.aspectRatio && plan.intent.aspectRatio !== updated.meta.targetAspect) {
        updated.meta.targetAspect = plan.intent.aspectRatio;
        updated.meta.resolution = EditIRCompiler.resolutionFor(plan.intent.aspectRatio);
        // Crops were computed for the old canvas: drop them so the renderer projection refits.
        EditIRCompiler.resetMainCrops(updated, false);
        actionBadges.push(`Canvas ${plan.intent.aspectRatio} (${updated.meta.resolution.width}x${updated.meta.resolution.height})`);
      }
      if (plan.intent.stylePreset) {
        updated.directorStyle.preset = plan.intent.stylePreset as any;
        if (plan.intent.energy === "high" || plan.intent.stylePreset === "MRBEAST_FAST") {
          updated.directorStyle.pacingMultiplier = 1.35;
          updated.directorStyle.zoomAggressiveness = 0.85;
        } else if (plan.intent.energy === "calm" || plan.intent.stylePreset === "ALI_ABDAAL_CLEAN") {
          updated.directorStyle.pacingMultiplier = 1.0;
          updated.directorStyle.zoomAggressiveness = 0.4;
        }
      }
    }

    /*
     * TIME SEMANTICS: every time in a plan refers to the timeline as it was BEFORE this plan
     * (`baseIR`). To honour that regardless of the order the planner emitted ops in:
     *   phase A - timeline-preserving ops (captions, zooms, b-roll, music, filters, reframe...) in order
     *   phase B - all cuts, merged and applied from the END backwards, rippling every other track
     *             (captions incl. per-word timings, zooms, overlays, audio)
     *   phase B2 - reorders (moveClip / reorderSegment), times mapped through the phase-B cuts
     *   phase C - speed changes (rescale the timeline)
     *   phase D - transitions (need the final cut boundaries)
     */
    const cutRanges: Array<{ start: number; end: number; reason: string }> = [];
    const speedOps: CreativeOperation[] = [];
    const transitionOps: CreativeOperation[] = [];
    const moveOps: CreativeOperation[] = [];
    const baseDurationSec = RationalTimeMath.toSeconds(baseIR.meta.totalDuration);

    for (const op of plan.operations) {
      try {
        switch (op.type) {
          case "removeRange": {
            const start = Math.max(0, op.startSec);
            const end = Math.min(baseDurationSec, op.startSec + op.durationSec);
            if (end - start <= 0.001) {
              rejectedOperations.push(`removeRange ${op.startSec.toFixed(2)}s (+${op.durationSec.toFixed(2)}s) is outside the timeline (${baseDurationSec.toFixed(2)}s)`);
            } else {
              cutRanges.push({ start, end, reason: op.reason });
            }
            break;
          }
          case "rippleDelete": {
            const clip = EditIRCompiler.mainTrack(updated)?.clips.find((c) => c.id === op.clipId);
            if (!clip) {
              rejectedOperations.push(`rippleDelete: clip ${op.clipId} not found`);
            } else {
              const start = RationalTimeMath.toSeconds(clip.timelineRange.start);
              cutRanges.push({ start, end: start + RationalTimeMath.toSeconds(clip.timelineRange.duration), reason: op.reason || `deleted clip ${op.clipId}` });
            }
            break;
          }
          case "trimClip": {
            // A trim is a ripple cut of the clip's head and/or tail, so every other track follows.
            const clip = EditIRCompiler.mainTrack(updated)?.clips.find((c) => c.id === op.clipId);
            if (!clip) {
              rejectedOperations.push(`trimClip: clip ${op.clipId} not found`);
              break;
            }
            const start = RationalTimeMath.toSeconds(clip.timelineRange.start);
            const dur = RationalTimeMath.toSeconds(clip.timelineRange.duration);
            const head = op.startTrimSec || 0;
            const tail = op.endTrimSec || 0;
            if (head <= 0 && tail <= 0) {
              rejectedOperations.push(`trimClip ${op.clipId}: nothing to trim (startTrimSec and endTrimSec are 0)`);
            } else if (head + tail > dur - 0.1) {
              rejectedOperations.push(`trimClip ${op.clipId}: trimming ${(head + tail).toFixed(2)}s would leave less than 0.1s of a ${dur.toFixed(2)}s clip (use rippleDelete to remove it)`);
            } else {
              if (head > 0) cutRanges.push({ start, end: start + head, reason: `trimmed ${head.toFixed(2)}s from the start of clip ${op.clipId}` });
              if (tail > 0) cutRanges.push({ start: start + dur - tail, end: start + dur, reason: `trimmed ${tail.toFixed(2)}s from the end of clip ${op.clipId}` });
            }
            break;
          }
          case "moveClip":
          case "reorderSegment":
            moveOps.push(op);
            break;
          case "rotateClip": {
            if (op.rotationDeg === undefined && op.flipH === undefined) {
              rejectedOperations.push("rotateClip: give rotationDeg and/or flipH");
              break;
            }
            const n = this.applyRotateClip(updated, op.clipId, op.rotationDeg, op.flipH);
            const what = [
              op.rotationDeg !== undefined ? `rotated to ${op.rotationDeg}°` : null,
              op.flipH !== undefined ? (op.flipH ? "mirrored" : "un-mirrored") : null,
            ].filter(Boolean).join(" and ");
            if (n === 0) rejectedOperations.push(`rotateClip: clip ${op.clipId} not found`);
            else appliedOperations.push(`${op.clipId === "all" ? "Whole video" : `Clip ${op.clipId}`} ${what}`);
            break;
          }
          case "changeSpeed":
            speedOps.push(op);
            break;
          case "addTransition":
            transitionOps.push(op);
            break;
          case "cleanFillers": {
            // Real filler cuts arrive as removeRange ops (PlanExpander / DeterministicPlanner).
            // On its own this op changes nothing, so never report it as applied without cuts.
            const hasFillerCuts = plan.operations.some((o) => o.type === "removeRange" && /filler/i.test(o.reason || ""));
            if (hasFillerCuts) actionBadges.push("Cleaned vocal fillers");
            else rejectedOperations.push("cleanFillers: no filler words found in the transcript (or no transcript supplied)");
            break;
          }
          case "splitClip": {
            const parts = this.applySplitClip(updated, op.clipId, op.splitTimeSec);
            if (parts) appliedOperations.push(`Split clip ${op.clipId} at ${op.splitTimeSec.toFixed(2)}s into ${parts[0]} and ${parts[1]}`);
            else rejectedOperations.push(`splitClip: clip ${op.clipId} not found, or ${op.splitTimeSec.toFixed(2)}s is not strictly inside it`);
            break;
          }
          case "reframeSubject": {
            this.applyReframe(updated, op.targetAspect, op.smoothingFactor);
            appliedOperations.push(`Re-framed subject for ${op.targetAspect}`);
            break;
          }
          case "changeAspectRatio": {
            const res = op.width && op.height ? { width: op.width, height: op.height } : EditIRCompiler.resolutionFor(op.targetAspect);
            updated.meta.targetAspect = op.targetAspect;
            updated.meta.resolution = res;
            const fit = op.mode === "fit";
            EditIRCompiler.resetMainCrops(updated, fit);
            if (op.background) updated.meta.background = op.background.toUpperCase();
            appliedOperations.push(`Changed canvas to ${op.targetAspect} (${res.width}x${res.height}), ${fit ? `whole frame fitted on ${updated.meta.background || "#000000"}` : "footage cropped to fill"}`);
            break;
          }
          case "addEffect": {
            this.applyAddEffect(updated, op);
            appliedOperations.push(`Added ${op.effect.replace("_", " ")} effect at ${op.startSec.toFixed(1)}s`);
            break;
          }
          case "addZoom": {
            this.applyAddZoom(updated, op);
            appliedOperations.push(`Added ${op.scale}x zoom at ${op.startSec.toFixed(1)}s for ${op.durationSec.toFixed(1)}s`);
            break;
          }
          case "clearCaptions": {
            const before = updated.tracks.captionTrack.length;
            updated.tracks.captionTrack = updated.tracks.captionTrack.filter((c) => c.role === "title");
            if (before > updated.tracks.captionTrack.length) {
              appliedOperations.push(`Replaced ${before - updated.tracks.captionTrack.length} existing caption(s)`);
            }
            break;
          }
          case "addCaption": {
            this.applyAddCaption(updated, op);
            appliedOperations.push(`Added kinetic caption at ${op.startSec.toFixed(1)}s: "${op.text}"`);
            break;
          }
          case "styleCaption": {
            if (updated.tracks.captionTrack.length === 0) {
              rejectedOperations.push("styleCaption: there are no captions to restyle");
              break;
            }
            this.applyStyleCaption(updated, op.preset, op.highlightColor, op.position);
            appliedOperations.push(`Styled captions with preset ${op.preset}`);
            break;
          }
          case "translateCaptions": {
            // Needs the AI provider: the mobile director removes this op and applies it after compiling.
            rejectedOperations.push("translateCaptions: caption translation is not available in this editor");
            break;
          }
          case "emphasizeWord": {
            this.applyEmphasizeWord(updated, op.captionId, op.wordIndex, op.color, op.scale);
            appliedOperations.push(`Emphasized word in caption ${op.captionId}`);
            break;
          }
          case "insertBroll": {
            const placed = this.applyInsertBroll(updated, op, availableAssets);
            if (placed) appliedOperations.push(`Inserted B-roll ${placed} at ${op.timelineStartSec.toFixed(1)}s for ${op.durationSec.toFixed(1)}s`);
            else rejectedOperations.push(`insertBroll at ${op.timelineStartSec.toFixed(1)}s: no asset, URL or stock query to source footage from`);
            break;
          }
          case "addBackgroundMusic": {
            this.applyBackgroundMusic(updated, op);
            appliedOperations.push(`Added background music ("${op.sourceUrl || op.query}") at ${op.volumeDb}dB${op.duckUnderSpeech ? `, ducked ${op.duckDb}dB under speech` : ""}`);
            break;
          }
          case "duckAudio": {
            const ducked = this.applyDuckAudio(updated, op.duckDb, op.attackMs, op.releaseMs);
            if (ducked === 0) rejectedOperations.push("duckAudio: there is no music/SFX track to duck (add background music first)");
            else appliedOperations.push(`Ducked ${ducked} music/SFX track(s) by ${op.duckDb}dB under speech`);
            break;
          }
          case "adjustVolume": {
            const target = this.applyAdjustVolume(updated, op.trackId, op.volumeDb);
            if (target) appliedOperations.push(`Set ${target} volume to ${op.volumeDb}dB`);
            else rejectedOperations.push(`adjustVolume: no audio track "${op.trackId}" (use "original" for the video's own sound, or "music" when background music exists)`);
            break;
          }
          case "applyFilter": {
            this.applyFilter(updated, op);
            appliedOperations.push(`Applied visual filter ${op.preset || "custom"} (brightness=${op.brightness ?? 1.0}, contrast=${op.contrast ?? 1.0}, saturation=${op.saturation ?? 1.0})`);
            break;
          }
          case "detachAudio": {
            this.applyDetachAudio(updated, op.clipId);
            appliedOperations.push(`Detached clip audio into separate audio track`);
            break;
          }
          case "autoSoundDesign": {
            this.applySoundDesign(updated, op);
            appliedOperations.push(`Synthesized sound effects (whooshes, pops)`);
            break;
          }
          case "addSoundEffect": {
            this.applyAddSoundEffect(updated, op);
            appliedOperations.push(`Placed ${op.sfxType || "sound"} effect at ${op.timelineStartSec.toFixed(2)}s`);
            break;
          }
          case "asynchronousSplit": {
            this.applyAsynchronousSplit(updated, op.clipId, op.splitType, op.offsetSec);
            appliedOperations.push(`Applied ${op.splitType} with ${op.offsetSec}s offset`);
            break;
          }
          case "beatAlign": {
            // Cut points move back to the last beat before them (a ripple trim of each clip's tail). Beats come
            // from the footage's own audio, so they travel with the footage when earlier cuts shift it.
            const trims = this.beatAlignCuts(updated, op.beatsSec ?? [], op.snapToleranceSec);
            if (!op.beatsSec?.length) rejectedOperations.push("beatAlign: no beat analysis for this video, so cuts were not moved");
            else if (trims.length === 0) rejectedOperations.push(`beatAlign: no cut is within ${op.snapToleranceSec}s after a beat`);
            else {
              cutRanges.push(...trims);
              appliedOperations.push(`Moved ${trims.length} cut(s) onto the beat`);
            }
            break;
          }
          case "addText": {
            this.applyAddText(updated, op);
            appliedOperations.push(`Added title/lower-third text: "${op.text}"`);
            break;
          }
          case "processFootage": {
            const clip =
              op.action === "remove_background"
                ? updated.tracks.videoTracks.filter((t) => t.type !== "MAIN_VIDEO").flatMap((t) => t.clips).find((c) => c.id === op.targetId)
                : EditIRCompiler.mainTrack(updated)?.clips.find((c) => c.id === op.targetId);
            if (!clip) {
              rejectedOperations.push(`processFootage: no ${op.action === "remove_background" ? "overlay" : "main clip"} "${op.targetId}"`);
              break;
            }
            if (op.action === "remove_background" && clip.mediaType !== "image" && !clip.layer) {
              // A cut-out must float above the video.
              clip.layer = { mode: "overlay", x: 0.5, y: 0.5, scale: 1, rotation: 0 };
              clip.fit = "contain";
            }
            clip.process = op.action;
            appliedOperations.push(`Queued ${op.action.replace("_", " ")} for ${op.targetId} (runs on the phone)`);
            break;
          }
          case "speedRamp": {
            const parts = this.applySpeedRampSplits(updated, op.clipId, op.preset);
            if (!parts) {
              rejectedOperations.push(`speedRamp: clip ${op.clipId} not found or too short to ramp`);
              break;
            }
            const base = EditIRCompiler.mainTrack(updated)?.clips.find((c) => c.id === parts[0].id)?.speedMultiplier ?? 1;
            for (const p of parts) speedOps.push({ type: "changeSpeed", clipId: p.id, speedMultiplier: Math.min(4, Math.max(0.25, base * p.speed)) } as any);
            appliedOperations.push(`Speed ramp "${op.preset}" on clip ${op.clipId} (${parts.map((p) => `${p.speed}x`).join(" → ")})`);
            break;
          }
          case "cleanVoice": {
            const main = EditIRCompiler.mainTrack(updated)?.clips ?? [];
            let n = 0;
            for (const c of main) {
              if (op.clipId !== "all" && c.id !== op.clipId) continue;
              if (op.enabled) c.voiceCleanup = true;
              else delete c.voiceCleanup;
              n++;
            }
            if (n > 0) appliedOperations.push(`${op.enabled ? "Reduced background noise on" : "Turned off noise reduction for"} ${n} clip(s)`);
            else rejectedOperations.push(`cleanVoice: no main clip "${op.clipId}"`);
            break;
          }
          case "addNarration": {
            const placed = this.applyAddNarration(updated, op);
            if (placed) appliedOperations.push(`Added AI narration at ${op.timelineStartSec.toFixed(1)}s: "${op.text}"`);
            else rejectedOperations.push(`addNarration: ${op.timelineStartSec.toFixed(1)}s is past the end of the video`);
            break;
          }
          case "addSticker": {
            const placed = this.applyAddSticker(updated, op);
            if (placed) appliedOperations.push(`Added ${op.emoji} sticker at ${op.timelineStartSec.toFixed(1)}s`);
            else rejectedOperations.push(`addSticker ${op.emoji}: ${op.timelineStartSec.toFixed(1)}s is past the end of the video`);
            break;
          }
          case "fadeClipAudio": {
            const n = this.applyFadeClipAudio(updated, op);
            if (n > 0) appliedOperations.push(`Faded clip audio in ${op.fadeInSec}s / out ${op.fadeOutSec}s on ${n} clip(s)`);
            else rejectedOperations.push(`fadeClipAudio: no main clip "${op.clipId}"`);
            break;
          }
          case "removeItem": {
            const n = this.applyRemoveItem(updated, op);
            const which = op.id ? ` "${op.id}"` : typeof op.atSec === "number" ? ` at ${op.atSec.toFixed(1)}s` : "";
            if (n > 0) appliedOperations.push(`Removed ${n} ${op.kind} item(s)${which}`);
            else rejectedOperations.push(`removeItem: no ${op.kind}${which} on the timeline`);
            break;
          }
          default:
            // Never report an operation as done when the compiler has no implementation for it.
            rejectedOperations.push(`Operation ${(op as any).type} is not supported by the timeline compiler yet`);
        }
      } catch (err: any) {
        rejectedOperations.push(`Failed to compile operation ${op.type}: ${err?.message}`);
      }
    }

    // Phase B: cuts. Two cuts that leave a sliver between them (< MIN_KEPT_SEC, e.g. a pause cut next to a filler
    // cut) would flash a few frames on screen: the sliver is cut too.
    const merged: Array<{ start: number; end: number; reason: string }> = [];
    for (const r of EditIRCompiler.mergeRanges(cutRanges)) {
      const prev = merged[merged.length - 1];
      const gap = prev ? r.start - prev.end : Infinity;
      if (prev && gap < MIN_KEPT_SEC) {
        prev.end = Math.max(prev.end, r.end);
        prev.reason = `${prev.reason}; ${r.reason} (and the ${Math.round(gap * 1000)} ms sliver between them)`;
      } else {
        merged.push({ ...r });
      }
    }
    let removedTotal = 0;
    for (let i = merged.length - 1; i >= 0; i--) {
      const r = merged[i];
      try {
        this.applyRemoveRange(updated, r.start, r.end - r.start, true);
        removedTotal += r.end - r.start;
        appliedOperations.push(`Removed range ${r.start.toFixed(2)}s - ${r.end.toFixed(2)}s: ${r.reason}`);
      } catch (err: any) {
        rejectedOperations.push(`Failed to remove ${r.start.toFixed(2)}s - ${r.end.toFixed(2)}s: ${err?.message}`);
      }
    }
    if (merged.length > 0) actionBadges.push(`Cut ${merged.length} range(s), ${removedTotal.toFixed(1)}s total`);

    // Phase B2: reorders. Their times refer to the pre-cut timeline, so map them through the cuts.
    const cutMap = (t: number) => {
      let removed = 0;
      for (const r of merged) {
        if (t >= r.end) removed += r.end - r.start;
        else if (t > r.start) removed += t - r.start;
      }
      return Math.max(0, t - removed);
    };
    for (const op of moveOps) {
      try {
        if (op.type === "moveClip") {
          const clip = EditIRCompiler.mainTrack(updated)?.clips.find((c) => c.id === op.clipId);
          if (!clip) {
            rejectedOperations.push(`moveClip: clip ${op.clipId} not found (or it was cut/split by another change in this request; move it in a separate request)`);
            continue;
          }
          const s = RationalTimeMath.toSeconds(clip.timelineRange.start);
          const e = s + RationalTimeMath.toSeconds(clip.timelineRange.duration);
          const r = this.applyMoveRange(updated, s, e, cutMap(op.targetTimelineStartSec));
          if (r.ok) appliedOperations.push(`Moved clip ${op.clipId} to ${r.newStartSec.toFixed(2)}s`);
          else rejectedOperations.push(`moveClip ${op.clipId}: ${r.reason}`);
        } else if (op.type === "reorderSegment") {
          const s = cutMap(op.segmentStartSec);
          const e = cutMap(op.segmentStartSec + op.segmentDurationSec);
          const r = this.applyMoveRange(updated, s, e, cutMap(op.newStartSec));
          if (r.ok) appliedOperations.push(`Moved ${op.segmentStartSec.toFixed(2)}s-${(op.segmentStartSec + op.segmentDurationSec).toFixed(2)}s to ${r.newStartSec.toFixed(2)}s`);
          else rejectedOperations.push(`reorderSegment ${op.segmentStartSec.toFixed(2)}s+${op.segmentDurationSec.toFixed(2)}s: ${r.reason}`);
        }
      } catch (err: any) {
        rejectedOperations.push(`Failed to move: ${err?.message}`);
      }
    }

    // Phase C: speed
    for (const op of speedOps) {
      if (op.type !== "changeSpeed") continue;
      try {
        const ok = this.applyChangeSpeed(updated, op.clipId, op.speedMultiplier);
        if (ok) appliedOperations.push(`Changed speed of ${op.clipId === "all" ? "the whole video" : `clip ${op.clipId}`} to ${op.speedMultiplier}x`);
        else rejectedOperations.push(`changeSpeed: clip ${op.clipId} not found`);
      } catch (err: any) {
        rejectedOperations.push(`Failed to change speed: ${err?.message}`);
      }
    }

    // Phase D: transitions
    for (const op of transitionOps) {
      if (op.type !== "addTransition") continue;
      const n = this.applyTransitions(updated, op.fromClipId, op.toClipId, op.transitionType, op.durationSec);
      if (n > 0) appliedOperations.push(`Added ${op.transitionType} transition at ${n} cut(s)`);
      else rejectedOperations.push(`addTransition: the timeline has no cuts to put a ${op.transitionType} on`);
    }

    const count = (t: string) => plan.operations.filter((o) => o.type === t).length;
    if (count("addZoom") > 0) actionBadges.push(`${count("addZoom")} zoom punch-in(s)`);
    if (count("addCaption") > 0) actionBadges.push(`${count("addCaption")} kinetic caption(s)`);
    if (count("insertBroll") > 0) actionBadges.push(`${count("insertBroll")} B-roll insert(s)`);
    if (count("addBackgroundMusic") > 0) actionBadges.push("Background music");
    if (count("duckAudio") > 0) actionBadges.push("Speech-ducked music");
    if (count("applyFilter") > 0) actionBadges.push("Colour filter");

    return { updatedEditIR: updated, appliedOperations, rejectedOperations, actionBadges };
  }

  static mainTrack(editIR: EditIR) {
    return editIR.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO") || editIR.tracks.videoTracks[0];
  }

  /**
   * Forgets main-track crops (they were computed for another canvas / orientation) so the
   * renderer projection recomputes a fill crop. `letterbox` true = fit the whole frame instead.
   */
  static resetMainCrops(editIR: EditIR, letterbox: boolean) {
    for (const clip of EditIRCompiler.mainTrack(editIR)?.clips || []) {
      if (!clip.transform) continue;
      delete clip.transform.crop;
      if (letterbox) clip.transform.letterbox = true;
      else delete clip.transform.letterbox;
    }
  }

  private static uniqueClipId(editIR: EditIR, base: string): string {
    const taken = new Set(editIR.tracks.videoTracks.flatMap((t) => t.clips.map((c) => c.id)));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  }

  static resolutionFor(aspect: "16:9" | "9:16" | "1:1" | "4:5"): { width: number; height: number } {
    switch (aspect) {
      case "9:16": return { width: 1080, height: 1920 };
      case "1:1": return { width: 1080, height: 1080 };
      case "4:5": return { width: 1080, height: 1350 };
      default: return { width: 1920, height: 1080 };
    }
  }

  static mergeRanges(ranges: Array<{ start: number; end: number; reason: string }>) {
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const out: Array<{ start: number; end: number; reason: string }> = [];
    for (const r of sorted) {
      const last = out[out.length - 1];
      if (last && r.start <= last.end + 0.02) {
        if (r.end > last.end) last.end = r.end;
        if (!last.reason.includes(r.reason)) last.reason = `${last.reason}; ${r.reason}`;
      } else {
        out.push({ ...r });
      }
    }
    return out;
  }

  /**
   * Re-times every non-main-track element through `map` (old timeline sec -> new timeline sec).
   */
  static remapSecondaryTracks(editIR: EditIR, map: (t: number) => number, oldTotalSec: number, minSec = 0.05) {
    const newTotalSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);
    const mapRange = (startSec: number, durSec: number) => {
      const s = map(startSec);
      const e = map(startSec + durSec);
      return { s, d: Math.max(0, e - s) };
    };

    editIR.tracks.cameraTrack = editIR.tracks.cameraTrack.flatMap((c) => {
      const { s, d } = mapRange(RationalTimeMath.toSeconds(c.timeRange.start), RationalTimeMath.toSeconds(c.timeRange.duration));
      if (d < 0.2) return [];
      return [{ ...c, timeRange: { start: RationalTimeMath.fromSeconds(s), duration: RationalTimeMath.fromSeconds(d) } }];
    });

    if (editIR.tracks.effectTrack) {
      editIR.tracks.effectTrack = editIR.tracks.effectTrack.flatMap((e) => {
        const { s, d } = mapRange(RationalTimeMath.toSeconds(e.timeRange.start), RationalTimeMath.toSeconds(e.timeRange.duration));
        if (d < 0.1) return [];
        return [{ ...e, timeRange: { start: RationalTimeMath.fromSeconds(s), duration: RationalTimeMath.fromSeconds(d) } }];
      });
    }

    editIR.tracks.captionTrack = editIR.tracks.captionTrack.flatMap((cap) => {
      const mapped = mapRange(RationalTimeMath.toSeconds(cap.timeRange.start), RationalTimeMath.toSeconds(cap.timeRange.duration));
      // A title is not footage: a cut moves it but does not shorten it (a real run left a 0.6 s title after the
      // opening pauses were cut). It keeps its length, within the new timeline.
      const { s, d } = cap.role === "title"
        ? { s: mapped.s, d: Math.min(RationalTimeMath.toSeconds(cap.timeRange.duration), Math.max(0, newTotalSec - mapped.s)) }
        : mapped;
      if (d < minSec) return [];
      const words = cap.words.flatMap((w) => {
        const ws = RationalTimeMath.toSeconds(w.start);
        const we = RationalTimeMath.toSeconds(w.end);
        const ns = map(ws);
        const ne = map(we);
        // A word whose span was (mostly) cut away is dropped rather than squashed to zero.
        if (ne - ns < Math.min(0.04, (we - ws) * 0.5)) return [];
        return [{ ...w, start: RationalTimeMath.fromSeconds(ns), end: RationalTimeMath.fromSeconds(ne) }];
      });
      if (cap.words.length > 0 && words.length === 0) return [];
      const text = cap.role === "title" || cap.words.length <= 1 ? cap.text : words.map((w) => w.word).join(" ");
      return [{ ...cap, text, words, timeRange: { start: RationalTimeMath.fromSeconds(s), duration: RationalTimeMath.fromSeconds(d) } }];
    });

    for (let tIdx = 1; tIdx < editIR.tracks.videoTracks.length; tIdx++) {
      const track = editIR.tracks.videoTracks[tIdx];
      track.clips = track.clips.flatMap((c) => {
        const { s, d } = mapRange(RationalTimeMath.toSeconds(c.timelineRange.start), RationalTimeMath.toSeconds(c.timelineRange.duration));
        if (d < 0.2) return [];
        return [{ ...c, timelineRange: { start: RationalTimeMath.fromSeconds(s), duration: RationalTimeMath.fromSeconds(d) } }];
      });
    }

    for (const aTrack of editIR.tracks.audioTracks) {
      aTrack.clips = aTrack.clips.flatMap((c) => {
        const startSec = RationalTimeMath.toSeconds(c.timelineRange.start);
        const durSec = RationalTimeMath.toSeconds(c.timelineRange.duration);
        if (aTrack.type === "BGM") {
          // Music is a continuous bed: keep it running, follow the timeline's new length.
          const s = map(startSec);
          const reachedEnd = startSec + durSec >= oldTotalSec - 0.05;
          const e = reachedEnd ? newTotalSec : Math.min(newTotalSec, map(startSec + durSec));
          if (e - s < 0.2) return [];
          return [{ ...c, timelineRange: { start: RationalTimeMath.fromSeconds(s), duration: RationalTimeMath.fromSeconds(e - s) } }];
        }
        const { s, d } = mapRange(startSec, durSec);
        if (d < minSec) return [];
        return [{ ...c, timelineRange: { start: RationalTimeMath.fromSeconds(s), duration: RationalTimeMath.fromSeconds(d) } }];
      });
    }
  }

  private static applyRemoveRange(editIR: EditIR, cutStartSec: number, cutDurationSec: number, ripple: boolean) {
    const mainTrack = editIR.tracks.videoTracks[0];
    if (!mainTrack || mainTrack.clips.length === 0) return;

    const oldTotalSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);
    const cutEndSec = cutStartSec + cutDurationSec;
    const newClips: VideoClip[] = [];
    let curTimelineOffset = 0;

    const sorted = [...mainTrack.clips].sort(
      (a, b) => RationalTimeMath.toSeconds(a.timelineRange.start) - RationalTimeMath.toSeconds(b.timelineRange.start)
    );

    for (const clip of sorted) {
      const clipStart = RationalTimeMath.toSeconds(clip.timelineRange.start);
      const clipDur = RationalTimeMath.toSeconds(clip.timelineRange.duration);
      const clipEnd = clipStart + clipDur;
      const speed = clip.speedMultiplier || 1;
      const srcStart = RationalTimeMath.toSeconds(clip.sourceRange.start);

      if (clipEnd <= cutStartSec || clipStart >= cutEndSec) {
        newClips.push({
          ...clip,
          timelineRange: { start: RationalTimeMath.fromSeconds(curTimelineOffset), duration: clip.timelineRange.duration },
        });
        curTimelineOffset += clipDur;
        continue;
      }

      if (cutStartSec > clipStart) {
        const leftDur = cutStartSec - clipStart;
        newClips.push({
          ...clip,
          id: generateUUID(),
          sourceRange: { start: clip.sourceRange.start, duration: RationalTimeMath.fromSeconds(leftDur * speed) },
          timelineRange: { start: RationalTimeMath.fromSeconds(curTimelineOffset), duration: RationalTimeMath.fromSeconds(leftDur) },
          transitionOut: undefined,
        });
        curTimelineOffset += leftDur;
      }

      if (cutEndSec < clipEnd) {
        const rightDur = clipEnd - cutEndSec;
        const srcOffset = srcStart + (cutEndSec - clipStart) * speed;
        newClips.push({
          ...clip,
          id: generateUUID(),
          sourceRange: { start: RationalTimeMath.fromSeconds(srcOffset), duration: RationalTimeMath.fromSeconds(rightDur * speed) },
          timelineRange: { start: RationalTimeMath.fromSeconds(curTimelineOffset), duration: RationalTimeMath.fromSeconds(rightDur) },
          transitionIn: undefined,
        });
        curTimelineOffset += rightDur;
      }
    }

    mainTrack.clips = newClips;
    editIR.meta.totalDuration = RationalTimeMath.fromSeconds(Math.max(0.1, curTimelineOffset));

    if (ripple) {
      const map = (t: number) => (t <= cutStartSec ? t : t >= cutEndSec ? t - cutDurationSec : cutStartSec);
      EditIRCompiler.remapSecondaryTracks(editIR, map, oldTotalSec);
    }
  }

  private static applyChangeSpeed(editIR: EditIR, clipId: string, speed: number): boolean {
    const mainTrack = editIR.tracks.videoTracks[0];
    if (!mainTrack || mainTrack.clips.length === 0) return false;
    const oldTotalSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);
    const clips = [...mainTrack.clips].sort(
      (a, b) => RationalTimeMath.toSeconds(a.timelineRange.start) - RationalTimeMath.toSeconds(b.timelineRange.start)
    );
    const all = clipId === "all" || clipId === "*" || clipId === "main_clip";
    const target = all ? null : clips.find((c) => c.id === clipId);
    if (!all && !target) return false;

    const pieces: Array<{ oldStart: number; oldEnd: number; newStart: number; factor: number }> = [];
    let cursor = 0;
    for (const clip of clips) {
      const oldStart = RationalTimeMath.toSeconds(clip.timelineRange.start);
      const oldDur = RationalTimeMath.toSeconds(clip.timelineRange.duration);
      const affected = all || clip === target;
      const newDur = affected ? oldDur / speed : oldDur;
      pieces.push({ oldStart, oldEnd: oldStart + oldDur, newStart: cursor, factor: newDur / Math.max(oldDur, 1e-9) });
      if (affected) clip.speedMultiplier = Math.round((clip.speedMultiplier || 1) * speed * 1000) / 1000;
      clip.timelineRange = { start: RationalTimeMath.fromSeconds(cursor), duration: RationalTimeMath.fromSeconds(newDur) };
      cursor += newDur;
    }
    mainTrack.clips = clips;
    editIR.meta.totalDuration = RationalTimeMath.fromSeconds(cursor);

    const map = (t: number) => {
      for (const p of pieces) {
        if (t <= p.oldEnd + 1e-9) return p.newStart + Math.max(0, t - p.oldStart) * p.factor;
      }
      const last = pieces[pieces.length - 1];
      return cursor + (t - last.oldEnd);
    };
    EditIRCompiler.remapSecondaryTracks(editIR, map, oldTotalSec);
    return true;
  }

  private static applyTransitions(editIR: EditIR, fromClipId: string, toClipId: string, type: any, durationSec: number): number {
    const mainTrack = editIR.tracks.videoTracks[0];
    if (!mainTrack || mainTrack.clips.length < 2) return 0;
    let n = 0;
    for (let i = 1; i < mainTrack.clips.length; i++) {
      const prev = mainTrack.clips[i - 1];
      const clip = mainTrack.clips[i];
      const matches = (fromClipId === "*" || fromClipId === prev.id) && (toClipId === "*" || toClipId === clip.id);
      if (!matches) continue;
      clip.transitionIn = { type, duration: RationalTimeMath.fromSeconds(durationSec) };
      n++;
    }
    return n;
  }

  private static applyBackgroundMusic(editIR: EditIR, op: any) {
    const totalSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);
    // One music bed: replace any previous BGM clips.
    let bgm = editIR.tracks.audioTracks.find((t) => t.type === "BGM");
    if (!bgm) {
      bgm = { id: generateUUID(), type: "BGM", volumeDb: op.volumeDb, duckWithSpeech: false, clips: [] };
      editIR.tracks.audioTracks.push(bgm);
    }
    bgm.volumeDb = op.volumeDb;
    bgm.duckWithSpeech = !!op.duckUnderSpeech;
    bgm.duckingConfig = op.duckUnderSpeech ? { duckDb: op.duckDb, attackMs: 120, releaseMs: 350 } : undefined;
    bgm.clips = [
      {
        id: generateUUID(),
        sourcePath: op.sourceUrl || `stock-music://${encodeURIComponent(op.query)}`,
        sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(totalSec) },
        timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(totalSec) },
        volumeDb: 0,
        fadeInDuration: RationalTimeMath.fromSeconds(op.fadeInSec ?? 0.5),
        fadeOutDuration: RationalTimeMath.fromSeconds(op.fadeOutSec ?? 1.0),
      },
    ];
  }

  private static applyRippleDelete(editIR: EditIR, clipId: string) {
    const mainTrack = editIR.tracks.videoTracks[0];
    if (!mainTrack) return;

    const targetClip = mainTrack.clips.find((c) => c.id === clipId);
    if (!targetClip) return;

    const startSec = RationalTimeMath.toSeconds(targetClip.timelineRange.start);
    const durSec = RationalTimeMath.toSeconds(targetClip.timelineRange.duration);
    this.applyRemoveRange(editIR, startSec, durSec, true);
  }

  /**
   * Splits a main-track clip at a timeline time. The parts get the ids `<id>_1` and `<id>_2`
   * (made unique if taken), so a later operation in the same plan can address them.
   * Speed-aware: source durations are timeline durations x speed. Returns the new ids, or null.
   */
  private static applySplitClip(editIR: EditIR, clipId: string, splitTimeSec: number): [string, string] | null {
    const mainTrack = EditIRCompiler.mainTrack(editIR);
    if (!mainTrack) return null;

    const clipIndex = mainTrack.clips.findIndex((c) => c.id === clipId);
    if (clipIndex === -1) return null;

    const clip = mainTrack.clips[clipIndex];
    const clipStart = RationalTimeMath.toSeconds(clip.timelineRange.start);
    const clipDur = RationalTimeMath.toSeconds(clip.timelineRange.duration);

    if (splitTimeSec <= clipStart + 0.01 || splitTimeSec >= clipStart + clipDur - 0.01) return null;

    const speed = clip.speedMultiplier || 1;
    const part1Dur = splitTimeSec - clipStart;
    const part2Dur = clipDur - part1Dur;
    const srcStart = RationalTimeMath.toSeconds(clip.sourceRange.start);
    const srcDur = RationalTimeMath.toSeconds(clip.sourceRange.duration);
    const srcSplit = Math.min(srcDur, part1Dur * speed);

    const id1 = EditIRCompiler.uniqueClipId(editIR, `${clip.id}_1`);
    const part1: VideoClip = {
      ...clip,
      id: id1,
      transform: { ...clip.transform },
      sourceRange: { start: clip.sourceRange.start, duration: RationalTimeMath.fromSeconds(srcSplit) },
      timelineRange: { start: clip.timelineRange.start, duration: RationalTimeMath.fromSeconds(part1Dur) },
      transitionOut: undefined,
    };
    mainTrack.clips.splice(clipIndex, 1, part1);
    const id2 = EditIRCompiler.uniqueClipId(editIR, `${clip.id}_2`);
    const part2: VideoClip = {
      ...clip,
      id: id2,
      transform: { ...clip.transform },
      sourceRange: { start: RationalTimeMath.fromSeconds(srcStart + srcSplit), duration: RationalTimeMath.fromSeconds(Math.max(0, srcDur - srcSplit)) },
      timelineRange: { start: RationalTimeMath.fromSeconds(splitTimeSec), duration: RationalTimeMath.fromSeconds(part2Dur) },
      // A split is invisible: no transition at the new boundary.
      transitionIn: undefined,
    };
    mainTrack.clips.splice(clipIndex + 1, 0, part2);
    return [id1, id2];
  }

  /**
   * Moves the main-track range [rangeStart, rangeEnd) (timeline seconds) so it is inserted at
   * `target` (a point on the same timeline, snapped to the nearest clip boundary outside the
   * range). Clips are split at the range edges if needed; the track stays contiguous and the
   * duration is unchanged. Captions, zooms, overlays and non-music audio travel with the footage
   * they sit on; the music bed is left alone.
   */
  private static applyMoveRange(
    editIR: EditIR,
    rangeStart: number,
    rangeEnd: number,
    target: number
  ): { ok: true; newStartSec: number } | { ok: false; reason: string } {
    const main = EditIRCompiler.mainTrack(editIR);
    if (!main || main.clips.length === 0) return { ok: false, reason: "the timeline has no footage" };
    const S = RationalTimeMath.toSeconds;
    const byStart = (a: VideoClip, b: VideoClip) => S(a.timelineRange.start) - S(b.timelineRange.start);
    main.clips.sort(byStart);
    const total = main.clips.reduce((acc, c) => acc + S(c.timelineRange.duration), 0);
    const a = Math.max(0, Math.min(total, rangeStart));
    const b = Math.max(0, Math.min(total, rangeEnd));
    if (b - a < 0.05) return { ok: false, reason: "the range to move is empty or outside the timeline" };
    if (b - a >= total - 0.05) return { ok: false, reason: "the range covers the whole timeline, so there is nothing to reorder" };

    // Split at the range edges so the moved block is made of whole clips.
    for (const edge of [a, b]) {
      const c = main.clips.find((x) => edge > S(x.timelineRange.start) + 0.01 && edge < S(x.timelineRange.start) + S(x.timelineRange.duration) - 0.01);
      if (c) this.applySplitClip(editIR, c.id, edge);
    }
    main.clips.sort(byStart);

    const pieces = main.clips.map((clip) => {
      const oldStart = S(clip.timelineRange.start);
      return { clip, oldStart, oldEnd: oldStart + S(clip.timelineRange.duration), newStart: oldStart };
    });
    const inBlock = (p: { oldStart: number; oldEnd: number }) => p.oldStart >= a - 0.02 && p.oldEnd <= b + 0.02;
    const block = pieces.filter(inBlock);
    const rest = pieces.filter((p) => !inBlock(p));
    if (block.length === 0 || rest.length === 0) return { ok: false, reason: "nothing to reorder" };

    // Target in the coordinates of the timeline without the block, snapped to a boundary.
    const blockLen = block.reduce((acc, p) => acc + (p.oldEnd - p.oldStart), 0);
    const t = target >= b ? target - blockLen : Math.min(target, a);
    let best = 0;
    let bestDist = Infinity;
    let acc = 0;
    for (let k = 0; k <= rest.length; k++) {
      const d = Math.abs(acc - t);
      if (d < bestDist - 1e-9) {
        best = k;
        bestDist = d;
      }
      if (k < rest.length) acc += rest[k].oldEnd - rest[k].oldStart;
    }
    const order = [...rest.slice(0, best), ...block, ...rest.slice(best)];
    if (order.every((p, i) => p === pieces[i])) return { ok: false, reason: "the footage is already at that position" };

    let cursor = 0;
    for (const p of order) {
      p.newStart = cursor;
      p.clip.timelineRange = { start: RationalTimeMath.fromSeconds(cursor), duration: RationalTimeMath.fromSeconds(p.oldEnd - p.oldStart) };
      cursor += p.oldEnd - p.oldStart;
    }
    main.clips = order.map((p) => p.clip);
    if (main.clips[0]) main.clips[0].transitionIn = undefined;
    editIR.meta.totalDuration = RationalTimeMath.fromSeconds(cursor);
    EditIRCompiler.remapByPieces(editIR, pieces, cursor);
    return { ok: true, newStartSec: block[0].newStart };
  }

  /**
   * Re-times secondary tracks after a reorder. Each element follows the piece of footage its
   * start sits on; a caption whose words straddle moved pieces is split so every word stays on
   * the footage that speaks it.
   */
  private static remapByPieces(
    editIR: EditIR,
    pieces: Array<{ oldStart: number; oldEnd: number; newStart: number }>,
    totalSec: number
  ) {
    const S = RationalTimeMath.toSeconds;
    const R = RationalTimeMath.fromSeconds;
    const pieceAt = (t: number) => {
      const i = pieces.findIndex((p) => t >= p.oldStart - 1e-6 && t < p.oldEnd - 1e-6);
      return i === -1 ? pieces.length - 1 : i;
    };
    const delta = (i: number) => pieces[i].newStart - pieces[i].oldStart;
    const clampRange = (start: number, dur: number) => {
      const s = Math.max(0, Math.min(totalSec, start));
      return { s, d: Math.max(0, Math.min(totalSec, start + dur) - s) };
    };

    editIR.tracks.cameraTrack = editIR.tracks.cameraTrack.flatMap((c) => {
      const st = S(c.timeRange.start);
      const { s, d } = clampRange(st + delta(pieceAt(st)), S(c.timeRange.duration));
      return d < 0.2 ? [] : [{ ...c, timeRange: { start: R(s), duration: R(d) } }];
    });

    if (editIR.tracks.effectTrack) {
      editIR.tracks.effectTrack = editIR.tracks.effectTrack.flatMap((e) => {
        const st = S(e.timeRange.start);
        const { s, d } = clampRange(st + delta(pieceAt(st)), S(e.timeRange.duration));
        return d < 0.1 ? [] : [{ ...e, timeRange: { start: R(s), duration: R(d) } }];
      });
    }

    editIR.tracks.captionTrack = editIR.tracks.captionTrack.flatMap((cap) => {
      const cs = S(cap.timeRange.start);
      const ce = cs + S(cap.timeRange.duration);
      if (cap.role === "title" || cap.words.length <= 1) {
        const dl = delta(pieceAt(cs));
        const { s, d } = clampRange(cs + dl, ce - cs);
        if (d < 0.05) return [];
        const words = cap.words.map((w) => ({ ...w, start: R(Math.max(s, S(w.start) + dl)), end: R(Math.min(s + d, S(w.end) + dl)) }));
        return [{ ...cap, words, timeRange: { start: R(s), duration: R(d) } }];
      }
      const groups: Array<{ piece: number; words: typeof cap.words }> = [];
      for (const w of cap.words) {
        const piece = pieceAt(S(w.start));
        const last = groups[groups.length - 1];
        if (last && last.piece === piece) last.words.push(w);
        else groups.push({ piece, words: [w] });
      }
      return groups.flatMap((g, gi) => {
        const dl = delta(g.piece);
        const gs = (gi === 0 ? cs : S(g.words[0].start)) + dl;
        const ge = (gi === groups.length - 1 ? ce : S(g.words[g.words.length - 1].end)) + dl;
        const { s, d } = clampRange(gs, ge - gs);
        if (d < 0.05) return [];
        const words = g.words.map((w) => ({ ...w, start: R(Math.max(s, S(w.start) + dl)), end: R(Math.min(s + d, S(w.end) + dl)) }));
        return [{
          ...cap,
          id: gi === 0 ? cap.id : `${cap.id}_${gi + 1}`,
          text: groups.length > 1 ? g.words.map((w) => w.word).join(" ") : cap.text,
          words,
          timeRange: { start: R(s), duration: R(d) },
        }];
      });
    });

    const main = EditIRCompiler.mainTrack(editIR);
    for (const track of editIR.tracks.videoTracks) {
      if (track === main) continue;
      track.clips = track.clips.flatMap((c) => {
        const st = S(c.timelineRange.start);
        const { s, d } = clampRange(st + delta(pieceAt(st)), S(c.timelineRange.duration));
        return d < 0.2 ? [] : [{ ...c, timelineRange: { start: R(s), duration: R(d) } }];
      });
    }
    for (const track of editIR.tracks.audioTracks) {
      if (track.type === "BGM") continue; // a continuous bed; the timeline length is unchanged
      track.clips = track.clips.flatMap((c) => {
        const st = S(c.timelineRange.start);
        const { s, d } = clampRange(st + delta(pieceAt(st)), S(c.timelineRange.duration));
        return d < 0.05 ? [] : [{ ...c, timelineRange: { start: R(s), duration: R(d) } }];
      });
    }
  }

  /** Sets absolute rotation and/or horizontal mirroring on main-track clips. Returns #clips changed. */
  private static applyRotateClip(editIR: EditIR, clipId: string, rotationDeg?: number, flipH?: boolean): number {
    const main = EditIRCompiler.mainTrack(editIR);
    if (!main) return 0;
    const all = clipId === "all" || clipId === "*";
    let n = 0;
    for (const clip of main.clips) {
      if (!all && clip.id !== clipId) continue;
      const t = clip.transform;
      const oldRot = (((t.rotationDeg || 0) % 360) + 360) % 360;
      const newRot = rotationDeg ?? oldRot;
      const oldFlip = !!t.flipH;
      const newFlip = flipH ?? oldFlip;
      if (newRot !== oldRot) {
        // The oriented frame changed: recompute the fill crop for it (a "fit" choice is kept).
        delete t.crop;
      } else if (newFlip !== oldFlip && t.crop) {
        // Mirror the crop window so the same picture content stays in frame.
        t.crop = { ...t.crop, left: t.crop.right, right: t.crop.left };
      }
      t.rotationDeg = newRot;
      if (newFlip) t.flipH = true;
      else delete t.flipH;
      n++;
    }
    return n;
  }

  private static applyReframe(editIR: EditIR, targetAspect: "9:16" | "16:9" | "1:1" | "4:5", _smoothing = 0.85) {
    editIR.meta.targetAspect = targetAspect;
    editIR.meta.resolution = EditIRCompiler.resolutionFor(targetAspect);
    // Reframing means "crop to fill the new canvas": drop old crops and any "fit" choice.
    EditIRCompiler.resetMainCrops(editIR, false);
    const vertical = targetAspect === "9:16" || targetAspect === "4:5";
    for (const cap of editIR.tracks.captionTrack) {
      if (cap.role === "title") continue;
      cap.style.position = { x: 0.5, y: vertical ? 0.72 : 0.8 };
    }
  }

  private static applyAddEffect(editIR: EditIR, op: any) {
    const totalSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);
    const startSec = Math.min(Math.max(0, op.startSec), Math.max(0, totalSec - 0.1));
    const durSec = Math.max(0.1, Math.min(op.durationSec, totalSec - startSec));
    (editIR.tracks.effectTrack ??= []).push({
      id: generateUUID(),
      type: op.effect,
      timeRange: { start: RationalTimeMath.fromSeconds(startSec), duration: RationalTimeMath.fromSeconds(durSec) },
      intensity: op.intensity ?? 0.6,
    });
  }

  private static applyAddZoom(editIR: EditIR, op: any) {
    const zoomEvent: CameraEvent = {
      id: generateUUID(),
      timeRange: {
        start: RationalTimeMath.fromSeconds(op.startSec),
        duration: RationalTimeMath.fromSeconds(op.durationSec),
      },
      targetType: op.targetType || "FACE",
      targetCoords: op.targetCoords || { x: 0.5, y: 0.38 },
      scale: op.scale || 1.3,
      spring: op.springConfig || { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
      motionBlur: op.motionBlur ?? true,
    };
    editIR.tracks.cameraTrack.push(zoomEvent);
  }

  private static applyAddCaption(editIR: EditIR, op: any) {
    const isVertical = editIR.meta.targetAspect === "9:16";
    const tpl = resolveCaptionTemplate(op.template)?.style;
    const highlightCol = op.highlightColor || (op.words && op.words.find((w: any) => w.color)?.color) || tpl?.highlightColor || (isVertical ? "#FFE600" : "#FACC15");
    const textCol = op.textColor || tpl?.textColor || "#FFFFFF";
    const caption: CaptionSegment = {
      id: generateUUID(),
      role: "caption",
      timeRange: {
        start: RationalTimeMath.fromSeconds(op.startSec),
        duration: RationalTimeMath.fromSeconds(op.durationSec),
      },
      text: op.text,
      words: op.words.map((w: any) => ({
        word: w.word,
        start: RationalTimeMath.fromSeconds(w.startSec),
        end: RationalTimeMath.fromSeconds(w.endSec),
        highlight: w.highlight ?? false,
        // Template captions leave plain words uncoloured, so the spoken word takes the highlight colour
        // (the renderer's rule), exactly like a template applied by hand.
        ...(tpl && !w.color && !w.highlight ? {} : { color: w.color || (w.highlight ? highlightCol : textCol) }),
        scaleMultiplier: w.scale ?? 1.0,
      })),
      style: {
        preset: (op.stylePreset as any) || "HORMOZI_BOUNCE",
        fontFamily: captionFontFor(op.text, tpl?.fontFamily || "Inter"),
        fontSize: op.fontSize || tpl?.fontSize || (isVertical ? 72 : 56),
        textColor: textCol,
        highlightColor: highlightCol,
        position: op.position || { x: 0.5, y: isVertical ? 0.72 : 0.8 },
        shadow: tpl ? tpl.shadow : true,
        strokeWidth: op.strokeWidth ?? tpl?.strokeWidth ?? 6,
        strokeColor: op.strokeColor || tpl?.strokeColor || "#000000",
        ...(op.background
          ? { pillBackground: op.background }
          : tpl?.pillBackground
            ? { pillBackground: tpl.pillBackground, pillPadding: tpl.pillPadding, pillRadius: tpl.pillRadius }
            : {}),
        uppercase: op.uppercase ?? tpl?.uppercase ?? false,
        animation: op.animation || tpl?.animation || "word_pop",
        fontWeight: tpl?.fontWeight ?? 800,
        ...(tpl?.glow ? { glow: true } : {}),
        ...(tpl ? { presetLabel: op.template } : {}),
      },
    };
    editIR.tracks.captionTrack.push(caption);
  }

  private static applyStyleCaption(
    editIR: EditIR,
    preset: string,
    highlightColor?: string,
    position?: { x?: number; y?: number }
  ) {
    const template = resolveCaptionTemplate(preset);
    for (const cap of editIR.tracks.captionTrack) {
      if (template) {
        // A template restyles speech captions only; titles keep their own look.
        if (cap.role === "title") continue;
        const t = template.style;
        const hl = highlightColor || t.highlightColor;
        cap.style = {
          ...cap.style,
          presetLabel: template.id,
          fontFamily: captionFontFor(cap.text, t.fontFamily),
          fontWeight: t.fontWeight,
          fontSize: t.fontSize,
          textColor: t.textColor,
          highlightColor: hl,
          strokeWidth: t.strokeWidth,
          strokeColor: t.strokeColor,
          shadow: t.shadow,
          uppercase: t.uppercase,
          animation: t.animation,
          glow: !!t.glow,
          pillBackground: t.pillBackground,
          pillPadding: t.pillPadding,
          pillRadius: t.pillRadius,
        };
        for (const w of cap.words) {
          if (w.highlight) w.color = hl;
          else delete w.color;
          w.scaleMultiplier = t.animation === "word_pop" ? 1.15 : 1.0;
        }
      } else {
        cap.style.preset = preset as any;
        if (highlightColor) cap.style.highlightColor = highlightColor;
      }
      if (position) {
        cap.style.position = {
          x: position.x ?? cap.style.position?.x ?? 0.5,
          y: position.y ?? cap.style.position?.y ?? 0.8,
        };
      }
    }
  }

  private static applyEmphasizeWord(
    editIR: EditIR,
    captionId: string,
    wordIndex: number,
    color: string,
    scale: number
  ) {
    const cap = editIR.tracks.captionTrack.find((c) => c.id === captionId);
    if (cap && cap.words[wordIndex]) {
      cap.words[wordIndex].highlight = true;
      cap.words[wordIndex].color = color;
      cap.words[wordIndex].scaleMultiplier = scale;
    }
  }

  private static applyInsertBroll(
    editIR: EditIR,
    op: any,
    availableAssets: MediaAssetDescriptor[]
  ): string | null {
    const asset = availableAssets.find((a) => a.id === op.assetId);
    let assetId: string;
    let sourcePath: string;
    let label: string;
    if (op.sourceUrl) {
      assetId = op.assetId && op.assetId !== "stock" ? op.assetId : `stock:${op.stockQuery || "url"}`;
      sourcePath = op.sourceUrl;
      label = op.stockQuery ? `"${op.stockQuery}"` : "from URL";
    } else if (asset) {
      assetId = asset.id;
      sourcePath = asset.filePath;
      label = `asset ${asset.name || asset.id}`;
    } else if (op.stockQuery && op.mediaType !== "image") {
      assetId = `stock:${op.stockQuery}`;
      sourcePath = `stock-query://${encodeURIComponent(op.stockQuery)}`;
      label = `"${op.stockQuery}" (stock, unresolved)`;
    } else {
      return null;
    }

    let brollTrack = editIR.tracks.videoTracks.find((t) => t.type === "B_ROLL_OVERLAY");
    if (!brollTrack) {
      brollTrack = { id: generateUUID(), type: "B_ROLL_OVERLAY", zIndex: 10, clips: [] };
      editIR.tracks.videoTracks.push(brollTrack);
    }

    const totalSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);
    const startSec = Math.min(op.timelineStartSec, Math.max(0, totalSec - 0.5));
    const durSec = Math.max(0.5, Math.min(op.durationSec, totalSec - startSec));

    brollTrack.clips.push({
      id: generateUUID(),
      assetId,
      sourcePath,
      sourceRange: { start: RationalTimeMath.fromSeconds(op.sourceStartSec || 0), duration: RationalTimeMath.fromSeconds(durSec) },
      timelineRange: { start: RationalTimeMath.fromSeconds(startSec), duration: RationalTimeMath.fromSeconds(durSec) },
      transform: {
        scale: { start: 1.0, end: 1.0, easing: "spring" },
        position: { x: 0, y: 0 },
        anchor: { x: 0.5, y: 0.5 },
        rotationDeg: 0,
        opacity: 1.0,
      },
      speedMultiplier: 1.0,
      volumeDb: op.keepAudio && op.mediaType !== "image" ? 0 : -60,
      effects: [],
      ...(op.mediaType === "image" ? { mediaType: "image" as const } : {}),
      ...(op.layout === "fit" || op.layout === "pip" || op.layout === "sticker" ? { fit: "contain" as const } : {}),
      ...(op.layout === "pip" || op.layout === "sticker" ? { layer: overlayLayerFor(op) } : {}),
      ...((op.layout === "pip" || op.layout === "sticker") && op.shape ? { mask: { shape: op.shape, radius: 0.15, feather: 0.01 } } : {}),
      // Keyed footage must float above the main video (a keyed cutaway would show black): full frame unless placed.
      ...(op.greenScreen
        ? {
            fit: "contain" as const,
            layer: op.layout === "pip" || op.layout === "sticker" ? overlayLayerFor(op) : { mode: "overlay" as const, x: 0.5, y: 0.5, scale: 1, rotation: 0 },
            chromaKey: { color: op.greenScreen === "blue" ? "#0047BB" : "#00FF00", similarity: 0.3, smoothness: 0.1, spill: 0.5 },
          }
        : {}),
    });
    const where = op.layout === "pip" || op.layout === "sticker" ? ` as ${op.layout}` : "";
    return `${op.mediaType === "image" ? `photo ${label}` : label}${where}`;
  }

  private static applyDuckAudio(editIR: EditIR, duckDb = -18.0, attackMs = 120, releaseMs = 350): number {
    let n = 0;
    for (const atrack of editIR.tracks.audioTracks) {
      if ((atrack.type === "BGM" || atrack.type === "SFX") && atrack.clips.length > 0) {
        atrack.duckWithSpeech = true;
        atrack.duckingConfig = { duckDb, attackMs, releaseMs };
        n++;
      }
    }
    return n;
  }

  /**
   * Sets a track's gain. `trackId` is an exact audio-track id, or an alias: "original" (the
   * footage's own sound; the mobile `audio.originalTrack`) or "music" (the BGM bed).
   * Returns a label of what was changed, or null when there is no such track (never faked).
   */
  private static applyAdjustVolume(editIR: EditIR, trackId: string, volumeDb: number): string | null {
    const exact = editIR.tracks.audioTracks.find((t) => t.id === trackId);
    if (exact) {
      exact.volumeDb = volumeDb;
      return exact.id === ORIGINAL_AUDIO_TRACK_ID ? "the original audio" : exact.type === "BGM" ? "the background music" : `track ${trackId}`;
    }
    const key = trackId.trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (["original", "originaltrack", "originalaudio", "voice", "main", "maintrack", "mainvideo", "dialogue", "speech", "video", "clip", "primary"].includes(key)) {
      let original = editIR.tracks.audioTracks.find((t) => t.id === ORIGINAL_AUDIO_TRACK_ID);
      if (!original) {
        // Gain-only track: no clips of its own, it scales the main-track clips' audio.
        original = { id: ORIGINAL_AUDIO_TRACK_ID, type: "PRIMARY_VOICE", volumeDb, duckWithSpeech: false, clips: [] };
        editIR.tracks.audioTracks.unshift(original);
      }
      original.volumeDb = volumeDb;
      return "the original audio";
    }
    if (["music", "bgm", "backgroundmusic", "song", "soundtrack"].includes(key)) {
      const bgm = editIR.tracks.audioTracks.find((t) => t.type === "BGM" && t.clips.length > 0);
      if (!bgm) return null;
      bgm.volumeDb = volumeDb;
      return "the background music";
    }
    return null;
  }

  private static applyFilter(editIR: EditIR, op: any) {
    const mainTrack = editIR.tracks.videoTracks[0];
    if (!mainTrack) return;

    for (const clip of mainTrack.clips) {
      if (!op.clipId || clip.id === op.clipId) {
        clip.transform = {
          ...clip.transform,
          filterPreset: op.preset ?? clip.transform.filterPreset ?? "NORMAL",
          brightness: op.brightness ?? clip.transform.brightness ?? 1.0,
          contrast: op.contrast ?? clip.transform.contrast ?? 1.0,
          saturation: op.saturation ?? clip.transform.saturation ?? 1.0,
          // The op uses phone units (-1..1 / 0..1); EditIR keeps -100..100 / 0..100.
          ...(op.exposure !== undefined ? { exposure: op.exposure } : {}),
          ...(op.temperature !== undefined ? { temperature: op.temperature * 100 } : {}),
          ...(op.tint !== undefined ? { tint: op.tint * 100 } : {}),
          ...(op.vignette !== undefined ? { vignette: op.vignette * 100 } : {}),
        };
      }
    }
  }

  private static applyDetachAudio(editIR: EditIR, clipId: string) {
    const mainTrack = editIR.tracks.videoTracks[0];
    if (!mainTrack) return;

    const targetClip = (clipId === "all" || clipId === "main_clip")
      ? mainTrack.clips[0]
      : mainTrack.clips.find((c) => c.id === clipId);

    if (!targetClip) return;

    let voiceTrack = editIR.tracks.audioTracks.find((t) => t.type === "PRIMARY_VOICE");
    if (!voiceTrack) {
      voiceTrack = {
        id: generateUUID(),
        type: "PRIMARY_VOICE",
        volumeDb: 0.0,
        duckWithSpeech: false,
        clips: [],
      };
      editIR.tracks.audioTracks.unshift(voiceTrack);
    }

    voiceTrack.clips.push({
      id: generateUUID(),
      sourcePath: targetClip.sourcePath,
      sourceRange: { ...targetClip.sourceRange },
      timelineRange: { ...targetClip.timelineRange },
      volumeDb: targetClip.volumeDb ?? 0.0,
    });

    // Mute original video clip so it doesn't double-play
    targetClip.volumeDb = -60.0;
  }

  private static applySoundDesign(editIR: EditIR, op: any) {
    let sfxTrack = editIR.tracks.audioTracks.find((t) => t.type === "SFX");
    if (!sfxTrack) {
      sfxTrack = {
        id: generateUUID(),
        type: "SFX",
        volumeDb: op.gainDb ?? -6.0,
        duckWithSpeech: false,
        clips: [],
      };
      editIR.tracks.audioTracks.push(sfxTrack);
    }

    // Generate whooshes on camera zooms
    for (const cameraEvent of editIR.tracks.cameraTrack) {
      const zoomStart = RationalTimeMath.toSeconds(cameraEvent.timeRange.start);
      sfxTrack.clips.push({
        id: generateUUID(),
        sourcePath: "synthetic://whoosh_transient.wav",
        sourceRange: {
          start: RationalTimeMath.fromSeconds(0),
          duration: RationalTimeMath.fromSeconds(0.6),
        },
        timelineRange: {
          start: RationalTimeMath.fromSeconds(Math.max(0, zoomStart - 0.08)),
          duration: RationalTimeMath.fromSeconds(0.6),
        },
        volumeDb: -8.0,
      });
    }

    // Generate UI pops on caption highlights
    for (const cap of editIR.tracks.captionTrack.slice(0, 5)) {
      const capStart = RationalTimeMath.toSeconds(cap.timeRange.start);
      sfxTrack.clips.push({
        id: generateUUID(),
        sourcePath: "synthetic://ui_pop.wav",
        sourceRange: {
          start: RationalTimeMath.fromSeconds(0),
          duration: RationalTimeMath.fromSeconds(0.2),
        },
        timelineRange: {
          start: RationalTimeMath.fromSeconds(capStart),
          duration: RationalTimeMath.fromSeconds(0.2),
        },
        volumeDb: -10.0,
      });
    }
  }

  private static applyAddSoundEffect(editIR: EditIR, op: any) {
    let sfxTrack = editIR.tracks.audioTracks.find((t) => t.type === "SFX");
    if (!sfxTrack) {
      sfxTrack = {
        id: generateUUID(),
        type: "SFX",
        volumeDb: 0.0,
        duckWithSpeech: false,
        clips: [],
      };
      editIR.tracks.audioTracks.push(sfxTrack);
    }
    const sourcePath = op.sourceUrl || `synthetic://${op.sfxType || "whoosh"}.wav`;
    const durSec = op.sfxType === "sub_drop" ? 1.2 : op.sfxType === "riser" ? 2.0 : 0.6;
    sfxTrack.clips.push({
      id: generateUUID(),
      sourcePath,
      sourceRange: {
        start: RationalTimeMath.fromSeconds(0),
        duration: RationalTimeMath.fromSeconds(durSec),
      },
      timelineRange: {
        start: RationalTimeMath.fromSeconds(Math.max(0, op.timelineStartSec)),
        duration: RationalTimeMath.fromSeconds(durSec),
      },
      volumeDb: op.volumeDb ?? -8.0,
    });
  }

  private static applyAsynchronousSplit(editIR: EditIR, clipId: string, splitType: "J_CUT" | "L_CUT", offsetSec: number) {
    const mainTrack = editIR.tracks.videoTracks[0];
    if (!mainTrack) return;

    const clip = (clipId === "all" || clipId === "main_clip") ? mainTrack.clips[0] : mainTrack.clips.find((c) => c.id === clipId);
    if (!clip) return;

    let voiceTrack = editIR.tracks.audioTracks.find((t) => t.type === "PRIMARY_VOICE");
    if (!voiceTrack) {
      voiceTrack = {
        id: generateUUID(),
        type: "PRIMARY_VOICE",
        volumeDb: 0.0,
        duckWithSpeech: false,
        clips: [],
      };
      editIR.tracks.audioTracks.unshift(voiceTrack);
    }

    const curStart = RationalTimeMath.toSeconds(clip.timelineRange.start);
    const curDur = RationalTimeMath.toSeconds(clip.timelineRange.duration);

    if (splitType === "J_CUT") {
      // Audio leads video by offsetSec
      const audioStart = Math.max(0, curStart - offsetSec);
      voiceTrack.clips.push({
        id: generateUUID(),
        sourcePath: clip.sourcePath,
        sourceRange: {
          start: RationalTimeMath.fromSeconds(Math.max(0, RationalTimeMath.toSeconds(clip.sourceRange.start) - offsetSec)),
          duration: RationalTimeMath.fromSeconds(curDur + offsetSec),
        },
        timelineRange: {
          start: RationalTimeMath.fromSeconds(audioStart),
          duration: RationalTimeMath.fromSeconds(curDur + offsetSec),
        },
        volumeDb: clip.volumeDb ?? 0.0,
      });
    } else {
      // Audio trails video by offsetSec
      voiceTrack.clips.push({
        id: generateUUID(),
        sourcePath: clip.sourcePath,
        sourceRange: {
          start: clip.sourceRange.start,
          duration: RationalTimeMath.fromSeconds(curDur + offsetSec),
        },
        timelineRange: {
          start: clip.timelineRange.start,
          duration: RationalTimeMath.fromSeconds(curDur + offsetSec),
        },
        volumeDb: clip.volumeDb ?? 0.0,
      });
    }

    clip.volumeDb = -60.0;
  }

  /** For each cut between main clips: trim the clip's tail back to the last beat within [toleranceSec]. */
  private static beatAlignCuts(editIR: EditIR, beatsSec: number[], toleranceSec: number) {
    const clips = EditIRCompiler.mainTrack(editIR)?.clips ?? [];
    const beats = [...beatsSec].sort((a, b) => a - b);
    const out: Array<{ start: number; end: number; reason: string }> = [];
    for (const c of clips.slice(0, -1)) {
      const start = RationalTimeMath.toSeconds(c.timelineRange.start);
      const end = start + RationalTimeMath.toSeconds(c.timelineRange.duration);
      const beat = [...beats].reverse().find((b) => b < end - 0.01 && end - b <= toleranceSec && b - start >= 0.3);
      if (beat != null) out.push({ start: beat, end, reason: `cut moved onto the beat at ${beat.toFixed(2)}s` });
    }
    return out;
  }

  private static applyAddText(editIR: EditIR, op: any) {
    let captionTrack = editIR.tracks.captionTrack;
    captionTrack.push({
      id: generateUUID(),
      role: "title",
      timeRange: {
        start: RationalTimeMath.fromSeconds(op.timelineStartSec),
        duration: RationalTimeMath.fromSeconds(op.durationSec),
      },
      text: op.text,
      words: [{
        word: op.text,
        start: RationalTimeMath.fromSeconds(op.timelineStartSec),
        end: RationalTimeMath.fromSeconds(op.timelineStartSec + op.durationSec),
        highlight: true,
        scaleMultiplier: 1.0,
      }],
      style: {
        preset: "BOLD_CENTER",
        fontFamily: op.fontFamily || "Inter",
        // Canvas pixels. Models often send point sizes (e.g. 24), which are unreadable on a 1080 px-wide canvas:
        // a title is never smaller than 5% of the canvas's short side.
        fontSize: Math.max(
          Math.round(Math.min(editIR.meta.resolution?.width ?? 1080, editIR.meta.resolution?.height ?? 1920) * 0.05),
          op.style?.fontSize || 64
        ),
        textColor: op.color || op.style?.color || "#FFFFFF",
        highlightColor: op.color || op.style?.color || "#FFFFFF",
        position: {
          // addText positions are -1..1 offsets from centre (legacy); normalise to 0..1 canvas fractions.
          x: Math.min(1, Math.max(0, 0.5 + (op.position?.x ?? 0) / 2)),
          y: Math.min(1, Math.max(0, 0.5 + (op.position?.y ?? -0.6) / 2)),
        },
        shadow: true,
        ...(op.backgroundColor || op.style?.backgroundColor ? { pillBackground: op.backgroundColor || op.style.backgroundColor } : {}),
        ...(op.strokeColor ? { strokeColor: op.strokeColor, strokeWidth: 4 } : {}),
        ...(op.uppercase ? { uppercase: true } : {}),
        ...(op.glow ? { glow: true } : {}),
        ...(op.enter ? { enter: op.enter } : {}),
        ...(op.exit ? { exit: op.exit } : {}),
        ...(op.loop ? { loop: op.loop } : {}),
        animation: "none",
        fontWeight: 800,
      },
    });
  }

  /**
   * AI narration = a voiceover whose recording (`tts:<text>`) the phone speaks itself. The length here is an estimate
   * (~2.6 words/s); the phone corrects it to the real spoken length.
   */
  private static applyAddNarration(editIR: EditIR, op: { text: string; timelineStartSec: number }): boolean {
    const totalSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);
    if (op.timelineStartSec >= totalSec - 0.3) return false;
    const words = op.text.split(/\s+/).filter(Boolean).length;
    const durSec = Math.min(totalSec - op.timelineStartSec, 0.4 + words / 2.6);
    let track = editIR.tracks.audioTracks.find((t) => t.type === "VOICEOVER");
    if (!track) {
      track = { id: "voiceover_lane", type: "VOICEOVER", volumeDb: 0, duckWithSpeech: false, clips: [] };
      editIR.tracks.audioTracks.push(track);
    }
    track.clips.push({
      id: generateUUID(),
      sourcePath: `asset://tts:${op.text}`,
      sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(durSec) },
      timelineRange: { start: RationalTimeMath.fromSeconds(op.timelineStartSec), duration: RationalTimeMath.fromSeconds(durSec) },
      volumeDb: 0,
    });
    return true;
  }

  /** Emoji sticker = an image layer whose asset (`emoji:<emoji>`) the phone draws itself. */
  private static applyAddSticker(editIR: EditIR, op: any): boolean {
    const totalSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);
    if (op.timelineStartSec >= totalSec - 0.3) return false;
    const durSec = Math.min(op.durationSec, totalSec - op.timelineStartSec);
    // Same track as phone-made overlays (a sticker is a floating image layer), so it round-trips to mobile.
    let track = editIR.tracks.videoTracks.find((t) => t.type === "B_ROLL_OVERLAY");
    if (!track) {
      track = { id: generateUUID(), type: "B_ROLL_OVERLAY", zIndex: 10, clips: [] };
      editIR.tracks.videoTracks.push(track);
    }
    // 3D stickers are found on the phone by name (library search + download); the emoji is the offline fallback.
    const is3d = op.style === "3d" && !!op.name;
    const assetId = is3d ? `sticker3d:${op.name}|${op.emoji}` : `emoji:${op.emoji}`;
    track.clips.push({
      id: generateUUID(),
      assetId,
      sourcePath: is3d ? `stock-query://${encodeURIComponent(assetId)}` : `device-asset://${assetId}`,
      sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(durSec) },
      timelineRange: { start: RationalTimeMath.fromSeconds(op.timelineStartSec), duration: RationalTimeMath.fromSeconds(durSec) },
      transform: { scale: { start: 1, end: 1, easing: "spring" }, position: { x: 0, y: 0 }, anchor: { x: 0.5, y: 0.5 }, rotationDeg: 0, opacity: 1 },
      speedMultiplier: 1,
      volumeDb: -60,
      effects: [],
      mediaType: "image",
      fit: "contain",
      layer: overlayLayerFor({ layout: "sticker", position: op.position ?? { x: 0.74, y: 0.22 }, scale: op.scale ?? 0.26, rotation: op.rotation, animationIn: op.animationIn }),
    });
    return true;
  }

  /** Splits a main clip into the preset's parts; returns each part's id and relative speed (null if impossible). */
  private static applySpeedRampSplits(editIR: EditIR, clipId: string, preset: string): Array<{ id: string; speed: number }> | null {
    const shape = SPEED_RAMP_PRESETS[preset];
    const clip = EditIRCompiler.mainTrack(editIR)?.clips.find((c) => c.id === clipId);
    if (!shape || !clip) return null;
    const start = RationalTimeMath.toSeconds(clip.timelineRange.start);
    const dur = RationalTimeMath.toSeconds(clip.timelineRange.duration);
    if (dur < shape.length * 0.4) return null;
    const out: Array<{ id: string; speed: number }> = [];
    let rest = clipId;
    let at = start;
    for (let i = 0; i < shape.length - 1; i++) {
      at += dur * shape[i][0];
      const parts = this.applySplitClip(editIR, rest, at);
      if (!parts) return null;
      out.push({ id: parts[0], speed: shape[i][1] });
      rest = parts[1];
    }
    out.push({ id: rest, speed: shape[shape.length - 1][1] });
    return out;
  }

  /** Sets audio fades on main clips (each capped at half the clip). Returns how many clips changed. */
  private static applyFadeClipAudio(editIR: EditIR, op: { clipId: string; fadeInSec: number; fadeOutSec: number }): number {
    const main = editIR.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO") ?? editIR.tracks.videoTracks[0];
    let n = 0;
    for (const clip of main?.clips ?? []) {
      if (op.clipId !== "all" && clip.id !== op.clipId) continue;
      const half = (RationalTimeMath.toSeconds(clip.timelineRange.duration) * 1000) / 2;
      const fin = Math.round(Math.min(half, op.fadeInSec * 1000));
      const fout = Math.round(Math.min(half, op.fadeOutSec * 1000));
      if (fin > 0) clip.audioFadeInMs = fin;
      else delete clip.audioFadeInMs;
      if (fout > 0) clip.audioFadeOutMs = fout;
      else delete clip.audioFadeOutMs;
      n++;
    }
    return n;
  }

  /** Removes items of one kind by id, by the moment they are on screen, or all of them. Returns how many. */
  private static applyRemoveItem(editIR: EditIR, op: { kind: string; id?: string; atSec?: number }): number {
    const sec = (t: any) => RationalTimeMath.toSeconds(t);
    const hit = (id: string, start: any, dur: any) =>
      op.id ? id === op.id : typeof op.atSec === "number" ? sec(start) <= op.atSec && op.atSec < sec(start) + sec(dur) : true;
    const t = editIR.tracks;
    function drop<T>(xs: T[], match: (x: T) => boolean): [T[], number] {
      const kept = xs.filter((x) => !match(x));
      return [kept, xs.length - kept.length];
    }
    let n = 0;
    switch (op.kind) {
      case "caption":
      case "title": {
        const title = op.kind === "title";
        [t.captionTrack, n] = drop(t.captionTrack, (c) => (title ? c.role === "title" : c.role !== "title") && hit(c.id, c.timeRange.start, c.timeRange.duration));
        break;
      }
      case "zoom":
        [t.cameraTrack, n] = drop(t.cameraTrack, (z) => hit(z.id, z.timeRange.start, z.timeRange.duration));
        break;
      case "effect":
        if (t.effectTrack) [t.effectTrack, n] = drop(t.effectTrack, (e: any) => hit(e.id, e.timeRange.start, e.timeRange.duration));
        break;
      case "broll":
        for (const track of t.videoTracks.filter((v) => v.type !== "MAIN_VIDEO")) {
          let k = 0;
          [track.clips, k] = drop(track.clips, (c) => hit(c.id, c.timelineRange.start, c.timelineRange.duration));
          n += k;
        }
        break;
      case "sfx":
        for (const track of t.audioTracks.filter((a) => a.type === "SFX")) {
          let k = 0;
          [track.clips, k] = drop(track.clips as any[], (c: any) => hit(c.id, c.timelineRange.start, c.timelineRange.duration)) as any;
          n += k;
        }
        break;
    }
    return n;
  }
}

/** Layer for a pip/sticker insertBroll; entrance keyframes mirror TimelineOps.layerEntrance in the Flutter app. */
function overlayLayerFor(op: { layout?: string; position?: { x: number; y: number }; scale?: number; rotation?: number; animationIn?: string }) {
  const sticker = op.layout === "sticker";
  const x = op.position?.x ?? (sticker ? 0.75 : 0.72);
  const y = op.position?.y ?? (sticker ? 0.2 : 0.28);
  const scale = op.scale ?? (sticker ? 0.25 : 0.42);
  const rotation = op.rotation ?? 0;
  const d = 400;
  const keyframes = (() => {
    switch (op.animationIn) {
      case "zoom_in": return [{ atMs: 0, scale: scale * 0.2, opacity: 0 }, { atMs: d, scale, opacity: 1 }];
      case "slide_left": return [{ atMs: 0, x: Math.min(1.5, x + 0.6) }, { atMs: d, x }];
      case "slide_up": return [{ atMs: 0, y: Math.min(1.5, y + 0.5) }, { atMs: d, y }];
      case "fade": return [{ atMs: 0, opacity: 0 }, { atMs: d, opacity: 1 }];
      case "spin": return [{ atMs: 0, rotation: rotation - 180, scale: Math.max(0.05, scale * 0.3) }, { atMs: d, rotation, scale }];
      default: return [];
    }
  })();
  return { mode: "overlay" as const, x, y, scale, rotation, ...(keyframes.length ? { keyframes } : {}) };
}
