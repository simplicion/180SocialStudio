/** Run: npx tsx --test packages/video-contracts/tests/caption-templates.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { EditIRCompiler } from "../src/edit-ir-compiler";
import { CreativeEditPlanSchema, AutoCaptionsOpSchema } from "../src/creative-plan.schema";
import { editIRFromMobileMedia, editIRFromMobile, toMobileEditIR } from "../src/mobile-edit-ir";
import { PlanExpander } from "../src/plan-expander";
import { retextCaptionSegment } from "../src/caption-translation";
import { RationalTimeMath } from "../src/time";
import { MobileEditIRSchema } from "../src/mobile-edit-ir";
import { captionKeywordIndex, captionFontFor } from "../src/caption-enhance";
import {
  CAPTION_TEMPLATES, CAPTION_TEMPLATE_IDS, CAPTION_FONT_ALLOWLIST, LEGACY_CAPTION_TEMPLATE_IDS, resolveCaptionTemplate, findCaptionTemplateInText,
  fontsOfSpec, legacyStyleOf, canonicalCaptionTemplateId,
} from "../src/caption-templates";
import { CaptionStyleV2Schema, DEFAULT_SCRIPT_FONTS, EDITABLE_FIELDS } from "../src/caption-style-v2";

const media = { assetId: "primary", durationMs: 10000, width: 1080, height: 1920, fps: 30 } as any;
const sources = [{ assetId: "primary", durationMs: 10000, width: 1080, height: 1920 }];
const words = ["this", "video", "cost", "one", "million", "dollars"].map((word, i) => ({
  word,
  startSeconds: 0.5 + i * 0.4,
  endSeconds: 0.85 + i * 0.4,
})) as any[];

function compile(operations: any[], base = editIRFromMobileMedia(media, "p1")) {
  const plan = CreativeEditPlanSchema.parse({
    intent: { aspectRatio: "9:16", resolution: { width: 1080, height: 1920 } },
    operations,
    explanation: "test",
  });
  return EditIRCompiler.compile(base, plan);
}
const mobileCaptions = (ir: any) => toMobileEditIR({ editIR: ir, sources, primaryAssetId: "primary" } as any).editIR.captions;

/** Every id the catalog shipped before captions v2. */
const OLD_IDS = [
  "HORMOZI_BOUNCE", "MRBEAST_HYPE", "ALI_ABDAAL_CLEAN", "DAN_KOE_MINIMAL", "CYBER_NEON", "KARAOKE_FROSTED", "VOX_EXPLAINER", "CINEMATIC_SUBTITLE",
  "RAJ_SHAMANI_BOLD", "VARUN_MAYYA_BOX", "IMAN_GADZHI_LUXE", "MUMBAI_BUBBLE", "EDITORIAL_SERIF", "DOCUMENTARY_LOWER", "NEON_PULSE", "STREET_IMPACT",
  "PASTEL_CREATOR", "MONOCHROME_BOLD", "NIGHT_RETRO", "DYNAMIC_DUO",
];

test("the catalog: 18 neutral templates, each a valid v2 spec with metadata and a flat v1 style derived from it", () => {
  assert.equal(CAPTION_TEMPLATES.length, 18);
  assert.deepEqual(CAPTION_TEMPLATES.map((t) => t.id), [...CAPTION_TEMPLATE_IDS]);
  assert.equal(new Set(CAPTION_TEMPLATES.map((t) => t.name)).size, 18, "names are unique");
  for (const t of CAPTION_TEMPLATES) {
    assert.deepEqual(CaptionStyleV2Schema.parse(t.styleV2), t.styleV2, t.id);
    assert.ok(t.description.length > 20, t.id);
    assert.ok(t.bestFor.length >= 3, t.id);
    assert.ok(t.energy >= 1 && t.energy <= 5, t.id);
    assert.ok(t.languages.length > 0, t.id);
    assert.ok(t.editable.length > 0 && t.editable.every((f) => (EDITABLE_FIELDS as readonly string[]).includes(f)), t.id);
    assert.deepEqual(t.styleV2.editable, [...t.editable], t.id);
    assert.ok(t.styleV2.typography.sizeRangePx, `${t.id} has a size range`);
    assert.equal(t.thumbnail, null, "thumbnails come from the real renderer later");
    assert.deepEqual(t.style, legacyStyleOf(t.styleV2), t.id);
    assert.equal(t.style.fontFamily, t.styleV2.typography.fonts.latin);
  }
  // Every template lets the creator change colours, size and position (their changes survive a template change).
  for (const t of CAPTION_TEMPLATES) for (const f of ["colors", "sizePx", "position"] as const) assert.ok(t.editable.includes(f), `${t.id} ${f}`);
});

