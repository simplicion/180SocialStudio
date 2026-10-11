/** Run: npx tsx --test --test-force-exit apps/backend/src/api/v1/media-editor/caption-translation.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import {
  translateCaptionLines,
  parseCaptionTranslation,
  parseTranslateCaptionsBody,
  buildCaptionTranslationPrompt,
  CaptionTranslationFailedError,
  MAX_TRANSLATE_CAPTIONS,
} from "./caption-translation";

test("translates line for line and tolerates prose or a code fence around the JSON", async () => {
  const prompts: string[] = [];
  const out = await translateCaptionLines(["hello friends", "let's start"], "hi", "native", async (p) => {
    prompts.push(p);
    return 'Here you go:\n```json\n["नमस्ते दोस्तों", "चलो शुरू करते हैं"]\n```';
  });
  assert.deepEqual(out, ["नमस्ते दोस्तों", "चलो शुरू करते हैं"]);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /into Hindi/);
  assert.match(prompts[0], /native script/);
  assert.ok(prompts[0].endsWith(JSON.stringify(["hello friends", "let's start"])));
});

test("roman script asks for Latin letters (Hinglish)", () => {
  const p = buildCaptionTranslationPrompt(["आज हम बात करेंगे"], "hi", "roman");
  assert.match(p, /Latin \(Roman\) letters/);
});

test("a wrong line count is retried once, then fails instead of misplacing text", async () => {
  let calls = 0;
  const out = await translateCaptionLines(["a", "b"], "es", "native", async () => (++calls === 1 ? '["uno"]' : '["uno", "dos"]'));
  assert.deepEqual(out, ["uno", "dos"]);
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(
    translateCaptionLines(["a", "b"], "es", "native", async () => { calls++; return '["uno"]'; }),
    CaptionTranslationFailedError
  );
  assert.equal(calls, 2);
});

test("provider errors and empty lines fail; nothing is invented", async () => {
  await assert.rejects(translateCaptionLines(["a"], "fr", "native", async () => { throw new Error("upstream down"); }), CaptionTranslationFailedError);
  assert.throws(() => parseCaptionTranslation('["ok", "  "]', 2), CaptionTranslationFailedError);
  assert.throws(() => parseCaptionTranslation("sorry, I cannot", 1), CaptionTranslationFailedError);
});

test("long caption lists are sent in batches and joined in order", async () => {
  const lines = Array.from({ length: 130 }, (_, i) => `line ${i}`);
  let calls = 0;
  const out = await translateCaptionLines(lines, "fr", "native", async (p) => {
    calls++;
    const input: string[] = JSON.parse(p.slice(p.lastIndexOf("\n") + 1));
    return JSON.stringify(input.map((l) => `fr ${l}`));
  });
  assert.equal(calls, 3);
  assert.equal(out.length, 130);
  assert.equal(out[129], "fr line 129");
});

test("request validation: language, script, ids, sizes", () => {
  const ok = parseTranslateCaptionsBody({ captions: [{ id: "c1", text: "  hello   there " }], targetLanguage: "HI", script: "roman" });
  assert.deepEqual(ok, { captions: [{ id: "c1", text: "hello there" }], targetLanguage: "hi", script: "roman" });
  assert.ok("error" in parseTranslateCaptionsBody({ captions: [{ id: "c1", text: "x" }], targetLanguage: "klingon" }));
  assert.ok("error" in parseTranslateCaptionsBody({ captions: [], targetLanguage: "hi" }));
  assert.ok("error" in parseTranslateCaptionsBody({ captions: [{ id: "", text: "x" }], targetLanguage: "hi" }));
  assert.ok("error" in parseTranslateCaptionsBody({ captions: [{ id: "c", text: "x".repeat(301) }], targetLanguage: "hi" }));
  const many = Array.from({ length: MAX_TRANSLATE_CAPTIONS + 1 }, (_, i) => ({ id: `c${i}`, text: "x" }));
  assert.ok("error" in parseTranslateCaptionsBody({ captions: many, targetLanguage: "hi" }));
});
