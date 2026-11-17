/**
 * Captions v2 Phase 6: the AI Director's caption template tool, emphasis validation, field-level provenance (the
 * creator's own colour / size / position survive a later template change) and the selection policy.
 * Run: npx tsx --test packages/video-contracts/tests/caption-director.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EditIRCompiler } from "../src/edit-ir-compiler";
import { CreativeEditPlanSchema, AutoCaptionsOpSchema } from "../src/creative-plan.schema";
import { editIRFromMobileMedia, editIRFromMobile, toMobileEditIR, MobileEditIRSchema, type MobileEditIR } from "../src/mobile-edit-ir";
import { PlanExpander } from "../src/plan-expander";
import { buildDirectorToolDefinitions, validateDirectorToolCalls, DIRECTOR_TOOL_SPECS } from "../src/director-tools";
import { TOOLS_BY_TARGET } from "../src/director-intent";
import { CAPTION_SELECTION_POLICY, captionCatalogForPrompt, chooseCaptionTemplate, CAPTION_TEMPLATES } from "../src/caption-templates";
import { validateCaptionEmphasis, isCaptionStopWord } from "../src/caption-emphasis";
import { preserveUntouched } from "../src/mobile-preserve";
import { DeterministicPlanner } from "../src/deterministic-planner";

const media = { assetId: "primary", durationMs: 10000, width: 1080, height: 1920, fps: 30 } as any;
const sources = [{ assetId: "primary", durationMs: 10000, width: 1080, height: 1920 }];
const intent = { aspectRatio: "9:16", resolution: { width: 1080, height: 1920 } };
const words = ["this", "video", "cost", "one", "million", "dollars", "and", "it", "failed"].map((word, i) => ({ word, startSeconds: 0.5 + i * 0.4, endSeconds: 0.85 + i * 0.4 })) as any[];
const toMobile = (ir: any): MobileEditIR => toMobileEditIR({ editIR: ir, sources, primaryAssetId: "primary" }).editIR;

function compileCalls(calls: Array<{ name: string; args: any }>, base: any) {
  const v = validateDirectorToolCalls(calls);
  assert.deepEqual(v.errors, []);
  return EditIRCompiler.compile(base, CreativeEditPlanSchema.parse({ intent, operations: v.operations, explanation: "t" }));
}
/** A phone timeline with Director-made captions in `template`. */
function captioned(template = "SPOTLIGHT_WORD"): MobileEditIR {
  const op = AutoCaptionsOpSchema.parse({ type: "autoCaptions", template });
  const r = EditIRCompiler.compile(editIRFromMobileMedia(media, "p1"), CreativeEditPlanSchema.parse({ intent, operations: PlanExpander.captionOps(words, op), explanation: "t" }));
  return MobileEditIRSchema.parse(toMobile(r.updatedEditIR));
}

test("applyCaptionTemplate is a Director tool in the captions stage, with the catalog ids and no creator names in any tool text", () => {
  const tools = buildDirectorToolDefinitions();
  const t = tools.find((x) => x.function.name === "applyCaptionTemplate")!;
  assert.ok(t);
  assert.deepEqual(t.function.parameters.properties.templateId.enum, CAPTION_TEMPLATES.map((x) => x.id));
  assert.ok(t.function.parameters.properties.overrides.properties.colors);
  assert.deepEqual(t.function.parameters.properties.emphasis.items.properties.role.enum, ["emphasis", "positive", "negative"]);
  assert.ok(TOOLS_BY_TARGET.caption.includes("applyCaptionTemplate"));
  // The agent's captions stage picks tools by /caption|Caption/ on the name.
  assert.ok(/caption|Caption/.test("applyCaptionTemplate"));
  const allText = JSON.stringify(tools).toLowerCase();
  for (const f of ["mrbeast", "mr beast", "hormozi", "abdaal", "dan koe", "shamani", "mayya", "gadzhi", "netflix", "vox"]) assert.ok(!allText.includes(f), `tool text mentions ${f}`);
  assert.ok(DIRECTOR_TOOL_SPECS.some((s) => s.name === "applyCaptionTemplate"));
});

