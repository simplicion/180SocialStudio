/** Run: npx tsx --test --test-force-exit apps/180-social-studio-backend/src/api/v1/media-editor/vision-shot-log.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { cachedShotLogHandler, shotLogHandler, type VisionDeps } from "./vision-shot-log";

const JPEG = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const LOG: any = { version: "shotlog/1", assetId: "primary", sourceHash: "hash-abcdef", durationMs: 8000, model: "claude/m", frameCount: 2, shots: [] };

function fakeRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: any) => ((res.body = b), res);
  return res;
}

function deps(over: Partial<VisionDeps> = {}) {
  const store = new Map<string, any>();
  const seen: any[] = [];
  const d: VisionDeps = {
    resolveClient: async () => ({ client: { provider: "claude" }, label: "claude/m", model: "m" }),
    buildShotLog: async (req) => {
      seen.push(req);
      return { ...LOG, frameCount: req.frames.length };
    },
    cache: { key: (c, h) => `${c}|${h}`, get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v) },
    ...over,
  };
  return { d, seen, store };
}

const body = (extra: Record<string, unknown> = {}) => ({ consent: "granted", assetId: "primary", sourceHash: "hash-abcdef", durationMs: "8000", width: "1080", height: "1920", timesMs: "[500,2500]", scenesMs: "[4000]", ...extra });
const call = async (d: VisionDeps, b: any, files: any[] = [{ buffer: JPEG() }, { buffer: JPEG() }], user: any = { companyId: "c1" }) => {
  const res = fakeRes();
  await shotLogHandler(() => d)({ user, body: b, files } as any, res);
  return res;
};

test("describes the stills, caches the text log per company, and drops the frames", async () => {
  const { d, seen, store } = deps();
  const files = [{ buffer: JPEG() }, { buffer: JPEG() }];
  const res = await call(d, body(), files);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cached, false);
  assert.equal(seen[0].frames.length, 2);
  assert.deepEqual(seen[0].frames.map((f: any) => f.tMs), [500, 2500]);
  assert.deepEqual(seen[0].scenesMs, [4000]);
  assert.ok(store.has("c1|hash-abcdef"));
  assert.ok(files.every((f) => f.buffer.length === 0), "the stills are released after the pass");
  const again = await call(d, body());
  assert.equal(again.body.cached, true);
  assert.equal(seen.length, 1, "a clip is looked at once");
});

test("consent, field and frame checks", async () => {
  const { d } = deps();
  assert.equal((await call(d, body({ consent: undefined }))).body.error, "CONSENT_REQUIRED");
  assert.equal((await call(d, body({ timesMs: "[500]" }))).statusCode, 400, "one time per frame");
  assert.equal((await call(d, body({ sourceHash: "x" }))).statusCode, 400);
  assert.equal((await call(d, body({ timesMs: "[500,9000]" }))).statusCode, 400, "no frame past the end");
  assert.equal((await call(d, body(), [{ buffer: Buffer.from("not a jpeg") }, { buffer: JPEG() }])).statusCode, 415);
  assert.equal((await call(d, body(), [])).body.error, "FRAMES_REQUIRED");
  assert.equal((await call(d, body(), undefined as any, {})).statusCode, 401);
});

test("no AI provider → 503; a failed vision call → 502, never a made-up log", async () => {
  assert.equal((await call(deps({ resolveClient: async () => null }).d, body())).body.error, "VISION_UNAVAILABLE");
  const failing = deps({ buildShotLog: async () => { throw Object.assign(new Error("described 0 of 2 frames"), { code: "VISION_FAILED" }); } });
  const err = console.error;
  console.error = () => {};
  try {
    const res = await call(failing.d, body());
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, "VISION_FAILED");
    assert.equal(failing.store.size, 0);
  } finally {
    console.error = err;
  }
});

test("cache lookup: 404 until looked at, then the log (company-scoped)", async () => {
  const { d, store } = deps();
  const get = (q: any, user: any = { companyId: "c1" }) => {
    const res = fakeRes();
    cachedShotLogHandler(() => d)({ user, query: q } as any, res);
    return res;
  };
  assert.equal(get({ assetId: "primary", sourceHash: "hash-abcdef" }).statusCode, 404);
  store.set("c1|hash-abcdef", LOG);
  assert.equal(get({ assetId: "clip2", sourceHash: "hash-abcdef" }).body.data.assetId, "clip2", "the same file as another asset reuses the log");
  assert.equal(get({ assetId: "primary", sourceHash: "hash-abcdef" }, { companyId: "c2" }).statusCode, 404);
  assert.equal(get({ assetId: "bad id!", sourceHash: "hash-abcdef" }).statusCode, 400);
});
