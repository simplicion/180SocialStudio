/** Run: npx tsx --test --test-force-exit apps/180-social-studio-backend/src/api/v1/media-editor/vision-critique.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { critiqueHandler, type CritiqueDeps } from "./vision-critique";

const JPEG = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const cps = JSON.stringify([
  { tMs: 100, kind: "hook", label: "the opening (hook)", refs: [] },
  { tMs: 5200, kind: "caption", label: "caption", refs: ["k1"] },
]);
function fakeRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (b: any) => ((res.body = b), res);
  return res;
}
const body = (extra: Record<string, unknown> = {}) => ({ consent: "granted", checkpoints: cps, width: "1080", height: "1920", aspect: "9:16", prompt: "make it punchy", ...extra });

function deps(over: Partial<CritiqueDeps> = {}) {
  const seen: any[] = [];
  const d: CritiqueDeps = {
    resolveClient: async () => ({ client: {}, label: "claude/m", model: "m" }),
    critique: async (p) => {
      seen.push(p);
      return { score: 7, issues: [], summary: "ok", model: "claude/m", frameCount: p.frames.length } as any;
    },
    ...over,
  };
  return { d, seen };
}
const run = async (d: CritiqueDeps, b: any, files: any[] = [{ buffer: JPEG() }, { buffer: JPEG() }], user: any = { companyId: "c1" }) => {
  const res = fakeRes();
  await critiqueHandler(() => d)({ user, body: b, files } as any, res);
  return res;
};

test("scores the stills with their checkpoints and releases them", async () => {
  const { d, seen } = deps();
  const files = [{ buffer: JPEG() }, { buffer: JPEG() }];
  const res = await run(d, body(), files);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.score, 7);
  assert.deepEqual(seen[0].frames.map((f: any) => [f.tMs, f.kind, f.refs]), [[100, "hook", []], [5200, "caption", ["k1"]]]);
  assert.deepEqual(seen[0].canvas, { width: 1080, height: 1920, aspect: "9:16" });
  assert.equal(seen[0].request, "make it punchy");
  assert.ok(files.every((f) => f.buffer.length === 0));
});

test("checks: consent, one checkpoint per still, JPEG only, auth", async () => {
  const { d } = deps();
  assert.equal((await run(d, body({ consent: undefined }))).body.error, "CONSENT_REQUIRED");
  assert.equal((await run(d, body(), [{ buffer: JPEG() }])).statusCode, 400);
  assert.equal((await run(d, body({ checkpoints: "[{\"tMs\":-1}]" }), [{ buffer: JPEG() }])).statusCode, 400);
  assert.equal((await run(d, body(), [{ buffer: Buffer.from("png?") }, { buffer: JPEG() }])).statusCode, 415);
  assert.equal((await run(d, body(), [], {})).statusCode, 401);
});

test("no provider → 503; a failed critique → 502 and no verdict", async () => {
  assert.equal((await run(deps({ resolveClient: async () => null }).d, body())).body.error, "VISION_UNAVAILABLE");
  const err = console.error;
  console.error = () => {};
  try {
    const res = await run(deps({ critique: async () => { throw new Error("no critique"); } }).d, body());
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.error, "CRITIQUE_FAILED");
  } finally {
    console.error = err;
  }
});