test("intent -> template through the tool: nicknames resolve to catalog ids", () => {
  const v = validateDirectorToolCalls([
    { name: "applyCaptionTemplate", args: { templateId: "mrbeast" } },
    { name: "applyCaptionTemplate", args: { templateId: "netflix subtitles" } },
    { name: "applyCaptionTemplate", args: { templateId: "Hormozi" } },
    { name: "applyCaptionTemplate", args: { templateId: "cinematic" } },
    { name: "autoCaptions", args: { template: "MUMBAI_BUBBLE" } },
  ]);
  assert.deepEqual(v.errors, []);
  assert.deepEqual(v.operations.map((o: any) => o.templateId ?? o.template), ["IMPACT_BOLD", "CINEMA_SUBTITLE", "SPOTLIGHT_WORD", "CINEMA_SUBTITLE", "BOLD_DESI"]);
  assert.match(validateDirectorToolCalls([{ name: "applyCaptionTemplate", args: { templateId: "NOT_A_TEMPLATE" } }]).errors.join(), /templateId/);
});

test("applyCaptionTemplate: the final spec rides on the caption as styleV2 plus the flat v1 fields; locked overrides are refused", () => {
  const base = editIRFromMobile(captioned("SPOTLIGHT_WORD"));
  const r = compileCalls([{ name: "applyCaptionTemplate", args: { templateId: "CINEMA_SUBTITLE", overrides: { colors: { text: "#FDE68A" }, maxWords: 2, case: "upper" } } }], base);
  assert.match(r.appliedOperations.join("\n"), /Cinema Subtitle caption template to 3 caption/);
  const rej = r.rejectedOperations.join("\n");
  assert.match(rej, /maxWords is not editable on the Cinema Subtitle template/);
  assert.match(rej, /case is not editable/);
  const cap = toMobile(r.updatedEditIR).captions[0];
  const st = cap.style as any;
  assert.equal(st.preset, "CINEMA_SUBTITLE");
  assert.equal(st.fontFamily, "Inter");
  assert.equal(st.textColor, "#FDE68A");
  assert.deepEqual(st.styleV2.paint.fill, { type: "solid", color: "#FDE68A" });
  assert.equal(st.styleV2.grouping.maxWords, 12, "locked maxWords kept the template's value");
  assert.equal(st.styleV2.typography.case, "none");
  assert.equal(st.uppercase, false);
  assert.equal(st.strokeWidthPx, 0);
  assert.deepEqual(st.enter, { type: "fade", durationMs: 180 });
  MobileEditIRSchema.parse(toMobile(r.updatedEditIR));
  // Round trip keeps the spec.
  const back = toMobile(editIRFromMobile(toMobile(r.updatedEditIR))).captions[0].style as any;
  assert.deepEqual(back.styleV2, st.styleV2);
});

test("applyCaptionTemplate with no captions is rejected", () => {
  const r = compileCalls([{ name: "applyCaptionTemplate", args: { templateId: "IMPACT_BOLD" } }], editIRFromMobileMedia(media, "p1"));
  assert.match(r.rejectedOperations.join(), /no captions to style/);
});

test("emphasis: valid picks get their role colour; stop words, missing words, a second pick per caption and bad roles are refused", () => {
  const base = editIRFromMobile(captioned("KEYWORD_POP"));
  const capIds = base.tracks.captionTrack.map((c) => c.id);
  assert.equal(capIds.length, 3); // "this video cost" / "one million dollars" / "and it failed"
  const r = compileCalls([{ name: "applyCaptionTemplate", args: { templateId: "KEYWORD_POP", emphasis: [
    { captionId: capIds[1], wordIndex: 1, role: "positive" },          // million
    { captionId: capIds[1], wordIndex: 2, role: "emphasis" },          // second pick in the same caption
    { word: "failed", role: "negative" },                              // by text
    { word: "the" },                                                    // not in the captions
    { captionId: capIds[2], wordIndex: 0 },                            // "and": a stop word
    { word: "cost", atSec: 1.3 },
  ] } }], base);
  const rej = r.rejectedOperations.join("\n");
  assert.match(rej, /already has an emphasised word/);
  assert.match(rej, /"the": that word is not in the captions/);
  assert.match(rej, /"and" is a stop word|already has an emphasised word/);
  const caps = toMobile(r.updatedEditIR).captions;
  const spec = CAPTION_TEMPLATES.find((t) => t.id === "KEYWORD_POP")!.styleV2;
  assert.deepEqual(caps[1].words.map((w) => w.highlight), [false, true, false]);
  assert.equal(caps[1].words[1].color, spec.emphasis.colors.positive);
  assert.equal(caps[1].words[1].scale, 1.35);
  assert.equal(caps[2].words[2].color, spec.emphasis.colors.negative);
  assert.ok(caps[0].words[2].highlight, "cost");
  assert.equal(caps.reduce((n, c) => n + c.words.filter((w) => w.highlight).length, 0), 3, "at most one per caption");
  // A bad role never gets past the schema.
  assert.ok(validateDirectorToolCalls([{ name: "applyCaptionTemplate", args: { templateId: "KEYWORD_POP", emphasis: [{ word: "cost", role: "money" }] } }]).errors.length === 1);
});