test("fonts: every template font (and every default script font) is an allow-listed OFL / Apache Google Font", () => {
  const allowed = new Set(Object.keys(CAPTION_FONT_ALLOWLIST));
  for (const f of Object.values(DEFAULT_SCRIPT_FONTS)) assert.ok(allowed.has(f), f);
  for (const t of CAPTION_TEMPLATES) for (const f of fontsOfSpec(t.styleV2)) assert.ok(allowed.has(f), `${t.id}: ${f} is not on the font allowlist`);
  for (const [f, v] of Object.entries(CAPTION_FONT_ALLOWLIST)) assert.ok(["OFL-1.1", "Apache-2.0"].includes(v.license), f);
  for (const banned of ["Komika", "The Bold Font", "Proxima Nova"]) assert.equal(allowed.has(banned), false);
});

test("personality rights: no creator or brand name in a user-facing name or description; aliases are the only place", () => {
  const FORBIDDEN = ["mrbeast", "mr beast", "beast", "hormozi", "abdaal", "dan koe", "shamani", "mayya", "gadzhi", "vox", "netflix", "natgeo", "bbc"];
  for (const t of CAPTION_TEMPLATES) {
    const shown = `${t.id} ${t.name} ${t.description} ${t.bestFor.join(" ")}`.toLowerCase();
    for (const f of FORBIDDEN) assert.ok(!shown.includes(f), `${t.id} shows "${f}"`);
  }
});

test("old ids: every id the catalog ever shipped maps to a new template and resolves", () => {
  for (const id of OLD_IDS) {
    const to = LEGACY_CAPTION_TEMPLATE_IDS[id];
    assert.ok(to && (CAPTION_TEMPLATE_IDS as readonly string[]).includes(to), id);
    assert.equal(resolveCaptionTemplate(id)?.id, to, id);
    assert.equal(canonicalCaptionTemplateId(id), to);
  }
  assert.equal(LEGACY_CAPTION_TEMPLATE_IDS.MRBEAST_HYPE, "IMPACT_BOLD");
  assert.equal(LEGACY_CAPTION_TEMPLATE_IDS.HORMOZI_BOUNCE, "SPOTLIGHT_WORD");
  assert.equal(LEGACY_CAPTION_TEMPLATE_IDS.ALI_ABDAAL_CLEAN, "GLASS_PILL");
  assert.equal(LEGACY_CAPTION_TEMPLATE_IDS.VARUN_MAYYA_BOX, "WORD_BOX_SLIDE");
  assert.equal(LEGACY_CAPTION_TEMPLATE_IDS.IMAN_GADZHI_LUXE, "LUXE_REVEAL");
  assert.equal(LEGACY_CAPTION_TEMPLATE_IDS.CINEMATIC_SUBTITLE, "CINEMA_SUBTITLE");
  assert.equal(canonicalCaptionTemplateId("SOMETHING_ELSE"), "SOMETHING_ELSE");
});

