import test from "node:test";
import assert from "node:assert/strict";
import {
  joinWordsForScript,
  isRtlText,
  applyCaptionCase,
  scriptOf,
  NO_SPACE_SCRIPTS,
} from "../src/caption-style-v2";
import { captionFontFor } from "../src/caption-enhance";
import { PlanExpander } from "../src/plan-expander";
import { AutoCaptionsOpSchema } from "../src/creative-plan.schema";

test("joinWordsForScript: Chinese, Japanese and Thai tokens are joined without spaces", () => {
  // Chinese
  assert.equal(
    joinWordsForScript(["这", "是", "我的", "故事。"]),
    "这是我的故事。"
  );

  // Japanese
  assert.equal(
    joinWordsForScript(["これは", "私の", "物語", "です。"]),
    "これは私の物語です。"
  );

  // Thai
  assert.equal(
    joinWordsForScript(["นี่", "คือ", "เรื่อง", "ของฉัน"]),
    "นี่คือเรื่องของฉัน"
  );

  // Mixed CJK + ASCII maintains spaces between adjacent ASCII tokens
  assert.equal(
    joinWordsForScript(["我", "喜欢", "iPhone", "16", "Pro"]),
    "我喜欢iPhone 16 Pro"
  );
});

test("joinWordsForScript: spaced scripts (Latin, Indic, Arabic) preserve word spaces", () => {
  assert.equal(joinWordsForScript(["Hello", "world", "today"]), "Hello world today");
  assert.equal(joinWordsForScript(["आज", "हम", "बात", "करेंगे"]), "आज हम बात करेंगे");
  assert.equal(joinWordsForScript(["مرحبا", "بكم", "جميعا"]), "مرحبا بكم جميعا");
});

test("PlanExpander.captionOps produces space-free text for CJK and Thai, and assigns proper script fonts", () => {
  const zhWords = [
    { word: "这", startSeconds: 1.0, endSeconds: 1.3 },
    { word: "是", startSeconds: 1.3, endSeconds: 1.6 },
    { word: "我的", startSeconds: 1.6, endSeconds: 2.0 },
    { word: "故事。", startSeconds: 2.0, endSeconds: 2.4 },
  ];
  const zhOps = PlanExpander.captionOps(
    zhWords as any,
    AutoCaptionsOpSchema.parse({ type: "autoCaptions", wordsPerCaption: 4 })
  );
  assert.equal((zhOps[0] as any).text, "这是我的故事。");

  const jaWords = [
    { word: "これは", startSeconds: 1.0, endSeconds: 1.4 },
    { word: "私の", startSeconds: 1.4, endSeconds: 1.8 },
    { word: "物語", startSeconds: 1.8, endSeconds: 2.2 },
    { word: "です。", startSeconds: 2.2, endSeconds: 2.6 },
  ];
  const jaOps = PlanExpander.captionOps(
    jaWords as any,
    AutoCaptionsOpSchema.parse({ type: "autoCaptions", wordsPerCaption: 4 })
  );
  assert.equal((jaOps[0] as any).text, "これは私の物語です。");

  const thWords = [
    { word: "นี่", startSeconds: 1.0, endSeconds: 1.3 },
    { word: "คือ", startSeconds: 1.3, endSeconds: 1.6 },
    { word: "เรื่อง", startSeconds: 1.6, endSeconds: 1.9 },
    { word: "ของฉัน", startSeconds: 1.9, endSeconds: 2.3 },
  ];
  const thOps = PlanExpander.captionOps(
    thWords as any,
    AutoCaptionsOpSchema.parse({ type: "autoCaptions", wordsPerCaption: 4 })
  );
  assert.equal((thOps[0] as any).text, "นี่คือเรื่องของฉัน");
});

test("captionFontFor resolves proper display fonts for all scripts without tofu fallback", () => {
  assert.equal(captionFontFor("Hello world", "Anton"), "Anton");
  assert.equal(captionFontFor("आज हम बात करेंगे", "Anton"), "Noto Sans Devanagari");
  assert.equal(captionFontFor("आज हम बात करेंगे", "Poppins"), "Poppins");
  assert.equal(captionFontFor("مرحبا بكم", "Montserrat"), "Noto Sans Arabic");
  assert.equal(captionFontFor("مرحبا بكم", "Cairo"), "Cairo");
  assert.equal(captionFontFor("นี่คือเรื่องของฉัน", "Anton"), "Noto Sans Thai");
  assert.equal(captionFontFor("นี่คือเรื่องของฉัน", "Kanit"), "Kanit");
  assert.equal(captionFontFor("这是我的故事", "Montserrat"), "Noto Sans SC");
  assert.equal(captionFontFor("これは私の物語", "Montserrat"), "Noto Sans JP");
  assert.equal(captionFontFor("한국어 자막", "Anton"), "Noto Sans KR");
});

test("isRtlText detects strong RTL characters accurately", () => {
  assert.equal(isRtlText("مرحبا بكم"), true);
  assert.equal(isRtlText("اردو زبان میں ویڈیو"), true);
  assert.equal(isRtlText("English with مرحبا embedded"), true);
  assert.equal(isRtlText("Hello world!"), false);
  assert.equal(isRtlText("12345 $500"), false);
  assert.equal(isRtlText("हिंदी पाठ"), false);
});

test("applyCaptionCase handles locale-aware rules and scripts without case", () => {
  // Turkish dotted i
  assert.equal(applyCaptionCase("istanbul", "upper", "tr"), "İSTANBUL");
  assert.equal(applyCaptionCase("ısparta", "upper", "tr"), "ISPARTA");

  // Scripts without case are untouched
  assert.equal(applyCaptionCase("नमस्ते", "upper"), "नमस्ते");
  assert.equal(applyCaptionCase("مرحبا", "upper"), "مرحبا");
  assert.equal(applyCaptionCase("这是中文", "upper"), "这是中文");
  assert.equal(applyCaptionCase("นี่คือภาษาไทย", "upper"), "นี่คือภาษาไทย");

  // Numbers, currency, and symbols are preserved
  assert.equal(applyCaptionCase("win $500 in 2026!", "upper"), "WIN $500 IN 2026!");
});

