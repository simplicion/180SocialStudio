/**
 * Seeded generator of valid, client-shaped MobileEditIR timelines that exercise every optional field
 * (layers + keyframes, chroma, mask, filters, fades, voiceCleanup, process, SFX with/without duration, device
 * music/SFX, voiceovers, watermark x/y, caption motion/glow, titles with styled words, overlapping and very short
 * manual items). Used by the F-05 round-trip identity tests.
 */
import { MobileEditIR, MobileEditIRSchema } from "../../src";

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
  const int = (a: number, b: number) => a + Math.floor(next() * (b - a + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  const chance = (p: number) => next() < p;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { next, int, pick, chance, r2 };
}

const HEX = ["#FFFFFF", "#FFE600", "#00E5FF", "#EF4444", "#000000", "#22C55E"];

export function randomMobileEditIR(seed: number): MobileEditIR {
  const r = rng(seed);
  const aspect = r.pick(["9:16", "16:9", "1:1", "4:5"] as const);
  const size = { "9:16": [1080, 1920], "16:9": [1920, 1080], "1:1": [1080, 1080], "4:5": [1080, 1350] }[aspect];
  const sources = [{ assetId: "primary", durationMs: r.int(8000, 60000), width: r.pick([1920, 1080]), height: r.pick([1080, 1920]) }];
  if (r.chance(0.5)) sources.push({ assetId: "clip2", durationMs: r.int(3000, 20000), width: 1080, height: 1920 });

  const clips: MobileEditIR["clips"] = [];
  let cursor = 0;
  const nClips = r.int(1, 4);
  for (let i = 0; i < nClips; i++) {
    const src = r.pick(sources);
    const a = r.int(0, Math.max(0, src.durationMs - 1500));
    const b = Math.min(src.durationMs, a + r.int(800, 8000));
    const speed = r.pick([1, 1, 0.5, 1.5, 2]);
    const dur = Math.max(1, Math.round((b - a) / speed));
    clips.push({
      id: `c${i + 1}`,
      assetId: src.assetId,
      sourceStartMs: a,
      sourceEndMs: b,
      timelineStartMs: cursor,
      timelineEndMs: cursor + dur,
      speed,
      volumeDb: r.pick([0, 0, -6, -60]),
      crop: r.chance(0.5) ? { x: r.r2(r.next() * 0.4), y: 0, width: 0.3164, height: 1 } : null,
      filter: r.chance(0.4)
        ? {
            preset: r.pick(["NORMAL", "WARM", "VINTAGE"]),
            brightness: r.r2(0.8 + r.next() * 0.4),
            contrast: r.r2(0.8 + r.next() * 0.4),
            saturation: r.r2(0.5 + r.next()),
            ...(r.chance(0.5) ? { exposure: r.r2(r.next() - 0.5) } : {}),
            ...(r.chance(0.5) ? { temperature: r.r2(r.next() - 0.5) } : {}),
            ...(r.chance(0.5) ? { tint: r.r2(r.next() - 0.5) } : {}),
            ...(r.chance(0.5) ? { vignette: r.r2(r.next()) } : {}),
          }
        : null,
      transitionIn: i > 0 && r.chance(0.5) ? { type: r.pick(["CROSSFADE", "DIP_BLACK", "GLITCH", "CUT"] as const), durationMs: r.int(100, 600) } : null,
      ...(r.chance(0.2) ? { rotationDeg: r.pick([90, 180, 270] as const) } : {}),
      ...(r.chance(0.2) ? { flipH: true } : {}),
      ...(r.chance(0.3) ? { audioFadeInMs: r.int(50, 400) } : {}),
      ...(r.chance(0.3) ? { audioFadeOutMs: r.int(50, 400) } : {}),
      ...(r.chance(0.2) ? { voiceCleanup: true } : {}),
      ...(r.chance(0.1) ? { process: r.pick(["reverse", "stabilize"] as const) } : {}),
    });
    cursor += dur;
  }
  const D = cursor;
  const span = (minLen: number, maxLen: number) => {
    const s = r.int(0, Math.max(0, D - minLen));
    return [s, Math.min(D, s + r.int(minLen, maxLen))] as const;
  };

  const overlays: MobileEditIR["overlays"] = [];
  for (let i = 0; i < r.int(0, 3); i++) {
    const [s, e] = span(40, 3000); // includes < 100 ms (the projection used to drop those)
    overlays.push({
      id: `o${i}`, kind: "broll", timelineStartMs: s, timelineEndMs: Math.max(s + 1, e), sourceStartMs: r.int(0, 2000),
      source: r.pick([
        { kind: "url" as const, url: `https://cdn.example.com/b${i}.mp4` },
        { kind: "asset" as const, assetId: `local_${i}` },
        { kind: "stock_query" as const, query: "city skyline", url: null },
      ]),
      fit: r.pick(["cover", "contain"] as const), opacity: r.r2(0.3 + r.next() * 0.7), muted: r.chance(0.7),
      ...(r.chance(0.3) ? { mediaType: "image" as const } : {}),
      ...(r.chance(0.5)
        ? {
            layer: {
              mode: r.pick(["cutaway", "overlay"] as const), x: r.r2(r.next()), y: r.r2(r.next()), scale: r.r2(0.2 + r.next()), rotation: r.int(-30, 30),
              ...(r.chance(0.5) ? { keyframes: [{ atMs: 0, opacity: 0, scale: 0.2 }, { atMs: 300, opacity: 1, x: 0.7 }] } : {}),
            },
          }
        : {}),
      ...(r.chance(0.3) ? { chromaKey: { color: "#00FF00", similarity: 0.4, smoothness: 0.1, spill: 0.2 } } : {}),
      ...(r.chance(0.3) ? { mask: { shape: r.pick(["circle", "rounded"] as const), radius: 0.2, feather: 0.05 } } : {}),
      ...(r.chance(0.1) ? { process: "remove_background" as const } : {}),
    });
  }

  const style = (title: boolean) => ({
    preset: r.pick(["CUSTOM", "HORMOZI_BOUNCE", "MRBEAST_HYPE"]),
    animation: r.pick(["none", "word_pop", "karaoke"] as const),
    fontFamily: r.pick(["Inter", "Anton", "Bebas Neue"]),
    fontWeight: r.pick([400, 700, 800, 900]),
    fontSizePx: r.int(30, 120),
    textColor: r.pick(HEX),
    highlightColor: r.pick(HEX),
    strokeColor: r.pick(HEX),
    strokeWidthPx: r.int(0, 8),
    shadow: r.chance(0.5),
    background: r.chance(0.3) ? { color: "#000000AA", paddingPx: 12, radiusPx: 8 } : null,
    uppercase: r.chance(0.5),
    positionX: r.r2(r.next()),
    positionY: r.r2(r.next()),
    maxWidthFraction: r.r2(0.5 + r.next() * 0.5),
    ...(r.chance(0.3) ? { glow: true } : {}),
    ...(r.chance(0.3) ? { enter: { type: r.pick(["fade", "pop", "slide_up"] as const), durationMs: 300 } } : {}),
    ...(r.chance(0.3) ? { exit: { type: "fade" as const, durationMs: 200 } } : {}),
    ...(r.chance(title ? 0.3 : 0.1) ? { loop: { type: "pulse" as const, periodMs: 800 } } : {}),
  });
  const captions: MobileEditIR["captions"] = [];
  for (let i = 0; i < r.int(0, 5); i++) {
    const title = r.chance(0.35);
    const [s, e0] = span(20, 3000); // includes < 50 ms
    const e = Math.max(s + 1, e0);
    const text = title ? r.pick(["Big News", "WAIT FOR IT", "Day 1"]) : r.pick(["so here is the thing", "you need consistency", "um okay"]);
    const toks = text.split(" ");
    const step = Math.max(1, Math.floor((e - s) / toks.length));
    captions.push({
      id: `cap${i}`, kind: title ? "text" : "caption", startMs: s, endMs: e, text,
      words: title && r.chance(0.5)
        ? [] // titles drawn from text only
        : toks.map((w, k) => ({
            text: w, startMs: Math.min(e, s + k * step), endMs: Math.min(e, s + (k + 1) * step),
            highlight: r.chance(0.3), color: r.chance(0.3) ? r.pick(HEX) : null, scale: r.pick([1, 1, 1.15]),
          })),
      style: style(title),
    });
  }

  // Manual zooms, sometimes overlapping or very short (the projection used to trim / drop them).
  const zooms: MobileEditIR["zooms"] = [];
  for (let i = 0; i < r.int(0, 3); i++) {
    const [s, e] = span(60, 2500);
    zooms.push({ id: `z${i}`, startMs: s, endMs: Math.max(s + 1, e), scale: r.r2(1 + r.next()), centerX: r.r2(r.next()), centerY: r.r2(r.next()), rampMs: r.int(0, 200) });
  }

  const ir: any = {
    schemaVersion: "mobile-editir/1",
    projectId: `proj_${seed}`,
    canvas: { aspect, width: size[0], height: size[1], fps: r.pick([30, 24, 29.97, 60]), background: r.pick(["#000000", "#202020", "#FFFFFF"]) },
    durationMs: D,
    sources,
    clips,
    overlays,
    captions,
    zooms,
    audio: { originalTrack: { volumeDb: r.pick([0, 0, -3, -60]) }, music: [], speechRangesMs: [] },
  };
  if (r.chance(0.6)) {
    const effects = [];
    for (let i = 0; i < r.int(0, 3); i++) {
      const [s, e] = span(30, 1500);
      effects.push({ id: `fx${i}`, type: r.pick(["flash", "shake", "vignette", "black_white"] as const), startMs: s, endMs: Math.max(s + 1, e), intensity: r.r2(r.next()) });
    }
    ir.effects = effects;
  }
  if (r.chance(0.6)) {
    ir.audio.music.push({
      id: "m1", timelineStartMs: 0, timelineEndMs: D, sourceStartMs: r.int(0, 5000),
      source: r.pick([
        { kind: "url", url: "https://cdn.example.com/track.mp3", query: "lofi" },
        { kind: "url", url: "http://legacy.example.com/track.mp3" },
        { kind: "asset", assetId: "music_local" },
        { kind: "file", path: "/data/user/0/app/files/song (1).m4a" },
      ]),
      volumeDb: r.int(-30, -6), fadeInMs: r.int(0, 2000), fadeOutMs: r.int(0, 2000),
      duck: { enabled: r.chance(0.6), duckDb: r.int(-24, -6), attackMs: r.int(50, 300), releaseMs: r.int(100, 600) },
    });
  }
  if (r.chance(0.6)) {
    const sfx = [];
    for (let i = 0; i < r.int(0, 3); i++) {
      sfx.push({
        id: `s${i}`, timelineStartMs: r.int(0, Math.max(0, D - 1)),
        ...(r.chance(0.5) ? { durationMs: r.int(200, 3000) } : {}),
        source: r.pick([{ kind: "url", url: "https://cdn.example.com/whoosh.mp3" }, { kind: "asset", assetId: `sfx_${i}` }, { kind: "file", path: "/sdcard/pop.wav" }]),
        volumeDb: r.int(-20, 0),
        ...(r.chance(0.3) ? { credit: "Sound by someone (CC BY)" } : {}),
      });
    }
    ir.audio.sfx = sfx;
  }
  if (r.chance(0.4)) {
    ir.audio.voiceovers = [{
      id: "vo1", timelineStartMs: r.int(0, Math.max(0, D - 500)), durationMs: r.int(300, 4000), sourceStartMs: 0,
      source: { kind: "asset", assetId: "vo_rec_1" }, volumeDb: r.int(-6, 3),
      ...(r.chance(0.5) ? { fadeInMs: 120 } : {}), ...(r.chance(0.5) ? { fadeOutMs: 200 } : {}),
    }];
  }
  if (r.chance(0.3)) {
    ir.watermark = { imageUrl: "https://cdn.example.com/logo.png", position: "top_right", opacityPct: 80, widthFraction: 0.14, ...(r.chance(0.5) ? { x: 0.8, y: 0.05, width: 0.15, height: 0.05 } : {}) };
  }
  if (r.chance(0.6)) {
    // Provenance and locks on some existing items (never on ids that are not on the timeline).
    const ids = [ir.clips, ir.overlays, ir.captions, ir.zooms, ir.effects ?? [], ir.audio.music, ir.audio.sfx ?? [], ir.audio.voiceovers ?? []].flat().map((x: any) => x.id);
    const meta: Record<string, any> = {};
    for (const id of ids) if (r.chance(0.5)) meta[id] = { origin: r.pick(["manual", "director", "template"]), ...(r.chance(0.3) ? { locked: true } : {}) };
    ir.itemMeta = meta;
  }
  return MobileEditIRSchema.parse(ir);
}
