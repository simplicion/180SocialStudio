import { CreativeOperation } from "./creative-plan.schema";
import { MobileEditIR } from "./mobile-edit-ir";

/**
 * Item provenance and per-item locks (editor overhaul Phase 2.2, audit F-21).
 *
 * `MobileEditIR.itemMeta[id]` says who made an item (`origin`: manual / director / template) and whether the creator
 * locked it. The Director never changes or removes a locked item, and never sweeps away the creator's own items
 * ("remove the zooms" keeps the ones they made) unless the request says "all" / "every".
 */
export type ItemOrigin = "manual" | "director" | "template";
export interface ItemMeta { origin?: ItemOrigin; locked?: boolean }

type Lane = "clips" | "overlays" | "captions" | "zooms" | "effects" | "music" | "sfx" | "voiceovers";

interface IndexedItem { lane: Lane; id: string; startMs: number; endMs: number; kind: string }

/** Every item of a timeline with its lane, span and removeItem kind. */
export function indexItems(ir: MobileEditIR): IndexedItem[] {
  const out: IndexedItem[] = [];
  for (const c of ir.clips) out.push({ lane: "clips", id: c.id, startMs: c.timelineStartMs, endMs: c.timelineEndMs, kind: "clip" });
  for (const o of ir.overlays) {
    const sticker = o.mediaType === "image" && o.layer?.mode === "overlay";
    out.push({ lane: "overlays", id: o.id, startMs: o.timelineStartMs, endMs: o.timelineEndMs, kind: sticker ? "sticker" : "broll" });
  }
  for (const c of ir.captions) out.push({ lane: "captions", id: c.id, startMs: c.startMs, endMs: c.endMs, kind: c.kind === "text" ? "title" : "caption" });
  for (const z of ir.zooms) out.push({ lane: "zooms", id: z.id, startMs: z.startMs, endMs: z.endMs, kind: "zoom" });
  for (const e of ir.effects ?? []) out.push({ lane: "effects", id: e.id, startMs: e.startMs, endMs: e.endMs, kind: "effect" });
  for (const m of ir.audio.music) out.push({ lane: "music", id: m.id, startMs: m.timelineStartMs, endMs: m.timelineEndMs, kind: "music" });
  for (const s of ir.audio.sfx ?? []) out.push({ lane: "sfx", id: s.id, startMs: s.timelineStartMs, endMs: s.timelineStartMs + (s.durationMs ?? 1000), kind: "sfx" });
  for (const v of ir.audio.voiceovers ?? []) out.push({ lane: "voiceovers", id: v.id, startMs: v.timelineStartMs, endMs: v.timelineStartMs + v.durationMs, kind: "voiceover" });
  return out;
}

const LABEL: Record<string, string> = {
  clip: "clip", broll: "B-roll", sticker: "sticker", caption: "caption", title: "title", zoom: "zoom", effect: "effect", music: "music", sfx: "sound effect", voiceover: "voiceover",
};

/** Ops that take a main clip id and accept "all". */
const CLIP_ALL_OPS = new Set(["changeSpeed", "rotateClip", "cleanVoice", "fadeClipAudio", "setClipVolume", "panClip"]);
/** Ops that cut / split / re-time footage in a time range: forbidden over a locked clip. */
const CUT_OPS = new Set(["removeRange", "trimClip", "reorderSegment", "moveClip", "rippleDelete", "splitClip", "speedRamp", "changeSpeed", "freezeFrame"]);
/** Ops that change the music bed. */
const MUSIC_OPS = new Set(["updateMusic", "changeMusicTrack", "duckAudio"]);

/** Ids an operation names explicitly. */
function targetIds(op: any): string[] {
  const ids = [op.id, op.target, op.overlayId, op.captionId, op.targetId, op.clipId].filter((v) => typeof v === "string" && v && v !== "all" && v !== "*" && v !== "auto" && !String(v).startsWith("all_"));
  return [...new Set(ids as string[])];
}

export interface ItemLockContext {
  meta: Record<string, ItemMeta>;
  /** The creator's request names everything ("all the zooms", "every caption"): sweeps may include their own items. */
  allowManualSweep: boolean;
}