test("emphasis validation: per-language stop words (en / hi / es) and the transcript check", () => {
  for (const w of ["the", "And", "is,", "है", "का", "hai", "toh", "el", "que", "para"]) assert.ok(isCaptionStopWord(w), w);
  for (const w of ["million", "पैसा", "dinero", "$500", "failed"]) assert.equal(isCaptionStopWord(w), false, w);
  const caps = [{ id: "a", startSec: 0, words: [{ word: "यह", startSec: 0, endSec: 0.3 }, { word: "पैसा", startSec: 0.3, endSec: 0.6 }] }];
  const r = validateCaptionEmphasis([{ captionId: "a", wordIndex: 0 }, { word: "पैसा", role: "positive" }, { word: "rupees" }], caps, "hi");
  assert.deepEqual(r.accepted, [{ captionId: "a", wordIndex: 1, role: "positive" }]);
  assert.equal(r.rejected.length, 2);
});

test("the creator's hand-set colour, size and position survive a later Director template change", () => {
  const phone = captioned("SPOTLIGHT_WORD");
  // The creator edits caption 0 by hand on the phone: colour, size, position (styleV2 / snapshot left as the server sent them).
  const edited: MobileEditIR = MobileEditIRSchema.parse({
    ...phone,
    captions: phone.captions.map((c, i) => (i === 0 ? { ...c, style: { ...c.style, textColor: "#00FFAA", fontSizePx: 70, positionX: 0.4, positionY: 0.3 } } : c)),
  });
  const r = compileCalls([{ name: "applyCaptionTemplate", args: { templateId: "IMPACT_BOLD" } }], editIRFromMobile(edited));
  assert.match(r.appliedOperations.join(), /kept your own colour\/size\/position on 1/);
  const caps = toMobile(r.updatedEditIR).captions;
  const mine = caps[0].style as any;
  assert.equal(mine.preset, "IMPACT_BOLD");
  assert.equal(mine.fontFamily, "Anton", "the template look changes");
  assert.deepEqual([mine.textColor, mine.fontSizePx, mine.positionX, mine.positionY], ["#00FFAA", 70, 0.4, 0.3], "the creator's fields stay");
  assert.equal(mine.styleV2.paint.fill.color, "#00FFAA");
  assert.equal(mine.styleV2.typography.sizePx, 70);
  assert.deepEqual([mine.styleV2.layout.position, mine.styleV2.layout.x, mine.styleV2.layout.y], ["custom", 0.4, 0.3]);
  assert.deepEqual(mine.userEdited, ["textColor", "sizePx", "position"]);
  // An untouched caption takes the template's own values.
  const other = caps[1].style as any;
  assert.deepEqual([other.textColor, other.fontSizePx], ["#FFE600", 72]);
  assert.equal(other.userEdited, undefined);

  // A second Director turn (another template) still keeps them: the ownership is sticky.
  const r2 = compileCalls([{ name: "applyCaptionTemplate", args: { templateId: "GLASS_PILL" } }], editIRFromMobile(MobileEditIRSchema.parse(toMobile(r.updatedEditIR))));
  const again = toMobile(r2.updatedEditIR).captions[0].style as any;
  assert.deepEqual([again.preset, again.textColor, again.fontSizePx, again.positionY], ["GLASS_PILL", "#00FFAA", 70, 0.3]);

  // When the creator now asks the Director for a colour, that explicit change wins and the colour is no longer "theirs".
  const r3 = compileCalls([{ name: "applyCaptionTemplate", args: { templateId: "GLASS_PILL", overrides: { colors: { text: "#FFFFFF" } } } }], editIRFromMobile(MobileEditIRSchema.parse(toMobile(r2.updatedEditIR))));
  const asked = toMobile(r3.updatedEditIR).captions[0].style as any;
  assert.equal(asked.textColor, "#FFFFFF");
  assert.deepEqual(asked.userEdited, ["sizePx", "position"]);
});

