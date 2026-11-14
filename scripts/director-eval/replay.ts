/**
 * Recorded / scripted model answers for the AI Director eval (quality-fix plan, Phase 7).
 *
 * - `recordingClient(real, sink)` wraps a real client and records every answer (method, offered tools, tool calls).
 * - `replayClient(fixture)` answers from `recordings/<fixture>.json` in order, and fails loudly when the Director asks
 *   something the recording does not have (the code changed the conversation: re-record with --record). Without a
 *   recording it uses `scriptedPolicy`: a deterministic editor that follows the Director's protocol from the
 *   fixture's reference notes, so pull requests test the whole pipeline (story cuts, guards, compiler, critic,
 *   playbooks) without an API key. Reports say which source answered.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { AgentMessage, AIClient, ToolCall } from "../../packages/domains/ai/src/kernel/ai-provider.service";

export interface RecordedCall {
  method: "generateWithTools" | "generateAgentTurn";
  /** Sorted names of the tools offered: the shape of the question. */
  tools: string;
  response: { text: string; toolCalls: ToolCall[]; stopReason?: string };
}

export interface Recording {
  source: "recorded";
  fixture: string;
  provider: string;
  model: string | null;
  at: string;
  calls: RecordedCall[];
}

const toolNames = (tools: any[]) => tools.map((t: any) => t.function?.name ?? t.name).sort().join(",");
const asTurn = (r: { text: string; toolCalls?: ToolCall[]; stopReason?: string }) => ({
  text: r.text || "",
  toolCalls: r.toolCalls ?? [],
  stopReason: (r.stopReason as any) ?? ((r.toolCalls?.length ?? 0) ? "tool_use" : "end_turn"),
  assistantMessage: { role: "assistant" as const, text: r.text || "", toolCalls: r.toolCalls ?? [] },
});

/** Wraps a real client; every answer is appended to `sink.calls`. */
export function recordingClient(real: AIClient, sink: { calls: RecordedCall[] }): AIClient {
  return {
    ...real,
    generateWithTools: real.generateWithTools
      ? async (prompt, tools, options) => {
          const r = await real.generateWithTools!(prompt, tools, options);
          sink.calls.push({ method: "generateWithTools", tools: toolNames(tools), response: { text: r.text, toolCalls: r.toolCalls ?? [], stopReason: r.stopReason } });
          return r;
        }
      : undefined,
    generateAgentTurn: real.generateAgentTurn
      ? async (system, messages, tools, options) => {
          const r = await real.generateAgentTurn!(system, messages, tools, options);
          sink.calls.push({ method: "generateAgentTurn", tools: toolNames(tools), response: { text: r.text, toolCalls: r.toolCalls ?? [], stopReason: r.stopReason } });
          return r;
        }
      : undefined,
  };
}

export function recordingPath(dir: string, fixtureId: string) {
  return join(dir, `${fixtureId}.json`);
}

/** Replays a recording, or (none recorded) the scripted policy. `source` tells the report which one answered. */
export function replayClient(fixture: any, recordingsDir: string): { client: AIClient; source: "recorded" | "scripted" } {
  const file = recordingPath(recordingsDir, fixture.id);
  if (existsSync(file)) {
    const rec: Recording = JSON.parse(readFileSync(file, "utf8"));
    let i = 0;
    const next = (method: RecordedCall["method"], tools: any[]) => {
      const call = rec.calls[i];
      const want = toolNames(tools);
      if (!call) throw new Error(`recording out of date: the Director made call #${i + 1} (${method}) that ${fixture.id}.json does not have; re-record with --record`);
      if (call.method !== method || call.tools !== want) {
        throw new Error(`recording out of date at call #${i + 1}: recorded ${call.method}[${call.tools.slice(0, 80)}], now ${method}[${want.slice(0, 80)}]; re-record with --record`);
      }
      i++;
      return call.response;
    };
    return {
      source: "recorded",
      client: {
        provider: rec.provider || "replay",
        model: rec.model || undefined,
        generate: async () => "",
        generateStream: async () => "",
        generateWithTools: async (_p, tools) => next("generateWithTools", tools) as any,
        generateAgentTurn: async (_s, _m, tools) => asTurn(next("generateAgentTurn", tools)) as any,
      },
    };
  }
  return { source: "scripted", client: scriptedClient(fixture) };
}

// ─── Scripted policy ─────────────────────────────────────────────────────────────────────────────

let seq = 0;
const call = (name: string, args: Record<string, any> = {}): ToolCall => ({ id: `s${++seq}`, name, args });

/** Timeline ranges (s) of the clips of `assets` in the fixture's starting timeline. */
function assetRanges(fixture: any, assets: string[]): Array<[number, number]> {
  return (fixture.request.currentEditIR?.clips ?? [])
    .filter((c: any) => assets.includes(c.assetId))
    .map((c: any) => [c.timelineStartMs / 1000, c.timelineEndMs / 1000] as [number, number]);
}

/**
 * A deterministic, competent editor: it cuts what the reference says must go, opens on the first line kept, and in
 * the agent loop does one sensible thing per stage using the numbers of the playbook in the system prompt.
 */
