"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scorePieceHook = scorePieceHook;
exports.runHookLabAgent = runHookLabAgent;
/**
 * Agent 4: Hook Lab
 *
 * Scores every spoken hook with the deterministic HookScorer (length, concreteness, stakes, front-loading,
 * viewer address, dealbreakers) and names the formula it matches. Hooks that fail are sent back to the LLM with
 * the scorer's own recommendations and the proven formula catalogue; a rewrite is accepted only when it scores
 * higher AND introduces no number or money figure that is absent from the brand and piece context.
 *
 * Nothing is ever replaced with a stock line: if the rewrite call fails or does not improve the hook, the
 * writer's original stays and the weakness is recorded on the piece for the human reviewer.
 */
const zod_1 = require("zod");
const hooks_data_1 = require("../../craft/data/hooks.data");
const craft_review_1 = require("../../craft/craft-review");
const hook_scorer_1 = require("../../craft/hook-scorer");
const platform_specs_1 = require("../../craft/platform-specs");
const budget_1 = require("../budget");
const json_agent_1 = require("../json-agent");
const HookLabSchema = zod_1.z.object({
    items: zod_1.z.array(zod_1.z.object({
        slotId: zod_1.z.string().min(1),
        candidates: zod_1.z.array(zod_1.z.string().trim().min(3).max(200)).min(1).max(4),
    })).min(1),
});
const isVideo = (p) => p.format === 'reel';
function scorePieceHook(piece, hook = piece.spokenHook) {
    if (isVideo(piece))
        return hook_scorer_1.HookScorer.score(hook);
    const platform = (0, platform_specs_1.toCraftPlatform)(piece.primaryPlatform) || 'instagram';
    return hook_scorer_1.HookScorer.score(hook, { spoken: false, maxWords: platform_specs_1.PLATFORM_CRAFT[platform].openingLineMaxWords });
}
const isWeak = (e) => !!e.dealbreaker || e.totalScore < craft_review_1.HOOK_PASS_SCORE;
/** Formula names + templates only: enough for the model to pick a shape without copying an example's numbers. */
function formulaCatalogue() {
    return hooks_data_1.HOOKS_DATA.hooks
        .map((h) => `${h.id}. ${h.name}: ${h.template}`).join('\n');
}
function pieceContext(piece, brand) {
    return [
        brand.promptContext, piece.topic, piece.angle, piece.headline, piece.spokenHook, piece.onScreenHook,
        piece.whatContentDelivers || '', ...(piece.script?.body.map((b) => b.beat) || []), piece.script?.cta || '',
        ...(piece.carouselBrief?.slides.map((s) => `${s.headline} ${s.body}`) || []),
    ].join('\n');
}
async function runHookLabAgent(params) {
    const { pieces, brand } = params;
    const evals = new Map();
    for (const p of pieces) {
        const e = scorePieceHook(p);
        evals.set(p.slotId, e);
        p.hookScore = e.totalScore;
        p.hookFormula = e.formulaName;
    }
    const weak = pieces.filter((p) => isWeak(evals.get(p.slotId)));
    const outcome = { scored: pieces.length, weak: weak.length, rewritten: 0 };
    if (!weak.length)
        return outcome;
    if (!(0, budget_1.optionalAgentLimits)().rewritesEnabled) {
        // Operator turned the rewrite pass off: hooks are still scored and the weak ones flagged for review.
        for (const p of weak) {
            const e = evals.get(p.slotId);
            p.critic.issues.push(`weak hook (${e.totalScore}/100): ${e.dealbreaker || e.recommendations[0] || 'needs a sharper opening'}`);
        }
        return outcome;
    }
    try {
        const { value } = await (0, json_agent_1.runJsonAgent)({
            llm: params.llm,
            role: 'hook_lab',
            meter: params.meter,
            log: params.log,
            maxTokens: Math.min(budget_1.AGENT_TOKEN_CAPS.hookLabMax, budget_1.AGENT_TOKEN_CAPS.hookLabBase + weak.length * budget_1.AGENT_TOKEN_CAPS.hookLabPerHook),
            schema: HookLabSchema,
            system: 'You are a hook editor for short-form video and social posts. You rewrite weak opening lines so a stranger stops scrolling. You never invent facts.',
            prompt: [
                brand.promptContext,
                '',
                'Each hook below failed a scoring rubric. Write 3 replacement candidates per hook that fix the listed problems.',
                'Rules:',
                '- Reel hooks are spoken: 5-11 words, sayable in under 3 seconds, no hashtags, no emoji.',
                '- Text-post hooks are the first line of the post: one sentence, the claim first.',
                '- Start on the payload (the claim, the stake or the number). No greeting, no "stop scrolling", no warm-up question.',
                '- Be concrete: name the specific situation, tool, role or outcome from the piece.',
                '- NEVER invent numbers, money amounts, percentages, client results or personal stories. Use a figure only if it already appears in the brand context or the piece. If there is no real figure, be specific without one.',
                '- Keep the promise the same: the rest of the script must still deliver on the new hook.',
                brand.forbiddenWords.length ? `- Never use: ${brand.forbiddenWords.join(', ')}` : '',
                '',
                'Proven hook shapes (use the shape, not the example wording):',
                formulaCatalogue(),
                '',
                'Hooks to fix:',
                JSON.stringify(weak.map((p) => {
                    const e = evals.get(p.slotId);
                    return {
                        slotId: p.slotId, format: p.format, platform: p.primaryPlatform, topic: p.topic, angle: p.angle,
                        whatContentDelivers: p.whatContentDelivers, currentHook: p.spokenHook, score: e.totalScore,
                        problems: e.recommendations,
                    };
                })),
                '',
                'Return JSON only: {"items":[{"slotId":"","candidates":["","",""]}]}',
            ].filter((l) => l !== '').join('\n'),
        });
        const byId = new Map(weak.map((p) => [p.slotId, p]));
        for (const item of value.items) {
            const p = byId.get(item.slotId);
            if (!p)
                continue;
            const before = evals.get(p.slotId);
            const context = pieceContext(p, brand);
            const best = item.candidates
                .filter((c) => (0, craft_review_1.inventedFigures)(c, context).length === 0)
                .map((c) => scorePieceHook(p, c))
                .filter((e) => !e.dealbreaker)
                .sort((a, b) => b.totalScore - a.totalScore)[0];
            if (best && best.totalScore > before.totalScore) {
                p.spokenHook = best.hook;
                if (p.script)
                    p.script.hook = best.hook;
                p.hookScore = best.totalScore;
                p.hookFormula = best.formulaName;
                evals.set(p.slotId, best);
                outcome.rewritten += 1;
            }
        }
    }
    catch (err) {
        // The rewrite is an improvement pass over real writer output, so a failure keeps the originals.
        outcome.error = err?.message || String(err);
        params.log?.('hook_lab_failed', { error: outcome.error });
    }
    for (const p of weak) {
        const e = evals.get(p.slotId);
        if (isWeak(e))
            p.critic.issues.push(`weak hook (${e.totalScore}/100): ${e.dealbreaker || e.recommendations[0] || 'needs a sharper opening'}`);
    }
    return outcome;
}
