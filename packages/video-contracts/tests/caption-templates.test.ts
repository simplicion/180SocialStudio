/** Run: npx tsx --test packages/video-contracts/tests/caption-templates.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { EditIRCompiler } from "../src/edit-ir-compiler";
import { CreativeEditPlanSchema, AutoCaptionsOpSchema } from "../src/creative-plan.schema";
import { editIRFromMobileMedia, toMobileEditIR } from "../src/mobile-edit-ir";
import { PlanExpander } from "../src/plan-expander";
import { retextCaptionSegment } from "../src/caption-translation";
import { RationalTimeMath } from "../src/time";
import { MobileEditIRSchema } from "../src/mobile-edit-ir";
import { captionKeywordIndex, captionFontFor } from "../src/caption-enhance";
import { CAPTION_TEMPLATES, CAPTION_TEMPLATE_IDS, resolveCaptionTemplate, findCaptionTemplateInText } from "../src/caption-templates";

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

test("every template id has a catalog entry and resolves by id, name and alias", () => {
  assert.deepEqual(CAPTION_TEMPLATES.map((t) => t.id), [...CAPTION_TEMPLATE_IDS]);
  assert.equal(resolveCaptionTemplate("MRBEAST_HYPE")?.id, "MRBEAST_HYPE");
  assert.equal(resolveCaptionTemplate("Mr. Beast")?.id, "MRBEAST_HYPE");
  assert.equal(resolveCaptionTemplate("hormozi")?.id, "HORMOZI_BOUNCE");
  assert.equal(resolveCaptionTemplate("BOLD_CENTER"), undefined);
  assert.equal(findCaptionTemplateInText("apply the Mr Beast type captioning with red highlights")?.id, "MRBEAST_HYPE");
  assert.equal(findCaptionTemplateInText("add captions"), undefined);
});

test("autoCaptions with a template: its font, outline and colours reach the phone; the spoken word highlights", () => {
  const op = AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "MRBEAST_HYPE" });
  const r = compile(PlanExpander.captionOps(words, op));
  const caps = mobileCaptions(r.updatedEditIR);
  assert.equal(caps.length, 2);
  const st = caps[0].style;
  assert.equal(st.preset, "MRBEAST_HYPE");
  assert.equal(st.fontFamily, "Montserrat");
  assert.equal(st.fontWeight, 900);
  assert.equal(st.textColor, "#FFFFFF");
  assert.equal(st.highlightColor, "#EF4444");
  assert.equal(st.strokeWidthPx, 4);
  assert.equal(st.uppercase, true);
  assert.equal(caps[0].text, "THIS VIDEO COST");
  assert.ok(caps[0].words.every((w: any) => w.color === null && w.scale === 1.15));
});

test("a colour given with the template overrides only that colour", () => {
  const op = AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "HORMOZI_BOUNCE", highlightColor: "#FF0000" });
  const st = mobileCaptions(compile(PlanExpander.captionOps(words, op)).updatedEditIR)[0].style;
  assert.equal(st.highlightColor, "#FF0000");
  assert.equal(st.textColor, "#FACC15");
  assert.equal(st.fontFamily, "Anton");
});

test("autoCaptions without a template keeps the classic look", () => {
  const op = AutoCaptionsOpSchema.parse({ type: "autoCaptions" });
  const caps = mobileCaptions(compile(PlanExpander.captionOps(words, op)).updatedEditIR);
  const st = caps[0].style;
  assert.equal(st.fontFamily, "Inter");
  assert.equal(st.highlightColor, "#FFE600");
  assert.equal(st.textColor, "#FFFFFF");
  assert.equal(st.animation, "word_pop");
  assert.equal(st.uppercase, false);
  assert.equal(st.preset, "HORMOZI_BOUNCE");
});

test("styleCaption with a template name restyles existing captions and replaces the old pill", () => {
  const first = compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "ALI_ABDAAL_CLEAN" })));
  assert.ok(mobileCaptions(first.updatedEditIR)[0].style.background);
  const r = compile([{ type: "styleCaption", preset: "mr beast", highlightColor: "#00E5FF" }], first.updatedEditIR);
  const cap = mobileCaptions(r.updatedEditIR)[0];
  assert.equal(cap.style.preset, "MRBEAST_HYPE");
  assert.equal(cap.style.fontFamily, "Montserrat");
  assert.equal(cap.style.highlightColor, "#00E5FF");
  assert.equal(cap.style.animation, "word_pop");
  assert.equal(cap.style.background, null);
  assert.ok(cap.words.every((w: any) => w.scale === 1.15));
});

test("word_box and word_reveal templates pass the phone schema; the compiler alone never translates", () => {
  for (const id of ["VARUN_MAYYA_BOX", "IMAN_GADZHI_LUXE", "MUMBAI_BUBBLE", "RAJ_SHAMANI_BOLD"]) {
    const r = compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: id })));
    const projected = toMobileEditIR({ editIR: r.updatedEditIR, sources, primaryAssetId: "primary" } as any).editIR;
    MobileEditIRSchema.parse(projected);
    assert.equal(projected.captions[0].style.preset, id);
  }
  assert.equal(mobileCaptions(compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "VARUN_MAYYA_BOX" }))).updatedEditIR)[0].style.animation, "word_box");
  assert.equal(resolveCaptionTemplate("iman gadzhi")?.style.animation, "word_reveal");
  const r = compile([{ type: "translateCaptions", targetLanguage: "hi" }]);
  assert.ok(r.rejectedOperations.some((x) => x.startsWith("translateCaptions")));
});

test("retextCaptionSegment spreads the new words over the caption's own range", () => {
  const ir = compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "MRBEAST_HYPE" }))).updatedEditIR;
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
  assert.ok(cap.words.every((w) => w.scaleMultiplier === 1.15 && !w.highlight));
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

test("autoCaptions: one key word per caption is highlighted, no emoji is added, Hindi gets a font that draws it", () => {
  const caps = mobileCaptions(compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "MRBEAST_HYPE", emoji: true }))).updatedEditIR);
  // "this video cost" has no key word; "one million dollars" highlights "million". An emoji flag is ignored.
  assert.ok(caps[0].words.every((w: any) => !w.highlight));
  assert.deepEqual(caps[1].words.map((w: any) => w.highlight), [false, true, false]);
  assert.equal(caps[1].words[1].color, "#EF4444");
  assert.equal(caps[1].text, "ONE MILLION DOLLARS");
  const off = mobileCaptions(compile(PlanExpander.captionOps(words, AutoCaptionsOpSchema.parse({ type: "autoCaptions", autoEmphasis: false }))).updatedEditIR);
  assert.ok(off.every((c: any) => c.words.every((w: any) => !w.highlight)));

  const hindi = ["आज", "हम", "बात", "करेंगे"].map((word, i) => ({ word, startSeconds: 0.5 + i * 0.4, endSeconds: 0.85 + i * 0.4 })) as any[];
  const hi = mobileCaptions(compile(PlanExpander.captionOps(hindi, AutoCaptionsOpSchema.parse({ type: "autoCaptions", template: "HORMOZI_BOUNCE" }))).updatedEditIR);
  assert.equal(hi[0].style.fontFamily, "Noto Sans Devanagari");
});
