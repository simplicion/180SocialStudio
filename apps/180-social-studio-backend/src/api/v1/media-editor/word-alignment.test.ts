/**
 * Forced-alignment hook (ALIGN_WORKER_URL) in the transcription path, with a stubbed worker.
 * Run: npx tsx --test apps/180-social-studio-backend/src/api/v1/media-editor/word-alignment.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { transcribeWithSpeakers, alignWordTimes } from "./media-transcription";

const STT = { text: "hello world", language: "english", duration: 2, words: [{ word: "hello", start: 0.3, end: 0.7 }, { word: "world", start: 0.9, end: 1.4 }] };

function stub(align: (body: FormData) => Response | Promise<Response>) {
  const calls: Array<{ url: string; secret?: string; body?: FormData }> = [];
  const f = (async (url: any, init: any) => {
    const u = String(url);
    calls.push({ url: u, secret: init?.headers?.["X-Worker-Secret"], body: init?.body });
    if (u.endsWith("/align")) return align(init.body as FormData);
    return new Response(JSON.stringify(STT));
  }) as any;
  return { f, calls };
}

test("ALIGN_WORKER_URL set: provider words are sent with the audio and come back with refined times", async () => {
  const { f, calls } = stub(async (body) => {
    const words = JSON.parse(String(body.get("words")));
    assert.deepEqual(words, [{ text: "hello", startMs: 300, endMs: 700 }, { text: "world", startMs: 900, endMs: 1400 }]);
    assert.equal(body.get("language"), "en");
    assert.ok(body.get("audio") instanceof Blob, "the extracted audio is sent, nothing else");
    return new Response(JSON.stringify({ words: [{ text: "HELLO", startMs: 240.4, endMs: 650, aligned: true }, { text: "world", startMs: 880, endMs: 1310, aligned: true }] }));
  });
  const r = await transcribeWithSpeakers(Buffer.from("x"), "a.m4a", "audio/mp4", "auto", f, { groqKey: "g" }, { ALIGN_WORKER_URL: "http://align/", ALIGN_WORKER_SECRET: "s" });
  assert.equal(r.alignment, "aligned");
  assert.deepEqual(r.words, [{ text: "hello", startMs: 240, endMs: 650 }, { text: "world", startMs: 880, endMs: 1310 }], "provider text kept, times refined");
  const call = calls.find((c) => c.url === "http://align/align");
  assert.ok(call);
  assert.equal(call!.secret, "s");
});

test("without ALIGN_WORKER_URL nothing is called and the provider times are kept", async () => {
  const { f, calls } = stub(() => new Response("{}"));
  const r = await transcribeWithSpeakers(Buffer.from("x"), "a.m4a", "audio/mp4", "auto", f, { groqKey: "g" }, {});
  assert.equal(r.alignment, "off");
  assert.ok(!calls.some((c) => c.url.includes("/align")));
  assert.deepEqual(r.words.map((w) => [w.startMs, w.endMs]), [[300, 700], [900, 1400]]);
});

test("a down, unsupported or broken worker falls back silently to the provider times", async () => {
  const cases: Array<[() => Response | Promise<Response>, string]> = [
    [() => new Response("loading", { status: 503 }), "unavailable"],
    [() => new Response(JSON.stringify({ detail: "language not supported" }), { status: 422 }), "unsupported"],
    [() => Promise.reject(new Error("ECONNREFUSED")), "failed"],
    [() => new Response(JSON.stringify({ words: [{ startMs: 1, endMs: 2 }] })), "failed"], // wrong word count
    [() => new Response("not json"), "failed"],
  ];
  for (const [answer, expected] of cases) {
    const { f } = stub(answer);
    const r = await transcribeWithSpeakers(Buffer.from("x"), "a.m4a", "audio/mp4", "auto", f, { groqKey: "g" }, { ALIGN_WORKER_URL: "http://align" });
    assert.equal(r.alignment, expected);
    assert.deepEqual(r.words.map((w) => [w.text, w.startMs, w.endMs]), [["hello", 300, 700], ["world", 900, 1400]]);
  }
});

test("a malformed time keeps that word's provider time; the trend secret is the fallback", async () => {
  let secret = "";
  const f = (async (_u: any, init: any) => {
    secret = init.headers["X-Worker-Secret"];
    return new Response(JSON.stringify({ words: [{ startMs: 10, endMs: 5 }, { startMs: 905, endMs: 1390 }] }));
  }) as any;
  const out = await alignWordTimes(Buffer.from("x"), "a.m4a", "audio/mp4", [{ text: "a", startMs: 0, endMs: 100 }, { text: "b", startMs: 900, endMs: 1400 }], "en", f, { ALIGN_WORKER_URL: "http://align", TREND_WORKER_SECRET: "t" });
  assert.equal(secret, "t");
  assert.deepEqual(out, [{ text: "a", startMs: 0, endMs: 100 }, { text: "b", startMs: 905, endMs: 1390 }]);
});

test("speakers are assigned on the refined times when both workers run", async () => {
  const f = (async (url: any) => {
    const u = String(url);
    if (u.endsWith("/diarize")) return new Response(JSON.stringify({ segments: [{ speaker: "S1", startMs: 0, endMs: 800 }, { speaker: "S2", startMs: 800, endMs: 2000 }] }));
    if (u.endsWith("/align")) return new Response(JSON.stringify({ words: [{ startMs: 300, endMs: 600 }, { startMs: 820, endMs: 1300 }] }));
    return new Response(JSON.stringify(STT));
  }) as any;
  const r = await transcribeWithSpeakers(Buffer.from("x"), "a.m4a", "audio/mp4", "auto", f, { groqKey: "g" }, { ALIGN_WORKER_URL: "http://a", DIARIZE_WORKER_URL: "http://d" });
  assert.equal(r.alignment, "aligned");
  assert.equal(r.diarization, "labelled");
  assert.deepEqual(r.words.map((w) => w.speaker), ["S1", "S2"]);
});
