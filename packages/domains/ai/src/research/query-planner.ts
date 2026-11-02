/**
 * Turns what the user typed (a Trend Lab topic, or a calendar's campaign name / goals / directives / reference)
 * plus the brand into keyword queries, a ranking question, hashtags and disambiguation anchors.
 *
 * One small LLM call; if it fails, a deterministic plan from the topic text is used so research still runs.
 */
import { runJsonAgent } from '../content/autopilot/json-agent';
import type { AutopilotLLM, UsageMeter } from '../content/autopilot/llm';
import { UNTRUSTED_DATA_POLICY, fenceUntrusted, sanitizeInlineUntrusted } from '@workspace/video-contracts';
import { QueryPlan, QueryPlanSchema } from './types';
import type { WorkerPlan } from './trend-worker.client';

export interface PlannerInput {
    /** The topic to research. For the calendar this is built from campaign name + goals + directives. */
    topic: string;
    industry: string;
    audience: string;
    /** Extra user context (goals, structure directives, reference excerpt). Untrusted: fenced. */
    context?: string[];
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'with', 'about', 'how', 'what', 'why', 'is', 'are', 'my', 'our', 'your', 'content', 'posts', 'videos']);

export function normaliseTopic(topic: string): string {
    return topic.toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Deterministic plan: keyword form of the topic, a broader industry query, hashtags from the keywords. */
export function fallbackPlan(input: PlannerInput): QueryPlan {
    const words = normaliseTopic(input.topic).split(' ').filter((w) => w.length > 1 && !STOP.has(w));
    const primary = words.slice(0, 8).join(' ') || normaliseTopic(input.topic).slice(0, 120) || 'trends';
    const industry = normaliseTopic(input.industry).split(' ').filter((w) => !STOP.has(w)).slice(0, 4).join(' ');
    const queries = [primary, industry && !primary.includes(industry) ? `${primary.split(' ').slice(0, 3).join(' ')} ${industry}`.trim() : ''].filter((q) => q.length >= 2);
    // Very short tags ("ai", "seo") are too generic to say anything about a niche; require 4+ characters.
    const hashtags = Array.from(new Set([words.slice(0, 2).join(''), words[0]].filter((h) => h && /^[a-z0-9_]{4,40}$/.test(h)))).slice(0, 2);
    return { intent: 'concept', searchQueries: queries.length ? queries : ['trends'], rankingQuestion: `What are people discussing about ${input.topic.slice(0, 200)}?`, hashtags, anchors: [] };
}

export async function planResearch(input: PlannerInput, llm: AutopilotLLM | null, meter?: UsageMeter): Promise<{ plan: QueryPlan; planner: 'llm' | 'fallback' }> {
    if (!llm) return { plan: fallbackPlan(input), planner: 'fallback' };
    try {
        const { value } = await runJsonAgent({
            llm,
            role: 'query_planner',
            meter,
            maxTokens: 600,
            schema: QueryPlanSchema,
            system: `You plan social-media trend research. You write short keyword queries the way posts are titled on Reddit, YouTube and news sites. ${UNTRUSTED_DATA_POLICY}`,
            prompt: [
                `Topic to research: ${sanitizeInlineUntrusted(input.topic, 200)}`,
                `Brand industry: ${sanitizeInlineUntrusted(input.industry, 120)}`,
                `Audience: ${sanitizeInlineUntrusted(input.audience, 200)}`,
                input.context?.length ? fenceUntrusted('document', input.context.join('\n'), { label: 'user context', maxChars: 2000 }).block : '',
                '',
                'Rules:',
                '- searchQueries: 2-5 concise keyword queries. The first is the core topic. Add the angles THIS audience would search. Never add years, months, "news", "latest" or "trends".',
                '- If a word is ambiguous (a brand name that is also a common word), add the disambiguating context to every query and list it in anchors.',
                '- rankingQuestion: one natural question describing what matters to this audience.',
                '- hashtags: 1-3 real, specific hashtags people use for this topic (letters/digits/underscore, no #).',
                '- intent: breaking_news | product | comparison | how_to | opinion | prediction | factual | concept.',
                'Return JSON only: {"intent":"","searchQueries":[""],"rankingQuestion":"","hashtags":[""],"anchors":[]}',
            ].filter(Boolean).join('\n'),
        });
        return { plan: value, planner: 'llm' };
    } catch {
        return { plan: fallbackPlan(input), planner: 'fallback' };
    }
}

const FRESHNESS: Record<string, WorkerPlan['freshness_mode']> = { breaking_news: 'strict_recent', prediction: 'strict_recent', concept: 'evergreen_ok', how_to: 'evergreen_ok' };
const CLUSTER: Record<string, WorkerPlan['cluster_mode']> = { breaking_news: 'story', comparison: 'debate', opinion: 'debate', prediction: 'market', how_to: 'workflow' };

/** Converts our plan to last30days' --plan format. The worker restricts sources to the lanes it may use. */
export function toWorkerPlan(plan: QueryPlan, sources: string[]): WorkerPlan {
    const weights = [1, 0.8, 0.6, 0.5];
    return {
        intent: plan.intent,
        freshness_mode: FRESHNESS[plan.intent] ?? 'balanced_recent',
        cluster_mode: CLUSTER[plan.intent] ?? 'none',
        subqueries: plan.searchQueries.slice(0, 4).map((q, i) => ({
            label: i === 0 ? 'primary' : `angle${i}`,
            search_query: q,
            ranking_query: i === 0 ? plan.rankingQuestion : `${plan.rankingQuestion} (${q})`.slice(0, 240),
            sources,
            weight: weights[i],
        })),
    };
}
