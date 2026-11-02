/**
 * Research agent 4 — Trend Analyst: reads everything the three gathering agents found (fenced as untrusted data)
 * and groups it into stories, writes what each is and why now, pulls verbatim audience quotes and questions,
 * proposes angles with a draft hook, labels sentiment per comment, and judges brand fit.
 *
 * It never writes numbers: metrics are computed in trend-metrics.ts. Grounding is enforced in code: every item id
 * must exist, every quote must appear verbatim in the item it cites, and invalid references are dropped.
 */
import { runJsonAgent } from '../../content/autopilot/json-agent';
import type { AutopilotLLM, UsageMeter } from '../../content/autopilot/llm';
import { UNTRUSTED_DATA_POLICY, fenceUntrusted, neutraliseUntrustedText, sanitizeInlineUntrusted } from '@workspace/video-contracts';
import { AnalystOutput, AnalystOutputSchema, ResearchItem } from '../types';

const MAX_EVIDENCE_CHARS = 16_000;

/**
 * Comparison form for the verbatim check. Both the quote and the source go through the same neutraliser the
 * evidence block used (NFKC, hidden characters removed), so a quote copied from the fenced evidence still matches
 * the raw text; then case, quote marks and whitespace are ignored.
 */
const squash = (s: string) => neutraliseUntrustedText(s, Number.MAX_SAFE_INTEGER).text.toLowerCase().replace(/[“”"'’`]/g, '').replace(/\s+/g, ' ').trim();

/** Evidence block, densest-first, within a character budget. Comment ids are `${itemId}#${n}`. */
export function evidenceLines(items: ResearchItem[]): string {
    const ranked = [...items].sort((a, b) => (b.engagement.primary ?? -1) - (a.engagement.primary ?? -1));
    const out: string[] = [];
    let used = 0;
    for (const it of ranked) {
        const eng = it.engagement.primary !== null ? `${it.engagement.primary} ${it.engagement.views !== null ? 'views' : it.engagement.upvotes !== null ? 'upvotes' : 'engagements'}` : 'no engagement data';
        const body = (it.fullText || it.text || '').slice(0, it.fullText ? 1500 : 400);
        const lines = [`[${it.id}] ${it.source} | ${it.publishedAt || 'undated'} | ${eng} | ${sanitizeInlineUntrusted(it.title, 200)}`];
        if (body) lines.push(`  ${sanitizeInlineUntrusted(body, 1500)}`);
        it.comments.forEach((c, k) => lines.push(`  [${it.id}#${k + 1}] comment: ${sanitizeInlineUntrusted(c, 300)}`));
        const block = lines.join('\n');
        if (used + block.length > MAX_EVIDENCE_CHARS) break;
        out.push(block);
        used += block.length;
    }
    return out.join('\n');
}

/** Keeps only references that exist and quotes that are verbatim; returns the problems found (for the repair pass). */
export function groundAnalystOutput(value: AnalystOutput, items: ResearchItem[]): { value: AnalystOutput; problems: string[] } {
    const byId = new Map(items.map((i) => [i.id, i]));
    const commentIds = new Set(items.flatMap((i) => i.comments.map((_, k) => `${i.id}#${k + 1}`)));
    const problems: string[] = [];
    const clusters = value.clusters.map((c) => {
        const itemIds = c.itemIds.filter((id) => byId.has(id));
        if (itemIds.length < c.itemIds.length) problems.push(`cluster "${c.id}" cites unknown item ids`);
        const reactionQuotes = c.reactionQuotes.filter((q) => {
            const it = byId.get(q.itemId);
            if (!it) { problems.push(`quote cites unknown item ${q.itemId}`); return false; }
            const hay = squash([it.title, it.text, it.fullText || '', ...it.comments].join(' '));
            const ok = hay.includes(squash(q.quote));
            if (!ok) problems.push(`quote "${q.quote.slice(0, 40)}…" is not verbatim in ${q.itemId}`);
            return ok;
        });
        return { ...c, itemIds, reactionQuotes };
    }).filter((c) => c.itemIds.length > 0);
    const sentiment = value.sentiment.filter((s) => byId.has(s.id) || commentIds.has(s.id));
    if (sentiment.length < value.sentiment.length) problems.push('sentiment labels reference unknown ids');
    return { value: { ...value, clusters, sentiment, offTopicItemIds: value.offTopicItemIds.filter((id) => byId.has(id)) }, problems };
}

export async function runTrendAnalystAgent(params: {
    llm: AutopilotLLM;
    topic: string;
    rankingQuestion: string;
    brandContext: string;
    items: ResearchItem[];
    meter?: UsageMeter;
}): Promise<AnalystOutput> {
    const { value } = await runJsonAgent({
        llm: params.llm,
        role: 'trend_analyst',
        meter: params.meter,
        maxTokens: 3500,
        schema: AnalystOutputSchema,
        tolerateCheckOnRepair: true,
        system: `You are a social media trend analyst. You read real posts and comments from the last 30 days and explain what an audience cares about right now. You only use the evidence given and cite it by id. You never invent numbers, statistics or quotes. ${UNTRUSTED_DATA_POLICY}`,
        prompt: [
            `Research topic: ${sanitizeInlineUntrusted(params.topic, 200)}`,
            `Question that matters: ${sanitizeInlineUntrusted(params.rankingQuestion, 240)}`,
            '',
            'The creator (judge brand fit against this):',
            params.brandContext,
            '',
            'Evidence (each line: [id] source | date | engagement | title, then text and [id#n] comments):',
            fenceUntrusted('research', evidenceLines(params.items), { maxChars: MAX_EVIDENCE_CHARS + 2000 }).block,
            '',
            'Tasks:',
            '1. Group the on-topic evidence into 1-5 clusters (distinct stories or debates). itemIds = every item in the cluster. List items that are not about the topic in offTopicItemIds.',
            '2. For each cluster: a plain title; summary (what it is); whyNow (what happened recently that makes it timely, from the evidence); audienceQuestions people are actually asking (from the comments/posts); reactionQuotes = up to 4 SHORT quotes copied EXACTLY, word for word, from a title, text or comment, each with the itemId it came from.',
            '3. angles: 2-4 angles THIS creator could own. Each: title, tension (the belief or frustration it plays on), draftHook (first words said on camera, max 12 words, no invented figures), format (reel | carousel | text).',
            '4. brandFit: strong | partial | weak for this creator, with a one-line reason.',
            '5. sentiment: label each comment id ([id#n]) you read, and items without comments by their id: positive | negative | mixed | neutral (attitude toward the topic).',
            'Do not output any numbers about engagement, growth or popularity; they are computed separately.',
            'Return JSON only: {"clusters":[{"id":"c1","title":"","summary":"","whyNow":"","itemIds":[""],"audienceQuestions":[""],"reactionQuotes":[{"itemId":"","quote":""}],"angles":[{"title":"","tension":"","draftHook":"","format":"reel"}],"brandFit":"partial","brandFitReason":""}],"sentiment":[{"id":"","label":"neutral"}],"offTopicItemIds":[]}',
        ].join('\n'),
        check: (v) => groundAnalystOutput(v, params.items).problems,
    });
    const grounded = groundAnalystOutput(value, params.items).value;
    if (!grounded.clusters.length) throw new Error('trend analyst produced no grounded clusters');
    return grounded;
}
