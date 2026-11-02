/**
 * Shared types of the trend research engine (Trend Lab + autopilot research stage).
 *
 * Every number shown to a user is computed in code (trend-metrics.ts) from ResearchItem fields that came from a
 * source API. Models only label and write prose; they never produce a metric.
 */
import { z } from 'zod';

export type ResearchSource =
    | 'reddit' | 'hackernews' | 'polymarket' | 'github' | 'x'
    | 'youtube' | 'instagram' | 'web' | 'own_posts' | 'competitors';

export type ResearchAgentId = 'social_pulse' | 'platform_signal' | 'web_news';

/** One piece of evidence, normalised across every source. Text fields are untrusted third-party content. */
export interface ResearchItem {
    /** Stable within one research run: `${agent}:${n}`. Analyst output references items by this id. */
    id: string;
    agent: ResearchAgentId;
    source: ResearchSource;
    url: string;
    title: string;
    text: string;
    publishedAt: string | null;
    engagement: {
        /** The source's headline counter (views > upvotes > likes > volume > comments). */
        primary: number | null;
        views: number | null;
        upvotes: number | null;
        likes: number | null;
        comments: number | null;
    };
    comments: string[];
    /** Full article text when fetched (web & news agent). */
    fullText?: string;
}

export interface SourceStatus {
    agent: ResearchAgentId;
    source: ResearchSource;
    status: 'ok' | 'empty' | 'skipped' | 'error';
    detail?: string;
    items: number;
}

export interface AgentOutcome {
    agent: ResearchAgentId;
    items: ResearchItem[];
    statuses: SourceStatus[];
    /** Extra numbers the agent measured directly (e.g. YouTube upload count for saturation). */
    signals?: Partial<SaturationSignal>;
}

export interface SaturationSignal {
    /** Uploads on the topic in the window as reported by YouTube search (approximate, provider's own estimate). */
    youtubeUploads30d: number | null;
    /** Median views of the top recent uploads. */
    youtubeMedianViews: number | null;
    youtubeSampled: number;
}

// ------------------------------------------------------------------ query plan

export const PLAN_INTENTS = ['breaking_news', 'product', 'comparison', 'how_to', 'opinion', 'prediction', 'factual', 'concept'] as const;

export const QueryPlanSchema = z.object({
    intent: z.enum(PLAN_INTENTS).catch('concept'),
    /** 2-5 keyword-style queries, the first is the primary. */
    searchQueries: z.array(z.string().min(2).max(120)).min(1).max(5),
    /** Natural-language question the ranking is about. */
    rankingQuestion: z.string().min(4).max(240),
    /** 1-3 hashtags (no #) for official hashtag search. */
    hashtags: z.array(z.string().regex(/^[A-Za-z0-9_]{2,40}$/)).max(3).default([]),
    /** Words that, if a result lacks all of them, mark it off-topic (disambiguation anchors). */
    anchors: z.array(z.string().min(2).max(40)).max(5).default([]),
});
export type QueryPlan = z.infer<typeof QueryPlanSchema>;

// ------------------------------------------------------------------ analyst output

export const SENTIMENTS = ['positive', 'negative', 'mixed', 'neutral'] as const;
export const BRAND_FIT = ['strong', 'partial', 'weak'] as const;

export const AnalystClusterSchema = z.object({
    id: z.string().min(1).max(20),
    title: z.string().min(3).max(140),
    summary: z.string().min(10).max(600),
    whyNow: z.string().min(5).max(300),
    itemIds: z.array(z.string()).min(1).max(30),
    audienceQuestions: z.array(z.string().min(5).max(200)).max(6).default([]),
    /** Verbatim short quotes of what people said, each tied to the item it came from. */
    reactionQuotes: z.array(z.object({ itemId: z.string(), quote: z.string().min(3).max(240) })).max(6).default([]),
    angles: z.array(z.object({
        title: z.string().min(3).max(120),
        tension: z.string().min(5).max(240),
        draftHook: z.string().min(5).max(160),
        format: z.enum(['reel', 'carousel', 'text']).catch('reel'),
    })).min(1).max(5),
    brandFit: z.enum(BRAND_FIT).catch('partial'),
    brandFitReason: z.string().min(3).max(240),
});
export type AnalystCluster = z.infer<typeof AnalystClusterSchema>;

export const AnalystOutputSchema = z.object({
    clusters: z.array(AnalystClusterSchema).min(1).max(6),
    /** One sentiment label per comment id (`${itemId}#${n}`) or item id the analyst read. */
    sentiment: z.array(z.object({ id: z.string(), label: z.enum(SENTIMENTS) })).max(200).default([]),
    offTopicItemIds: z.array(z.string()).max(100).default([]),
});
export type AnalystOutput = z.infer<typeof AnalystOutputSchema>;

// ------------------------------------------------------------------ report

export type Verdict = 'create_now' | 'sharpen_angle' | 'wait' | 'skip';

export interface TrendMetrics {
    volume: Partial<Record<ResearchSource, number>>;
    totalItems: number;
    /** 0-100: mean within-source engagement percentile of the cluster's items. */
    engagementIndex: number;
    /** Engagement per day in the last 7 days divided by engagement per day in days 8-window (null when undated). */
    momentum: number | null;
    momentumLabel: 'rising' | 'steady' | 'cooling' | 'unknown';
    saturation: SaturationSignal & { label: 'low' | 'medium' | 'high' | 'unknown' };
    sentiment: { positive: number; negative: number; mixed: number; neutral: number; n: number };
    brandFit: number;
    opportunityScore: number;
    /** 0-100 from source coverage and sample sizes. */
    confidence: number;
    verdict: Verdict;
    verdictReasons: string[];
}

export interface ReportCluster extends Omit<AnalystCluster, 'itemIds' | 'reactionQuotes'> {
    metrics: TrendMetrics;
    items: Pick<ResearchItem, 'id' | 'source' | 'url' | 'title' | 'publishedAt' | 'engagement'>[];
    reactionQuotes: { quote: string; source: ResearchSource; url: string }[];
    /** Angles with their draft hooks scored by the deterministic HookScorer. */
    angles: (AnalystCluster['angles'][number] & { id: string; hookScore: number; hookGrade: string })[];
}

/** One of the creator's own published posts, as a multiple of their usual result on that platform. */
export interface OwnPostOutcome { format: string; multiple: number }

export interface PerformanceOutlook {
    available: boolean;
    basedOnPosts: number;
    /** Per format: the median multiple of the creator's own posts vs their usual (formats with >= 5 posts). */
    byFormat: { format: string; posts: number; medianMultiple: number; label: 'above' | 'around' | 'below' }[];
    note: string;
}

export interface TrendResearchReport {
    topic: string;
    windowDays: number;
    generatedAt: string;
    plan: QueryPlan;
    clusters: ReportCluster[];
    statuses: SourceStatus[];
    outlook: PerformanceOutlook;
    sources: { url: string; title: string; source: ResearchSource }[];
    /** How the numbers are computed, shown in the "How we calculate this" expander. */
    methodology: string[];
}
