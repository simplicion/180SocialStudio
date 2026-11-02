/**
 * Research agent 2 — Platform Signal: what is working ON the platforms the creator posts to, through official APIs
 * only (no scraping):
 *   YouTube Data API   search (last N days, by view count) + video statistics + top comments, and the upload count
 *                      that feeds the saturation metric. Quota: search 100 units, videos 1, commentThreads 1 each.
 *   Instagram          hashtag top media through the project's connected business account (injected; the Graph API
 *                      allows 30 unique hashtags per 7 days per account, so callers track that).
 *   Project signals    the creator's own outlier posts and stored competitor-radar scans (injected; tenant data, never
 *                      cached across companies).
 */
import type { AgentOutcome, QueryPlan, ResearchItem, SaturationSignal, SourceStatus } from '../types';

type FetchJson = (url: string) => Promise<any>;

export interface InstagramMedia { permalink: string; caption: string; timestamp: string | null; likes: number | null; comments: number | null }

export interface PlatformSignalDeps {
    /** Server API key for public YouTube search (YOUTUBE_API_KEY). */
    youtubeApiKey?: string | null;
    /** Instagram hashtag top media via the project's connected account; absent = lane skipped. */
    instagramHashtagTopMedia?: (hashtag: string) => Promise<InstagramMedia[]>;
    /** HTTP JSON getter; injectable for tests. */
    fetchJson?: FetchJson;
}

const YT = 'https://www.googleapis.com/youtube/v3';

const defaultFetchJson: FetchJson = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
        let reason = '';
        try { reason = (await res.json())?.error?.errors?.[0]?.reason || ''; } catch { /* ignore */ }
        throw new Error(`HTTP ${res.status}${reason ? ` (${reason})` : ''}`);
    }
    return res.json();
};

const num = (v: unknown): number | null => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function median(xs: number[]): number | null {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

async function youtubeLane(plan: QueryPlan, days: number, key: string, fetchJson: FetchJson, startId: number) {
    const after = new Date(Date.now() - days * 86_400_000).toISOString();
    const q = encodeURIComponent(plan.searchQueries[0]);
    const search = await fetchJson(`${YT}/search?part=snippet&type=video&maxResults=15&order=viewCount&publishedAfter=${encodeURIComponent(after)}&q=${q}&key=${key}`);
    const ids: string[] = (search.items || []).map((i: any) => i.id?.videoId).filter(Boolean);
    const signal: SaturationSignal = { youtubeUploads30d: num(search.pageInfo?.totalResults), youtubeMedianViews: null, youtubeSampled: 0 };
    if (!ids.length) return { items: [] as ResearchItem[], signal };
    const vids = await fetchJson(`${YT}/videos?part=snippet,statistics&id=${ids.join(',')}&key=${key}`);
    const items: ResearchItem[] = (vids.items || []).map((v: any, i: number) => {
        const s = v.statistics || {};
        const views = num(s.viewCount);
        return {
            id: `platform:${startId + i}`, agent: 'platform_signal', source: 'youtube', url: `https://www.youtube.com/watch?v=${v.id}`,
            title: String(v.snippet?.title || '').slice(0, 300), text: String(v.snippet?.description || '').slice(0, 600),
            publishedAt: v.snippet?.publishedAt ? String(v.snippet.publishedAt).slice(0, 10) : null,
            engagement: { primary: views, views, upvotes: null, likes: num(s.likeCount), comments: num(s.commentCount) },
            comments: [],
        } as ResearchItem;
    });
    const views = items.map((i) => i.engagement.views).filter((v): v is number => v !== null);
    signal.youtubeMedianViews = median(views);
    signal.youtubeSampled = views.length;
    // Top comments of the three most-viewed videos, for the sentiment read. Comments may be disabled per video.
    const top = [...items].sort((a, b) => (b.engagement.views || 0) - (a.engagement.views || 0)).slice(0, 3);
    await Promise.all(top.map(async (it) => {
        try {
            const vid = it.url.split('v=')[1];
            const c = await fetchJson(`${YT}/commentThreads?part=snippet&videoId=${vid}&order=relevance&maxResults=5&textFormat=plainText&key=${key}`);
            it.comments = (c.items || []).map((t: any) => String(t.snippet?.topLevelComment?.snippet?.textDisplay || '').slice(0, 400)).filter((t: string) => t.length > 15).slice(0, 3);
        } catch { /* commentsDisabled etc.: keep the video, no comments */ }
    }));
    return { items, signal };
}

export async function runPlatformSignalAgent(params: { plan: QueryPlan; days: number; deps: PlatformSignalDeps }): Promise<AgentOutcome> {
    const { plan, days, deps } = params;
    const fetchJson = deps.fetchJson ?? defaultFetchJson;
    const items: ResearchItem[] = [];
    const statuses: SourceStatus[] = [];
    let signals: Partial<SaturationSignal> | undefined;

    const lanes: Promise<void>[] = [];
    if (deps.youtubeApiKey) {
        lanes.push(youtubeLane(plan, days, deps.youtubeApiKey, fetchJson, 1).then(
            (r) => { items.push(...r.items); signals = r.signal; statuses.push({ agent: 'platform_signal', source: 'youtube', status: r.items.length ? 'ok' : 'empty', items: r.items.length }); },
            (e) => { statuses.push({ agent: 'platform_signal', source: 'youtube', status: 'error', detail: String(e?.message || e).slice(0, 200), items: 0 }); },
        ));
    } else {
        statuses.push({ agent: 'platform_signal', source: 'youtube', status: 'skipped', detail: 'YOUTUBE_API_KEY not configured', items: 0 });
    }

    if (deps.instagramHashtagTopMedia && plan.hashtags.length) {
        const fn = deps.instagramHashtagTopMedia;
        lanes.push((async () => {
            try {
                const media = (await Promise.all(plan.hashtags.slice(0, 2).map((h) => fn(h)))).flat();
                const since = Date.now() - days * 86_400_000;
                const fresh = media.filter((m) => !m.timestamp || Date.parse(m.timestamp) >= since);
                const mapped = fresh.slice(0, 20).map((m, i) => {
                    const eng = m.likes === null && m.comments === null ? null : (m.likes || 0) + (m.comments || 0);
                    return {
                        id: `platform:${200 + i}`, agent: 'platform_signal', source: 'instagram', url: m.permalink,
                        title: m.caption.split(/\r?\n/)[0].slice(0, 200) || '(no caption)', text: m.caption.slice(0, 600),
                        publishedAt: m.timestamp ? m.timestamp.slice(0, 10) : null,
                        engagement: { primary: eng, views: null, upvotes: null, likes: m.likes, comments: m.comments }, comments: [],
                    } as ResearchItem;
                });
                items.push(...mapped);
                statuses.push({ agent: 'platform_signal', source: 'instagram', status: mapped.length ? 'ok' : 'empty', items: mapped.length });
            } catch (e: any) {
                statuses.push({ agent: 'platform_signal', source: 'instagram', status: 'error', detail: String(e?.message || e).slice(0, 200), items: 0 });
            }
        })());
    } else {
        statuses.push({ agent: 'platform_signal', source: 'instagram', status: 'skipped', detail: deps.instagramHashtagTopMedia ? 'no hashtags planned' : 'no connected Instagram business account', items: 0 });
    }

    await Promise.all(lanes);
    return { agent: 'platform_signal', items, statuses, signals };
}