test("intent -> template: hidden aliases resolve creator and brand nicknames", () => {
  const cases: Array<[string, string]> = [
    ["mrbeast captions", "IMPACT_BOLD"],
    ["give me MrBeast style captions", "IMPACT_BOLD"],
    ["hormozi style", "SPOTLIGHT_WORD"],
    ["netflix subtitles please", "CINEMA_SUBTITLE"],
    ["make them cinematic captions", "CINEMA_SUBTITLE"],
    ["apply the Mr Beast type captioning with red highlights", "IMPACT_BOLD"],
    ["karaoke captions", "KARAOKE_SWEEP"],
    ["desi bubble look", "BOLD_DESI"],
    ["documentary style captions", "DOCUMENTARY"],
  ];
  for (const [text, id] of cases) assert.equal(findCaptionTemplateInText(text)?.id, id, text);
  assert.equal(resolveCaptionTemplate("Mr. Beast")?.id, "IMPACT_BOLD");
  assert.equal(resolveCaptionTemplate("netflix")?.id, "CINEMA_SUBTITLE");
  assert.equal(resolveCaptionTemplate("Impact Bold")?.id, "IMPACT_BOLD");
  assert.equal(resolveCaptionTemplate("hormozi style")?.id, "SPOTLIGHT_WORD");
  assert.equal(resolveCaptionTemplate("CLEAN"), undefined);
  assert.equal(findCaptionTemplateInText("add captions"), undefined);
});

test("autoCaptions with a template: its spec and flat font, outline and colours reach the phone; the spoken word highlights", () => {
  const op = AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "mrbeast" });
  assert.equal(op.template, "IMPACT_BOLD");
  const r = compile(PlanExpander.captionOps(words, op));
  const caps = mobileCaptions(r.updatedEditIR);
  assert.equal(caps.length, 2);
  const st = caps[0].style as any;
  assert.equal(st.preset, "IMPACT_BOLD");
  assert.equal(st.fontFamily, "Anton");
  assert.equal(st.textColor, "#FFE600");
  assert.equal(st.strokeWidthPx, 6);
  assert.equal(st.stroke2WidthPx, 14, "the second outline reaches the phone");
  assert.equal(st.uppercase, true);
  assert.equal(st.styleV2.typography.fonts.latin, "Anton");
  assert.equal(st.templateApplied.templateId, "IMPACT_BOLD");
  assert.equal(caps[0].text, "THIS VIDEO COST");
  assert.ok(caps[0].words.every((w: any) => w.color === null));
  MobileEditIRSchema.parse(toMobileEditIR({ editIR: r.updatedEditIR, sources, primaryAssetId: "primary" } as any).editIR);
});

test("a colour given with the template overrides only that colour, also inside styleV2", () => {
  const op = AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "SPOTLIGHT_WORD", highlightColor: "#FF0000" });
  const st = mobileCaptions(compile(PlanExpander.captionOps(words, op)).updatedEditIR)[0].style as any;
  assert.equal(st.highlightColor, "#FF0000");
  assert.equal(st.styleV2.words.active.color, "#FF0000");
  assert.equal(st.textColor, "#FFFFFF");
  assert.equal(st.fontFamily, "Montserrat");
});

test("autoCaptions without a template keeps the classic look", () => {
  const op = AutoCaptionsOpSchema.parse({ type: "autoCaptions" });
  const caps = mobileCaptions(compile(PlanExpander.captionOps(words, op)).updatedEditIR);
  const st = caps[0].style as any;
  assert.equal(st.fontFamily, "Inter");
  assert.equal(st.highlightColor, "#FFE600");
  assert.equal(st.animation, "word_pop");
  assert.equal(st.styleV2, undefined);
});

test("styleCaption with a template name restyles existing captions and replaces the old pill", () => {
  const first = compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "GLASS_PILL" })));
  assert.ok(mobileCaptions(first.updatedEditIR)[0].style.background);
  const r = compile([{ type: "styleCaption", preset: "mr beast", highlightColor: "#00E5FF" }], first.updatedEditIR);
  const cap = mobileCaptions(r.updatedEditIR)[0];
  assert.equal(cap.style.preset, "IMPACT_BOLD");
  assert.equal(cap.style.fontFamily, "Anton");
  assert.equal(cap.style.highlightColor, "#00E5FF");
  assert.equal(cap.style.background, null);
  assert.ok(cap.words.every((w: any) => w.scale === 1.12));
});

