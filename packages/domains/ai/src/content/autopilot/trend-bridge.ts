/**
 * Bridge between the trend research engine (src/research) and the calendar pipeline:
 *   - what to research: the user's own words (campaign name, goals, directives, reference) instead of a generic
 *     "<industry> trends" query (audit finding A1)
 *   - report -> research digest with ids, code-computed signal lines, audience questions, verbatim quotes, angles
 *   - per-slot evidence and the creator's own winning hooks as prompt blocks (A5, A10)
 */
import { fenceUntrusted, sanitizeInlineUntrusted } from '@workspace/video-contracts';
import type { TrendResearchReport } from '../../research/types';
import type { ResearchDigest, StrategySlot } from './schemas';
import type { AutopilotRunInput, PieceTrend, WinningExemplar } from './types';

export type DigestTrend = ResearchDigest['trends'][number];

/** The research topic and planner context, built from what the user typed. */
export function researchTopicFromInput(input: AutopilotRunInput): { topic: string; context: string[] } {
    const parts = [input.campaignName, ...input.goals].map((s) => (s || '').trim()).filter(Boolean);
    const topic = (parts[0] || input.brand.industry || 'content ideas').slice(0, 200);
    const context = [
        input.goals.length ? `Goals: ${input.goals.join('; ')}` : '',
        input.structureDirectives ? `Directives: ${input.structureDirectives.slice(0, 600)}` : '',
        input.referenceInspirations ? `Reference excerpt: ${input.referenceInspirations.slice(0, 800)}` : '',
        input.brand.positioning ? `Positioning: ${input.brand.positioning}` : '',
    ].filter(Boolean);
    return { topic, context };
}

const VERDICT_TEXT: Record<string, string> = { create_now: 'create now', sharpen_angle: 'create with a sharper angle', wait: 'wait', skip: 'skip' };

/** Clusters worth planning around (skip-verdict clusters are dropped), as digest trends. */
export function reportToDigest(report: TrendResearchReport): ResearchDigest {
    const trends: DigestTrend[] = report.clusters
        .filter((c) => c.metrics.verdict !== 'skip' && c.items.length > 0)
        .slice(0, 6)
        .map((c) => ({
            id: c.id,
            topic: c.title.slice(0, 200),
            whyNow: c.whyNow.slice(0, 400),
            sourceUrls: c.items.slice(0, 5).map((i) => i.url),
            signal: [c.metrics.momentumLabel !== 'unknown' ? c.metrics.momentumLabel : '', `opportunity ${c.metrics.opportunityScore}/100`, `${c.metrics.totalItems} posts`,
                c.metrics.sentiment.n ? `sentiment +${c.metrics.sentiment.positive}% / -${c.metrics.sentiment.negative}% (n=${c.metrics.sentiment.n})` : ''].filter(Boolean).join(' · '),
            verdict: VERDICT_TEXT[c.metrics.verdict],
            audienceQuestions: c.audienceQuestions.slice(0, 4),
            quotes: c.reactionQuotes.slice(0, 4).map((q) => ({ quote: q.quote, url: q.url })),
            angles: c.angles.slice(0, 3).map((a) => ({ title: a.title, tension: a.tension, draftHook: a.draftHook })),
        }));
    return { trends };
}

export function trendsById(digest: ResearchDigest | undefined): Map<string, DigestTrend> {
    return new Map((digest?.trends || []).filter((t) => t.id).map((t) => [t.id as string, t]));
}

/** Strategist block: trends with ids, signals and angles. Untrusted text is fenced. */
export function strategistTrendBlock(digest: ResearchDigest | undefined): string {
    const trends = digest?.trends || [];
    if (!trends.length) return '';
    const lines = trends.map((t) => [
        `- trendId "${t.id ?? ''}": ${sanitizeInlineUntrusted(t.topic, 200)} — ${sanitizeInlineUntrusted(t.whyNow, 300)}`,
        t.signal ? `  signal: ${t.signal}${t.verdict ? ` · verdict: ${t.verdict}` : ''}` : '',
        ...(t.angles || []).map((a) => `  angle: ${sanitizeInlineUntrusted(a.title, 120)} (tension: ${sanitizeInlineUntrusted(a.tension, 200)})`),
        ...(t.audienceQuestions || []).map((q) => `  people ask: ${sanitizeInlineUntrusted(q, 200)}`),
    ].filter(Boolean).join('\n'));
    return fenceUntrusted('research', lines.join('\n'), { label: 'trend research (last 30 days)', maxChars: 7000 }).block;
}

/** How many slots must cover a researched trend: ~40%, but never more than 3 slots per trend. */
export function minTrendSlots(slotCount: number, trendCount: number): number {
    if (!trendCount) return 0;
    return Math.min(Math.ceil(slotCount * 0.4), trendCount * 3);
}

/** Attaches each slot's sources from its trend (deterministic: the model never copies URLs). */
export function attachTrendSources(slots: StrategySlot[], byId: Map<string, DigestTrend>): void {
    for (const s of slots) {
        const t = s.trendId ? byId.get(s.trendId) : undefined;
        if (!t) { delete s.trendId; continue; }
        s.sourceUrls = t.sourceUrls.slice(0, 3);
    }
}

export function pieceTrend(t: DigestTrend): PieceTrend {
    return {
        id: t.id || '', title: t.topic, whyNow: t.whyNow, signal: t.signal,
        audienceQuestions: t.audienceQuestions || [],
        quotes: (t.quotes || []).filter((q) => q.quote && q.url).map((q) => ({ quote: q.quote as string, url: q.url as string })),
        sourceUrls: t.sourceUrls,
    };
}

/** Writer block: what the audience is actually saying about each slot's trend, verbatim. */
export function slotEvidenceBlock(slots: { slotId: string; trend?: PieceTrend }[]): string {
    const withTrend = slots.filter((s) => s.trend);
    if (!withTrend.length) return '';
    const body = withTrend.map((s) => {
        const t = s.trend!;
        return [
            `slot ${s.slotId} — trend: ${sanitizeInlineUntrusted(t.title, 160)}`,
            ...t.audienceQuestions.map((q) => `  they ask: ${sanitizeInlineUntrusted(q, 200)}`),
            ...t.quotes.map((q) => `  they said: "${sanitizeInlineUntrusted(q.quote, 240)}"`),
        ].join('\n');
    }).join('\n');
    return [
        'AUDIENCE EVIDENCE (real posts/comments from the last 30 days). Use their words and questions to make hooks specific;',
        'answer what they ask. Do not quote people as if they were the creator, and do not invent figures from it.',
        fenceUntrusted('research', body, { label: 'audience evidence', maxChars: 6000 }).block,
    ].join('\n');
}

/** Writer block: the creator's own outperforming hooks (same project only; never another tenant's content). */
export function exemplarBlock(exemplars: WinningExemplar[] | undefined): string {
    const list = (exemplars || []).filter((e) => e.hook && e.multiple >= 1.5).slice(0, 5);
    if (!list.length) return '';
    return [
        'HOOKS THAT WORKED FOR THIS CREATOR (their own published posts, result vs their usual). Learn the pattern',
        '(specificity, tension, length, who it speaks to); never reuse the wording.',
        fenceUntrusted('memory', list.map((e) => `- ${e.multiple}x on ${e.platform} (${e.format}): ${sanitizeInlineUntrusted(e.hook, 160)}`).join('\n'), { label: 'own winning hooks', maxChars: 1500 }).block,
    ].join('\n');
}
