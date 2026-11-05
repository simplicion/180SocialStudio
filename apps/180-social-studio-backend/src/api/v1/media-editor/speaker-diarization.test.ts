/**
 * Run: npx tsx --test apps/180-social-studio-backend/src/api/v1/media-editor/speaker-diarization.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { labelWordsWithSpeakers, transcribeWithSpeakers, diarizeAudio, type WordTimestamp } from "./media-transcription";

const w = (text: string, startMs: number, endMs: number): WordTimestamp => ({ text, startMs, endMs });

test("each word takes the speaker it overlaps most", () => {
  const out = labelWordsWithSpeakers(
    [w("hi", 0, 300), w("there", 900, 1300), w("hey", 1400, 1700), w("ok", 9000, 9200)],
    [{ speaker: "S1", startMs: 0, endMs: 1200 }, { speaker: "S2", startMs: 1200, endMs: 3000 }]
  );
  assert.deepEqual(out.map((x) => x.speaker), ["S1", "S1", "S2", undefined], "the last word is far from every turn: unlabelled");
});

test("a word in a short gap takes the nearest turn", () => {
  const out = labelWordsWithSpeakers([w("um", 1100, 1200)], [{ speaker: "S1", startMs: 0, endMs: 1000 }, { speaker: "S2", startMs: 1500, endMs: 2000 }]);
  assert.equal(out[0].speaker, "S1");
});

const sttOk = async (url: string | URL | Request) => {
  if (String(url).includes("/diarize")) {
    return new Response(JSON.stringify({ speakers: 2, segments: [{ speaker: "S1", startMs: 0, endMs: 1000 }, { speaker: "S2", startMs: 1000, endMs: 2000 }] }));
  }
  return new Response(JSON.stringify({ text: "a b", language: "english", duration: 2, words: [{ word: "a", start: 0.1, end: 0.4 }, { word: "b", start: 1.2, end: 1.5 }] }));
};

test("transcript and speakers together", async () => {
  const r = await transcribeWithSpeakers(Buffer.from("x"), "a.m4a", "audio/mp4", "auto", sttOk as any, { groqKey: "g" }, { DIARIZE_WORKER_URL: "http://d", DIARIZE_WORKER_SECRET: "s" });
  assert.equal(r.diarization, "labelled");
  assert.equal(r.speakers, 2);
  assert.deepEqual(r.words.map((x) => x.speaker), ["S1", "S2"]);
});

test("without DIARIZE_WORKER_URL nothing is called and words have no speaker", async () => {
  let diarizeCalls = 0;
  const f = (async (url: any, init: any) => {
    if (String(url).includes("/diarize")) diarizeCalls++;
    return sttOk(url);
  }) as any;
  const r = await transcribeWithSpeakers(Buffer.from("x"), "a.m4a", "audio/mp4", "auto", f, { groqKey: "g" }, {});
  assert.equal(diarizeCalls, 0);
  assert.equal(r.diarization, "off");
  assert.ok(r.words.every((x) => x.speaker === undefined));
});

test("a down worker never fails the transcript", async () => {
  const f = (async (url: any) => (String(url).includes("/diarize") ? new Response("loading", { status: 503 }) : sttOk(url))) as any;
  const r = await transcribeWithSpeakers(Buffer.from("x"), "a.m4a", "audio/mp4", "auto", f, { groqKey: "g" }, { DIARIZE_WORKER_URL: "http://d" });
  assert.equal(r.diarization, "unavailable");
  assert.equal(r.words.length, 2);
  const thrown = (async (url: any) => (String(url).includes("/diarize") ? Promise.reject(new Error("ECONNREFUSED")) : sttOk(url))) as any;
  const r2 = await transcribeWithSpeakers(Buffer.from("x"), "a.m4a", "audio/mp4", "auto", thrown, { groqKey: "g" }, { DIARIZE_WORKER_URL: "http://d" });
  assert.equal(r2.diarization, "failed");
});

test("the worker secret is sent and bad segments are dropped", async () => {
  let header = "";
  const f = (async (_url: any, init: any) => {
    header = init.headers["X-Worker-Secret"];
    return new Response(JSON.stringify({ segments: [{ speaker: "S1", startMs: 0, endMs: 100 }, { speaker: "S2", startMs: 50, endMs: 10 }, { bad: 1 }] }));
  }) as any;
  const turns = await diarizeAudio(Buffer.from("x"), "a.m4a", "audio/mp4", f, { DIARIZE_WORKER_URL: "http://d/", TREND_WORKER_SECRET: "t" });
  assert.equal(header, "t");
  assert.deepEqual(turns, [{ speaker: "S1", startMs: 0, endMs: 100 }]);
});
