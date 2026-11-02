/**
 * Research agent 1 — Social Pulse: what communities engaged with in the window, ranked by upvotes, comments and
 * money (last30days via services/trend-worker: Hacker News, Polymarket, GitHub; X and Reddit through official APIs
 * when their credentials are configured on the worker). Comments come along for the sentiment read.
 */
import type { TrendWorkerClient, WorkerPulseItem } from '../trend-worker.client';
import { toWorkerPlan } from '../query-planner';
import type { AgentOutcome, QueryPlan, ResearchItem, ResearchSource, SourceStatus } from '../types';

const KNOWN: Record<string, ResearchSource> = { reddit: 'reddit', hackernews: 'hackernews', hn: 'hackernews', polymarket: 'polymarket', github: 'github', x: 'x' };
/** Every lane the worker may run; it drops the ones it is not configured for. */
const REQUESTED_SOURCES = ['reddit', 'hackernews', 'polymarket', 'github', 'x'];

/** Drops results that mention none of the disambiguation anchors (e.g. "Loom" the app vs looms). */
export function onTopic(text: string, anchors: string[]): boolean {
    if (!anchors.length) return true;
    const t = text.toLowerCase();
    return anchors.some((a) => t.includes(a.toLowerCase()));
}

export function mapPulseItem(it: WorkerPulseItem, n: number): ResearchItem | null {
    const source = KNOWN[it.source];
    if (!source) return null;
    const e = it.engagement || ({} as WorkerPulseItem['engagement']);
    return {
        id: `pulse:${n}`,
        agent: 'social_pulse',
        source,
        url: it.url,
        title: it.title,
        text: it.text || '',
        publishedAt: it.publishedAt || null,
        engagement: { primary: e.primary ?? null, views: e.views ?? null, upvotes: e.upvotes ?? null, likes: e.likes ?? null, comments: e.comments ?? null },
        comments: (it.topComments || []).slice(0, 3),
    };
}

export async function runSocialPulseAgent(params: { worker: TrendWorkerClient | null; topic: string; plan: QueryPlan; days: number }): Promise<AgentOutcome> {
    if (!params.worker) {
        return { agent: 'social_pulse', items: [], statuses: [{ agent: 'social_pulse', source: 'hackernews', status: 'skipped', detail: 'trend-worker not configured', items: 0 }] };
    }
    const res = await params.worker.pulse({ topic: params.topic, days: params.days, plan: toWorkerPlan(params.plan, REQUESTED_SOURCES), maxItems: 40, withComments: true });
    const items: ResearchItem[] = [];
    for (const raw of res.items) {
        const mapped = mapPulseItem(raw, items.length + 1);
        if (mapped && onTopic(`${mapped.title} ${mapped.text}`, params.plan.anchors)) items.push(mapped);
    }
    const statuses: SourceStatus[] = Object.entries(res.sourceStatus).flatMap(([src, st]) => {
        const source = KNOWN[src];
        if (!source) return [];
        const count = items.filter((i) => i.source === source).length;
        const status: SourceStatus['status'] = st === 'ok' ? (count ? 'ok' : 'empty') : st === 'disabled' ? 'skipped' : 'error';
        return [{ agent: 'social_pulse' as const, source, status, detail: st === 'ok' ? undefined : st, items: count }];
    });
    return { agent: 'social_pulse', items, statuses };
}
