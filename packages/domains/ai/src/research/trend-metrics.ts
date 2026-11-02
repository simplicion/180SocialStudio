/**
 * Deterministic trend metrics. EVERY number on a Trend Report comes from here, computed from source data; the
 * analyst model only groups items and labels sentiment/brand fit. The formulas are also returned as plain
 * sentences (METHODOLOGY) for the "How we calculate this" expander, so users can see exactly what a score means.
 */
import type { ResearchItem, ResearchSource, SaturationSignal, TrendMetrics, Verdict } from './types';

export const METHODOLOGY = [
    'Engagement index (0-100): each post is ranked against the other posts found on the same platform in this research (a Reddit post is only compared with Reddit posts, a YouTube video with YouTube videos); the index is the average rank of the posts in this topic.',
    'Momentum: posts per day in the last 7 days compared with posts per day earlier in the window. Above 1.5x is "rising", below 0.67x is "cooling". Needs at least 2 dated posts on each side, otherwise "unknown".',
    'Saturation: how many YouTube videos on this topic were uploaded in the window (YouTube\'s own estimate). Under 200 is low, under 2,000 medium, above that high.',
    'Sentiment: each comment or post we read is labelled positive, negative, mixed or neutral; the shares are counted from those labels and shown with the sample size.',
    'Brand fit: strong = 85, partial = 55, weak = 20, from how directly the topic serves your audience and positioning.',
    'Opportunity (0-100) = 35% engagement index + 25% momentum (rising 90, steady 60, cooling 25, unknown 50) + 15% room to stand out (100 minus saturation: low 20, medium 50, high 85, unknown 50) + 25% brand fit.',
    'Confidence (0-100) = half from how many different platforms had evidence (3 or more = full) and half from how many posts we found (12 or more = full).',
    'Performance outlook compares your own past posts in the same format with your usual results; it is only shown when you have at least 10 published posts with metrics.',
];

const DAY = 86_400_000;

/** Percentile (0-100) of every item's primary engagement among items of the same source in this research. */
export function sourcePercentiles(items: ResearchItem[]): Map<string, number> {
    const bySource = new Map<ResearchSource, ResearchItem[]>();
    for (const it of items) if (it.engagement.primary !== null) (bySource.get(it.source) || bySource.set(it.source, []).get(it.source)!).push(it);
    const out = new Map<string, number>();
    for (const group of bySource.values()) {
        const sorted = [...group].sort((a, b) => (a.engagement.primary as number) - (b.engagement.primary as number));
        sorted.forEach((it, i) => out.set(it.id, group.length === 1 ? 50 : Math.round((i / (group.length - 1)) * 100)));
    }
    return out;
}

export function engagementIndex(cluster: ResearchItem[], percentiles: Map<string, number>): number {
    const ps = cluster.map((i) => percentiles.get(i.id)).filter((p): p is number => p !== undefined);
    return ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : 0;
}

export function momentum(cluster: ResearchItem[], now: Date, windowDays: number): { ratio: number | null; label: TrendMetrics['momentumLabel'] } {
    if (windowDays <= 7) return { ratio: null, label: 'unknown' };
    let recent = 0, earlier = 0;
    for (const it of cluster) {
        if (!it.publishedAt) continue;
        const age = (now.getTime() - Date.parse(`${it.publishedAt.slice(0, 10)}T00:00:00Z`)) / DAY;
        if (!Number.isFinite(age) || age < -1 || age > windowDays) continue;
        if (age <= 7) recent++; else earlier++;
    }
    if (recent < 2 || earlier < 2) return { ratio: null, label: 'unknown' };
    const ratio = Math.round(((recent / 7) / (earlier / (windowDays - 7))) * 100) / 100;
    return { ratio, label: ratio >= 1.5 ? 'rising' : ratio <= 0.67 ? 'cooling' : 'steady' };
}

export function saturationLabel(s: Partial<SaturationSignal> | undefined): TrendMetrics['saturation']['label'] {
    const n = s?.youtubeUploads30d;
    if (n === null || n === undefined) return 'unknown';
    return n < 200 ? 'low' : n < 2000 ? 'medium' : 'high';
}

export function sentimentShares(labels: string[]): TrendMetrics['sentiment'] {
    const n = labels.length;
    const share = (l: string) => (n ? Math.round((labels.filter((x) => x === l).length / n) * 100) : 0);
    return { positive: share('positive'), negative: share('negative'), mixed: share('mixed'), neutral: share('neutral'), n };
}