export function scriptedClient(fixture: any): AIClient {
  const checks = fixture.reference?.checks ?? {};
  const cuts: Array<[number, number]> = [
    ...(checks.shouldCutSourceMs ?? []).map(([a, b]: [number, number]) => [a / 1000, b / 1000] as [number, number]),
    ...assetRanges(fixture, checks.shouldDropAssets ?? []),
  ];
  const inCut = (a: number, b: number) => cuts.some(([x, y]) => a >= x - 0.15 && b <= y + 0.15);
  let system = "";
  let first = "";
  return {
    provider: "scripted",
    model: "scripted-policy",
    generate: async () => "",
    generateStream: async () => "",
    generateWithTools: async (prompt, tools) => {
      const names = new Set(tools.map((t: any) => t.function?.name ?? t.name));
      if (names.has("plan_story")) {
        const lines = [...prompt.matchAll(/^(L\d+) \[(\d+\.\d+)-(\d+\.\d+)/gm)].map((m) => ({ id: m[1], a: Number(m[2]), b: Number(m[3]) }));
        const remove = lines.filter((l) => inCut(l.a, l.b)).map((l) => ({ lineId: l.id, reason: checks.shouldDropAssets?.length ? "retake" : "false_start" }));
        const hook = lines.find((l) => !remove.some((r) => r.lineId === l.id));
        return { text: "", toolCalls: hook ? [call("plan_story", { hookLineId: hook.id, remove, roles: [{ lineId: hook.id, role: "hook" }], summary: "Cut what the reference says must go." })] : [] };
      }
      // Intent classification and one-shot repairs: nothing (the offline rules / no repair).
      if (names.has("finish_edit")) return { text: "", toolCalls: [call("finish_edit", { summary: "No change needed." })] };
      return { text: "", toolCalls: [] };
    },
    generateAgentTurn: async (sys, messages: AgentMessage[], tools) => {
      if (!system) system = sys;
      if (!first) first = String((messages[0] as any)?.content ?? "");
      const last = messages[messages.length - 1];
      if (last?.role === "tool") return asTurn({ text: "", toolCalls: [call("stage_done")] }) as any;
      const names = new Set(tools.map((t: any) => t.function?.name ?? t.name));
      const done = () => asTurn({ text: "", toolCalls: [call("finish_edit", { summary: "Edited." }), call("reply_to_creator", { reply: "Done: tightened, captioned and framed it.", phase: "done" })] }) as any;
      // A stage with every tool (scoped request, coverage): finish.
      if (names.has("removeSilences") && names.has("autoCaptions")) return done();
      if (names.has("removeSilences")) {
        const pause = Number(/pause cuts at ([\d.]+) s/.exec(system)?.[1] ?? 0.5);
        return asTurn({ text: "", toolCalls: [call("removeSilences", { minDurationSec: pause }), call("stage_done")] }) as any;
      }
      if (names.has("autoCaptions")) {
        const template = /captions: template ([A-Z_]+)/.exec(system)?.[1];
        return asTurn({ text: "", toolCalls: [call("autoCaptions", template ? { template } : {}), call("stage_done")] }) as any;
      }
      if (names.has("addZoom")) {
        const calls: ToolCall[] = [];
        const canvas = /canvas (\d+:\d+)/.exec(first)?.[1];
        if (checks.targetAspect && canvas && canvas !== checks.targetAspect && names.has("reframeSubject")) {
          calls.push(call("reframeSubject", { targetAspect: checks.targetAspect, mode: "track" }));
        }
        if (checks.maxZooms !== 0) {
          const len = Number(/Timeline length now: 0 \.\. ([\d.]+) s/.exec(first)?.[1] ?? 20);
          // The main subject of the shot at each zoom's time (ShotLog lines: "a-b framing ... | main: X centre (x,y)").
          const shots = [...first.matchAll(/^(\d+\.\d)-(\d+\.\d) [^\n]*?main: [^|\n]*? centre \(([\d.]+),([\d.]+)\)/gm)].map((s) => ({ a: Number(s[1]), b: Number(s[2]), x: Number(s[3]), y: Number(s[4]) }));
          const at = (t: number) => shots.find((s) => t >= s.a && t < s.b) ?? shots[0];
          const [lo, hi] = (/zooms [\d.]+-[\d.]+\/min at ([\d.]+)-([\d.]+)x/.exec(system) ?? [0, "1.2", "1.3"]).slice(1).map(Number);
          const scale = Math.round(((lo + hi) / 2) * 100) / 100;
          for (const f of [0.3, 0.62]) {
            const t = Math.round(len * f * 10) / 10;
            const s = at(t);
            calls.push(call("addZoom", { startSec: t, durationSec: 1.4, targetType: "FACE", targetCoords: { x: s ? s.x : 0.5, y: s ? s.y : 0.4 }, scale }));
          }
        }
        return asTurn({ text: "", toolCalls: [...calls, call("stage_done")] }) as any;
      }
      if (names.has("addBackgroundMusic")) {
        const wants = checks.music || /\bmusic\b/i.test(fixture.request.prompt || "");
        return asTurn({ text: "", toolCalls: [...(wants ? [call("addBackgroundMusic", { query: "upbeat", duckUnderSpeech: true })] : []), call("stage_done")] }) as any;
      }
      if (names.has("insertBroll") || names.has("addText")) return asTurn({ text: "", toolCalls: [call("stage_done")] }) as any;
      return done();
    },
  };
}
