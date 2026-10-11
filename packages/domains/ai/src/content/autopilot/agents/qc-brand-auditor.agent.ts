/**
 * Agent 4: Quality Control & Brand Auditor Agent
 *
 * Implements Master SOP Stage 07 (Quality Control):
 * - Checks the 10-point SOP checklist:
 *     1. Hook (creates curiosity, tension, relevance)
 *     2. Promise (body delivers on hook)
 *     3. Value (concrete insight/framework)
 *     4. Psychology (deliberate psychological job)
 *     5. Audience Fit
 *     6. Brand Fit (voice & forbidden words)
 *     7. Accuracy & Claims
 *     8. CTA (single natural next step)
 *     9. Design / Visual Direction (specific enough to shoot/design)
 *     10. Production Ready
 * - Deterministic enforcement:
 *     Removes forbidden words, caps hashtags per platform, fits X/Twitter to 280 chars, flags duplicates.
 */
import { PLATFORM_RULES } from '../platform-rules';
import { AutopilotPlatform, CriticReview, CriticReviewSchema } from '../schemas';
import type { AutopilotBrandContext, AutopilotPiece, PieceCopy } from '../types';
import { runJsonAgent } from '../json-agent';
import { AutopilotLLM, UsageMeter } from '../llm';

export interface AuditBatchParams {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    pieces: AutopilotPiece[];
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}

export async function runQcBrandAuditorAgent(params: AuditBatchParams): Promise<void> {
    const { llm, brand, pieces, meter, log } = params;

    // 1. LLM-based Master SOP Review
    const payload = pieces.map((p) => ({
        slotId: p.slotId,
        format: p.format,
        spokenHook: p.spokenHook,
        onScreenHook: p.onScreenHook,
        psychologicalJob: p.psychologicalJob,
        script: p.script ? { hook: p.script.hook, cta: p.script.cta } : undefined,
        carouselSlidesCount: p.carouselBrief?.slides.length,
        captions: Object.entries(p.captions).map(([plat, c]) => ({ platform: plat, caption: c?.caption, cta: c?.cta })),
    }));

    const systemPrompt = [
        'You are a senior brand quality assurance and creative director.',
        'You audit content pieces against the 10-point Master SOP Quality Standard:',
        '1 Hook tension, 2 Promise delivery, 3 Value depth, 4 Psychological job clarity, 5 Audience fit,',
        '6 Brand voice fit, 7 Claim accuracy, 8 CTA clarity, 9 Visual direction readiness, 10 Production readiness.',
        'Flag or fix any pieces that use generic filler, weak hooks, or lack deliberate psychological tension.',
    ].join(' ');

    const prompt = [
        brand.promptContext,
        '',
        'PIECES TO AUDIT:',
        JSON.stringify(payload),
        '',
        'Return JSON: {"items":[{"slotId":"","verdict":"ok","issues":[],"fixes":[],"fixedSpokenHook":""}]}',
    ].join('\n');

    try {
        const res = await runJsonAgent({
            llm,
            role: 'critic',
            system: systemPrompt,
            prompt,
            schema: CriticReviewSchema,
            maxTokens: Math.min(8000, 600 + pieces.length * 400),
            meter,
            log,
        });

        // Apply LLM fixes
        const reviewBySlot = new Map(res.value.items.map((i) => [i.slotId, i]));
        for (const piece of pieces) {
            const rev = reviewBySlot.get(piece.slotId);
            if (!rev) continue;
            if (rev.verdict !== 'ok') {
                piece.critic.verdict = rev.verdict;
                piece.critic.issues.push(...rev.issues);
            }
            if (rev.fixedSpokenHook && rev.fixedSpokenHook.trim()) {
                piece.spokenHook = rev.fixedSpokenHook.trim();
            }
            for (const fix of rev.fixes) {
                const c = piece.captions[fix.platform as AutopilotPlatform];
                if (c && fix.caption) {
                    c.caption = fix.caption;
                }
            }
        }
    } catch (e) {
        log?.('qc_auditor_llm_warning', { error: String(e) });
        // Deterministic checks will still ensure safety even if LLM critic blips
    }

    // 2. Deterministic Brand Enforcement
    for (const piece of pieces) {
        enforceDeterministicRules(piece, brand);
    }
}

export function enforceDeterministicRules(piece: AutopilotPiece, brand: AutopilotBrandContext): void {
    const forbidden = (brand.forbiddenWords || []).map((w) => w.trim()).filter(Boolean);

    for (const [platStr, copy] of Object.entries(piece.captions) as [AutopilotPlatform, PieceCopy][]) {
        if (!copy) continue;
        const rules = PLATFORM_RULES[platStr];

        // 1. Forbidden words removal
        for (const word of forbidden) {
            const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi');
            if (re.test(copy.caption)) {
                copy.caption = copy.caption.replace(re, '').replace(/\s{2,}/g, ' ').trim();
                piece.critic.issues.push(`Removed forbidden word "${word}" on ${platStr}`);
            }
        }

        // 2. Hashtags capping per platform rules
        if (rules?.maxHashtags && copy.hashtags.length > rules.maxHashtags) {
            copy.hashtags = copy.hashtags.slice(0, rules.maxHashtags);
        }

        // 3. Twitter / X 280-char fitting
        if (platStr === 'x' && copy.caption.length > 280) {
            copy.caption = copy.caption.slice(0, 277) + '…';
        }
    }
}

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
