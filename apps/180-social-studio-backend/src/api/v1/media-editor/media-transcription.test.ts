/**
 * Run: npx tsx --test apps/backend/src/api/v1/media-editor/media-transcription.test.ts
 * Live check (uses Groq or OpenAI credits): LIVE_TEST_WAV=path/to/speech.wav plus GROQ_API_KEY or OPENAI_API_KEY.
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import {
  transcribeAudioBuffer,
  TranscriptionUnavailableError,
  TranscriptionFailedError,
  ALLOWED_AUDIO_MIME_TYPES,
  normalizeRequestLanguage,
  resolveDetectedLanguage,
  sttProviderOrder,
} from "./media-transcription";

const withKeys = async (keys: { groq?: string; openai?: string }, fn: () => Promise<void>) => {
  const prevGroq = process.env.GROQ_API_KEY;
  const prevOpenAI = process.env.OPENAI_API_KEY;
  const prevOrder = process.env.STT_PROVIDER_ORDER;
  delete process.env.STT_PROVIDER_ORDER;

  delete process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;

  if (keys.groq !== undefined) process.env.GROQ_API_KEY = keys.groq;
  if (keys.openai !== undefined) process.env.OPENAI_API_KEY = keys.openai;

  try {
    await fn();
  } finally {
    if (prevGroq !== undefined) process.env.GROQ_API_KEY = prevGroq;
    else delete process.env.GROQ_API_KEY;

    if (prevOpenAI !== undefined) process.env.OPENAI_API_KEY = prevOpenAI;
    else delete process.env.OPENAI_API_KEY;
    if (prevOrder !== undefined) process.env.STT_PROVIDER_ORDER = prevOrder;
  }
};

test("throws TranscriptionUnavailableError when no STT keys are configured (no literal fallback)", async () => {
  await withKeys({}, async () => {
    let called = false;
    const fakeFetch: any = async () => { called = true; };
    await assert.rejects(transcribeAudioBuffer(Buffer.from("x"), "a.m4a", "audio/m4a", "en", fakeFetch), TranscriptionUnavailableError);
    assert.equal(called, false, "no network call without a key");
  });
});

test("maps Groq Whisper word timestamps (seconds) to ms and sends verbose_json", async () => {
  await withKeys({ groq: "gsk_test_key" }, async () => {
    let captured: any;
    const fakeFetch: any = async (url: string, init: any) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        text: "growth happens every single day",
        language: "english",
        duration: 2.5,
        words: [
          { word: "growth", start: 0.1, end: 0.5 },
          { word: "happens", start: 0.51, end: 0.9 },
          { word: "every", start: 0.91, end: 1.2 },
          { word: "single", start: 1.21, end: 1.6 },
          { word: "day", start: 1.61, end: 2.1 },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const out = await transcribeAudioBuffer(Buffer.from("fake-audio"), "speech.wav", "audio/wav", "en", fakeFetch);
    assert.equal(captured.url, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(captured.init.headers.Authorization, "Bearer gsk_test_key");
    const form: FormData = captured.init.body;
    assert.equal(form.get("model"), "whisper-large-v3-turbo");
    assert.equal(form.get("response_format"), "verbose_json");
    assert.equal(form.get("timestamp_granularities[]"), "word");
    assert.equal(out.words.length, 5);
    assert.deepEqual(out.words[0], { text: "growth", startMs: 100, endMs: 500 });
    assert.equal(out.provider, "groq");
    assert.equal(out.durationMs, 2500);
    assert.equal(form.get("language"), "en");
    assert.equal(out.language, "en", "Whisper's language name is returned as an ISO code");
  });
});

test("auto-detect: sends no language, uses the full Whisper model and returns the detected ISO code", async () => {
  await withKeys({ groq: "gsk_test_key" }, async () => {
    let form: FormData | undefined;
    const fakeFetch: any = async (_url: string, init: any) => {
      form = init.body;
      return new Response(JSON.stringify({
        text: "आज हम बात करेंगे",
        language: "Hindi",
        duration: 1.6,
        words: [
          { word: "आज", start: 0.1, end: 0.4 },
          { word: "हम", start: 0.45, end: 0.7 },
          { word: "बात", start: 0.75, end: 1.1 },
          { word: "करेंगे", start: 1.15, end: 1.6 },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const out = await transcribeAudioBuffer(Buffer.from("fake-audio"), "speech.m4a", "audio/m4a", undefined, fakeFetch);
    assert.equal(form!.get("language"), null, "no language is forced on the provider");
    assert.equal(form!.get("model"), "whisper-large-v3");
    assert.equal(out.language, "hi");
    assert.equal(out.words[3].text, "करेंगे");
  });
});

test("a failing first provider falls through to the next; STT_PROVIDER_ORDER reorders and skips keyless providers", async () => {
  await withKeys({}, async () => {
    const urls: string[] = [];
    const fakeFetch: any = async (url: string) => {
      urls.push(url);
      if (url.includes("groq")) return new Response("quota", { status: 429 });
      return new Response(JSON.stringify({ text: "hello there", language: "english", duration: 1, words: [{ word: "hello", start: 0, end: 0.4 }, { word: "there", start: 0.5, end: 0.9 }] }), { status: 200 });
    };
    const out = await transcribeAudioBuffer(Buffer.from("x"), "a.wav", "audio/wav", "en", fakeFetch, { groqKey: "gsk", openaiKey: "sk" });
    assert.equal(urls.length, 2);
    assert.equal(out.provider, "openai");
  });
  assert.deepEqual(sttProviderOrder({ groqKey: "b", openaiKey: "c" }, undefined), ["groq", "openai"]);
  assert.deepEqual(sttProviderOrder({ groqKey: "b" }, "openai, groq ,bogus"), ["groq"]);
  assert.deepEqual(sttProviderOrder({ openaiKey: "c" }, ""), ["openai"]);
});

test("request language: two-letter codes pass, region is dropped, anything else means auto-detect", () => {
  assert.equal(normalizeRequestLanguage("hi"), "hi");
  assert.equal(normalizeRequestLanguage("HI-in"), "hi");
  assert.equal(normalizeRequestLanguage(undefined), "auto");
  assert.equal(normalizeRequestLanguage("auto"), "auto");
  assert.equal(normalizeRequestLanguage("hindi; drop table"), "auto");
});

test("detected language: known names map to ISO, unknown falls back to the request or 'und'", () => {
  assert.equal(resolveDetectedLanguage("tamil", "auto"), "ta");
  assert.equal(resolveDetectedLanguage("ta", "auto"), "ta");
  assert.equal(resolveDetectedLanguage(undefined, "bn"), "bn");
  assert.equal(resolveDetectedLanguage("", "auto"), "und");
});

test("maps OpenAI Whisper word timestamps (seconds) to ms and sends verbose_json with whisper-1", async () => {
  await withKeys({ openai: "sk-test-openai-key" }, async () => {
    let captured: any;
    const fakeFetch: any = async (url: string, init: any) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        text: "transform your content with ai",
        language: "english",
        duration: 3.2,
        words: [
          { word: "transform", start: 0.15, end: 0.7 },
          { word: "your", start: 0.75, end: 0.95 },
          { word: "content", start: 1.0, end: 1.5 },
          { word: "with", start: 1.55, end: 1.8 },
          { word: "ai", start: 1.85, end: 2.3 },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const out = await transcribeAudioBuffer(Buffer.from("fake-audio"), "audio.wav", "audio/wav", "en", fakeFetch);
    assert.equal(captured.url, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(captured.init.headers.Authorization, "Bearer sk-test-openai-key");
    const form: FormData = captured.init.body;
    assert.equal(form.get("model"), "whisper-1");
    assert.equal(form.get("response_format"), "verbose_json");
    assert.equal(form.get("timestamp_granularities[]"), "word");
    assert.equal(out.words.length, 5);
    assert.deepEqual(out.words[0], { text: "transform", startMs: 150, endMs: 700 });
    assert.equal(out.durationMs, 3200);
  });
});

test("provider errors result in TranscriptionFailedError", async () => {
  await withKeys({ groq: "gsk_test_key" }, async () => {
    const err500: any = async () => new Response("upstream down", { status: 500 });
    await assert.rejects(transcribeAudioBuffer(Buffer.from("x"), "a.wav", "audio/wav", "en", err500), TranscriptionFailedError);
  });
});

test("accepted mime types cover what Android/iOS recorders produce", () => {
  for (const m of ["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav"]) assert.ok(ALLOWED_AUDIO_MIME_TYPES.has(m), m);
  assert.ok(!ALLOWED_AUDIO_MIME_TYPES.has("video/mp4"), "video uploads are refused (audio only)");
});

const liveWav = process.env.LIVE_TEST_WAV;
test("LIVE Groq/OpenAI STT returns word timestamps", { skip: !liveWav || (!process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY) ? "set LIVE_TEST_WAV and GROQ_API_KEY or OPENAI_API_KEY" : false }, async () => {
  const out = await transcribeAudioBuffer(fs.readFileSync(liveWav!), "live.wav", "audio/wav", "en");
  console.log(JSON.stringify({ durationMs: out.durationMs, text: out.text, words: out.words.slice(0, 8), wordCount: out.words.length }));
  assert.ok(out.words.length > 3);
  assert.ok(out.words.every((w, i) => w.endMs >= w.startMs && (i === 0 || w.startMs >= out.words[i - 1].startMs)));
});