test("box and reveal templates pass the phone schema; the compiler alone never translates", () => {
  for (const id of ["WORD_BOX_SLIDE", "LUXE_REVEAL", "BOLD_DESI", "PODCAST_DUO", "TYPEWRITER_STORY", "GRADIENT_EDGE", "BREAKING_NEWS"]) {
    const r = compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: id })));
    const projected = toMobileEditIR({ editIR: r.updatedEditIR, sources, primaryAssetId: "primary" } as any).editIR;
    MobileEditIRSchema.parse(projected);
    assert.equal(projected.captions[0].style.preset, id);
  }
  assert.equal(mobileCaptions(compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "WORD_BOX_SLIDE" }))).updatedEditIR)[0].style.animation, "word_box");
  assert.equal(resolveCaptionTemplate("iman gadzhi")?.style.animation, "word_reveal");
  const r = compile([{ type: "translateCaptions", targetLanguage: "hi" }]);
  assert.ok(r.rejectedOperations.some((x) => x.startsWith("translateCaptions")));
});

test("old projects: a caption stored with an old template id still parses, renders its flat fields and round-trips", () => {
  const base = toMobileEditIR({ editIR: editIRFromMobileMedia(media, "p1"), sources, primaryAssetId: "primary" }).editIR;
  const old = MobileEditIRSchema.parse({
    ...base,
    captions: [{
      id: "c1", kind: "caption", startMs: 500, endMs: 2000, text: "THIS VIDEO COST",
      words: [{ text: "THIS", startMs: 500, endMs: 900 }, { text: "VIDEO", startMs: 900, endMs: 1400 }, { text: "COST", startMs: 1400, endMs: 2000, highlight: true }],
      style: { preset: "HORMOZI_BOUNCE", animation: "word_pop", fontFamily: "Anton", fontWeight: 400, fontSizePx: 52, textColor: "#FACC15", highlightColor: "#22C55E", strokeWidthPx: 3, uppercase: true },
    }],
  });
  const back = toMobileEditIR({ editIR: editIRFromMobile(old), sources, primaryAssetId: "primary" }).editIR.captions[0];
  assert.deepEqual([back.style.preset, back.style.fontFamily, back.style.textColor, back.style.highlightColor, back.style.strokeWidthPx], ["HORMOZI_BOUNCE", "Anton", "#FACC15", "#22C55E", 3]);
  assert.equal((back.style as any).styleV2, undefined, "nothing is invented for an old caption");
  assert.equal(resolveCaptionTemplate(back.style.preset)?.id, "SPOTLIGHT_WORD", "its preset opens as the new template");
});

test("retextCaptionSegment spreads the new words over the caption's own range", () => {
  const ir = compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "IMPACT_BOLD" }))).updatedEditIR;
  const cap = ir.tracks.captionTrack[0];
  const start = RationalTimeMath.toSeconds(cap.timeRange.start);
  const end = start + RationalTimeMath.toSeconds(cap.timeRange.duration);
  retextCaptionSegment(cap, "  yeh video   mehenga tha ");
  assert.equal(cap.text, "yeh video mehenga tha");
  assert.equal(cap.words.length, 4);
  assert.ok(Math.abs(RationalTimeMath.toSeconds(cap.words[0].start) - start) < 0.001);
  assert.ok(Math.abs(RationalTimeMath.toSeconds(cap.words[3].end) - end) < 0.001);
  for (let i = 1; i < cap.words.length; i++) {
    assert.ok(RationalTimeMath.toSeconds(cap.words[i].start) >= RationalTimeMath.toSeconds(cap.words[i - 1].end) - 0.001);
  }
  assert.ok(cap.words.every((w) => !w.highlight));
});

