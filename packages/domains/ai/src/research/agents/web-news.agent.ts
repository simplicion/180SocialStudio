/**
 * Research agent 3 — Web & News: recent articles from the existing web search provider (Tavily / Brave), with the
 * full readable text of the top results fetched through the trend-worker (Scrapling, SSRF-guarded, robots.txt
 * honoured) so the analyst works from the article, not a 500-character snippet.
 */
import type { WebSearchProvider, WebSearchResult } from '../../content/autopilot/research';
import type { TrendWorkerClient } from '../trend-worker.client';
import type { AgentOutcome, QueryPlan, ResearchItem, SourceStatus } from '../types';
import { onTopic } from './social-pulse.agent';

const FULL_TEXT_TOP_N = 5;

export async function runWebNewsAgent(params: { search: WebSearchProvider | null; worker: TrendWorkerClient | null; plan: QueryPlan; days: number }): Promise<AgentOutcome> {
    const { search, worker, plan, days } = params;
    if (!search) {
        return { agent: 'web_news', items: [], statuses: [{ agent: 'web_news', source: 'web', status: 'skipped', detail: 'no web search key (TAVILY_API_KEY or BRAVE_SEARCH_API_KEY)', items: 0 }] };
    }
    const batches = await Promise.all(plan.searchQueries.slice(0, 2).map((q) => search.search(q, { maxResults: 6, recencyDays: days }).catch(() => [] as WebSearchResult[])));
    const seen = new Set<string>();
    const results = batches.flat().filter((r) => !seen.has(r.url) && seen.add(r.url) && onTopic(`${r.title} ${r.snippet}`, plan.anchors)).slice(0, 10);
    const items: ResearchItem[] = results.map((r, i) => ({
        id: `web:${i + 1}`, agent: 'web_news', source: 'web', url: r.url, title: r.title.slice(0, 300), text: r.snippet.slice(0, 600),
        publishedAt: r.publishedAt && /^\d{4}-\d{2}-\d{2}/.test(r.publishedAt) ? r.publishedAt.slice(0, 10) : null,
        engagement: { primary: null, views: null, upvotes: null, likes: null, comments: null }, comments: [],
    }));
    const statuses: SourceStatus[] = [{ agent: 'web_news', source: 'web', status: items.length ? 'ok' : 'empty', detail: search.name, items: items.length }];

    if (worker && items.length) {
        try {
            const { pages } = await worker.fetchPages(items.slice(0, FULL_TEXT_TOP_N).map((i) => i.url));
            const byUrl = new Map(pages.filter((p) => p.ok).map((p) => [p.url, p]));
            for (const it of items) {
                const p = byUrl.get(it.url);
                if (p) it.fullText = p.markdown.slice(0, 6000);
            }
        } catch (e: any) {
            statuses.push({ agent: 'web_news', source: 'web', status: 'error', detail: `full-text fetch failed: ${String(e?.message || e).slice(0, 150)}`, items: 0 });
        }
    }
    return { agent: 'web_news', items, statuses };
}
