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
import { z } from 'zod';
import { HOOKS_DATA } from '../../craft/data/hooks.data';
import { HOOK_PASS_SCORE, inventedFigures } from '../../craft/craft-review';
import { HookEvaluation, HookScorer } from '../../craft/hook-scorer';
import { PLATFORM_CRAFT, toCraftPlatform } from '../../craft/platform-specs';
import { AGENT_TOKEN_CAPS, optionalAgentLimits } from '../budget';
import { runJsonAgent } from '../json-agent';
import { AutopilotLLM, UsageMeter } from '../llm';
import type { AutopilotBrandContext, AutopilotPiece } from '../types';

const HookLabSchema = z.object({
    items: z.array(z.object({
        slotId: z.string().min(1),
        candidates: z.array(z.string().trim().min(3).max(200)).min(1).max(4),
    })).min(1),
});

export interface HookLabOutcome {
    scored: number;
    weak: number;
    rewritten: number;
    error?: string;
}

const isVideo = (p: AutopilotPiece) => p.format === 'reel';

export function scorePieceHook(piece: AutopilotPiece, hook = piece.spokenHook): HookEvaluation {
    if (isVideo(piece)) return HookScorer.score(hook);
    const platform = toCraftPlatform(piece.primaryPlatform) || 'instagram';
    return HookScorer.score(hook, { spoken: false, maxWords: PLATFORM_CRAFT[platform].openingLineMaxWords });
}

const isWeak = (e: HookEvaluation) => !!e.dealbreaker || e.totalScore < HOOK_PASS_SCORE;

/** Formula names + templates only: enough for the model to pick a shape without copying an example's numbers. */
function formulaCatalogue(): string {
    return (HOOKS_DATA.hooks as { id: number; name: string; template: string }[])
        .map((h) => `${h.id}. ${h.name}: ${h.template}`).join('\n');
}

function pieceContext(piece: AutopilotPiece, brand: AutopilotBrandContext): string {
    return [
        brand.promptContext, piece.topic, piece.angle, piece.headline, piece.spokenHook, piece.onScreenHook,
        piece.whatContentDelivers || '', ...(piece.script?.body.map((b) => b.beat) || []), piece.script?.cta || '',
        ...(piece.carouselBrief?.slides.map((s) => `${s.headline} ${s.body}`) || []),
    ].join('\n');
}

export async function runHookLabAgent(params: {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    pieces: AutopilotPiece[];
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<HookLabOutcome> {
    const { pieces, brand } = params;
    const evals = new Map<string, HookEvaluation>();
    for (const p of pieces) {
        const e = scorePieceHook(p);
        evals.set(p.slotId, e);
        p.hookScore = e.totalScore;
        p.hookFormula = e.formulaName;
    }
    const weak = pieces.filter((p) => isWeak(evals.get(p.slotId)!));
    const outcome: HookLabOutcome = { scored: pieces.length, weak: weak.length, rewritten: 0 };
    if (!weak.length) return outcome;
    if (!optionalAgentLimits().rewritesEnabled) {
        // Operator turned the rewrite pass off: hooks are still scored and the weak ones flagged for review.
        for (const p of weak) {
            const e = evals.get(p.slotId)!;
            p.critic.issues.push(`weak hook (${e.totalScore}/100): ${e.dealbreaker || e.recommendations[0] || 'needs a sharper opening'}`);
        }
        return outcome;
    }

    try {
        const { value } = await runJsonAgent({
            llm: params.llm,
            role: 'hook_lab',
            meter: params.meter,
            log: params.log,
            maxTokens: Math.min(AGENT_TOKEN_CAPS.hookLabMax, AGENT_TOKEN_CAPS.hookLabBase + weak.length * AGENT_TOKEN_CAPS.hookLabPerHook),
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
                    const e = evals.get(p.slotId)!;
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
            if (!p) continue;
            const before = evals.get(p.slotId)!;
            const context = pieceContext(p, brand);
            const best = item.candidates
                .filter((c) => inventedFigures(c, context).length === 0)
                .map((c) => scorePieceHook(p, c))
                .filter((e) => !e.dealbreaker)
                .sort((a, b) => b.totalScore - a.totalScore)[0];
            if (best && best.totalScore > before.totalScore) {
                p.spokenHook = best.hook;
                if (p.script) p.script.hook = best.hook;
                p.hookScore = best.totalScore;
                p.hookFormula = best.formulaName;
                evals.set(p.slotId, best);
                outcome.rewritten += 1;
            }
        }
    } catch (err: any) {
        // The rewrite is an improvement pass over real writer output, so a failure keeps the originals.
        outcome.error = err?.message || String(err);
        params.log?.('hook_lab_failed', { error: outcome.error });
    }

    for (const p of weak) {
        const e = evals.get(p.slotId)!;
        if (isWeak(e)) p.critic.issues.push(`weak hook (${e.totalScore}/100): ${e.dealbreaker || e.recommendations[0] || 'needs a sharper opening'}`);
    }
    return outcome;
}
