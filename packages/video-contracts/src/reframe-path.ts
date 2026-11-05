/**
 * Moving auto-reframe (editor overhaul Phase 6.1, audit F-18): a virtual camera operator that keeps the speaker in a
 * crop window over time, instead of one static crop centred on the median face.
 *
 * Input: the on-device face track of one source (centre x/y as 0..1 of the display frame, sampled every ~500 ms),
 * the clip's source range, the crop window size and the source's scene cuts. Output: `cropKeyframes` (window
 * top-left at SOURCE ms), which every renderer interpolates linearly.
 *
 * The camera behaves like an operator: it ignores small movements (dead zone), never pans faster than a set speed,
 * eases towards the subject, and re-centres at once on a scene cut (a new shot is not a pan).
 */
export interface FaceSampleSrc { tMs: number; x: number; y: number; w: number; h: number }
export interface CropKeyframe { sourceMs: number; x: number; y: number }

export interface ReframePathOptions {
  /** Movement of the subject (fraction of the frame) the camera ignores. Default 0.06. */
  deadZone?: number;
  /** Fastest pan, in frame widths per second. Default 0.35. */
  maxPanPerSec?: number;
  /** 0..1: how much of the remaining distance the camera closes per second. Default 0.85 (the reframe smoothingFactor). */
  smoothing?: number;
  /** At most this many keyframes per clip (the contract allows 240). */
  maxKeyframes?: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r4 = (v: number) => Math.round(v * 10000) / 10000;

export function computeCropPath(
  faces: FaceSampleSrc[] | null | undefined,
  clip: { sourceStartMs: number; sourceEndMs: number },
  window: { width: number; height: number },
  scenesMs: number[] = [],
  opts: ReframePathOptions = {}
): CropKeyframe[] {
  if (!faces?.length) return [];
  // Nothing to move when the window covers the frame in both directions.
  const canPanX = window.width < 0.999;
  const canPanY = window.height < 0.999;
  if (!canPanX && !canPanY) return [];
  const dead = opts.deadZone ?? 0.06;
  const maxPan = opts.maxPanPerSec ?? 0.35;
  const smooth = clamp(opts.smoothing ?? 0.85, 0.05, 1);
  const maxKf = Math.min(240, opts.maxKeyframes ?? 240);

  // The largest face per sample time is the subject; samples outside the clip (±1 s for a smooth start) are ignored.
  const byT = new Map<number, FaceSampleSrc>();
  for (const f of faces) {
    if (f.tMs < clip.sourceStartMs - 1000 || f.tMs > clip.sourceEndMs + 1000) continue;
    const cur = byT.get(f.tMs);
    if (!cur || f.w * f.h > cur.w * cur.h) byT.set(f.tMs, f);
  }
  const samples = [...byT.values()].sort((a, b) => a.tMs - b.tMs);
  if (!samples.length) return [];

  const target = (f: FaceSampleSrc) => ({
    x: canPanX ? clamp(f.x - window.width / 2, 0, 1 - window.width) : 0,
    y: canPanY ? clamp(f.y - window.height / 2, 0, 1 - window.height) : 0,
  });
  const cuts = scenesMs.filter((t) => t > clip.sourceStartMs && t < clip.sourceEndMs).sort((a, b) => a - b);

  const out: CropKeyframe[] = [];
  const push = (sourceMs: number, x: number, y: number) => {
    const last = out[out.length - 1];
    if (last && last.sourceMs === sourceMs) {
      last.x = r4(x);
      last.y = r4(y);
      return;
    }
    out.push({ sourceMs: Math.round(sourceMs), x: r4(x), y: r4(y) });
  };

  let cam = target(samples[0]);
  let t = Math.max(clip.sourceStartMs, Math.min(samples[0].tMs, clip.sourceStartMs));
  push(clip.sourceStartMs, cam.x, cam.y);
  let cutIdx = 0;
  for (const s of samples) {
    if (s.tMs <= clip.sourceStartMs) {
      cam = target(s);
      out[0] = { sourceMs: clip.sourceStartMs, x: r4(cam.x), y: r4(cam.y) };
      continue;
    }
    if (s.tMs > clip.sourceEndMs) break;
    // A scene cut between the last point and this sample: hold until the cut, then jump to the new shot's subject.
    while (cutIdx < cuts.length && cuts[cutIdx] <= s.tMs) {
      const cut = cuts[cutIdx++];
      push(cut - 1, cam.x, cam.y);
      cam = target(s);
      push(cut, cam.x, cam.y);
      t = cut;
    }
    const dt = Math.max(0, (s.tMs - t) / 1000);
    const want = target(s);
    const step = (from: number, to: number) => {
      const d = to - from;
      if (Math.abs(d) <= dead) return from; // inside the dead zone: the camera stays put
      const eased = d * (1 - Math.pow(1 - smooth, dt));
      const limit = maxPan * dt;
      return from + clamp(eased, -limit, limit);
    };
    const next = { x: canPanX ? step(cam.x, want.x) : cam.x, y: canPanY ? step(cam.y, want.y) : cam.y };
    if (Math.abs(next.x - cam.x) > 0.002 || Math.abs(next.y - cam.y) > 0.002) {
      // Hold, then move: the camera starts moving from the previous point, not from the clip start.
      const last = out[out.length - 1];
      if (last && (last.x !== r4(cam.x) || last.y !== r4(cam.y))) push(t, cam.x, cam.y);
      cam = next;
      push(s.tMs, cam.x, cam.y);
    }
    t = s.tMs;
  }
  // A still camera is just the static crop.
  if (out.every((k) => k.x === out[0].x && k.y === out[0].y)) return [out[0]];
  // Too many points: keep every n-th, plus both ends of each scene cut.
  if (out.length > maxKf) {
    const keep = new Set<number>([0, out.length - 1]);
    out.forEach((k, i) => { if (cuts.some((c) => k.sourceMs === c || k.sourceMs === c - 1)) keep.add(i); });
    const every = Math.ceil(out.length / (maxKf - keep.size));
    out.forEach((_, i) => { if (i % every === 0) keep.add(i); });
    return out.filter((_, i) => keep.has(i)).slice(0, maxKf);
  }
  return out;
}