test("old projects: a creator's colour on a caption saved with an old template id is recognised and kept", () => {
  const base = toMobile(editIRFromMobileMedia(media, "p1"));
  const old = MobileEditIRSchema.parse({
    ...base,
    captions: [{
      id: "c1", kind: "caption", startMs: 500, endMs: 1700, text: "THIS VIDEO COST",
      words: [{ text: "THIS", startMs: 500, endMs: 900 }, { text: "VIDEO", startMs: 900, endMs: 1300 }, { text: "COST", startMs: 1300, endMs: 1700 }],
      // Old Punchy Bounce look, except the text colour the creator set to pink.
      style: { preset: "HORMOZI_BOUNCE", animation: "word_pop", fontFamily: "Anton", fontWeight: 400, fontSizePx: 52, textColor: "#FF66CC", highlightColor: "#22C55E", strokeWidthPx: 3, uppercase: true },
    }],
  });
  const r = compileCalls([{ name: "applyCaptionTemplate", args: { templateId: "MINIMAL_CLEAN" } }], editIRFromMobile(old));
  const st = toMobile(r.updatedEditIR).captions[0].style as any;
  assert.equal(st.fontFamily, "Inter");
  assert.equal(st.textColor, "#FF66CC");
  assert.equal(st.highlightColor, "#CBD5E1", "the old template's own highlight is not treated as the creator's");
});

test("scoped 'make captions yellow' changes only the colour, and only that field is marked as the Director's", () => {
  const phone = captioned("SPOTLIGHT_WORD");
  const ops = DeterministicPlanner.plan("make the captions yellow", {
    projectDurationSec: 10, tracksCount: 2, clipsCount: 1, assetIds: ["primary"], currentAspect: "9:16", currentResolution: { width: 1080, height: 1920 },
    currentPlayheadSec: 0, existingCaptionsCount: phone.captions.length, existingEffects: [], existingAudioTracks: [], lockedTrackIds: [], directorPreferences: {},
    userConstraints: { doNotRemoveIntro: false, keepEnding: false, protectedTimeRanges: [], doNotAddMusic: false, useUploadedBrollOnly: false, lockedTrackIds: [], preserveVoiceAudio: true },
  } as any, { transcript: [], silences: [], faces: [], audioEvents: [], brollOpportunities: [], fillerWords: [], sceneChanges: [] } as any).operations.filter((o) => /aption/.test(o.type));
  assert.deepEqual(ops.map((o) => o.type), ["styleCaption"]);
  const before = editIRFromMobile(phone);
  const r = EditIRCompiler.compile(before, CreativeEditPlanSchema.parse({ intent, operations: ops, explanation: "t" }));
  const a = phone.captions[0].style as any;
  const b = toMobile(r.updatedEditIR).captions[0].style as any;
  const diff = Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  assert.deepEqual(diff.filter((k) => k !== "templateApplied").sort(), ["highlightColor"]);
  assert.notEqual(b.highlightColor, a.highlightColor);
  assert.equal(b.fontFamily, a.fontFamily);
  // The Director's own change is recorded, so it is not mistaken for a hand edit later.
  assert.equal(b.templateApplied.highlightColor, b.highlightColor);
  assert.equal(b.userEdited, undefined);
});

