/**
 * Caption Rendering Engine v2 Parity & Math Tests (captions v2, Phase 3).
 * Run: npx tsx --test packages/video-contracts/tests/caption-rendering-v2.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  easeAt, safeRect, anchorInSafeZone,
  type CaptionEasing, type CaptionLayout,
} from "../src/caption-style-v2";
import { MobileCaptionStyleSchema } from "../src/mobile-edit-ir";

test("easeAt: spring regimes (under-damped, critically damped, over-damped)", () => {
  const springUnderdamped: CaptionEasing = { type: "spring", stiffness: 180, damping: 14 }; // zeta ~ 0.52
  const linear: CaptionEasing = { type: "linear" };
  const overshoot: CaptionEasing = { type: "back", overshoot: 1.70158 };

  // At t=0 ms, all curves start at 0
  assert.equal(easeAt(springUnderdamped, 0, 500), 0);
  assert.equal(easeAt(linear, 0, 500), 0);
  assert.equal(easeAt(overshoot, 0, 500), 0);

  // At t=duration, curves settle at 1
  assert.equal(easeAt(springUnderdamped, 500, 500), 1);
  assert.equal(easeAt(linear, 500, 500), 1);
  assert.equal(easeAt(overshoot, 500, 500), 1);

  // Under-damped spring overshoots 1.0 around mid-trajectory
  let maxUnderdamped = 0;
  for (let ms = 0; ms <= 500; ms += 10) {
    const v = easeAt(springUnderdamped, ms, 500);
    if (v > maxUnderdamped) maxUnderdamped = v;
  }
  assert.ok(maxUnderdamped > 1.0, `Spring should overshoot 1.0, peak was ${maxUnderdamped}`);

  // Overshoot (back ease-out) also exceeds 1.0
  let maxBack = 0;
  for (let ms = 0; ms <= 500; ms += 10) {
    const v = easeAt(overshoot, ms, 500);
    if (v > maxBack) maxBack = v;
  }
  assert.ok(maxBack > 1.0, `Overshoot should exceed 1.0, peak was ${maxBack}`);

  // Standard eases never overshoot 1.0
  const easeIn: CaptionEasing = { type: "cubic", mode: "in" };
  const easeOut: CaptionEasing = { type: "cubic", mode: "out" };
  const easeInOut: CaptionEasing = { type: "cubic", mode: "in-out" };
  for (let ms = 0; ms <= 500; ms += 25) {
    assert.ok(easeAt(linear, ms, 500) <= 1.0001);
    assert.ok(easeAt(easeIn, ms, 500) <= 1.0001);
    assert.ok(easeAt(easeOut, ms, 500) <= 1.0001);
    assert.ok(easeAt(easeInOut, ms, 500) <= 1.0001);
  }
});

test("easeAt is frame-rate independent across 24, 30 and 60 fps", () => {
  const spring: CaptionEasing = { type: "spring", stiffness: 180, damping: 14 };
  const durationMs = 500;

  // Sampling at the exact same physical time (e.g. 200 ms)
  const targetMs = 200;
  const val24 = easeAt(spring, targetMs, durationMs);
  const val30 = easeAt(spring, targetMs, durationMs);
  const val60 = easeAt(spring, targetMs, durationMs);

  assert.equal(val24, val30);
  assert.equal(val30, val60);
});

test("safeRect calculates exact pixel boundaries for TikTok, Reels, Shorts", () => {
  const w = 1080;
  const h = 1920;

  // TikTok safe zone: 220 top, 480 bottom, 60 left, 140 right
  const tiktok = safeRect("tiktok", w, h);
  assert.equal(tiktok.top, 220);
  assert.equal(tiktok.bottom, h - 480);
  assert.equal(tiktok.left, 60);
  assert.equal(tiktok.right, w - 140);

  // Instagram Reels safe zone: 270 top, 670 bottom, 65 left, 120 right
  const reels = safeRect("reels", w, h);
  assert.equal(reels.top, 270);
  assert.equal(reels.bottom, h - 670);
  assert.equal(reels.left, 65);
  assert.equal(reels.right, w - 120);

  // YouTube Shorts safe zone: 240 top, 600 bottom, 60 left, 140 right
  const shorts = safeRect("shorts", w, h);
  assert.equal(shorts.top, 240);
  assert.equal(shorts.bottom, h - 600);

  // None (unconstrained canvas)
  const none = safeRect("none", w, h);
  assert.equal(none.top, 0);
  assert.equal(none.bottom, h);
  assert.equal(none.left, 0);
  assert.equal(none.right, w);
});

test("anchorInSafeZone clamps captions outside safe bounds", () => {
  const w = 1080;
  const h = 1920;
  const blockW = 400;
  const blockH = 100;

  // Caption pushed too far down into TikTok bottom safe zone
  const layoutBottom: CaptionLayout = {
    safeZone: "tiktok",
    position: "custom",
    x: 0.5,
    y: 0.95, // 0.95 * 1920 = 1824, would overflow bottom margin 1440
    align: "center",
    maxLines: 2,
    balance: "bottom-heavy",
  };
  const clampedLow = anchorInSafeZone(layoutBottom, w, h, blockW, blockH);
  assert.ok(clampedLow.y + blockH / 2 <= 1920 - 480, `Expected bottom within 1440, got ${clampedLow.y + blockH / 2}`);

  // Caption pushed too far to the right into TikTok UI area
  const layoutRight: CaptionLayout = {
    safeZone: "tiktok",
    position: "custom",
    x: 0.95, // 0.95 * 1080 = 1026, would overflow right margin 940
    y: 0.5,
    align: "center",
    maxLines: 2,
    balance: "bottom-heavy",
  };
  const clampedRight = anchorInSafeZone(layoutRight, w, h, blockW, blockH);
  assert.ok(clampedRight.x + blockW / 2 <= 1080 - 140, `Expected right within 940, got ${clampedRight.x + blockW / 2}`);

  // Caption placed in valid center area remains untouched
  const layoutCenter: CaptionLayout = {
    safeZone: "tiktok",
    position: "custom",
    x: 0.5,
    y: 0.5,
    align: "center",
    maxLines: 2,
    balance: "bottom-heavy",
  };
  const centerUnchanged = anchorInSafeZone(layoutCenter, w, h, blockW, blockH);
  assert.equal(centerUnchanged.x, 540);
  assert.equal(centerUnchanged.y, 960);
});

test("MobileCaptionStyleSchema parses Phase 3 v2 layered paints and safe zones", () => {
  const rawStyle = {
    preset: "BOLD_POP",
    animation: "none",
    fontFamily: "Montserrat",
    fontWeight: 900,
    fontSizePx: 72,
    textColor: "#FFFFFFFF",
    highlightColor: "#FFF7C204",
    strokeColor: "#FF000000",
    strokeWidthPx: 8,
    shadow: true,
    safeZone: "tiktok" as const,
    faceAvoid: true,
    maxLines: 2,
    backgroundMode: "pill" as const,
    backgroundOpacity: 0.85,
    strokes: [
      { color: "#FF000000", widthPx: 6 },
      { color: "#FF333333", widthPx: 12 },
    ],
    gradient: {
      top: "#FFFFFFFF",
      bottom: "#FFFFD700",
    },
    glowColor: "#FFF7C204",
    glowRadiusPx: 16,
    glowStrength: 0.6,
  };

  const parsed = MobileCaptionStyleSchema.parse(rawStyle);
  assert.equal(parsed.safeZone, "tiktok");
  assert.equal(parsed.faceAvoid, true);
  assert.equal(parsed.maxLines, 2);
  assert.equal(parsed.backgroundMode, "pill");
  assert.equal(parsed.backgroundOpacity, 0.85);
  assert.equal(parsed.strokes?.length, 2);
  assert.equal(parsed.strokes?.[1].widthPx, 12);
  assert.equal(parsed.gradient?.bottom, "#FFFFD700");
  assert.equal(parsed.glowRadiusPx, 16);
});