/** The request asks for a sweep over everything of a kind. */
export const asksForAll = (prompt: string) => /\b(all|every|everything|each)\b/i.test(prompt);

/**
 * Drops (or narrows) operations that would change a locked item, or sweep away the creator's own items.
 * Returns the operations to compile and one violation line per change refused.
 */
export function applyItemLocks(ops: CreativeOperation[], ir: MobileEditIR, ctx: ItemLockContext): { ops: CreativeOperation[]; violations: string[] } {
  const items = indexItems(ir);
  const byId = new Map(items.map((i) => [i.id, i]));
  const locked = new Set(Object.entries(ctx.meta).filter(([, m]) => m.locked).map(([id]) => id));
  const manual = new Set(Object.entries(ctx.meta).filter(([, m]) => m.origin === "manual").map(([id]) => id));
  const lockedClips = items.filter((i) => i.lane === "clips" && locked.has(i.id));
  const musicLocked = items.some((i) => i.lane === "music" && locked.has(i.id));
  const violations: string[] = [];
  const out: CreativeOperation[] = [];
  const msOf = (s: number) => Math.round(s * 1000);
  const overlapsLockedClip = (aMs: number, bMs: number) => lockedClips.find((c) => Math.max(aMs, c.startMs) < Math.min(bMs, c.endMs) - 1);

  for (const raw of ops) {
    const op: any = raw;
    // 1. An explicitly named locked item.
    const hit = targetIds(op).find((id) => locked.has(id));
    if (hit) {
      violations.push(`${op.type} would change your locked ${LABEL[byId.get(hit)?.kind ?? ""] ?? "item"} ${hit}`);
      continue;
    }
    // 2. Locked music.
    if (musicLocked && (MUSIC_OPS.has(op.type) || (op.type === "adjustVolume" && op.trackId === "music") || (op.type === "muteTrack" && op.track === "music") || (op.type === "addBackgroundMusic" && op.replace) || (op.type === "removeItem" && op.kind === "music"))) {
      violations.push(`${op.type} would change your locked music`);
      continue;
    }
    if (lockedClips.length) {
      // 3. "all clips" sweeps skip locked clips.
      if (CLIP_ALL_OPS.has(op.type) && (op.clipId === "all" || op.clipId === "*")) {
        const free = items.filter((i) => i.lane === "clips" && !locked.has(i.id));
        violations.push(`${op.type} left your ${lockedClips.length} locked clip(s) unchanged`);
        for (const c of free) out.push({ ...op, clipId: c.id });
        continue;
      }
      // 4. Cutting, splitting or re-timing a locked clip.
      let range: [number, number] | null = null;
      if (op.type === "removeRange") range = [msOf(op.startSec), msOf(op.startSec + op.durationSec)];
      else if (op.type === "reorderSegment") range = [msOf(op.segmentStartSec), msOf(op.segmentStartSec + op.segmentDurationSec)];
      else if (op.type === "freezeFrame" || op.type === "splitClip") {
        const t = msOf(op.type === "freezeFrame" ? op.timestampSec : op.splitTimeSec);
        range = [t, t + 1];
      }
      const inLocked = range ? overlapsLockedClip(range[0], range[1]) : null;
      if (CUT_OPS.has(op.type) && inLocked) {
        violations.push(`${op.type} would cut or re-time your locked clip ${inLocked.id}`);
        continue;
      }
      if (op.type === "beatAlign" || op.type === "reframeSubject" || op.type === "changeAspectRatio") {
        violations.push(`${op.type} would change your locked clip(s)`);
        continue;
      }
    }
    // 5. "Remove the zooms" (no id, no time) keeps the creator's own and locked items unless they said "all".
    if (op.type === "removeItem" && !op.id && typeof op.atSec !== "number") {
      const ofKind = items.filter((i) => i.kind === op.kind || (op.kind === "broll" && i.kind === "sticker"));
      const keep = ofKind.filter((i) => locked.has(i.id) || (!ctx.allowManualSweep && manual.has(i.id)));
      if (keep.length) {
        const drop = ofKind.filter((i) => !keep.includes(i));
        violations.push(`kept ${keep.length} ${LABEL[op.kind] ?? op.kind}${keep.length === 1 ? "" : "s"} you made or locked (say "all" to remove those too)`);
        for (const i of drop) out.push({ ...op, id: i.id });
        continue;
      }
    }
    out.push(raw);
  }
  return { ops: out, violations };
}