test("an untouched caption comes back to the phone verbatim (the provenance pass does not churn it)", () => {
  const phone = captioned("SPOTLIGHT_WORD");
  const before = editIRFromMobile(phone);
  const r = compileCalls([{ name: "addZoom", args: { startSec: 2, durationSec: 1, targetCoords: { x: 0.5, y: 0.4 } } }], editIRFromMobile(phone));
  const out = preserveUntouched(phone, before, r.updatedEditIR, toMobile(r.updatedEditIR));
  assert.deepEqual(out.captions, phone.captions);
});

test("translateCaptions accepts BCP-47 language codes (zh-Hant, hi-Latn, fil) and refuses junk", () => {
  for (const code of ["en", "hi", "fil", "zh-Hans", "zh-Hant", "hi-Latn", "pt-BR", "sr-Latn-RS"]) {
    assert.deepEqual(validateDirectorToolCalls([{ name: "translateCaptions", args: { targetLanguage: code } }]).errors, [], code);
  }
  for (const code of ["english", "EN", "zh_Hant", "hi-latin", ""]) {
    assert.equal(validateDirectorToolCalls([{ name: "translateCaptions", args: { targetLanguage: code } }]).errors.length, 1, code);
  }
});

test("the caption style carries the phone's captionTemplate / captionOverrides keys and they round-trip", () => {
  const base = editIRFromMobile(captioned("SPOTLIGHT_WORD"));
  const r = compileCalls([{ name: "applyCaptionTemplate", args: { templateId: "GLASS_PILL", overrides: { colors: { active: "#FF0000" }, motionIntensity: 0.5 } } }], base);
  const st = toMobile(r.updatedEditIR).captions[0].style as any;
  assert.equal(st.captionTemplate, "GLASS_PILL");
  assert.deepEqual(st.captionOverrides, { colors: { active: "#FF0000" }, motionIntensity: 0.5 });
  const back = toMobile(editIRFromMobile(MobileEditIRSchema.parse(toMobile(r.updatedEditIR)))).captions[0].style as any;
  assert.equal(back.captionTemplate, "GLASS_PILL");
  assert.deepEqual(back.captionOverrides, st.captionOverrides);
  // A style the phone wrote with those keys parses.
  MobileEditIRSchema.parse({ ...toMobile(r.updatedEditIR), captions: [{ ...toMobile(r.updatedEditIR).captions[0], style: { ...st, captionOverrides: { sizePx: 60 } } }] });
});

test("selection policy: compact catalog + policy text for the planner, and the offline rules", () => {
  const lines = captionCatalogForPrompt();
  assert.equal(lines.length, CAPTION_TEMPLATES.length);
  assert.match(lines.find((l) => l.startsWith("BOLD_DESI"))!, /mood bold \| energy 4\/5 \| best for: .*hinglish.* \| languages: hi,hinglish.* \| editable: colors,sizePx,position/);
  assert.match(CAPTION_SELECTION_POLICY, /Hindi, Hinglish .* BOLD_DESI/);
  assert.match(CAPTION_SELECTION_POLICY, /storytelling.*CINEMA_SUBTITLE/);
  assert.match(CAPTION_SELECTION_POLICY, /business.*SPOTLIGHT_WORD or KEYWORD_POP/);
  assert.match(CAPTION_SELECTION_POLICY, /at most ONE meaningful word per caption group/);
  assert.ok(!/beast|hormozi|netflix|abdaal/i.test(CAPTION_SELECTION_POLICY + lines.join("\n")));
  assert.equal(chooseCaptionTemplate({ prompt: "add bold captions", transcriptText: "आज हम बात करेंगे पैसे की" })?.id, "BOLD_DESI");
  assert.equal(chooseCaptionTemplate({ prompt: "bold hinglish captions", transcriptText: "aaj hum paise ki baat karenge" })?.id, "BOLD_DESI");
  assert.equal(chooseCaptionTemplate({ prompt: "captions for my travel story" })?.id, "CINEMA_SUBTITLE");
  assert.equal(chooseCaptionTemplate({ prompt: "captions for this finance tip" })?.id, "KEYWORD_POP");
  assert.equal(chooseCaptionTemplate({ prompt: "mrbeast captions" })?.id, "IMPACT_BOLD");
  assert.equal(chooseCaptionTemplate({ prompt: "add captions" }), undefined);
});
