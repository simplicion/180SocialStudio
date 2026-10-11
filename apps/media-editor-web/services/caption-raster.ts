/**
 * Captions and titles as pixels, for both desktop exporters.
 *
 *  - `captionStateTimeline` splits the timeline into intervals where the caption picture does not change (which
 *    caption is shown, which word is highlighted, which titles are up) — pure, unit-tested.
 *  - `drawCaptionState` draws one such state on a 2D canvas. It reproduces the preview's layout
 *    (RemotionVideoComposition: kinetic caption box at the bottom, word highlight + pop, titles at their own position
 *    and style) and is the ONLY caption drawing code: the compatibility renderer calls it per frame, and the native
 *    export rasterises each distinct state once to a transparent PNG (`rasterizeCaptionStates`) that FFmpeg holds for
 *    the state's duration (an ffconcat image sequence, see apps/desktop-app/src-tauri/src/overlays.rs).
 *  - Fonts: the same Google Fonts stylesheet as the preview is loaded and every family/weight used is awaited before
 *    drawing (`ensureCaptionFonts`), so the export uses the preview's fonts.
 */

import { RationalTimeMath, type CaptionSegment, type EditIR } from "@workspace/video-contracts";

export const STUDIO_FONTS_LINK_ID = "google-fonts-180-studio";
export const STUDIO_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Anton&family=Bebas+Neue&family=Inter:wght@400;500;600;700;800;900&family=Montserrat:wght@700;900&family=Outfit:wght@600;800&family=Poppins:wght@700;900&family=Roboto:wght@700;900&family=Syne:wght@700;800&display=swap";

export const MAX_CAPTION_STATES = 3000;

const secOf = (t: { value: number; timescale: number }) => RationalTimeMath.toSeconds(t);
const isTitle = (c: CaptionSegment) => c.role === "title";

export interface CaptionVisualState {
  /** active caption (speech) with the highlighted word index (-1 = none), then active titles in track order */
  caption: { id: string; activeWord: number } | null;
  titles: string[];
}

export const stateKey = (s: CaptionVisualState) =>
  `${s.caption ? `${s.caption.id}#${s.caption.activeWord}` : "-"}|${s.titles.join(",")}`;

/** The caption picture at time `t`, with the preview's rules (first active caption; every active title). */
export function captionStateAt(captions: readonly CaptionSegment[], t: number): CaptionVisualState {
  const active = (c: CaptionSegment) => {
    const s = secOf(c.timeRange.start);
    return t >= s && t <= s + secOf(c.timeRange.duration);
  };
  const cap = captions.find((c) => !isTitle(c) && active(c));
  let caption: CaptionVisualState["caption"] = null;
  if (cap) {
    const activeWord = (cap.words ?? []).findIndex((w) => t >= secOf(w.start) && t <= secOf(w.end));
    caption = { id: cap.id, activeWord };
  }
  return { caption, titles: captions.filter((c) => isTitle(c) && active(c)).map((c) => c.id) };
}

/**
 * Distinct caption pictures and the order/duration they are shown in, covering [0, durationSec] exactly. Interval
 * edges are every caption, title and word boundary; each interval takes the state at its midpoint.
 */
export function captionStateTimeline(
  captions: readonly CaptionSegment[],
  durationSec: number
): { states: CaptionVisualState[]; sequence: Array<{ state: number; durationSec: number }> } {
  const edges = new Set<number>([0, durationSec]);
  const add = (v: number) => {
    if (Number.isFinite(v) && v > 0 && v < durationSec) edges.add(Math.round(v * 1e6) / 1e6);
  };
  for (const c of captions) {
    const s = secOf(c.timeRange.start);
    add(s);
    add(s + secOf(c.timeRange.duration));
    if (!isTitle(c)) for (const w of c.words ?? []) {
      add(secOf(w.start));
      add(secOf(w.end));
    }
  }
  const points = [...edges].sort((a, b) => a - b);
  const states: CaptionVisualState[] = [];
  const index = new Map<string, number>();
  const sequence: Array<{ state: number; durationSec: number }> = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b - a < 1e-4) continue;
    const st = captionStateAt(captions, (a + b) / 2);
    const key = stateKey(st);
    let idx = index.get(key);
    if (idx === undefined) {
      idx = states.length;
      states.push(st);
      index.set(key, idx);
      if (states.length > MAX_CAPTION_STATES) {
        throw new Error(`This timeline has more than ${MAX_CAPTION_STATES} caption states; split the export or simplify the captions.`);
      }
    }
    const last = sequence[sequence.length - 1];
    if (last && last.state === idx) last.durationSec += b - a;
    else sequence.push({ state: idx, durationSec: b - a });
  }
  return { states, sequence };
}

// ── drawing (shared by the compatibility renderer and the native rasteriser) ─────────────────────────────────────

