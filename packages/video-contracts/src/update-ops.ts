import { EditIR, VideoClip, CaptionSegment } from "./edit-ir.schema";
import { CreativeOperation, ORIGINAL_AUDIO_TRACK_ID } from "./creative-plan.schema";
import { RationalTimeMath } from "./time";
import { retextCaptionSegment } from "./caption-translation";
import { cropFor } from "./mobile-edit-ir";

/**
 * Update tools (editor overhaul Phase 2, audit F-20): each changes ONE existing item in place, by id, the way the
 * manual editor's TimelineOps does, so "make the title bigger" never becomes remove + re-add. Only the fields an
 * operation names change. Times are seconds on the timeline the plan was made for (phase A of the compiler).
 */
export type UpdateResult = { ok: boolean; message: string };

const sec = RationalTimeMath.toSeconds;
const R = RationalTimeMath.fromSeconds;
const MUTED_DB = -60;

function mainClips(ir: EditIR): VideoClip[] {
  const main = ir.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO") || ir.tracks.videoTracks[0];
  return main?.clips ?? [];
}
const overlayClips = (ir: EditIR) => ir.tracks.videoTracks.filter((t) => t.type !== "MAIN_VIDEO").flatMap((t) => t.clips);
const audioOf = (ir: EditIR, type: "BGM" | "SFX" | "VOICEOVER") => ir.tracks.audioTracks.filter((t) => t.type === type);

function captionTargets(ir: EditIR, target: string): CaptionSegment[] {
  if (target === "all_captions") return ir.tracks.captionTrack.filter((c) => c.role !== "title");
  if (target === "all_titles") return ir.tracks.captionTrack.filter((c) => c.role === "title");
  return ir.tracks.captionTrack.filter((c) => c.id === target);
}

/** Clamp a [start, start + dur) window into the timeline; null when nothing is left. */
function fitWindow(ir: EditIR, startSec: number, durSec: number): { s: number; d: number } | null {
  const total = sec(ir.meta.totalDuration);
  const s = Math.max(0, Math.min(startSec, total - 0.05));
  const d = Math.min(durSec, total - s);
  return d > 0.01 ? { s, d } : null;
}

