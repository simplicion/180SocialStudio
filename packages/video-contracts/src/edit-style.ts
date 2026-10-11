/**
 * Edit-style fingerprint: how the creator has edited so far, measured from the timeline (no AI). The AI Director uses
 * it to continue a half-finished edit in the same style ("finish this like I started it") and to keep later turns
 * consistent. Pure and deterministic.
 */
import type { EditIR } from "./edit-ir.schema";
import { RationalTimeMath } from "./time";

export interface EditStyleFingerprint {
  durationSec: number;
  /** End of the last edit marker (caption, title, zoom, B-roll/layer, effect, SFX, cut); 0 = nothing edited yet. */
  editedUntilSec: number;
  /** The tail with no edits yet, when it is long enough to matter (≥ 3 s and ≥ 15% of the video). */
  uneditedRange: { fromSec: number; toSec: number } | null;
  /** Average main-track shot length inside the edited part. */
  avgShotSec: number | null;
  cutsPerMin: number;
  zoomsPerMin: number;
  avgZoomScale: number | null;
  brollPerMin: number;
  avgBrollSec: number | null;
  /** Share of overlays drawn as layers (PiP / stickers) rather than full-frame cutaways. */
  layerShare: number;
  effectsPerMin: number;
  effectTypes: string[];
  sfxPerMin: number;
  transitionTypes: string[];
  filterPreset: string | null;
  captions: { preset: string; textColor: string; highlightColor: string; animation: string | null; fontFamily: string } | null;
  titles: { count: number; fontFamily: string | null; enter: string | null; exit: string | null; loop: string | null; glow: boolean } | null;
  music: { volumeDb: number; ducked: boolean } | null;
}