/** Preview composition width for this canvas (CanvasViewport: 1080 for 9:16 / 1:1, 1920 for 16:9). */
const compositionUnit = (w: number, h: number) => w / (w > h ? 1920 : 1080);

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrapWords(ctx: Ctx, words: string[], maxWidth: number, gap: number): Array<{ words: number[]; width: number }> {
  const lines: Array<{ words: number[]; width: number }> = [];
  let cur: { words: number[]; width: number } = { words: [], width: 0 };
  words.forEach((w, i) => {
    const ww = ctx.measureText(w).width;
    const next = cur.words.length === 0 ? ww : cur.width + gap + ww;
    if (cur.words.length > 0 && next > maxWidth) {
      lines.push(cur);
      cur = { words: [i], width: ww };
    } else {
      cur = { words: [...cur.words, i], width: next };
    }
  });
  if (cur.words.length > 0) lines.push(cur);
  return lines;
}

function setLetterSpacing(ctx: Ctx, px: number) {
  if ("letterSpacing" in ctx) (ctx as any).letterSpacing = `${px}px`;
}

/** The speech caption box (preview: bottom 8%, pill, word-by-word highlight with a 1.18 pop). */
function drawKineticCaption(ctx: Ctx, cap: CaptionSegment, activeWord: number, W: number, H: number) {
  const u = compositionUnit(W, H);
  const st = cap.style ?? ({} as CaptionSegment["style"]);
  const fs = (st.fontSize ? Math.round(st.fontSize * 0.7) : 26) * u;
  const family = st.fontFamily || "Inter";
  const upper = (st as any).uppercase !== false;
  const hasWords = (cap.words ?? []).length > 0;
  const words = hasWords ? cap.words.map((w) => w.word) : [cap.text];
  const text = words.map((w) => (upper ? w.toUpperCase() : w));
  const padX = (st.pillBackground ? 24 : 20) * u;
  const padY = (st.pillBackground ? st.pillPadding || 10 : 10) * u;
  const gap = 8 * u;
  const lineH = fs * 1.2;

  ctx.save();
  ctx.font = `900 ${fs}px '${family}', sans-serif`;
  setLetterSpacing(ctx, fs * 0.03);
  const lines = wrapWords(ctx, text, W - 2 * 24 * u - 2 * padX, gap);
  const boxW = Math.max(...lines.map((l) => l.width)) + 2 * padX;
  const boxH = lines.length * lineH + (lines.length - 1) * gap + 2 * padY;
  const boxX = (W - boxW) / 2;
  const boxY = H - 0.08 * H - boxH;

  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 35 * u;
  ctx.shadowOffsetY = 15 * u;
  ctx.fillStyle = st.pillBackground || "rgba(0,0,0,0.85)";
  roundRect(ctx, boxX, boxY, boxW, boxH, (st.pillRadius || 20) * u);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 1 * u;
  ctx.strokeStyle = st.pillBackground ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.18)";
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const activeColor = st.highlightColor || "#FBBF24";
  const baseColor = hasWords ? st.textColor || "#FFFFFF" : st.textColor || "#FBBF24";
  lines.forEach((line, li) => {
    let x = (W - (line.width + 2 * padX)) / 2 + padX;
    const y = boxY + padY + li * (lineH + gap) + lineH / 2;
    for (const wi of line.words) {
      const w = ctx.measureText(text[wi]).width;
      const isActive = hasWords && wi === activeWord;
      ctx.save();
      if (isActive) {
        ctx.translate(x + w / 2, y);
        ctx.scale(1.18, 1.18);
        ctx.translate(-(x + w / 2), -y);
      }
      const color = isActive ? activeColor : baseColor;
      if ((st as any).glow) {
        ctx.shadowColor = isActive ? activeColor : "#FFFFFF";
        ctx.shadowBlur = 16 * u;
      } else if (isActive || !hasWords) {
        ctx.shadowColor = isActive ? activeColor : "rgba(251,191,36,0.85)";
        ctx.shadowBlur = 12 * u;
      } else if (st.shadow) {
        ctx.shadowColor = "rgba(0,0,0,0.9)";
        ctx.shadowBlur = 14 * u;
        ctx.shadowOffsetY = 4 * u;
      }
      ctx.fillStyle = color;
      ctx.fillText(text[wi], x, y);
      if (st.strokeWidth) {
        ctx.shadowColor = "transparent";
        ctx.lineWidth = st.strokeWidth * u;
        ctx.strokeStyle = st.strokeColor || "#000000";
        ctx.lineJoin = "round";
        ctx.strokeText(text[wi], x, y);
      }
      ctx.restore();
      x += w + gap;
    }
  });
  ctx.restore();
}