export function applyUpdateOp(ir: EditIR, op: CreativeOperation, opts: { sources?: Array<{ assetId: string; durationMs: number; width: number; height: number }> } = {}): UpdateResult {
  switch (op.type) {
    case "editText": {
      const cap = ir.tracks.captionTrack.find((c) => c.id === op.id);
      if (!cap) return { ok: false, message: `no caption or title "${op.id}"` };
      if (cap.role === "title" && cap.words.length <= 1) {
        cap.text = op.text;
        cap.words = [{ word: op.text, start: cap.timeRange.start, end: R(sec(cap.timeRange.start) + sec(cap.timeRange.duration)), highlight: cap.words[0]?.highlight ?? false, ...(cap.words[0]?.color ? { color: cap.words[0].color } : {}), scaleMultiplier: cap.words[0]?.scaleMultiplier ?? 1 }];
      } else {
        // Same timing and look; the words are spread over the caption's time.
        retextCaptionSegment(cap, op.text);
      }
      return { ok: true, message: `Changed the text of ${cap.role === "title" ? "title" : "caption"} ${op.id} to "${op.text}"` };
    }

    case "updateTextStyle": {
      const caps = captionTargets(ir, op.target);
      if (!caps.length) return { ok: false, message: `no caption or title "${op.target}"` };
      const changed: string[] = [];
      for (const cap of caps) {
        const st = cap.style as any;
        if (op.fontFamily) st.fontFamily = op.fontFamily;
        if (op.fontSizePx) st.fontSize = op.fontSizePx;
        if (op.textColor) st.textColor = op.textColor;
        if (op.highlightColor) {
          st.highlightColor = op.highlightColor;
          for (const w of cap.words) if (w.highlight) w.color = op.highlightColor;
        }
        if (op.strokeColor) {
          st.strokeColor = op.strokeColor;
          if (!st.strokeWidth) st.strokeWidth = 4;
        }
        if (op.strokeWidthPx !== undefined) st.strokeWidth = op.strokeWidthPx;
        if (op.backgroundColor === "none") {
          delete st.pillBackground;
          delete st.pillPadding;
          delete st.pillRadius;
        } else if (op.backgroundColor) st.pillBackground = op.backgroundColor;
        if (op.uppercase !== undefined) st.uppercase = op.uppercase;
        if (op.glow !== undefined) st.glow = op.glow;
        if (op.enter) st.enter = op.enter;
        if (op.exit) st.exit = op.exit;
        if (op.loop) st.loop = op.loop;
        if (op.positionX !== undefined || op.positionY !== undefined) {
          st.position = { x: op.positionX ?? st.position?.x ?? 0.5, y: op.positionY ?? st.position?.y ?? 0.8 };
        }
        if (op.rotationDeg !== undefined) st.rotationDeg = op.rotationDeg;
        if (op.scale !== undefined) st.scale = op.scale;
      }
      for (const k of ["fontFamily", "fontSizePx", "textColor", "highlightColor", "strokeColor", "strokeWidthPx", "backgroundColor", "uppercase", "glow", "enter", "exit", "loop", "positionX", "positionY", "rotationDeg", "scale"] as const) {
        if ((op as any)[k] !== undefined) changed.push(k);
      }
      if (!changed.length) return { ok: false, message: "nothing to change (give at least one style field)" };
      return { ok: true, message: `Restyled ${caps.length} ${op.target === "all_titles" || caps[0].role === "title" ? "title" : "caption"}(s): ${changed.join(", ")}` };
    }

    case "retimeItem": {
      if (op.startSec === undefined && op.durationSec === undefined) return { ok: false, message: "give startSec and/or durationSec" };
      const retime = (start: any, dur: any): { s: number; d: number } | null =>
        fitWindow(ir, op.startSec ?? sec(start), op.durationSec ?? sec(dur));
      switch (op.kind) {
        case "caption":
        case "title": {
          const cap = ir.tracks.captionTrack.find((c) => c.id === op.id && (op.kind === "title") === (c.role === "title"));
          if (!cap) return { ok: false, message: `no ${op.kind} "${op.id}"` };
          const w = retime(cap.timeRange.start, cap.timeRange.duration);
          if (!w) return { ok: false, message: "that time is outside the video" };
          const s0 = sec(cap.timeRange.start);
          const k = w.d / Math.max(1e-6, sec(cap.timeRange.duration));
          cap.words = cap.words.map((x) => ({ ...x, start: R(w.s + (sec(x.start) - s0) * k), end: R(w.s + (sec(x.end) - s0) * k) }));
          cap.timeRange = { start: R(w.s), duration: R(w.d) };
          return { ok: true, message: `Moved ${op.kind} ${op.id} to ${w.s.toFixed(2)}s (${w.d.toFixed(2)}s)` };
        }
        case "zoom": {
          const z = ir.tracks.cameraTrack.find((x) => x.id === op.id);
          if (!z) return { ok: false, message: `no zoom "${op.id}"` };
          const w = retime(z.timeRange.start, z.timeRange.duration);
          if (!w) return { ok: false, message: "that time is outside the video" };
          z.timeRange = { start: R(w.s), duration: R(w.d) };
          return { ok: true, message: `Moved zoom ${op.id} to ${w.s.toFixed(2)}s (${w.d.toFixed(2)}s)` };
        }
        case "effect": {
          const e = (ir.tracks.effectTrack ?? []).find((x) => x.id === op.id);
          if (!e) return { ok: false, message: `no effect "${op.id}"` };
          const w = retime(e.timeRange.start, e.timeRange.duration);
          if (!w) return { ok: false, message: "that time is outside the video" };
          e.timeRange = { start: R(w.s), duration: R(w.d) };
          return { ok: true, message: `Moved effect ${op.id} to ${w.s.toFixed(2)}s` };
        }
        case "broll": {
          const o = overlayClips(ir).find((x) => x.id === op.id);
          if (!o) return { ok: false, message: `no B-roll / layer "${op.id}"` };
          const w = retime(o.timelineRange.start, o.timelineRange.duration);
          if (!w) return { ok: false, message: "that time is outside the video" };
          o.timelineRange = { start: R(w.s), duration: R(w.d) };
          o.sourceRange = { start: o.sourceRange.start, duration: R(w.d * (o.speedMultiplier || 1)) };
          return { ok: true, message: `Moved B-roll ${op.id} to ${w.s.toFixed(2)}s (${w.d.toFixed(2)}s)` };
        }
        case "sfx":
        case "voiceover": {
          const c = audioOf(ir, op.kind === "sfx" ? "SFX" : "VOICEOVER").flatMap((t) => t.clips).find((x) => x.id === op.id);
          if (!c) return { ok: false, message: `no ${op.kind === "sfx" ? "sound effect" : "voiceover"} "${op.id}"` };
          const keepWhole = op.kind === "sfx" && (c as any).fullFile && op.durationSec === undefined;
          const w = retime(c.timelineRange.start, c.timelineRange.duration);
          if (!w) return { ok: false, message: "that time is outside the video" };
          if (op.kind === "voiceover" && op.durationSec !== undefined && op.durationSec > sec(c.sourceRange.duration) + 1e-3) {
            return { ok: false, message: "a voiceover cannot be longer than its recording" };
          }
          c.timelineRange = { start: R(w.s), duration: keepWhole ? c.timelineRange.duration : R(w.d) };
          if (op.durationSec !== undefined) {
            c.sourceRange = { start: c.sourceRange.start, duration: R(w.d) };
            delete (c as any).fullFile;
          }
          return { ok: true, message: `Moved ${op.kind === "sfx" ? "sound effect" : "voiceover"} ${op.id} to ${w.s.toFixed(2)}s` };
        }
      }
      return { ok: false, message: `cannot re-time ${(op as any).kind}` };
    }

    case "updateOverlay": {
      const o = overlayClips(ir).find((x) => x.id === op.id);
      if (!o) return { ok: false, message: `no B-roll / layer "${op.id}"` };
      if (op.x !== undefined || op.y !== undefined || op.scale !== undefined || op.rotation !== undefined) {
        // Moving or resizing a full-screen cutaway makes it a floating layer.
        const l = o.layer ?? { mode: "overlay" as const, x: 0.5, y: 0.5, scale: 1, rotation: 0 };
        o.layer = { ...l, mode: "overlay", x: op.x ?? l.x, y: op.y ?? l.y, scale: op.scale ?? l.scale, rotation: op.rotation ?? l.rotation };
      }
      if (op.opacity !== undefined) o.transform = { ...o.transform, opacity: op.opacity };
      if (op.fit) o.fit = op.fit;
      if (op.muted !== undefined) o.volumeDb = op.muted ? MUTED_DB : 0;
      if (op.mask === "none") delete o.mask;
      else if (op.mask) o.mask = { shape: op.mask, radius: op.mask === "circle" ? 0.5 : 0.12, feather: 0.02 };
      if (op.chromaKey === "none") delete o.chromaKey;
      else if (op.chromaKey) o.chromaKey = { color: op.chromaKey === "green" ? "#00FF00" : "#0000FF", similarity: 0.4, smoothness: 0.1, spill: 0.3 };
      if (op.sourceUrl) {
        o.sourcePath = op.sourceUrl;
        o.assetId = "url";
      } else if (op.stockQuery) {
        o.sourcePath = `stock-query://${encodeURIComponent(op.stockQuery)}`;
        o.assetId = `stock:${op.stockQuery}`;
      }
      return { ok: true, message: `Updated layer ${op.id}` };
    }

    case "updateVoiceover": {
      for (const t of audioOf(ir, "VOICEOVER")) {
        const c = t.clips.find((x) => x.id === op.id);
        if (!c) continue;
        if (op.volumeDb !== undefined) c.volumeDb = op.volumeDb - (t.volumeDb ?? 0);
        if (op.fadeInSec !== undefined) c.fadeInDuration = R(op.fadeInSec);
        if (op.fadeOutSec !== undefined) c.fadeOutDuration = R(op.fadeOutSec);
        return { ok: true, message: `Updated voiceover ${op.id}` };
      }
      return { ok: false, message: `no voiceover "${op.id}"` };
    }

    case "setKeyframe": {
      const o = overlayClips(ir).find((x) => x.id === op.overlayId);
      if (!o) return { ok: false, message: `no B-roll / layer "${op.overlayId}"` };
      const len = sec(o.timelineRange.duration);
      if (op.atSec > len + 1e-3) return { ok: false, message: `the layer is only ${len.toFixed(2)}s long` };
      if ([op.x, op.y, op.scale, op.rotation, op.opacity].every((v) => v === undefined)) return { ok: false, message: "give at least one of x, y, scale, rotation, opacity" };
      const l = o.layer ?? { mode: "overlay" as const, x: 0.5, y: 0.5, scale: 1, rotation: 0 };
      const atMs = Math.round(op.atSec * 1000);
      const kf = { atMs, ...(op.x !== undefined ? { x: op.x } : {}), ...(op.y !== undefined ? { y: op.y } : {}), ...(op.scale !== undefined ? { scale: op.scale } : {}), ...(op.rotation !== undefined ? { rotation: op.rotation } : {}), ...(op.opacity !== undefined ? { opacity: op.opacity } : {}) };
      const rest = (l.keyframes ?? []).filter((k) => Math.abs(k.atMs - atMs) > 20);
      if (rest.length >= 60) return { ok: false, message: "a layer has at most 60 keyframes" };
      o.layer = { ...l, keyframes: [...rest, kf].sort((a, b) => a.atMs - b.atMs) };
      return { ok: true, message: `Set a keyframe on ${op.overlayId} at ${op.atSec.toFixed(2)}s` };
    }

    case "removeKeyframe": {
      const o = overlayClips(ir).find((x) => x.id === op.overlayId);
      const atMs = Math.round(op.atSec * 1000);
      const ks = o?.layer?.keyframes ?? [];
      const rest = ks.filter((k) => Math.abs(k.atMs - atMs) > 50);
      if (!o || rest.length === ks.length) return { ok: false, message: `no keyframe on "${op.overlayId}" at ${op.atSec.toFixed(2)}s` };
      o.layer = { ...o.layer!, ...(rest.length ? { keyframes: rest } : { keyframes: undefined }) };
      if (!rest.length) delete (o.layer as any).keyframes;
      return { ok: true, message: `Removed the keyframe on ${op.overlayId} at ${op.atSec.toFixed(2)}s` };
    }

    case "updateZoom": {
      const z = ir.tracks.cameraTrack.find((x) => x.id === op.id);
      if (!z) return { ok: false, message: `no zoom "${op.id}"` };
      if (op.scale !== undefined) z.scale = op.scale;
      if (op.centerX !== undefined || op.centerY !== undefined) z.targetCoords = { x: op.centerX ?? z.targetCoords.x, y: op.centerY ?? z.targetCoords.y };
      if (op.centerX !== undefined || op.centerY !== undefined) z.targetType = "MANUAL";
      if (op.rampMs !== undefined) z.rampMs = op.rampMs;
      if (op.startSec !== undefined || op.durationSec !== undefined) {
        const w = fitWindow(ir, op.startSec ?? sec(z.timeRange.start), op.durationSec ?? sec(z.timeRange.duration));
        if (!w) return { ok: false, message: "that time is outside the video" };
        z.timeRange = { start: R(w.s), duration: R(w.d) };
      }
      return { ok: true, message: `Updated zoom ${op.id}${op.scale !== undefined ? ` to ${op.scale}x` : ""}` };
    }

    case "updateEffect": {
      const e = (ir.tracks.effectTrack ?? []).find((x) => x.id === op.id);
      if (!e) return { ok: false, message: `no effect "${op.id}"` };
      if (op.intensity !== undefined) e.intensity = op.intensity;
      if (op.effect) e.type = op.effect;
      return { ok: true, message: `Updated effect ${op.id}` };
    }

    case "updateMusic": {
      const track = audioOf(ir, "BGM").find((t) => t.clips.length > 0 && (!op.id || t.clips.some((c) => c.id === op.id)));
      if (!track) return { ok: false, message: op.id ? `no music "${op.id}"` : "there is no music (add it with addBackgroundMusic)" };
      const clip = track.clips[0];
      if (op.volumeDb !== undefined) track.volumeDb = op.volumeDb - (clip.volumeDb ?? 0);
      if (op.fadeInSec !== undefined) clip.fadeInDuration = R(op.fadeInSec);
      if (op.fadeOutSec !== undefined) clip.fadeOutDuration = R(op.fadeOutSec);
      if (op.duck !== undefined) track.duckWithSpeech = op.duck;
      if (op.duckDb !== undefined || op.duck) {
        const cfg = track.duckingConfig ?? { duckDb: -12, attackMs: 120, releaseMs: 350 };
        track.duckingConfig = { ...cfg, ...(op.duckDb !== undefined ? { duckDb: op.duckDb } : {}) };
      }
      return { ok: true, message: `Updated the music${op.volumeDb !== undefined ? ` (level ${op.volumeDb} dB)` : ""}` };
    }

    case "changeMusicTrack": {
      const track = audioOf(ir, "BGM").find((t) => t.clips.length > 0 && (!op.id || t.clips.some((c) => c.id === op.id)));
      if (!track) return { ok: false, message: op.id ? `no music "${op.id}"` : "there is no music to change (add it with addBackgroundMusic)" };
      if (!op.query && !op.sourceUrl) return { ok: false, message: "give a mood query or a sourceUrl" };
      const clip = track.clips[0];
      // A different track with the same level, fades and ducking.
      clip.sourcePath = op.sourceUrl || `stock-music://${encodeURIComponent(op.query!)}`;
      if (op.query) clip.sourceQuery = op.query;
      else delete clip.sourceQuery;
      clip.sourceRange = { start: R(0), duration: clip.sourceRange.duration };
      return { ok: true, message: `Changed the music track ("${op.sourceUrl || op.query}"), kept its level and fades` };
    }

    case "setSfxVolume": {
      for (const t of audioOf(ir, "SFX")) {
        const c = t.clips.find((x) => x.id === op.id);
        if (c) {
          c.volumeDb = op.volumeDb - (t.volumeDb ?? 0);
          return { ok: true, message: `Set sound effect ${op.id} to ${op.volumeDb} dB` };
        }
      }
      return { ok: false, message: `no sound effect "${op.id}"` };
    }

    case "setClipVolume": {
      const clips = mainClips(ir).filter((c) => op.clipId === "all" || c.id === op.clipId);
      if (!clips.length) return { ok: false, message: `no main clip "${op.clipId}"` };
      for (const c of clips) c.volumeDb = op.volumeDb;
      return { ok: true, message: `Set the sound of ${op.clipId === "all" ? "every clip" : `clip ${op.clipId}`} to ${op.volumeDb} dB` };
    }

    case "jlCut": {
      const clips = [...mainClips(ir)].sort((a, b) => sec(a.timelineRange.start) - sec(b.timelineRange.start));
      const i = clips.findIndex((x) => x.id === op.clipId);
      if (i < 0) return { ok: false, message: `no main clip "${op.clipId}"` };
      if (op.leadMs === undefined && op.lagMs === undefined) return { ok: false, message: "give leadMs (J-cut) and/or lagMs (L-cut)" };
      const c = clips[i];
      const speed = c.speedMultiplier || 1;
      const src = opts.sources?.find((s) => s.assetId === c.assetId);
      const srcStartMs = sec(c.sourceRange.start) * 1000;
      const srcEndMs = srcStartMs + sec(c.sourceRange.duration) * 1000;
      const halfMs = (x: VideoClip | undefined) => (x ? (sec(x.timelineRange.duration) * 1000) / 2 : 0);
      const notes: string[] = [];
      if (op.leadMs !== undefined) {
        // The extra sound comes from the source before the clip, and plays over at most half of the previous clip.
        const lead = Math.round(Math.min(op.leadMs, srcStartMs / speed, halfMs(clips[i - 1])));
        if (lead < op.leadMs) notes.push(`J-cut shortened to ${lead} ms (${i === 0 ? "no clip before it" : "not enough footage before it"})`);
        if (lead > 0) c.audioLeadMs = lead;
        else delete c.audioLeadMs;
      }
      if (op.lagMs !== undefined) {
        const after = src ? (src.durationMs - srcEndMs) / speed : 0;
        const lag = Math.round(Math.max(0, Math.min(op.lagMs, after, halfMs(clips[i + 1]))));
        if (lag < op.lagMs) notes.push(`L-cut shortened to ${lag} ms (${i === clips.length - 1 ? "no clip after it" : "not enough footage after it"})`);
        if (lag > 0) c.audioLagMs = lag;
        else delete c.audioLagMs;
      }
      if (!c.audioLeadMs && !c.audioLagMs && notes.length) return { ok: false, message: notes.join("; ") };
      return { ok: true, message: `${c.audioLeadMs ? `J-cut ${c.audioLeadMs} ms` : ""}${c.audioLeadMs && c.audioLagMs ? " and " : ""}${c.audioLagMs ? `L-cut ${c.audioLagMs} ms` : ""} on clip ${op.clipId}${notes.length ? ` (${notes.join("; ")})` : ""}` };
    }

    case "setCrop": {
      const c = mainClips(ir).find((x) => x.id === op.clipId);
      if (!c) return { ok: false, message: `no main clip "${op.clipId}"` };
      if (op.x + op.width > 1.0001 || op.y + op.height > 1.0001) return { ok: false, message: "the crop goes outside the frame" };
      // Framing set by hand replaces a moving framing.
      delete c.cropKeyframes;
      if (c.transform) delete (c.transform as any).reframeTrack;
      c.transform = { ...c.transform, crop: { left: op.x, top: op.y, right: Math.max(0, 1 - op.x - op.width), bottom: Math.max(0, 1 - op.y - op.height) } };
      delete (c.transform as any).letterbox;
      return { ok: true, message: `Set the framing of clip ${op.clipId}` };
    }

    case "panClip": {
      const clips = mainClips(ir).filter((c) => op.clipId === "all" || c.id === op.clipId);
      if (!clips.length) return { ok: false, message: `no main clip "${op.clipId}"` };
      let n = 0;
      for (const c of clips) {
        let w: number | null = null;
        let h: number | null = null;
        if (c.transform?.crop) {
          w = 1 - c.transform.crop.left - c.transform.crop.right;
          h = 1 - c.transform.crop.top - c.transform.crop.bottom;
        } else {
          // The fill crop the renderer would use, from the source size.
          const src = opts.sources?.find((s) => s.assetId === c.assetId);
          const sideways = c.transform?.rotationDeg === 90 || c.transform?.rotationDeg === 270;
          const fill = src ? cropFor(sideways ? src.height : src.width, sideways ? src.width : src.height, ir.meta.resolution.width, ir.meta.resolution.height) : null;
          if (fill) {
            w = fill.width;
            h = fill.height;
          }
        }
        if (w === null || h === null || (w >= 0.999 && h >= 0.999)) continue; // the whole frame shows: nothing to pan
        const x = Math.min(1 - w, Math.max(0, op.centerX - w / 2));
        const y = Math.min(1 - h, Math.max(0, op.centerY - h / 2));
        delete c.cropKeyframes;
        if (c.transform) delete (c.transform as any).reframeTrack;
        c.transform = { ...c.transform, crop: { left: x, top: y, right: Math.max(0, 1 - x - w), bottom: Math.max(0, 1 - y - h) } };
        delete (c.transform as any).letterbox;
        n++;
      }
      if (!n) return { ok: false, message: "the whole frame is already shown, so there is nothing to pan" };
      return { ok: true, message: `Re-centred the framing of ${n} clip(s)` };
    }

    case "replaceClip": {
      const c = mainClips(ir).find((x) => x.id === op.clipId);
      if (!c) return { ok: false, message: `no main clip "${op.clipId}"` };
      const src = opts.sources?.find((s) => s.assetId === op.replacementAssetId);
      if (!src) return { ok: false, message: `no footage "${op.replacementAssetId}" on this project` };
      const need = sec(c.sourceRange.duration);
      const avail = src.durationMs / 1000;
      if (avail + 1e-3 < need) return { ok: false, message: `${op.replacementAssetId} is ${avail.toFixed(1)}s long; this clip needs ${need.toFixed(1)}s` };
      const start = sec(c.sourceRange.start) + need <= avail ? c.sourceRange.start : R(0);
      c.assetId = op.replacementAssetId;
      c.sourcePath = `device-asset://${op.replacementAssetId}`;
      c.sourceRange = { start, duration: c.sourceRange.duration };
      // The old crop was for the old footage.
      if (c.transform) delete c.transform.crop;
      return { ok: true, message: `Replaced the footage of clip ${op.clipId} with ${op.replacementAssetId}` };
    }

    case "muteTrack": {
      if (op.track === "original") {
        let t = ir.tracks.audioTracks.find((a) => a.id === ORIGINAL_AUDIO_TRACK_ID);
        if (!t) {
          t = { id: ORIGINAL_AUDIO_TRACK_ID, type: "PRIMARY_VOICE", volumeDb: 0, duckWithSpeech: false, clips: [] };
          ir.tracks.audioTracks.push(t);
        }
        t.volumeDb = op.muted ? MUTED_DB : t.volumeDb <= MUTED_DB ? 0 : t.volumeDb;
        return { ok: true, message: `${op.muted ? "Muted" : "Unmuted"} the video's own sound` };
      }
      const type = op.track === "music" ? "BGM" : op.track === "sfx" ? "SFX" : "VOICEOVER";
      const tracks = audioOf(ir, type).filter((t) => t.clips.length > 0);
      if (!tracks.length) return { ok: false, message: `there is no ${op.track} to ${op.muted ? "mute" : "unmute"}` };
      const back = op.track === "music" ? -16 : op.track === "sfx" ? -8 : 0;
      for (const t of tracks) {
        if (op.track === "music") {
          const clipDb = t.clips[0].volumeDb ?? 0;
          t.volumeDb = op.muted ? MUTED_DB - clipDb : t.volumeDb + clipDb <= MUTED_DB ? back - clipDb : t.volumeDb;
        } else {
          for (const c of t.clips) c.volumeDb = op.muted ? MUTED_DB - (t.volumeDb ?? 0) : (t.volumeDb ?? 0) + (c.volumeDb ?? 0) <= MUTED_DB ? back - (t.volumeDb ?? 0) : c.volumeDb;
        }
      }
      return { ok: true, message: `${op.muted ? "Muted" : "Unmuted"} the ${op.track}` };
    }
  }
  return { ok: false, message: `not an update operation` };
}
