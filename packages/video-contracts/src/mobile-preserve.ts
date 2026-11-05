import { EditIR } from "./edit-ir.schema";
import { MobileEditIR } from "./mobile-edit-ir";
import { ORIGINAL_AUDIO_TRACK_ID } from "./creative-plan.schema";

/**
 * Lossless round trip for what a Director turn did not touch (audit F-05).
 *
 * The server edits a canonical copy of the client's MobileEditIR and projects the result back. The projection is
 * not an identity: it clamps, trims, drops short items and normalises fields. So every item whose canonical form
 * is the same after the turn as before it is given back exactly as the client sent it. Items the turn created,
 * changed or moved (a cut ripples later items) keep the projected form.
 *
 * `before` must be the canonical IR built from `client` before compiling (an untouched copy), `after` the final one.
 */
export function preserveUntouched(client: MobileEditIR, before: EditIR, after: EditIR, projected: MobileEditIR): MobileEditIR {
  const out: MobileEditIR = { ...projected, audio: { ...projected.audio } };
  const same = (a: unknown, b: unknown) => a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b);

  /** One lane: untouched items come back verbatim; the whole client lane (order included) when nothing changed. */
  function lane<T extends { id: string }>(
    clientItems: T[] | undefined,
    projectedItems: T[] | undefined,
    canonBefore: Map<string, unknown>,
    canonAfter: Map<string, unknown>,
    startOf: (x: T) => number
  ): T[] | undefined {
    const mine = clientItems ?? [];
    const untouched = (id: string) => same(canonBefore.get(id), canonAfter.get(id));
    const laneUntouched =
      canonBefore.size === canonAfter.size && [...canonAfter.keys()].every((id) => untouched(id)) && mine.every((x) => canonAfter.has(x.id));
    if (laneUntouched) return clientItems === undefined && !(projectedItems?.length) ? undefined : [...mine];
    const byId = new Map(mine.map((x) => [x.id, x]));
    const result = (projectedItems ?? []).map((p) => (byId.has(p.id) && untouched(p.id) ? byId.get(p.id)! : p));
    const present = new Set(result.map((x) => x.id));
    // Untouched client items the projection dropped (too short, overlapping, ...) are the creator's: they come back.
    for (const x of mine) if (!present.has(x.id) && untouched(x.id)) result.push(x);
    return result.sort((a, b) => startOf(a) - startOf(b));
  }

  const idx = (ir: EditIR) => {
    const main = ir.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO") || ir.tracks.videoTracks[0];
    const bgm = ir.tracks.audioTracks.filter((t) => t.type === "BGM");
    const sfxTracks = ir.tracks.audioTracks.filter((t) => t.type === "SFX");
    const voTracks = ir.tracks.audioTracks.filter((t) => t.type === "VOICEOVER");
    return {
      clips: new Map((main?.clips ?? []).map((c) => [c.id, c] as [string, unknown])),
      overlays: new Map(ir.tracks.videoTracks.filter((t) => t !== main).flatMap((t) => t.clips.map((c) => [c.id, c] as [string, unknown]))),
      captions: new Map(ir.tracks.captionTrack.map((c) => [c.id, c] as [string, unknown])),
      zooms: new Map(ir.tracks.cameraTrack.map((z) => [z.id, z] as [string, unknown])),
      effects: new Map((ir.tracks.effectTrack ?? []).map((e) => [e.id, e] as [string, unknown])),
      // Track-level gain / ducking belongs to the item on mobile, so it is part of the comparison.
      music: new Map(bgm.flatMap((t) => t.clips.map((c) => [c.id, { t: { ...t, clips: undefined }, c }] as [string, unknown]))),
      sfx: new Map(sfxTracks.flatMap((t) => t.clips.map((c) => [c.id, { v: t.volumeDb, c }] as [string, unknown]))),
      voiceovers: new Map(voTracks.flatMap((t) => t.clips.map((c) => [c.id, { v: t.volumeDb, c }] as [string, unknown]))),
      original: ir.tracks.audioTracks.find((t) => t.id === ORIGINAL_AUDIO_TRACK_ID)?.volumeDb ?? 0,
      meta: { a: ir.meta.targetAspect, r: ir.meta.resolution, f: ir.meta.fps, b: ir.meta.background ?? null },
    };
  };
  const b = idx(before);
  const a = idx(after);

  // A clip's framing depends on the canvas (its automatic fill crop): a canvas change means every clip is re-projected.
  const canvasSame = same(b.meta, a.meta);
  const clips = canvasSame ? lane(client.clips, projected.clips, b.clips, a.clips, (c) => c.timelineStartMs)! : projected.clips;
  out.clips = clips;
  const clipsVerbatim = clips.length === client.clips.length && clips.every((c, i) => c === client.clips[i]);
  if (clipsVerbatim) out.durationMs = client.durationMs;
  if (canvasSame) out.canvas = client.canvas;

  out.overlays = lane(client.overlays, projected.overlays, b.overlays, a.overlays, (o) => o.timelineStartMs)!;
  out.captions = lane(client.captions, projected.captions, b.captions, a.captions, (c) => c.startMs)!;
  out.zooms = lane(client.zooms, projected.zooms, b.zooms, a.zooms, (z) => z.startMs)!;
  const effects = lane(client.effects, projected.effects, b.effects, a.effects, (e) => e.startMs);
  if (effects === undefined || (effects.length === 0 && client.effects === undefined)) delete out.effects;
  else out.effects = effects;

  out.audio.music = lane(client.audio.music, projected.audio.music, b.music, a.music, (m) => m.timelineStartMs)!;
  const sfx = lane(client.audio.sfx, projected.audio.sfx, b.sfx, a.sfx, (s) => s.timelineStartMs);
  if (sfx === undefined || (sfx.length === 0 && client.audio.sfx === undefined)) delete out.audio.sfx;
  else out.audio.sfx = sfx;
  const vo = lane(client.audio.voiceovers, projected.audio.voiceovers, b.voiceovers, a.voiceovers, (v) => v.timelineStartMs);
  if (vo === undefined || (vo.length === 0 && client.audio.voiceovers === undefined)) delete out.audio.voiceovers;
  else out.audio.voiceovers = vo;
  if (b.original === a.original) out.audio.originalTrack = client.audio.originalTrack;

  // Sources: the client's order and values; sources the turn added (or refreshed) after them.
  const clientSrc = new Map(client.sources.map((s) => [s.assetId, s]));
  const projectedSrc = new Map(projected.sources.map((s) => [s.assetId, s]));
  out.sources = [
    ...client.sources.map((s) => projectedSrc.get(s.assetId) ?? s).map((s) => (same(s, clientSrc.get(s.assetId)) ? clientSrc.get(s.assetId)! : s)),
    ...projected.sources.filter((s) => !clientSrc.has(s.assetId)),
  ];

  // Provenance: the creator's entries for items still on the timeline; items this turn created are the Director's.
  // Main clips are footage (their ids change with every cut), so only the creator's own clip entries are carried.
  const clientMeta = client.itemMeta ?? {};
  const clientIds = new Set([
    ...client.clips, ...client.overlays, ...client.captions, ...client.zooms, ...(client.effects ?? []),
    ...client.audio.music, ...(client.audio.sfx ?? []), ...(client.audio.voiceovers ?? []),
  ].map((x) => x.id));
  const meta: NonNullable<MobileEditIR["itemMeta"]> = {};
  for (const c of out.clips) if (clientMeta[c.id]) meta[c.id] = clientMeta[c.id];
  for (const x of [...out.overlays, ...out.captions, ...out.zooms, ...(out.effects ?? []), ...out.audio.music, ...(out.audio.sfx ?? []), ...(out.audio.voiceovers ?? [])]) {
    if (clientMeta[x.id]) meta[x.id] = clientMeta[x.id];
    else if (!clientIds.has(x.id)) meta[x.id] = { origin: "director" };
  }
  if (Object.keys(meta).length || client.itemMeta) out.itemMeta = meta;
  else delete out.itemMeta;
  return out;
}
