/**
 * Caption Style Spec v2 (captions v2, Phase 1).
 * Run: npx tsx --test packages/video-contracts/tests/caption-style-v2.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { CAPTION_TEMPLATES } from "../src/caption-templates";
import { MobileCaptionStyleSchema } from "../src/mobile-edit-ir";
import {
  CaptionStyleV2Schema, migrateV1TemplateStyle, migrateMobileCaptionStyle, applyCaptionOverrides, easeAt, safeRect, anchorInSafeZone,
  scriptOf, groupingLimitsFor, applyCaptionCase, fontForText, GroupingSchema, type CaptionStyleV2,
} from "../src/caption-style-v2";

const fillColor = (s: CaptionStyleV2) => (s.paint.fill.type === "solid" ? s.paint.fill.color : s.paint.fill.top);

test("every v1 catalog template migrates to a valid v2 spec that keeps its look", () => {
  for (const t of CAPTION_TEMPLATES) {
    const v2 = migrateV1TemplateStyle(t.style);
    CaptionStyleV2Schema.parse(v2);
    assert.equal(v2.typography.fonts.latin, t.style.fontFamily, t.id);
    assert.equal(v2.typography.weight, t.style.fontWeight, t.id);
    assert.equal(v2.typography.sizePx, t.style.fontSize, t.id);
    assert.equal(fillColor(v2), t.style.textColor, t.id);
    assert.equal(v2.typography.case, t.style.uppercase ? "upper" : "none", t.id);
    assert.equal(v2.paint.strokes.length, t.style.strokeWidth > 0 ? 1 : 0, t.id);
    if (t.style.strokeWidth > 0) assert.deepEqual([v2.paint.strokes[0].color, v2.paint.strokes[0].widthPx], [t.style.strokeColor, t.style.strokeWidth]);
    assert.equal(v2.paint.shadow !== null, t.style.shadow, t.id);
    assert.equal(v2.paint.glow !== null, !!t.style.glow, t.id);
    assert.equal(v2.paint.background.mode, t.style.pillBackground ? "pill" : "none", t.id);
    const r = v2.typography.sizeRangePx!;
    assert.ok(r.min < t.style.fontSize && t.style.fontSize < r.max, `${t.id} size range`);
  }
});

test("v1 word animations become word states + active-word motion", () => {
  const base = CAPTION_TEMPLATES[0].style;
  const pop = migrateV1TemplateStyle({ ...base, animation: "word_pop", highlightColor: "#22C55E" });
  assert.deepEqual([pop.words.active.color, pop.words.active.scale, pop.motion.activeWord.type], ["#22C55E", 1.15, "scale-spring"]);
  const kara = migrateV1TemplateStyle({ ...base, animation: "karaoke", highlightColor: "#14B8A6" });
  assert.deepEqual([kara.words.active.color, kara.words.spoken.color, kara.motion.activeWord.type], ["#14B8A6", "#14B8A6", "color-sweep"]);
  const box = migrateV1TemplateStyle({ ...base, animation: "word_box", highlightColor: "#7C3AED" });
  assert.equal(box.words.active.background?.color, "#7C3AED");
  assert.equal(box.motion.activeWord.type, "box-slide");
  const reveal = migrateV1TemplateStyle({ ...base, animation: "word_reveal" });
  assert.deepEqual([reveal.words.resting.opacity, reveal.motion.wordEnter.type], [0, "fade"]);
  const none = migrateV1TemplateStyle({ ...base, animation: "none" });
  assert.equal(none.motion.activeWord.type, "none");
  assert.equal(none.words.active.color, null);
});

test("a pill colour with alpha splits into colour + opacity", () => {
  const frosted = migrateV1TemplateStyle(CAPTION_TEMPLATES.find((t) => t.id === "KARAOKE_FROSTED")!.style);
  assert.deepEqual([frosted.paint.background.color, frosted.paint.background.opacity, frosted.paint.background.paddingPx, frosted.paint.background.radiusPx], ["#0F172A", 0.851, 10, 20]);
});

test("a caption's stored v1 style map migrates and keeps its hand-placed position exactly", () => {
  const v1 = MobileCaptionStyleSchema.parse({
    animation: "word_pop", fontFamily: "Anton", fontSizePx: 72, textColor: "#FACC15", highlightColor: "#EF4444", strokeWidthPx: 4,
    uppercase: true, positionX: 0.4, positionY: 0.81, maxWidthFraction: 0.7, background: { color: "#00000080", paddingPx: 20, radiusPx: 30 },
    enter: { type: "slide_up", durationMs: 300 }, exit: { type: "fade", durationMs: 200 }, rotationDeg: 5,
  });
  const v2 = migrateMobileCaptionStyle(v1);
  assert.deepEqual([v2.layout.position, v2.layout.x, v2.layout.y, v2.layout.maxWidthFraction], ["custom", 0.4, 0.81, 0.7]);
  assert.deepEqual([v2.layout.safeZone, v2.layout.faceAvoid], ["none", false], "no automatic move of a hand-placed caption");
  assert.deepEqual([v2.paint.background.mode, v2.paint.background.color, v2.paint.background.opacity, v2.paint.background.paddingPx], ["pill", "#000000", 0.502, 20]);
  assert.deepEqual([v2.motion.groupEnter.type, v2.motion.groupEnter.durationMs, v2.motion.groupExit.type], ["slide-up", 300, "fade"]);
  assert.deepEqual([v2.typography.fonts.latin, v2.typography.sizePx, v2.typography.case, fillColor(v2)], ["Anton", 72, "upper", "#FACC15"]);
  // The phone's defaults (a style with only what the text tool set) migrate too.
  CaptionStyleV2Schema.parse(migrateMobileCaptionStyle(MobileCaptionStyleSchema.parse({})));
  CaptionStyleV2Schema.parse(migrateMobileCaptionStyle({}));
});

test("user overrides: editable fields apply, locked fields are refused, size is clamped to the template range", () => {
  const spec = migrateV1TemplateStyle(CAPTION_TEMPLATES[0].style); // Anton 52, range 31..83
  const { spec: s, rejected } = applyCaptionOverrides(spec, { colors: { text: "#FFFFFF", active: "#00FF88" }, sizePx: 200, position: { preset: "upper-third" }, case: "none", motionIntensity: 0.4 });
  assert.deepEqual(rejected, []);
  assert.equal(fillColor(s), "#FFFFFF");
  assert.equal(s.words.active.color, "#00FF88");
  assert.equal(s.typography.sizePx, 83, "clamped to the template's range");
  assert.deepEqual([s.layout.position, s.typography.case, s.motion.intensity], ["upper-third", "none", 0.4]);
  // The signature stays: font, strokes, motion type.
  assert.deepEqual([s.typography.fonts, s.paint.strokes, s.motion.activeWord.type], [spec.typography.fonts, spec.paint.strokes, spec.motion.activeWord.type]);

  const locked: CaptionStyleV2 = { ...spec, editable: ["colors"] };
  const r = applyCaptionOverrides(locked, { colors: { text: "#000000" }, sizePx: 40, maxWords: 1 });
  assert.deepEqual(r.rejected.sort(), ["maxWords", "sizePx"]);
  assert.equal(r.spec.typography.sizePx, spec.typography.sizePx);
  assert.equal(r.spec.grouping.maxWords, spec.grouping.maxWords);
});

test("'make the captions yellow' changes only the colour", () => {
  const spec = migrateV1TemplateStyle(CAPTION_TEMPLATES[1].style);
  const { spec: s } = applyCaptionOverrides(spec, { colors: { text: "#FACC15" } });
  assert.deepEqual({ ...s, paint: { ...s.paint, fill: null } }, { ...spec, paint: { ...spec.paint, fill: null } });
  assert.equal(fillColor(s), "#FACC15");
});

test("the schema refuses what the renderers cannot draw", () => {
  const ok = migrateV1TemplateStyle(CAPTION_TEMPLATES[0].style);
  const stroke = { color: "#000000", widthPx: 2 };
  assert.throws(() => CaptionStyleV2Schema.parse({ ...ok, paint: { ...ok.paint, strokes: [stroke, stroke, stroke] } }), /2/);
  assert.throws(() => CaptionStyleV2Schema.parse({ ...ok, typography: { ...ok.typography, sizePx: 300 } }), /sizeRangePx/);
  assert.throws(() => CaptionStyleV2Schema.parse({ ...ok, paint: { ...ok.paint, fill: { type: "solid", color: "yellow" } } }), /colour/);
  assert.throws(() => CaptionStyleV2Schema.parse({ ...ok, layout: { ...ok.layout, maxLines: 3 } }));
  assert.throws(() => GroupingSchema.parse({ minDurationMs: 4000, maxDurationMs: 1000 }));
  assert.throws(() => CaptionStyleV2Schema.parse({ ...ok, editable: ["fontFamily"] }));
});

test("easing: ends at 0 and 1, back and an under-damped spring overshoot, an over-damped spring never does", () => {
  for (const e of [{ type: "linear" }, { type: "cubic", mode: "out" }, { type: "back", overshoot: 1.70158 }, { type: "spring", stiffness: 300, damping: 18 }] as const) {
    assert.equal(easeAt(e, 0, 400), 0);
    assert.equal(easeAt(e, 400, 400), 1);
    assert.equal(easeAt(e, 999, 400), 1);
  }
  const back = Array.from({ length: 40 }, (_, i) => easeAt({ type: "back", overshoot: 1.70158 }, i * 10, 400));
  assert.ok(Math.max(...back) > 1.05 && Math.max(...back) < 1.15, `back peak ${Math.max(...back)}`);
  const springy = Array.from({ length: 60 }, (_, i) => easeAt({ type: "spring", stiffness: 300, damping: 12 }, i * 10, 600));
  assert.ok(Math.max(...springy) > 1.1, "under-damped spring overshoots");
  const stiff = Array.from({ length: 60 }, (_, i) => easeAt({ type: "spring", stiffness: 100, damping: 40 }, i * 10, 600));
  assert.ok(Math.max(...stiff) <= 1 + 1e-9, "over-damped spring does not overshoot");
  assert.ok(Math.abs(easeAt({ type: "spring", stiffness: 100, damping: 20 }, 300, 2000) - (1 - Math.exp(-3) * (1 + 3))) < 1e-9, "critically damped closed form");
});

test("easing is time-based: 24, 30 and 60 fps sample the same curve at the same instant", () => {
  const e = { type: "spring", stiffness: 260, damping: 14 } as const;
  const at = (fps: number, frame: number) => easeAt(e, (frame * 1000) / fps, 500);
  assert.equal(at(24, 6), at(60, 15)); // both 250 ms
  assert.equal(at(30, 3), at(60, 6)); // both 100 ms
});

test("safe zones: TikTok margins on 1080x1920, scaled for 720x1280; blocks are pushed inside", () => {
  assert.deepEqual(safeRect("tiktok", 1080, 1920), { left: 60, top: 220, right: 940, bottom: 1440 });
  assert.deepEqual(safeRect("reels", 720, 1280), { left: 65 * (720 / 1080), top: 270 * (1280 / 1920), right: 720 - 120 * (720 / 1080), bottom: 1280 - 670 * (1280 / 1920) });
  const layout = { position: "custom", x: 0.5, y: 0.95, maxWidthFraction: 0.86, maxLines: 2, align: "center", safeZone: "tiktok", faceAvoid: true } as const;
  const a = anchorInSafeZone(layout, 1080, 1920, 800, 200);
  assert.equal(a.y, 1440 - 100, "a caption at the bottom edge is lifted above the TikTok UI");
  assert.equal(a.x, 540, "an 800 px block centred on the canvas already fits 60..940: it stays centred");
  assert.equal(anchorInSafeZone(layout, 1080, 1920, 860, 200).x, 510, "a wider block is pushed left, away from the TikTok buttons");
  const lower = anchorInSafeZone({ ...layout, position: "lower-third" }, 1080, 1920, 600, 160);
  assert.ok(Math.abs(lower.y - 0.68 * 1920) < 1e-9, "the lower-third preset already sits inside the TikTok zone");
  assert.equal(anchorInSafeZone({ ...layout, safeZone: "none" }, 1080, 1920, 800, 200).y, 1820, "no safe zone: only kept inside the canvas");
  assert.equal(anchorInSafeZone({ ...layout, safeZone: "none", y: 0.8 }, 1080, 1920, 800, 200).y, 0.8 * 1920);
});

test("scripts, fonts and grouping defaults per language (Netflix: 42/39/16 chars per line, 17/22/9 cps)", () => {
  const cases: Array<[string, string, number, number]> = [
    ["This is my story", "latin", 42, 17], ["Это моя история", "cyrillic", 39, 17], ["यह मेरी कहानी है", "devanagari", 42, 22],
    ["这是我的故事", "cjk-sc", 16, 9], ["これは私の物語です", "cjk-jp", 16, 9], ["هذه قصتي", "arabic", 42, 17], ["นี่คือเรื่องของฉัน", "thai", 35, 17],
    ["이것은 나의 이야기", "korean", 16, 12], ["আমার গল্প", "bengali", 42, 22], ["என் கதை", "tamil", 42, 22], ["123 🚀", "latin", 42, 17],
  ];
  const grouping = GroupingSchema.parse({});
  for (const [text, script, cpl, cps] of cases) {
    assert.equal(scriptOf(text), script, text);
    assert.deepEqual(groupingLimitsFor(grouping, text), { maxCharsPerLine: cpl, maxCharsPerSecond: cps }, text);
  }
  assert.deepEqual(groupingLimitsFor(GroupingSchema.parse({ maxCharsPerLine: 20 }), "这是"), { maxCharsPerLine: 20, maxCharsPerSecond: 9 });
  const fonts = { latin: "Anton", devanagari: "Baloo 2" };
  assert.equal(fontForText(fonts, "HELLO"), "Anton");
  assert.equal(fontForText(fonts, "नमस्ते"), "Baloo 2");
  assert.equal(fontForText(fonts, "مرحبا"), "Noto Sans Arabic", "a script the template has no font for uses the readable default");
});

test("case is locale-aware and only touches scripts that have case", () => {
  assert.equal(applyCaptionCase("istanbul is big", "upper", "tr"), "İSTANBUL İS BİG");
  assert.equal(applyCaptionCase("istanbul", "upper", "en"), "ISTANBUL");
  assert.equal(applyCaptionCase("straße", "upper"), "STRASSE");
  assert.equal(applyCaptionCase("यह मेरी कहानी", "upper"), "यह मेरी कहानी");
  assert.equal(applyCaptionCase("这是我的故事", "title"), "这是我的故事");
  assert.equal(applyCaptionCase("the iPhone is here", "title"), "The IPhone Is Here");
  assert.equal(applyCaptionCase("₹500 crore deal", "upper"), "₹500 CRORE DEAL", "numbers and currency intact");
  assert.equal(applyCaptionCase("anything", "none"), "anything");
});