/** A title (text template / addText): its own position, font, colours, stroke and box (preview: activeTitles). */
function drawTitle(ctx: Ctx, t: CaptionSegment, W: number, H: number) {
  const st = t.style;
  const u = compositionUnit(W, H);
  const fs = ((st.fontSize || 64) / 1080) * Math.min(W, H);
  const text = st.uppercase ? t.text.toUpperCase() : t.text;
  const lineH = fs * 1.15;
  ctx.save();
  ctx.font = `${st.fontWeight ?? 800} ${fs}px '${st.fontFamily || "Inter"}', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tokens = text.split(/\s+/).filter(Boolean);
  const lines = wrapWords(ctx, tokens, (st.maxWidthFraction ?? 0.86) * W, ctx.measureText(" ").width).map((l) =>
    l.words.map((i) => tokens[i]).join(" ")
  );
  const widest = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
  const cx = (st.position?.x ?? 0.5) * W;
  const cy = (st.position?.y ?? 0.5) * H;
  const blockH = lines.length * lineH;
  if (st.pillBackground) {
    const pad = (st.pillPadding ?? 12) * u;
    ctx.fillStyle = st.pillBackground;
    roundRect(ctx, cx - widest / 2 - pad * 1.4, cy - blockH / 2 - pad, widest + pad * 2.8, blockH + pad * 2, (st.pillRadius ?? 12) * u);
    ctx.fill();
  }
  lines.forEach((line, i) => {
    const y = cy - blockH / 2 + lineH * (i + 0.5);
    if (st.strokeWidth) {
      ctx.lineWidth = (st.strokeWidth / 2) * u;
      ctx.strokeStyle = st.strokeColor || "#000000";
      ctx.lineJoin = "round";
      ctx.strokeText(line, cx, y);
    }
    if (st.shadow) {
      ctx.shadowColor = "rgba(0,0,0,0.85)";
      ctx.shadowBlur = 14 * u;
      ctx.shadowOffsetY = 4 * u;
    }
    ctx.fillStyle = st.textColor || "#FFFFFF";
    ctx.fillText(line, cx, y);
    ctx.shadowColor = "transparent";
  });
  ctx.restore();
}

/** Draws one caption state onto a W×H canvas (does not clear it). */
export function drawCaptionState(ctx: Ctx, captions: readonly CaptionSegment[], state: CaptionVisualState, W: number, H: number) {
  const byId = new Map(captions.map((c) => [c.id, c]));
  if (state.caption) {
    const cap = byId.get(state.caption.id);
    if (cap) drawKineticCaption(ctx, cap, state.caption.activeWord, W, H);
  }
  for (const id of state.titles) {
    const t = byId.get(id);
    if (t) drawTitle(ctx, t, W, H);
  }
}

// ── browser-only: fonts + rasterising ─────────────────────────────────────────────────────────────────────────────

/** Loads the preview's font stylesheet and waits for every family/weight the captions use. */
export async function ensureCaptionFonts(captions: readonly CaptionSegment[], timeoutMs = 8000): Promise<string[]> {
  if (typeof document === "undefined") return [];
  if (!document.getElementById(STUDIO_FONTS_LINK_ID)) {
    const link = document.createElement("link");
    link.id = STUDIO_FONTS_LINK_ID;
    link.rel = "stylesheet";
    link.href = STUDIO_FONTS_URL;
    document.head.appendChild(link);
  }
  const wanted = new Set<string>();
  for (const c of captions) {
    const fam = c.style?.fontFamily || "Inter";
    wanted.add(`${isTitle(c) ? c.style.fontWeight ?? 800 : 900} 48px '${fam}'`);
  }
  const missing: string[] = [];
  const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), timeoutMs));
  await Promise.race([
    Promise.all(
      [...wanted].map(async (spec) => {
        try {
          const faces = await document.fonts.load(spec);
          if (faces.length === 0) missing.push(spec);
        } catch {
          missing.push(spec);
        }
      })
    ),
    timeout,
  ]);
  return missing;
}

async function canvasToBase64Png(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not encode a caption image.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Every distinct caption picture of the timeline as a transparent W×H PNG (base64) + the sequence to show them. */
export async function rasterizeCaptionStates(
  editIR: EditIR,
  W: number,
  H: number,
  durationSec: number,
  onProgress?: (done: number, total: number) => void
): Promise<{ images: string[]; sequence: Array<{ image: number; durationSec: number }>; missingFonts: string[] }> {
  const captions = editIR.tracks.captionTrack ?? [];
  const missingFonts = await ensureCaptionFonts(captions);
  const { states, sequence } = captionStateTimeline(captions, durationSec);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available to draw captions.");
  const images: string[] = [];
  for (let i = 0; i < states.length; i++) {
    ctx.clearRect(0, 0, W, H);
    drawCaptionState(ctx, captions, states[i], W, H);
    images.push(await canvasToBase64Png(canvas));
    onProgress?.(i + 1, states.length);
  }
  return { images, sequence: sequence.map((s) => ({ image: s.state, durationSec: s.durationSec })), missingFonts };
}