const sec = (t: any) => RationalTimeMath.toSeconds(t);
/** Names from the timeline (fonts, preset labels) are user data: keep them to plain words so they cannot carry prompt text. */
const label = (v: unknown): string => String(v ?? "").replace(/[^\w #().-]/g, "").slice(0, 40);
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const mode = (xs: string[]): string | null => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
};

export function deriveEditStyle(ir: EditIR): EditStyleFingerprint {
  const duration = Math.max(0, sec(ir.meta.totalDuration));
  const main = ir.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO")?.clips ?? [];
  const overlays = ir.tracks.videoTracks.filter((t) => t.type !== "MAIN_VIDEO").flatMap((t) => t.clips);
  const caps = ir.tracks.captionTrack.filter((c) => c.role !== "title");
  const titles = ir.tracks.captionTrack.filter((c) => c.role === "title");
  const zooms = ir.tracks.cameraTrack;
  const effects = ir.tracks.effectTrack ?? [];
  const sfx = ir.tracks.audioTracks.filter((t) => t.type === "SFX").flatMap((t) => t.clips);
  const bgm = ir.tracks.audioTracks.find((t) => t.type === "BGM" && t.clips.length > 0);

  const end = (start: any, dur: any) => sec(start) + sec(dur);
  // Captions are usually generated for the whole video at once, so they do not mark where manual editing stopped.
  const markers = [
    ...titles.map((c) => end(c.timeRange.start, c.timeRange.duration)),
    ...zooms.map((z) => end(z.timeRange.start, z.timeRange.duration)),
    ...overlays.map((o) => end(o.timelineRange.start, o.timelineRange.duration)),
    ...effects.map((e: any) => end(e.timeRange.start, e.timeRange.duration)),
    ...sfx.map((s: any) => end(s.timelineRange.start, s.timelineRange.duration)),
    // A cut boundary between main clips is an edit (the first clip's start is not).
    ...main.slice(1).map((c) => sec(c.timelineRange.start)),
  ];
  const editedUntil = Math.min(duration, markers.length ? Math.max(...markers) : 0);
  const tail = duration - editedUntil;
  const uneditedRange = editedUntil > 0 && tail >= 3 && tail >= duration * 0.15 ? { fromSec: round(editedUntil), toSec: round(duration) } : null;

  // Rates are measured over the part the creator actually edited (or the whole video when nothing marks an end).
  const span = Math.max(1, uneditedRange ? editedUntil : duration);
  const perMin = (n: number) => round((n / span) * 60, 1);
  const inSpan = (startSec: number) => startSec < span + 0.01;

  const editedShots = main.filter((c) => inSpan(sec(c.timelineRange.start)));
  const shotLens = editedShots.map((c) => sec(c.timelineRange.duration)).filter((d) => d > 0);
  const zoomsIn = zooms.filter((z) => inSpan(sec(z.timeRange.start)));
  const overlaysIn = overlays.filter((o) => inSpan(sec(o.timelineRange.start)));
  const effectsIn = effects.filter((e: any) => inSpan(sec(e.timeRange.start)));
  const sfxIn = sfx.filter((s: any) => inSpan(sec(s.timelineRange.start)));
  const transitions = main.map((c) => c.transitionIn?.type as string | undefined).filter((t): t is string => !!t && t !== "CUT");
  const filters = main.map((c) => (c.transform as any)?.filterPreset).filter((f): f is string => !!f && f !== "NORMAL");

  const cap0 = caps[0];
  const titleStyle = (k: "enter" | "exit" | "loop") => mode(titles.map((t) => (t.style as any)[k]?.type).filter(Boolean));
  return {
    durationSec: round(duration),
    editedUntilSec: round(editedUntil),
    uneditedRange,
    avgShotSec: shotLens.length ? round(shotLens.reduce((a, b) => a + b, 0) / shotLens.length) : null,
    cutsPerMin: perMin(Math.max(0, editedShots.length - 1)),
    zoomsPerMin: perMin(zoomsIn.length),
    avgZoomScale: zoomsIn.length ? round(zoomsIn.reduce((a, z) => a + z.scale, 0) / zoomsIn.length) : null,
    brollPerMin: perMin(overlaysIn.length),
    avgBrollSec: overlaysIn.length ? round(overlaysIn.reduce((a, o) => a + sec(o.timelineRange.duration), 0) / overlaysIn.length) : null,
    layerShare: overlays.length ? round(overlays.filter((o) => o.layer?.mode === "overlay").length / overlays.length) : 0,
    effectsPerMin: perMin(effectsIn.length),
    effectTypes: [...new Set(effectsIn.map((e: any) => String(e.type)))],
    sfxPerMin: perMin(sfxIn.length),
    transitionTypes: [...new Set(transitions)],
    filterPreset: mode(filters),
    captions: cap0
      ? {
          preset: label(cap0.style.presetLabel || cap0.style.preset),
          textColor: label(cap0.style.textColor),
          highlightColor: label(cap0.style.highlightColor),
          animation: cap0.style.animation ?? null,
          fontFamily: label(cap0.style.fontFamily),
        }
      : null,
    titles: titles.length
      ? {
          count: titles.length,
          fontFamily: mode(titles.map((t) => label(t.style.fontFamily))),
          enter: titleStyle("enter"),
          exit: titleStyle("exit"),
          loop: titleStyle("loop"),
          glow: titles.some((t) => !!t.style.glow),
        }
      : null,
    music: bgm ? { volumeDb: bgm.volumeDb, ducked: !!bgm.duckWithSpeech } : null,
  };
}

/** Prompt lines for the Director: the measured style and, when part of the video is still raw, what to do with it. */
export function describeEditStyle(f: EditStyleFingerprint): string[] {
  const parts: string[] = [];
  if (f.avgShotSec != null && f.cutsPerMin > 0) parts.push(`shots ~${f.avgShotSec}s (${f.cutsPerMin} cuts/min)`);
  if (f.zoomsPerMin) parts.push(`${f.zoomsPerMin} zooms/min (avg x${f.avgZoomScale})`);
  if (f.brollPerMin) parts.push(`${f.brollPerMin} B-roll/min (~${f.avgBrollSec}s each${f.layerShare >= 0.5 ? ", mostly picture-in-picture layers" : ""})`);
  if (f.effectsPerMin) parts.push(`${f.effectsPerMin} effects/min (${f.effectTypes.join(", ")})`);
  if (f.sfxPerMin) parts.push(`${f.sfxPerMin} sound effects/min`);
  if (f.transitionTypes.length) parts.push(`transitions: ${f.transitionTypes.join(", ")}`);
  if (f.filterPreset) parts.push(`filter ${f.filterPreset}`);
  if (f.captions) parts.push(`captions ${f.captions.preset} (${f.captions.textColor} / highlight ${f.captions.highlightColor}, ${f.captions.animation ?? "static"})`);
  if (f.titles) {
    const motion = [f.titles.enter && `in ${f.titles.enter}`, f.titles.exit && `out ${f.titles.exit}`, f.titles.loop && `loop ${f.titles.loop}`].filter(Boolean).join(", ");
    parts.push(`${f.titles.count} title(s) in ${f.titles.fontFamily ?? "default font"}${motion ? ` (${motion})` : ""}${f.titles.glow ? ", glow" : ""}`);
  }
  if (f.music) parts.push(`music at ${f.music.volumeDb}dB${f.music.ducked ? ", ducked" : ""}`);
  const lines = [`- creator's edit style: ${parts.length ? parts.join("; ") : "nothing edited yet"}`];
  if (f.uneditedRange) {
    lines.push(
      `- edited up to ${f.editedUntilSec}s; ${f.uneditedRange.fromSec}s–${f.uneditedRange.toSec}s is still unedited. ` +
        `If asked to finish / complete / continue, edit ONLY that range and match the style above at the same density ` +
        `(same cut rhythm, zooms, B-roll/layers, effects, sound effects, caption and title styles). Do not change the edited part.`,
    );
  }
  return lines;
}
