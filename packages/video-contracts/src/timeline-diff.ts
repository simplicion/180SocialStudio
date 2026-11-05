import { MobileEditIR } from "./mobile-edit-ir";

/**
 * What a Director turn changes, in plain words, for the proposal card (editor overhaul Phase 3.3):
 * "+2 zooms, captions restyled (12), music −16 → −22 dB, 0 removed". Destructive changes (items removed, footage cut)
 * are counted separately so the phone can highlight them.
 */
export interface TimelineDiffSummary {
  /** One line, e.g. "+2 zooms · 12 captions restyled · music −16 → −22 dB · nothing removed". */
  text: string;
  /** Each change as its own short phrase. */
  changes: string[];
  /** Items the turn removed (not counting clips split by cuts). */
  removed: number;
  /** Seconds of footage cut (timeline got shorter by this much). */
  cutSec: number;
  /** Something is removed or cut: the phone highlights it. */
  destructive: boolean;
}

type Lane = { key: string; one: string; many: string; items: (ir: MobileEditIR) => Array<{ id: string }> };

const LANES: Lane[] = [
  { key: "titles", one: "title", many: "titles", items: (ir) => ir.captions.filter((c) => c.kind === "text") },
  { key: "captions", one: "caption", many: "captions", items: (ir) => ir.captions.filter((c) => c.kind !== "text") },
  { key: "zooms", one: "zoom", many: "zooms", items: (ir) => ir.zooms },
  { key: "overlays", one: "B-roll / layer", many: "B-roll / layers", items: (ir) => ir.overlays },
  { key: "effects", one: "effect", many: "effects", items: (ir) => ir.effects ?? [] },
  { key: "sfx", one: "sound effect", many: "sound effects", items: (ir) => ir.audio.sfx ?? [] },
  { key: "voiceovers", one: "voiceover", many: "voiceovers", items: (ir) => ir.audio.voiceovers ?? [] },
];

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const db = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 10) / 10)}`;

export function summarizeTimelineDiff(before: MobileEditIR, after: MobileEditIR): TimelineDiffSummary {
  const changes: string[] = [];
  let removed = 0;

  // Footage: length and cuts.
  const cutMs = before.durationMs - after.durationMs;
  if (cutMs > 50) changes.push(`${(cutMs / 1000).toFixed(1)} s cut`);
  else if (cutMs < -50) changes.push(`+${(-cutMs / 1000).toFixed(1)} s of footage`);
  const clipIds = (ir: MobileEditIR) => ir.clips.map((c) => `${c.assetId}:${c.sourceStartMs}-${c.sourceEndMs}`);
  if (Math.abs(cutMs) <= 50 && !same(clipIds(before), clipIds(after))) changes.push("clips re-arranged");
  const look = (c: MobileEditIR["clips"][number]) => [c.speed, c.volumeDb, c.crop, c.filter, c.transitionIn, c.rotationDeg ?? 0, c.flipH ?? false];
  if (same(clipIds(before), clipIds(after))) {
    const n = after.clips.filter((c, i) => !same(look(c), look(before.clips[i]))).length;
    if (n) changes.push(`${count(n, "clip", "clips")} adjusted`);
  }
  if (before.canvas.aspect !== after.canvas.aspect) changes.push(`canvas ${before.canvas.aspect} → ${after.canvas.aspect}`);

  // Item lanes: added, removed, changed (text vs look).
  for (const lane of LANES) {
    const b = new Map(lane.items(before).map((x) => [x.id, x]));
    const a = new Map(lane.items(after).map((x) => [x.id, x]));
    const added = [...a.keys()].filter((id) => !b.has(id)).length;
    const gone = [...b.keys()].filter((id) => !a.has(id)).length;
    let restyled = 0;
    let retexted = 0;
    let moved = 0;
    let other = 0;
    for (const [id, x] of a) {
      const y = b.get(id) as any;
      if (!y || same(x, y)) continue;
      const xx = x as any;
      if ((lane.key === "captions" || lane.key === "titles") && xx.text !== y.text) retexted++;
      else if ((lane.key === "captions" || lane.key === "titles") && !same(xx.style, y.style)) restyled++;
      else if (same({ ...xx, startMs: 0, endMs: 0, timelineStartMs: 0, timelineEndMs: 0, words: [] }, { ...y, startMs: 0, endMs: 0, timelineStartMs: 0, timelineEndMs: 0, words: [] })) moved++;
      else other++;
    }
    // Pure timing shifts caused by a cut are not news; they are only counted when nothing was cut.
    if (cutMs > 50) moved = 0;
    removed += gone;
    if (added) changes.push(`+${count(added, lane.one, lane.many)}`);
    if (gone) changes.push(`−${count(gone, lane.one, lane.many)}`);
    if (retexted) changes.push(`${count(retexted, lane.one, lane.many)} reworded`);
    if (restyled) changes.push(`${count(restyled, lane.one, lane.many)} restyled`);
    if (moved) changes.push(`${count(moved, lane.one, lane.many)} moved`);
    if (other) changes.push(`${count(other, lane.one, lane.many)} changed`);
  }

  // Music: added / removed / swapped / level / fades / ducking.
  const mb = before.audio.music[0];
  const ma = after.audio.music[0];
  if (!mb && ma) changes.push("+music");
  else if (mb && !ma) {
    changes.push("−music");
    removed++;
  } else if (mb && ma) {
    if (!same(mb.source, ma.source)) changes.push("music track changed");
    if (mb.volumeDb !== ma.volumeDb) changes.push(`music ${db(mb.volumeDb)} → ${db(ma.volumeDb)} dB`);
    if (mb.fadeInMs !== ma.fadeInMs || mb.fadeOutMs !== ma.fadeOutMs) changes.push("music fades changed");
    if (mb.duck.enabled !== ma.duck.enabled) changes.push(ma.duck.enabled ? "music ducks under speech" : "music ducking off");
  }
  if (before.audio.originalTrack.volumeDb !== after.audio.originalTrack.volumeDb) {
    changes.push(`original sound ${db(before.audio.originalTrack.volumeDb)} → ${db(after.audio.originalTrack.volumeDb)} dB`);
  }
  if (!same(before.watermark ?? null, after.watermark ?? null)) changes.push(after.watermark ? (before.watermark ? "logo changed" : "+logo") : "−logo");

  const cutSec = Math.max(0, Math.round(cutMs / 100) / 10);
  const destructive = removed > 0 || cutSec > 0.05;
  const tail = removed ? `${removed} removed` : "nothing removed";
  const text = changes.length ? `${changes.join(" · ")} · ${tail}` : "no changes";
  return { text, changes, removed, cutSec, destructive };
}
