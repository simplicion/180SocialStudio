/**
 * Typed client for services/trend-worker. The contract mirrors services/trend-worker/app/models.py.
 * When TREND_WORKER_URL is unset or the worker is down, callers get null/`unavailable` and the research engine
 * degrades to the agents that do not need it; nothing throws into the calendar or Trend Lab flow.
 */

export interface WorkerEngagement { primary: number | null; upvotes: number | null; comments: number | null; views: number | null; likes: number | null; volume: number | null }
export interface WorkerPulseItem { source: string; url: string; title: string; text: string; publishedAt: string | null; engagement: WorkerEngagement; relevance: number | null; cluster: string | null; topComments: string[] }
export interface WorkerPulseResponse { topic: string; windowDays: number; engine: 'last30days' | 'native'; sourceStatus: Record<string, string>; items: WorkerPulseItem[]; clusters: { title: string; summary: string; sources: string[]; engagementTotal: number | null }[]; warnings: string[] }
export interface WorkerFetchedPage { url: string; ok: boolean; error: string | null; finalUrl: string | null; status: number | null; title: string; markdown: string; truncated: boolean; rendered?: boolean }
export interface WorkerSearchResult { title: string; url: string; snippet: string; publishedAt: string | null; source: string; engine: 'searxng' | 'ddgs'; kind: 'news' | 'web' }
export interface WorkerSearchResponse { results: WorkerSearchResult[]; engines: string[]; warnings: string[] }

/** Plan shape last30days expects (see services/trend-worker/app/models.py QueryPlan). */
export interface WorkerPlan {
    intent: string;
    freshness_mode: 'strict_recent' | 'balanced_recent' | 'evergreen_ok';
    cluster_mode: 'story' | 'debate' | 'market' | 'workflow' | 'none';
    subqueries: { label: string; search_query: string; ranking_query: string; sources: string[]; weight: number }[];
}

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export class TrendWorkerError extends Error {
    constructor(message: string, readonly status?: number) { super(message); this.name = 'TrendWorkerError'; }
}

export class TrendWorkerClient {
    constructor(
        private readonly baseUrl: string,
        private readonly secret: string,
        private readonly fetchImpl: FetchLike = (globalThis as any).fetch,
    ) {}

    private async post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
        let lastErr: unknown;
        // One retry on transient failures (busy worker, connection reset); validation errors are not retried.
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': this.secret },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(timeoutMs),
                });
                if (res.ok) return (await res.json()) as T;
                if (res.status !== 429 && res.status < 500) throw new TrendWorkerError(`trend-worker ${path} rejected the request (HTTP ${res.status})`, res.status);
                lastErr = new TrendWorkerError(`trend-worker ${path} HTTP ${res.status}`, res.status);
            } catch (err) {
                if (err instanceof TrendWorkerError && err.status && err.status !== 429 && err.status < 500) throw err;
                lastErr = err;
            }
            if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
        }
        throw lastErr instanceof Error ? lastErr : new TrendWorkerError(String(lastErr));
    }

    pulse(params: { topic: string; days?: number; plan?: WorkerPlan; maxItems?: number; withComments?: boolean }): Promise<WorkerPulseResponse> {
        // last30days can take ~70 s on a cold topic; the worker itself caps at 90 s.
        return this.post('/pulse', { topic: params.topic, days: params.days ?? 30, plan: params.plan, maxItems: params.maxItems ?? 40, withComments: params.withComments ?? true }, 120_000);
    }

    fetchPages(urls: string[]): Promise<{ pages: WorkerFetchedPage[] }> {
        // Up to ~35 s when a JavaScript-only page falls back to the Chromium render.
        return this.post('/fetch', { urls: urls.slice(0, 6) }, 60_000);
    }

    /** Keyless web & news search (SearXNG or the ddgs metasearch library on the worker). */
    search(params: { queries: string[]; days?: number; maxResults?: number }): Promise<WorkerSearchResponse> {
        return this.post('/search', { queries: params.queries.slice(0, 3), days: params.days ?? 30, maxResults: params.maxResults ?? 6 }, 60_000);
    }
}

export function createTrendWorkerClientFromEnv(env: NodeJS.ProcessEnv = process.env): TrendWorkerClient | null {
    if (!env.TREND_WORKER_URL || !env.TREND_WORKER_SECRET) return null;
    return new TrendWorkerClient(env.TREND_WORKER_URL, env.TREND_WORKER_SECRET);
}
