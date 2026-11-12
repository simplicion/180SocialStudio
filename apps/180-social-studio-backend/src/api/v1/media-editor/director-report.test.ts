/** Run: npx tsx --test --test-force-exit apps/180-social-studio-backend/src/api/v1/media-editor/director-report.test.ts */
import test from "node:test";
import assert from "node:assert/strict";
import { directorReportHandler, turnRecordsFromPayloads } from "./director-report";

function fakeRes() {
  const res: any = { statusCode: 0, body: null };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
}

test("only final events count; old payloads without turnLog still count by plannerSource", () => {
  const r = turnRecordsFromPayloads([
    { final: true, turnLog: { intent: "edit", plannerSource: "llm" } },
    { final: true, plannerSource: "deterministic" },
    { final: false, plannerSource: "llm" },
    { final: true },
  ]);
  assert.deepEqual(r.map((x: any) => x.plannerSource), ["llm", "deterministic"]);
});

test("report is scoped to the verified company and clamps days", async () => {
  const calls: Array<{ companyId: string; since: Date }> = [];
  const handler = directorReportHandler({
    async listTurnPayloads(companyId, since) {
      calls.push({ companyId, since });
      return [
        { final: true, turnLog: { intent: "edit", plannerSource: "deterministic", fallback: { code: "no_key", reason: "no AI API key" } } },
        { final: true, turnLog: { intent: "edit", plannerSource: "llm", provider: "claude", model: "m" } },
      ];
    },
  });
  const res = fakeRes();
  await handler({ user: { companyId: "c1" }, query: { days: "500", companyId: "other" } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].companyId, "c1", "never a query value");
  assert.equal(res.body.report.days, 90);
  assert.equal(res.body.report.fallbackPct, 50);
  assert.deepEqual(res.body.report.fallbackByCode, { no_key: 1 });
});

test("unauthenticated callers get 401", async () => {
  const res = fakeRes();
  await directorReportHandler({ listTurnPayloads: async () => [] })({ query: {} } as any, res);
  assert.equal(res.statusCode, 401);
});