export const BRAND_FIT_SCORE = { strong: 85, partial: 55, weak: 20 } as const;
const MOMENTUM_SCORE = { rising: 90, steady: 60, cooling: 25, unknown: 50 } as const;
const SATURATION_SCORE = { low: 20, medium: 50, high: 85, unknown: 50 } as const;

export function opportunityScore(p: { engagementIndex: number; momentumLabel: TrendMetrics['momentumLabel']; saturationLabel: TrendMetrics['saturation']['label']; brandFit: number }): number {
    return Math.round(0.35 * p.engagementIndex + 0.25 * MOMENTUM_SCORE[p.momentumLabel] + 0.15 * (100 - SATURATION_SCORE[p.saturationLabel]) + 0.25 * p.brandFit);
}

export function confidenceScore(cluster: ResearchItem[]): number {
    const sources = new Set(cluster.map((i) => i.source)).size;
    return Math.round(100 * (0.5 * Math.min(1, sources / 3) + 0.5 * Math.min(1, cluster.length / 12)));
}

export function decideVerdict(m: Omit<TrendMetrics, 'verdict' | 'verdictReasons'>, brandFitLabel: 'strong' | 'partial' | 'weak'): { verdict: Verdict; reasons: string[] } {
    const reasons: string[] = [];
    if (brandFitLabel === 'weak') return { verdict: 'skip', reasons: ['The topic is popular, but it does not serve your audience or positioning.'] };
    if (m.confidence < 30) return { verdict: 'wait', reasons: [`Too little evidence yet (${m.totalItems} posts across ${Object.keys(m.volume).length} platforms). Check again in a few days.`] };
    if (m.momentumLabel === 'rising') reasons.push(`Rising: ${m.momentum}x more posts per day this week than earlier in the month.`);
    if (m.momentumLabel === 'cooling') reasons.push('Cooling: fewer posts per day this week than earlier in the month.');
    if (m.saturation.label === 'high') reasons.push('Crowded: many creators already covered it, so a generic take will get lost.');
    if (m.saturation.label === 'low') reasons.push('Room to stand out: few recent videos on it.');
    if (m.engagementIndex >= 60) reasons.push('The posts on this topic are among the most engaged in what we found.');
    if (m.sentiment.n >= 5 && m.sentiment.negative + m.sentiment.mixed >= 50) reasons.push(`Opinions are split (${m.sentiment.negative}% negative, ${m.sentiment.mixed}% mixed of ${m.sentiment.n}), which suits a clear point of view.`);
    if (m.opportunityScore >= 65 && m.saturation.label !== 'high') return { verdict: 'create_now', reasons };
    if (m.opportunityScore >= 45) return { verdict: 'sharpen_angle', reasons: reasons.length ? reasons : ['Worth covering with a specific angle rather than a general overview.'] };
    if (m.momentumLabel === 'cooling') return { verdict: 'skip', reasons };
    return { verdict: 'wait', reasons: reasons.length ? reasons : ['Engagement is modest so far.'] };
}

export function computeClusterMetrics(params: {
    cluster: ResearchItem[];
    percentiles: Map<string, number>;
    saturation: Partial<SaturationSignal> | undefined;
    sentimentLabels: string[];
    brandFit: 'strong' | 'partial' | 'weak';
    now: Date;
    windowDays: number;
}): TrendMetrics {
    const { cluster } = params;
    const volume: Partial<Record<ResearchSource, number>> = {};
    for (const it of cluster) volume[it.source] = (volume[it.source] || 0) + 1;
    const eIdx = engagementIndex(cluster, params.percentiles);
    const mom = momentum(cluster, params.now, params.windowDays);
    const satLabel = saturationLabel(params.saturation);
    const brandFit = BRAND_FIT_SCORE[params.brandFit];
    const base = {
        volume,
        totalItems: cluster.length,
        engagementIndex: eIdx,
        momentum: mom.ratio,
        momentumLabel: mom.label,
        saturation: {
            youtubeUploads30d: params.saturation?.youtubeUploads30d ?? null,
            youtubeMedianViews: params.saturation?.youtubeMedianViews ?? null,
            youtubeSampled: params.saturation?.youtubeSampled ?? 0,
            label: satLabel,
        },
        sentiment: sentimentShares(params.sentimentLabels),
        brandFit,
        opportunityScore: opportunityScore({ engagementIndex: eIdx, momentumLabel: mom.label, saturationLabel: satLabel, brandFit }),
        confidence: confidenceScore(cluster),
    };
    const v = decideVerdict(base, params.brandFit);
    return { ...base, verdict: v.verdict, verdictReasons: v.reasons };
}
