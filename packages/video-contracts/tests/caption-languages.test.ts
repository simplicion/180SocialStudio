/** Captions v2 Phase 8: one shared language list, its derived copies, and per-language data rules. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CAPTION_LANGUAGES, findCaptionLanguage } from "../src/caption-languages";
import { CAPTION_TARGET_LANGUAGES, buildCaptionTranslationPrompt } from "../src/caption-translation";
import { applyCaptionCase, scriptOf, WRITING_SCRIPTS, joinWordsForScript } from "../src/caption-style-v2";
import { DART_LANGUAGES_PATH, renderCaptionLanguagesDart } from "../scripts/gen-caption-languages-dart";

const SPEC = [
  "en", "hi", "hi-Latn", "bn", "ta", "te", "mr", "gu", "kn", "ml", "pa", "or", "as", "ur", "ne", "sd", "ar", "fa", "es", "pt",
  "fr", "de", "it", "id", "ms", "tr", "ru", "uk", "vi", "th", "ja", "ko", "zh-Hans", "zh-Hant", "fil", "sw",
];

/** A short native sample per language: its script must be what the record says. */
const SAMPLE: Record<string, string> = {
  en: "hello", hi: "नमस्ते", "hi-Latn": "namaste", bn: "নমস্কার", ta: "வணக்கம்", te: "నమస్కారం", mr: "नमस्कार", gu: "નમસ્તે",
  kn: "ನಮಸ್ಕಾರ", ml: "നമസ്കാരം", pa: "ਸਤਿ", or: "ନମସ୍କାର", as: "নমস্কাৰ", ur: "سلام", ne: "नमस्ते", sd: "سلام", ar: "مرحبا",
  fa: "سلام", es: "hola", pt: "olá", fr: "bonjour", de: "hallo", it: "ciao", id: "halo", ms: "helo", tr: "merhaba", ru: "привет",
  uk: "привіт", vi: "xin chào", th: "สวัสดี", ja: "こんにちは", ko: "안녕하세요", "zh-Hans": "你好", "zh-Hant": "你好", fil: "kumusta", sw: "habari",
};

test("the list has every language of the spec, once, with valid BCP-47 codes", () => {
  const codes = CAPTION_LANGUAGES.map((l) => l.code);
  assert.deepEqual([...codes].sort(), [...SPEC].sort());
  assert.equal(new Set(codes.map((c) => c.toLowerCase())).size, codes.length);
  for (const c of codes) assert.match(c, /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/, c);
});

test("every record is internally consistent with its script", () => {
  for (const l of CAPTION_LANGUAGES) {
    assert.ok(WRITING_SCRIPTS.includes(l.script), l.code);
    assert.equal(scriptOf(SAMPLE[l.code]), l.script === "cjk-jp" && !/[぀-ヿ]/.test(SAMPLE[l.code]) ? "cjk-sc" : l.script, `${l.code} sample script`);
    assert.ok(l.fontStack.length >= 2 && l.fontStack.every((f) => f.length > 0), l.code);
    assert.ok(l.maxCharsPerLine >= 12 && l.maxCharsPerLine <= 42, l.code);
    assert.ok(l.maxCharsPerSecond >= 9 && l.maxCharsPerSecond <= 22, l.code);
    assert.equal(l.hasCase, l.casingLocale !== null, l.code);
    if (l.transcriptionCode !== null) assert.match(l.transcriptionCode, /^[a-z]{2}$/, `${l.code}: Whisper takes ISO-639-1`);
  }
});

test("RTL, no-space and casing flags", () => {
  const rtl = CAPTION_LANGUAGES.filter((l) => l.rtl).map((l) => l.code).sort();
  assert.deepEqual(rtl, ["ar", "fa", "sd", "ur"]);
  const noSpace = CAPTION_LANGUAGES.filter((l) => l.noSpaces).map((l) => l.code).sort();
  assert.deepEqual(noSpace, ["ja", "th", "zh-Hans", "zh-Hant"]);
  for (const c of ["ja", "zh-Hans", "zh-Hant"]) {
    const l = findCaptionLanguage(c)!;
    assert.equal(l.maxCharsPerLine, 16, c);
    assert.equal(l.maxCharsPerSecond, 9, c);
  }
  assert.equal(findCaptionLanguage("hi")!.maxCharsPerSecond, 22);
  assert.equal(findCaptionLanguage("en")!.maxCharsPerSecond, 17);
  const cased = CAPTION_LANGUAGES.filter((l) => l.hasCase).map((l) => l.script);
  assert.ok(cased.every((s) => s === "latin" || s === "cyrillic"));
  assert.equal(findCaptionLanguage("tr")!.casingLocale, "tr");
});

test("locale-aware casing per cased language (Turkish dotted i)", () => {
  const tr = findCaptionLanguage("tr")!;
  assert.equal(applyCaptionCase("istanbul ılık", "upper", tr.casingLocale!), "İSTANBUL ILIK");
  assert.equal(applyCaptionCase("istanbul", "upper", findCaptionLanguage("en")!.casingLocale!), "ISTANBUL");
  assert.equal(applyCaptionCase("привіт світ", "title", "uk"), "Привіт Світ");
  for (const l of CAPTION_LANGUAGES.filter((x) => !x.hasCase)) assert.equal(applyCaptionCase(SAMPLE[l.code], "upper", "en"), SAMPLE[l.code], l.code);
});

test("no-space languages are joined without spaces, others with spaces", () => {
  for (const l of CAPTION_LANGUAGES) {
    const s = SAMPLE[l.code];
    const joined = joinWordsForScript([s, s], l.script);
    assert.equal(joined, l.noSpaces ? s + s : `${s} ${s}`, l.code);
  }
});

test("aliases and case-insensitive lookup", () => {
  assert.equal(findCaptionLanguage("zh")!.code, "zh-Hans");
  assert.equal(findCaptionLanguage("ZH-HANT")!.code, "zh-Hant");
  assert.equal(findCaptionLanguage("tl")!.code, "fil");
  assert.equal(findCaptionLanguage("klingon"), undefined);
});

test("CAPTION_TARGET_LANGUAGES is derived from the shared list (codes + aliases)", () => {
  const expected: Record<string, string> = {};
  for (const l of CAPTION_LANGUAGES) {
    expected[l.code] = l.name;
    for (const a of l.aliases) expected[a] = l.name;
  }
  assert.deepEqual(CAPTION_TARGET_LANGUAGES, expected);
  // Old projects / the Director's two-letter codes keep working.
  for (const c of ["en", "hi", "zh", "ta", "es"]) assert.ok(CAPTION_TARGET_LANGUAGES[c], c);
});

test("Hinglish always translates to Roman letters", () => {
  const p = buildCaptionTranslationPrompt(["नमस्ते"], "hi-Latn", "native");
  assert.match(p, /Latin \(Roman\) letters/);
  assert.match(p, /Hinglish/);
  assert.match(buildCaptionTranslationPrompt(["hi"], "ta", "native"), /native script/);
});

test("the phone's caption_languages_data.dart is generated from this list (run the generator when this fails)", () => {
  const onDisk = readFileSync(DART_LANGUAGES_PATH, "utf8").replace(/\r\n/g, "\n");
  assert.equal(onDisk, renderCaptionLanguagesDart());
  for (const l of CAPTION_LANGUAGES) assert.ok(onDisk.includes(`code: '${l.code}'`), l.code);
});
