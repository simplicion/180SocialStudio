/**
 * runTrendResearch: the one research engine shared by Trend Lab and the autopilot calendar.
 *
 *   plan (query planner) -> [social pulse | platform signal | web & news] in parallel (cached 24h, public data)
 *   -> trend analyst (grounded clusters, quotes, angles, sentiment labels, brand fit)
 *   -> deterministic metrics + verdict per cluster -> TrendResearchReport
 *
 * A gathering agent that fails is reported in `statuses` and the rest continue. Only a missing LLM or an analyst
 * failure fails the run (there is no canned fallback for analysis).
 */
import { HookScorer } from '../content/craft';
import { AutopilotError, AutopilotLLM, UsageMeter } from '../content/autopilot/llm';
import type { WebSearchProvider } from '../content/autopilot/research';
import { runPlatformSignalAgent, PlatformSignalDeps } from './agents/platform-signal.agent';
import { runSocialPulseAgent } from './agents/social-pulse.agent';
import { runTrendAnalystAgent } from './agents/trend-analyst.agent';
import { runWebNewsAgent } from './agents/web-news.agent';
import { planResearch } from './query-planner';
import { TREND_CACHE_TTL_MS, TrendCache, trendCacheKey } from './trend-cache';
import { computeClusterMetrics, METHODOLOGY, sourcePercentiles } from './trend-metrics';
import type { TrendWorkerClient } from './trend-worker.client';
import type {
    AgentOutcome, OwnPostOutcome, PerformanceOutlook, ReportCluster, ResearchAgentId, ResearchItem, SaturationSignal, SourceStatus, TrendResearchReport,
} from './types';

export type ResearchStage = 'planning' | 'gathering' | 'social_pulse' | 'platform_signal' | 'web_news' | 'analyst' | 'done';

export interface TrendResearchInput {
    topic: string;
    brand: { industry: string; audience: string; promptContext: string };
    /** Extra user context for the planner (calendar goals, directives, reference excerpt). */
    context?: string[];
    days?: number;
}

export interface TrendResearchDeps {
    llm: AutopilotLLM | null;
    worker: TrendWorkerClient | null;
    search: WebSearchProvider | null;
    platform: PlatformSignalDeps;
    cache?: TrendCache | null;
    /** The project's own published posts as multiples of its usual result (tenant data, never cached). */
    ownHistory?: () => Promise<OwnPostOutcome[]>;
    meter?: UsageMeter;
    onStage?: (stage: ResearchStage, progress: number, detail?: string) => void | Promise<void>;
    now?: () => Date;
}

export function performanceOutlook(history: OwnPostOutcome[]): PerformanceOutlook {
    const usable = history.filter((h) => Number.isFinite(h.multiple) && h.multiple >= 0);
    if (usable.length < 10) {
        return { available: false, basedOnPosts: usable.length, byFormat: [], note: `Not enough history yet: ${usable.length} of 10 published posts with metrics.` };
    }
    const groups = new Map<string, number[]>();
    for (const h of usable) (groups.get(h.format) || groups.set(h.format, []).get(h.format)!).push(h.multiple);
    const byFormat = [...groups].filter(([, xs]) => xs.length >= 5).map(([format, xs]) => {
        const s = [...xs].sort((a, b) => a - b);
        const m = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
        const medianMultiple = Math.round(m * 100) / 100;
        return { format, posts: xs.length, medianMultiple, label: (medianMultiple >= 1.2 ? 'above' : medianMultiple <= 0.8 ? 'below' : 'around') as 'above' | 'around' | 'below' };
    });
    return { available: byFormat.length > 0, basedOnPosts: usable.length, byFormat, note: byFormat.length ? 'Each format compared with your usual result on the same platform.' : 'No format has 5 or more posts with metrics yet.' };
}

const failed = (agent: ResearchAgentId, err: unknown): AgentOutcome => ({
    agent, items: [], statuses: [{ agent, source: agent === 'web_news' ? 'web' : agent === 'platform_signal' ? 'youtube' : 'hackernews', status: 'error', detail: String((err as any)?.message || err).slice(0, 200), items: 0 }],
});

/** Gives every item a run-unique id (cached outcomes from different runs could collide otherwise). */
function reindex(outcomes: AgentOutcome[]): ResearchItem[] {
    const prefix: Record<ResearchAgentId, string> = { social_pulse: 'p', platform_signal: 's', web_news: 'w' };
    return outcomes.flatMap((o) => o.items.map((it, i) => ({ ...it, id: `${prefix[o.agent]}${i + 1}` })));
}

