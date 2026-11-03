/**
 * Builds the trend research runner from the environment, shared by the autopilot calendar and Trend Lab.
 *
 *   TREND_WORKER_URL + TREND_WORKER_SECRET   social pulse lane + full-text article fetch
 *   TAVILY_API_KEY | BRAVE_SEARCH_API_KEY     web & news lane (optional: without them the worker's free search is used)
 *   YOUTUBE_API_KEY                           YouTube lane + saturation metric
 * Any missing piece just turns its lane off (reported in the report's statuses). Tenant-specific inputs (the
 * project's own history, its Instagram reader) are passed per call, never captured here.
 */
import type { AutopilotLLM, UsageMeter } from '../content/autopilot/llm';
import { createWebSearchProviderFromEnv, WebSearchProvider } from '../content/autopilot/research';
import type { InstagramMedia } from './agents/platform-signal.agent';
import { runTrendResearch, ResearchStage } from './research-orchestrator';
import { PrismaTrendCache, TrendCache } from './trend-cache';
import { createTrendWorkerClientFromEnv, TrendWorkerClient } from './trend-worker.client';
import type { OwnPostOutcome, TrendResearchReport } from './types';

export interface TrendResearchCall {
    llm: AutopilotLLM;
    meter?: UsageMeter;
    topic: string;
    context?: string[];
    brand: { industry: string; audience: string; promptContext: string };
    days?: number;
    ownHistory?: () => Promise<OwnPostOutcome[]>;
    instagramHashtagTopMedia?: (hashtag: string) => Promise<InstagramMedia[]>;
    /** The project's connected YouTube channel token, used when YOUTUBE_API_KEY is not set. */
    youtubeAccessToken?: () => Promise<string | null>;
    onStage?: (stage: ResearchStage, progress: number, detail?: string) => void | Promise<void>;
}

export type TrendResearchRunner = (call: TrendResearchCall) => Promise<TrendResearchReport>;

export interface TrendResearchConfig {
    worker: TrendWorkerClient | null;
    search: WebSearchProvider | null;
    youtubeApiKey: string | null;
    cache: TrendCache | null;
}

export function trendResearchConfigFromEnv(db: unknown | null, env: NodeJS.ProcessEnv = process.env): TrendResearchConfig {
    return {
        worker: createTrendWorkerClientFromEnv(env),
        search: createWebSearchProviderFromEnv(env),
        youtubeApiKey: env.YOUTUBE_API_KEY || null,
        cache: db ? new PrismaTrendCache(db) : null,
    };
}

/** Which lanes are live, for UI and logs ("YouTube off: add YOUTUBE_API_KEY"). */
export function describeLanes(cfg: TrendResearchConfig): { lane: string; on: boolean; hint?: string }[] {
    return [
        { lane: 'social_pulse', on: !!cfg.worker, hint: cfg.worker ? undefined : 'set TREND_WORKER_URL and TREND_WORKER_SECRET' },
        { lane: 'youtube', on: !!cfg.youtubeApiKey, hint: cfg.youtubeApiKey ? undefined : 'set YOUTUBE_API_KEY' },
        { lane: 'web_news', on: !!cfg.search, hint: cfg.search ? undefined : 'start the trend-worker (free search) or set TAVILY_API_KEY' },
    ];
}

export function createTrendResearchRunner(cfg: TrendResearchConfig): TrendResearchRunner {
    return (call) => runTrendResearch(
        { topic: call.topic, brand: call.brand, context: call.context, days: call.days },
        {
            llm: call.llm,
            worker: cfg.worker,
            search: cfg.search,
            platform: { youtubeApiKey: cfg.youtubeApiKey, youtubeAccessToken: call.youtubeAccessToken, instagramHashtagTopMedia: call.instagramHashtagTopMedia },
            cache: cfg.cache,
            ownHistory: call.ownHistory,
            meter: call.meter,
            onStage: call.onStage,
        },
    );
}
