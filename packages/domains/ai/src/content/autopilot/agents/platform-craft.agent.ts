/**
 * Agent 6: Platform Craft (format cop)
 *
 * Lints every platform copy with the per-platform rules in craft/platform-specs (feed fold, hashtag cap, dead or
 * penalised links, one ask, greeting openers, stock phrasing). Copies with a hard failure, a wasted fold or stock
 * AI phrasing go back to the LLM once with the exact failures; a rewrite is kept only if it lints better and
 * adds no figure that is not already in the piece. Failures keep the writer's original and are left for the
 * critic's deterministic pass (which still caps hashtags and fits length).
 */
import { z } from 'zod';
import { inventedFigures } from '../../craft/craft-review';
import { CopyLintResult, PlatformCopyLinter } from '../../craft/copy-linter';
import { PLATFORM_CRAFT, toCraftPlatform } from '../../craft/platform-specs';
import { AGENT_TOKEN_CAPS, optionalAgentLimits } from '../budget';
import { runJsonAgent } from '../json-agent';
import { AutopilotLLM, UsageMeter } from '../llm';
import { AUTOPILOT_PLATFORMS, AutopilotPlatform } from '../schemas';
import type { AutopilotBrandContext, AutopilotPiece, PieceCopy } from '../types';

const CraftFixSchema = z.object({
    items: z.array(z.object({
        slotId: z.string().min(1),
        platform: z.enum(AUTOPILOT_PLATFORMS),
        caption: z.string().trim().min(1).max(5000),
    })).min(1),
});

/** WARN checks worth an LLM round-trip; the rest are advice for the reviewer. */
const REWRITE_ON_WARN = new Set(['FOLD_HOOK', 'STOCK_PHRASES']);
const MAX_FIXES_PER_CALL = AGENT_TOKEN_CAPS.craftChunk;

export interface PlatformCraftOutcome {
    linted: number;
    failing: number;
    rewritten: number;
    /** Failing copies left for the reviewer because the run's fix-call limit was reached. */
    skipped: number;
    error?: string;
}

function lintCopy(platform: AutopilotPlatform, copy: PieceCopy): CopyLintResult | null {
    const craft = toCraftPlatform(platform);
    if (!craft) return null;
    const tags = copy.hashtags.filter((t) => !copy.caption.includes(t));
    return PlatformCopyLinter.analyze(craft, tags.length ? `${copy.caption.trim()}\n\n${tags.join(' ')}` : copy.caption);
}

function problemsOf(lint: CopyLintResult): string[] {
    return lint.checks
        // Hashtag count is capped deterministically by the critic; asking the model to drop tags wastes a call.
        .filter((c) => c.check !== 'HASHTAG_COUNT' && (c.status === 'FAIL' || (c.status === 'WARN' && REWRITE_ON_WARN.has(c.check))))
        .map((c) => c.detail);
}

export async function runPlatformCraftAgent(params: {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    pieces: AutopilotPiece[];
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<PlatformCraftOutcome> {
    const outcome: PlatformCraftOutcome = { linted: 0, failing: 0, rewritten: 0, skipped: 0 };
    const failing: { piece: AutopilotPiece; platform: AutopilotPlatform; copy: PieceCopy; lint: CopyLintResult; problems: string[] }[] = [];
    for (const piece of params.pieces) {
        for (const platform of piece.platforms) {
            const copy = piece.captions[platform];
            if (!copy) continue;
            const lint = lintCopy(platform, copy);
            if (!lint) continue;
            outcome.linted += 1;
            const problems = problemsOf(lint);
            if (problems.length) failing.push({ piece, platform, copy, lint, problems });
        }
    }
    outcome.failing = failing.length;
    if (!failing.length) return outcome;
    const limits = optionalAgentLimits();
    // Worst failures first, so a capped run spends its calls where they matter most.
    failing.sort((a, b) => a.lint.score - b.lint.score);
    const budget = limits.rewritesEnabled ? limits.craftMaxFixCalls * MAX_FIXES_PER_CALL : 0;
    outcome.skipped = Math.max(0, failing.length - budget);
    failing.length = Math.min(failing.length, budget);
    if (!failing.length) return outcome;

    try {
        for (let i = 0; i < failing.length; i += MAX_FIXES_PER_CALL) {
            const chunk = failing.slice(i, i + MAX_FIXES_PER_CALL);
            const key = (slotId: string, platform: string) => `${slotId}|${platform}`;
            const wanted = new Map(chunk.map((f) => [key(f.piece.slotId, f.platform), f]));
            const platforms = Array.from(new Set(chunk.map((f) => f.platform)));
            const { value } = await runJsonAgent({
                llm: params.llm,
                role: 'craft',
                meter: params.meter,
                log: params.log,
                maxTokens: Math.min(AGENT_TOKEN_CAPS.craftMax, AGENT_TOKEN_CAPS.craftBase + chunk.length * AGENT_TOKEN_CAPS.craftPerFix),
                schema: CraftFixSchema,
                system: 'You are a platform-native social copy editor. You fix captions so they follow each platform\'s feed mechanics. You change as little as needed and never invent facts.',
                prompt: [
                    params.brand.promptContext,
                    '',
                    'Platform rules:',
                    ...platforms.map((p) => {
                        const s = PLATFORM_CRAFT[toCraftPlatform(p)!];
                        return `- ${s.label}: ${s.playbook.join(' ')}`;
                    }),
                    '',
                    'Fix each caption below so every listed problem is gone. Keep the meaning, the offer and the facts.',
                    'Do not put hashtags in the caption (they are stored separately). Do not add numbers, results or stories that are not already in the caption.',
                    params.brand.forbiddenWords.length ? `Never use: ${params.brand.forbiddenWords.join(', ')}` : '',
                    '',
                    'Captions:',
                    JSON.stringify(chunk.map((f) => ({ slotId: f.piece.slotId, platform: f.platform, hook: f.piece.spokenHook, caption: f.copy.caption, problems: f.problems }))),
                    '',
                    'Return JSON only: {"items":[{"slotId":"","platform":"instagram","caption":""}]}',
                ].filter((l) => l !== '').join('\n'),
            });
            for (const item of value.items) {
                const f = wanted.get(key(item.slotId, item.platform));
                if (!f) continue;
                if (inventedFigures(item.caption, `${f.copy.caption}\n${params.brand.promptContext}\n${f.piece.topic}\n${f.piece.angle}`).length) continue;
                const after = lintCopy(f.platform, { ...f.copy, caption: item.caption });
                if (after && after.score > f.lint.score) {
                    f.copy.caption = item.caption;
                    outcome.rewritten += 1;
                }
            }
        }
    } catch (err: any) {
        outcome.error = err?.message || String(err);
        params.log?.('platform_craft_failed', { error: outcome.error });
    }
    return outcome;
}