test("key word and font rules", () => {
  assert.equal(captionKeywordIndex(["this", "cost", "$500", "amazing"]), 2);
  assert.equal(captionKeywordIndex(["the", "biggest", "mistake"]), 1);
  assert.equal(captionKeywordIndex(["so", "here", "we", "go"]), null);
  assert.equal(captionKeywordIndex(["because", "people"]), null);
  assert.equal(captionFontFor("आज हम", "Anton"), "Noto Sans Devanagari");
  assert.equal(captionFontFor("आज हम", "Poppins"), "Poppins");
  assert.equal(captionFontFor("வணக்கம்", "Montserrat"), "Noto Sans Tamil");
  assert.equal(captionFontFor("aaj hum", "Anton"), "Anton");
});

test("autoCaptions: one key word per caption is highlighted, no emoji is added, Hindi gets the template's Devanagari font", () => {
  const caps = mobileCaptions(compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "IMPACT_BOLD", emoji: true }))).updatedEditIR);
  // "this video cost" has no key word; "one million dollars" highlights "million". An emoji flag is ignored.
  assert.ok(caps[0].words.every((w: any) => !w.highlight));
  assert.deepEqual(caps[1].words.map((w: any) => w.highlight), [false, true, false]);
  assert.equal(caps[1].words[1].color, caps[1].style.highlightColor);
  assert.equal(caps[1].text, "ONE MILLION DOLLARS");
  const off = mobileCaptions(compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", autoEmphasis: false }))).updatedEditIR);
  assert.ok(off.every((c: any) => c.words.every((w: any) => !w.highlight)));

  const hindi = ["आज", "हम", "बात", "करेंगे"].map((word, i) => ({ word, startSeconds: 0.5 + i * 0.4, endSeconds: 0.85 + i * 0.4 })) as any[];
  const hi = mobileCaptions(compile(PlanExpander.captionOps(hindi, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "BOLD_DESI" }))).updatedEditIR);
  assert.equal(hi[0].style.fontFamily, "Baloo 2");
  const cinema = mobileCaptions(compile(PlanExpander.captionOps(hindi, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "CINEMA_SUBTITLE" }))).updatedEditIR);
  assert.equal(cinema[0].style.fontFamily, "Mukta");
});

test("a title from the phone's text tool (partial style, legacy animation) is accepted and round-trips", () => {
  const base = toMobileEditIR({ editIR: editIRFromMobileMedia(media, "p1"), sources, primaryAssetId: "primary" }).editIR;
  const fromPhone = {
    ...base,
    captions: [
      { id: "txt_1", kind: "text", startMs: 500, endMs: 2500, text: "Hello\nworld", words: [{ text: "Hello world", startMs: 500, endMs: 2500 }],
        style: { fontFamily: "Anton", fontSizePx: 96, textColor: "#FFFFFF", positionX: 0.5, positionY: 0.2, background: { color: "#000000B3" }, animation: "fade_in" } },
      { id: "cap_1", kind: "caption", startMs: 3000, endMs: 4000, text: "typed by hand", words: [], style: {} },
    ],
  };
  const parsed = MobileEditIRSchema.parse(fromPhone);
  const title = parsed.captions[0];
  assert.equal(title.style.animation, "none");
  assert.equal(title.style.fontWeight, 800);
  assert.deepEqual(title.style.background, { color: "#000000B3", paddingPx: 16, radiusPx: 16 });
  assert.equal(title.words[0].highlight, false);
  assert.equal(parsed.captions[1].style.fontSizePx, 64);

  const back = toMobileEditIR({ editIR: editIRFromMobile(parsed), sources, primaryAssetId: "primary" }).editIR;
  assert.deepEqual(back.captions.map((c) => [c.id, c.kind, c.text]), [["txt_1", "text", "Hello\nworld"], ["cap_1", "caption", "typed by hand"]]);
});