export async function runTrendResearch(input: TrendResearchInput, deps: TrendResearchDeps): Promise<TrendResearchReport> {
    if (!deps.llm) throw new AutopilotError('AI_NOT_CONFIGURED', 'Trend research needs an AI provider for the analyst.');
    const now = deps.now?.() ?? new Date();
    const days = input.days ?? 30;
    const stage = async (s: ResearchStage, p: number, d?: string) => { await deps.onStage?.(s, p, d); };

    await stage('planning', 5, 'Planning searches for your topic');
    const { plan } = await planResearch({ topic: input.topic, industry: input.brand.industry, audience: input.brand.audience, context: input.context }, deps.llm, deps.meter);

    const lanes = [deps.worker ? 'worker' : '', deps.search ? `web:${deps.search.name}` : '', deps.platform.youtubeApiKey ? 'youtube' : '', deps.platform.instagramHashtagTopMedia ? 'instagram' : ''].filter(Boolean);
    const key = trendCacheKey({ searchQueries: plan.searchQueries, hashtags: plan.hashtags, days, lanes });
    let outcomes = deps.cache ? await deps.cache.get(key) : null;
    const cached = !!outcomes;
    if (!outcomes) {
        await stage('gathering', 15, 'Social pulse, platform and web research agents are working');
        let done = 0;
        const track = async <T>(agent: ResearchStage, p: Promise<T>) => {
            const r = await p;
            done += 1;
            await stage(agent, 15 + done * 18, `${done}/3 research agents finished`);
            return r;
        };
        outcomes = await Promise.all([
            track('social_pulse', runSocialPulseAgent({ worker: deps.worker, topic: input.topic, plan, days }).catch((e) => failed('social_pulse', e))),
            track('platform_signal', runPlatformSignalAgent({ plan, days, deps: deps.platform }).catch((e) => failed('platform_signal', e))),
            track('web_news', runWebNewsAgent({ search: deps.search, worker: deps.worker, plan, days }).catch((e) => failed('web_news', e))),
        ]);
        // Cache only when something was found and nothing errored, so a transient outage is not served for a day.
        const anyItems = outcomes.some((o) => o.items.length);
        const anyError = outcomes.some((o) => o.statuses.some((s) => s.status === 'error'));
        if (deps.cache && anyItems && !anyError) await deps.cache.set(key, outcomes, TREND_CACHE_TTL_MS);
    }

    const statuses: SourceStatus[] = outcomes.flatMap((o) => o.statuses);
    const items = reindex(outcomes);
    const saturation: Partial<SaturationSignal> | undefined = outcomes.find((o) => o.agent === 'platform_signal')?.signals;
    const history = deps.ownHistory ? await deps.ownHistory().catch(() => [] as OwnPostOutcome[]) : [];
    const outlook = performanceOutlook(history);
    const base = { topic: input.topic, windowDays: days, generatedAt: now.toISOString(), plan, statuses, outlook, methodology: METHODOLOGY };

    if (!items.length) {
        await stage('done', 100, 'No recent discussion found');
        return { ...base, clusters: [], sources: [] };
    }

    await stage('analyst', 75, cached ? 'Analyst agent is reading cached research' : 'Analyst agent is reading what people said');
    const analysis = await runTrendAnalystAgent({ llm: deps.llm, topic: input.topic, rankingQuestion: plan.rankingQuestion, brandContext: input.brand.promptContext, items, meter: deps.meter });

    const offTopic = new Set(analysis.offTopicItemIds);
    const byId = new Map(items.map((i) => [i.id, i]));
    const percentiles = sourcePercentiles(items.filter((i) => !offTopic.has(i.id)));
    const clusters: ReportCluster[] = analysis.clusters.map((c) => {
        const clusterItems = c.itemIds.filter((id) => !offTopic.has(id)).map((id) => byId.get(id)!).filter(Boolean);
        const ids = new Set(clusterItems.map((i) => i.id));
        const labels = analysis.sentiment.filter((s) => ids.has(s.id.split('#')[0])).map((s) => s.label);
        const metrics = computeClusterMetrics({ cluster: clusterItems, percentiles, saturation, sentimentLabels: labels, brandFit: c.brandFit, now, windowDays: days });
        return {
            id: c.id, title: c.title, summary: c.summary, whyNow: c.whyNow, audienceQuestions: c.audienceQuestions, brandFit: c.brandFit, brandFitReason: c.brandFitReason,
            metrics,
            items: clusterItems.map((i) => ({ id: i.id, source: i.source, url: i.url, title: i.title, publishedAt: i.publishedAt, engagement: i.engagement })),
            reactionQuotes: c.reactionQuotes.map((q) => ({ quote: q.quote, source: byId.get(q.itemId)!.source, url: byId.get(q.itemId)!.url })),
            angles: c.angles.map((a, k) => {
                const ev = HookScorer.score(a.draftHook, a.format === 'reel' ? {} : { spoken: false });
                return { ...a, id: `${c.id}-a${k + 1}`, hookScore: ev.totalScore, hookGrade: ev.grade };
            }),
        };
    }).filter((c) => c.items.length > 0).sort((a, b) => b.metrics.opportunityScore - a.metrics.opportunityScore);

    const seen = new Set<string>();
    const sources = clusters.flatMap((c) => c.items).filter((i) => !seen.has(i.url) && seen.add(i.url)).map((i) => ({ url: i.url, title: i.title, source: i.source }));
    await stage('done', 100, `${clusters.length} trend${clusters.length === 1 ? '' : 's'} found`);
    return { ...base, clusters, sources };
}
