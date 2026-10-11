"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_TOKEN_CAPS = void 0;
exports.optionalAgentLimits = optionalAgentLimits;
exports.estimateAutopilotBudget = estimateAutopilotBudget;
exports.priceUsage = priceUsage;
/**
 * What a calendar run can cost, before it runs, and what it did cost, after.
 *
 *  - estimateAutopilotBudget: exact number of AI calls per agent and the output-token ceiling of each (the same
 *    caps the pipeline passes as max_tokens), computed from days, platforms and content mix. It is a ceiling, not a
 *    forecast: Hook Lab and Platform Craft only call the model when something fails their checks.
 *  - priceUsage: turns a run's token usage into money only when the operator has configured prices
 *    (AUTOPILOT_PRICE_INPUT_PER_MTOK_USD / AUTOPILOT_PRICE_OUTPUT_PER_MTOK_USD). No price is assumed.
 *  - optionalAgentLimits: operator switches that bound the two rewrite agents.
 */
const cadence_1 = require("./cadence");
/** Same numbers the pipeline uses for max_tokens. Kept here so the estimate and the run cannot drift apart. */
exports.AGENT_TOKEN_CAPS = {
    research: 1500,
    strategistBase: 1500,
    strategistPerSlot: 110,
    strategistMax: 9000,
    hookBase: 800,
    hookPerSlot: 650,
    hookMax: 8000,
    hookChunk: 4,
    hookLabBase: 500,
    hookLabPerHook: 220,
    hookLabMax: 4000,
    copyBase: 500,
    copyPerPlatformCopy: 260,
    copyMax: 8000,
    copyChunk: 5,
    craftBase: 500,
    craftPerFix: 420,
    craftMax: 8000,
    craftChunk: 12,
    criticBase: 400,
    criticPerPiece: 350,
    criticMax: 6000,
};
function optionalAgentLimits(env = process.env) {
    const raw = Number(env.AUTOPILOT_CRAFT_MAX_FIX_CALLS);
    return {
        rewritesEnabled: env.AUTOPILOT_REWRITE_AGENTS !== 'off',
        craftMaxFixCalls: Number.isFinite(raw) && raw >= 0 ? Math.min(20, Math.floor(raw)) : 3,
    };
}
const chunkSizes = (n, size) => Array.from({ length: Math.ceil(n / size) }, (_, i) => Math.min(size, n - i * size));
function estimateAutopilotBudget(input, limits = optionalAgentLimits()) {
    const C = exports.AGENT_TOKEN_CAPS;
    const plan = (0, cadence_1.planCadence)(input.days, input.contentMix, input.platforms);
    // Without a mix the strategist plans one piece per day.
    const perDay = new Map();
    if (plan)
        for (const s of plan)
            perDay.set(s.day, (perDay.get(s.day) || 0) + 1);
    else
        for (let d = 1; d <= input.days; d++)
            perDay.set(d, 1);
    const pieces = Array.from(perDay.values()).reduce((a, b) => a + b, 0);
    const weeks = new Map();
    for (const [day, n] of perDay)
        weeks.set(Math.ceil(day / 7), (weeks.get(Math.ceil(day / 7)) || 0) + n);
    const weekSizes = Array.from(weeks.values());
    const nPlat = input.platforms.length;
    const agents = [];
    const add = (agent, tokens, conditional = false) => agents.push({ agent, calls: tokens.length, maxOutputTokens: tokens.reduce((a, b) => a + b, 0), conditional });
    if (input.researchEnabled)
        add('research', [C.research]);
    add('strategist', [Math.min(C.strategistMax, C.strategistBase + pieces * C.strategistPerSlot)]);
    add('hook_script', weekSizes.flatMap((w) => chunkSizes(w, C.hookChunk).map((n) => Math.min(C.hookMax, C.hookBase + n * C.hookPerSlot))));
    add('hook_lab', limits.rewritesEnabled ? [Math.min(C.hookLabMax, C.hookLabBase + pieces * C.hookLabPerHook)] : [], true);
    add('copy', weekSizes.flatMap((w) => chunkSizes(w, C.copyChunk).map((n) => Math.min(C.copyMax, C.copyBase + n * nPlat * C.copyPerPlatformCopy))));
    const craftCalls = limits.rewritesEnabled ? Math.min(limits.craftMaxFixCalls, Math.ceil((pieces * nPlat) / C.craftChunk)) : 0;
    add('craft', Array.from({ length: craftCalls }, () => Math.min(C.craftMax, C.craftBase + C.craftChunk * C.craftPerFix)), true);
    add('critic', weekSizes.map((w) => Math.min(C.criticMax, C.criticBase + w * C.criticPerPiece)));
    const calls = agents.reduce((a, b) => a + b.calls, 0);
    const maxOutputTokens = agents.reduce((a, b) => a + b.maxOutputTokens, 0);
    return { days: input.days, pieces, platforms: nPlat, agents, calls, maxOutputTokens, worstCaseCalls: calls * 2, worstCaseOutputTokens: maxOutputTokens * 2 };
}
/** Cost of a run from its token usage, or null when no prices are configured. */
function priceUsage(usage, env = process.env) {
    const input = Number(env.AUTOPILOT_PRICE_INPUT_PER_MTOK_USD);
    const output = Number(env.AUTOPILOT_PRICE_OUTPUT_PER_MTOK_USD);
    if (!(input >= 0) || !(output >= 0) || env.AUTOPILOT_PRICE_INPUT_PER_MTOK_USD === undefined || env.AUTOPILOT_PRICE_OUTPUT_PER_MTOK_USD === undefined)
        return null;
    const round = (v) => Math.round(v * 10000) / 10000;
    const inputUsd = (usage.inputTokens / 1_000_000) * input;
    const outputUsd = (usage.outputTokens / 1_000_000) * output;
    return { inputUsd: round(inputUsd), outputUsd: round(outputUsd), totalUsd: round(inputUsd + outputUsd), pricePerMTok: { input, output }, estimatedTokens: !!usage.estimated };
}