const TIME_FIELDS: Record<Exclude<Lane, "clips">, string[]> = {
  overlays: ["timelineStartMs", "timelineEndMs"],
  captions: ["startMs", "endMs"],
  zooms: ["startMs", "endMs"],
  effects: ["startMs", "endMs"],
  music: ["timelineStartMs", "timelineEndMs"],
  sfx: ["timelineStartMs"],
  voiceovers: ["timelineStartMs"],
};

function laneOf(ir: MobileEditIR, lane: Exclude<Lane, "clips">): any[] | undefined {
  switch (lane) {
    case "overlays": return ir.overlays;
    case "captions": return ir.captions;
    case "zooms": return ir.zooms;
    case "effects": return ir.effects;
    case "music": return ir.audio.music;
    case "sfx": return ir.audio.sfx;
    case "voiceovers": return ir.audio.voiceovers;
  }
}

function setLane(ir: MobileEditIR, lane: Exclude<Lane, "clips">, items: any[]) {
  switch (lane) {
    case "overlays": ir.overlays = items; break;
    case "captions": ir.captions = items; break;
    case "zooms": ir.zooms = items; break;
    case "effects": ir.effects = items; break;
    case "music": ir.audio.music = items; break;
    case "sfx": ir.audio.sfx = items; break;
    case "voiceovers": ir.audio.voiceovers = items; break;
  }
}

/**
 * Backstop for locks: a locked item the turn still changed (a sweep such as "restyle all captions") comes back as
 * the creator's version; only its position follows the cuts (shifted by the move of its start). A locked item the
 * turn removed is put back. Returns the ids restored.
 */
export function enforceItemLocks(client: MobileEditIR, out: MobileEditIR): { editIR: MobileEditIR; restored: string[] } {
  const meta = client.itemMeta ?? {};
  const locked = new Set(Object.entries(meta).filter(([, m]) => m.locked).map(([id]) => id));
  if (!locked.size) return { editIR: out, restored: [] };
  const result: MobileEditIR = { ...out, audio: { ...out.audio } };
  const restored: string[] = [];
  for (const lane of Object.keys(TIME_FIELDS) as Array<Exclude<Lane, "clips">>) {
    const mine = (laneOf(client, lane) ?? []).filter((x: any) => locked.has(x.id));
    if (!mine.length) continue;
    const fields = TIME_FIELDS[lane];
    const items = [...(laneOf(result, lane) ?? [])];
    const before = restored.length;
    for (const x of mine) {
      const i = items.findIndex((y: any) => y.id === x.id);
      const theirs = i >= 0 ? items[i] : null;
      const delta = theirs ? (theirs[fields[0]] as number) - (x[fields[0]] as number) : 0;
      const back = JSON.parse(JSON.stringify(x));
      for (const f of fields) back[f] = Math.max(0, Math.min(result.durationMs, (x[f] as number) + delta));
      if (lane === "captions") back.words = (x.words ?? []).map((w: any) => ({ ...w, startMs: Math.max(0, w.startMs + delta), endMs: Math.max(0, w.endMs + delta) }));
      if (theirs && JSON.stringify(theirs) === JSON.stringify(back)) continue;
      if (theirs) items[i] = back;
      else if ((back[fields[0]] as number) < result.durationMs) items.push(back);
      else continue;
      restored.push(x.id);
    }
    if (restored.length === before) continue; // nothing restored: the lane (and its order) stays as it is
    const key = fields[0];
    setLane(result, lane, items.sort((a: any, b: any) => a[key] - b[key]));
  }
  return { editIR: result, restored };
}
