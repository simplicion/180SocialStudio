/**
 * LLM-as-judge for the AI Director eval (quality-fix plan, Phase 7).
 *
 * Scores a finished edit 0-10 against the fixture's reference (what a skilled editor must / must not do) and the
 * visual critic's rubric. The fixtures carry no real footage, so the judge reads the final timeline (what is on it,
 * where, with which words) instead of rendered stills; once a fixture has `frames/` the same call can include them.
 *
 * The judge model is deliberately different from the Director's by default (DIRECTOR_JUDGE_MODEL, else
 * `defaultJudgeModel(provider)`: gpt-6.1-sol while the Director runs gpt-6-astra, claude-sonnet-5-5 against
 * claude-opus-5-5), so the edit is not graded by the model that made it.
 */
import type { AIClient } from "../../packages/domains/ai/src/kernel/ai-provider.service";
import { CreativePlanner } from "../../packages/domains/ai/src/builders/creative-planner";
import { VISUAL_RUBRIC } from "../../packages/domains/ai/src/builders/visual-critic";

export interface Judgement {
  score: number;
  mustDo: Array<{ item: string; met: boolean }>;
  mustNotDo: Array<{ item: string; violated: boolean }>;
  notes: string;
  model: string;
}

const TOOL = "record_judgement";

/** A judge model of the same provider that is not the Director's default model. */
export function defaultJudgeModel(provider: string): string {
  if (provider === "openai") return "gpt-6.1-sol";
  if (provider === "gemini") return "gemini-3.6-flash";
  return "claude-sonnet-5-5";
}

export async function judgeEdit(client: AIClient, model: string, fixture: any, res: any): Promise<Judgement> {
  if (typeof client.generateWithTools !== "function") throw new Error("the judge needs tool calling");
  const ref = fixture.reference;
  const timeline = CreativePlanner.describeEditIR(res.ast, res.editIR?.itemMeta ?? {}).join("\n").slice(0, 14000);
  const prompt = [
    `You judge a short-form video edit made by an AI editor. You cannot see the video: you read its final timeline.`,
    `## The video before editing`,
    fixture.description,
    `## What the creator asked`,
    JSON.stringify(fixture.request.prompt),
    `## A skilled editor MUST`,
    ...ref.mustDo.map((x: string, i: number) => `${i + 1}. ${x}`),
    `## A skilled editor must NOT`,
    ...ref.mustNotDo.map((x: string, i: number) => `${i + 1}. ${x}`),
    `## Quality rubric (judge what the timeline shows of these)`,
    VISUAL_RUBRIC,
    `## The final timeline (times in seconds; captions carry their words)`,
    timeline,
    `## The editor's reply to the creator`,
    JSON.stringify(res.reply ?? ""),
    ``,
    `Call ${TOOL} once: for each MUST item whether it is met, for each must-NOT item whether it is violated, a score 0-10 (10 = what a skilled human editor would deliver; deduct for every unmet MUST and every violated must-NOT), and one or two sentences of notes. Judge only what the timeline shows; when the timeline cannot show an item, say so in notes and do not count it.`,
  ].join("\n");
  const tool = {
    type: "function",
    function: {
      name: TOOL,
      description: "Record the judgement of the edit.",
      parameters: {
        type: "object",
        properties: {
          score: { type: "number" },
          mustDo: { type: "array", items: { type: "object", properties: { item: { type: "integer" }, met: { type: "boolean" } }, required: ["item", "met"] } },
          mustNotDo: { type: "array", items: { type: "object", properties: { item: { type: "integer" }, violated: { type: "boolean" } }, required: ["item", "violated"] } },
          notes: { type: "string" },
        },
        required: ["score", "mustDo", "mustNotDo", "notes"],
      },
    },
  };
  const r = await client.generateWithTools(prompt, [tool], { model, max_tokens: 4000, effort: "medium", temperature: 0 });
  const c = (r.toolCalls || []).find((x) => x.name === TOOL);
  if (!c || typeof c.args?.score !== "number") throw new Error("the judge returned no score");
  const pick = (list: any[], key: string, items: string[]) =>
    (Array.isArray(list) ? list : [])
      .filter((x) => Number.isInteger(x?.item) && x.item >= 1 && x.item <= items.length)
      .map((x) => ({ item: items[x.item - 1], [key]: !!x[key] }));
  return {
    score: Math.round(Math.min(10, Math.max(0, c.args.score)) * 10) / 10,
    mustDo: pick(c.args.mustDo, "met", ref.mustDo) as any,
    mustNotDo: pick(c.args.mustNotDo, "violated", ref.mustNotDo) as any,
    notes: String(c.args.notes ?? "").slice(0, 500),
    model,
  };
}

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
};
