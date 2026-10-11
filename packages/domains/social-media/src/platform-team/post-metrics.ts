/**
 * Per-post metrics for published posts, read from each network's official API with the account's vault token and
 * stored on the variant (`platformMeta.metrics`), so the app can rank the creator's own posts without typing
 * numbers in.
 *
 *   Instagram  GET /{media-id}/insights (views, reach, saved, shares, likes, comments)
 *   Facebook   GET /{post-id}?fields=shares,reactions.summary,comments.summary + /insights (unique impressions)
 *   YouTube    GET /videos?part=statistics
 *   X          GET /2/tweets/{id}?tweet.fields=public_metrics
 *   LinkedIn   GET /rest/socialActions/{urn} (+ organizationalEntityShareStatistics for company pages)
 *
 * A metric the platform does not return stays null. A post that cannot be read is reported with the provider's
 * reason and keeps its previous numbers. Nothing is estimated. Every query is scoped by companyId and projectId.
 */
import { HookScorer } from '@workspace/ai/content/craft';
import { metaGraphUrl, normalizePlatform } from '../publishing/config';
import { linkedInApiVersion } from '../publishing/linkedin-version';
import { expectOk, getDb, providerFetch } from '../publishing/http';
import { SocialTokenVault } from '../publishing/token-vault';
import { SocialDomainError, VAULT_ACCOUNT_SELECT, requireCompanyId } from '../tenant-scope';

export interface PostMetrics {
    views: number | null;
    reach: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    fetchedAt: string;
    source: 'live';
}

export type MetricsFetcher = (platform: string, url: string, token: string, what: string, headers?: Record<string, string>) => Promise<any>;

const defaultFetch: MetricsFetcher = async (platform, url, token, what, headers = {}) => {
    const res = await providerFetch(platform, url, { headers: { Authorization: `Bearer ${token}`, ...headers }, timeoutMs: 12_000 });
    return expectOk(platform, res, what);
};

const n = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const empty = (now: Date): PostMetrics => ({ views: null, reach: null, likes: null, comments: null, shares: null, saves: null, fetchedAt: now.toISOString(), source: 'live' });
const insight = (data: any[], name: string): number | null => {
    const row = (data || []).find((d: any) => d?.name === name);
    if (!row) return null;
    return n(row.total_value?.value ?? row.values?.[row.values.length - 1]?.value);
};

/** Reads one post's numbers from its platform. Throws the provider error when the post cannot be read at all. */
export async function fetchPostMetrics(
    params: { platform: string; externalId: string; token: string; account: { platformAccountId: string }; now?: Date },
    fetchJson: MetricsFetcher = defaultFetch,
): Promise<PostMetrics> {
    const { externalId, token } = params;
    const platform = normalizePlatform(params.platform);
    const out = empty(params.now || new Date());
    const id = encodeURIComponent(externalId);

    if (platform === 'instagram') {
        let ins: any;
        try {
            ins = await fetchJson('instagram', metaGraphUrl(`${id}/insights?metric=views,reach,saved,shares,likes,comments`, token, 'instagram'), token, 'Instagram post insights');
        } catch {
            // Older media and some formats reject `views`/`shares`; the remaining metrics are still real.
            ins = await fetchJson('instagram', metaGraphUrl(`${id}/insights?metric=reach,saved,likes,comments`, token, 'instagram'), token, 'Instagram post insights');
        }
        return { ...out, views: insight(ins.data, 'views'), reach: insight(ins.data, 'reach'), saves: insight(ins.data, 'saved'), shares: insight(ins.data, 'shares'), likes: insight(ins.data, 'likes'), comments: insight(ins.data, 'comments') };
    }

    if (platform === 'facebook') {
        const post = await fetchJson('facebook', metaGraphUrl(`${id}?fields=shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)`, token, 'facebook'), token, 'Facebook post');
        let reach: number | null = null;
        let views: number | null = null;
        try {
            const ins = await fetchJson('facebook', metaGraphUrl(`${id}/insights?metric=post_impressions_unique,post_video_views`, token, 'facebook'), token, 'Facebook post insights');
            reach = insight(ins.data, 'post_impressions_unique');
            views = insight(ins.data, 'post_video_views');
        } catch {
            // Insights need read_insights and are not offered for every object type; counts above still stand.
        }
        return { ...out, views, reach, likes: n(post.reactions?.summary?.total_count), comments: n(post.comments?.summary?.total_count), shares: n(post.shares?.count) };
    }

    if (platform === 'youtube') {
        const r = await fetchJson('youtube', `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${id}`, token, 'YouTube video statistics');
        const s = r.items?.[0]?.statistics;
        if (!s) throw new SocialDomainError('POST_NOT_FOUND', 404, 'YouTube no longer has this video.');
        return { ...out, views: n(s.viewCount), likes: n(s.likeCount), comments: n(s.commentCount) };
    }

    if (platform === 'x') {
        const base = (process.env.X_API_BASE_URL?.trim() || 'https://api.x.com').replace(/\/+$/, '');
        const r = await fetchJson('x', `${base}/2/tweets/${id}?tweet.fields=public_metrics`, token, 'X post metrics');
        const m = r.data?.public_metrics;
        if (!m) throw new SocialDomainError('POST_NOT_FOUND', 404, 'X did not return metrics for this post.');
        return { ...out, views: n(m.impression_count), likes: n(m.like_count), comments: n(m.reply_count), shares: (n(m.retweet_count) ?? 0) + (n(m.quote_count) ?? 0), saves: n(m.bookmark_count) };
    }

    if (platform === 'linkedin') {
        const headers = { 'LinkedIn-Version': linkedInApiVersion(), 'X-Restli-Protocol-Version': '2.0.0' };
        const social = await fetchJson('linkedin', `https://api.linkedin.com/rest/socialActions/${id}`, token, 'LinkedIn post reactions', headers);
        const result: PostMetrics = { ...out, likes: n(social.likesSummary?.totalLikes), comments: n(social.commentsSummary?.aggregatedTotalComments) };
        const org = params.account.platformAccountId;
        if (/^urn:li:organization:/.test(org)) {
            try {
                const key = externalId.startsWith('urn:li:ugcPost:') ? 'ugcPosts' : 'shares';
                const stats = await fetchJson(
                    'linkedin',
                    `https://api.linkedin.com/rest/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(org)}&${key}=List(${id})`,
                    token, 'LinkedIn post statistics', headers,
                );
                const t = stats.elements?.[0]?.totalShareStatistics;
                if (t) return { ...result, views: n(t.impressionCount), reach: n(t.uniqueImpressionsCount), shares: n(t.shareCount), likes: n(t.likeCount) ?? result.likes, comments: n(t.commentCount) ?? result.comments };
            } catch {
                // Needs r_organization_social; reactions and comments above are still real.
            }
        }
        return result;
    }

    throw new SocialDomainError('PLATFORM_METRICS_UNAVAILABLE', 422, `Per-post metrics are not available for ${params.platform}.`);
}

const asObj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const accountPlatforms = (platform: string): string[] => (normalizePlatform(platform) === 'x' ? ['twitter', 'x'] : [platform]);
const isRealExternalId = (id: unknown) => typeof id === 'string' && !!id && !/^(sim_|container:|fbvideo:|pending)/i.test(id);

export interface MilestoneAchieved {
    id: string;
    type: 'views' | 'likes';
    threshold: number;
    label: string;
    achievedAt: string;
}

export const VIEW_MILESTONES = [
    { id: 'views_1m', threshold: 1_000_000, label: '1 Million Views' },
    { id: 'views_500k', threshold: 500_000, label: '500K Views' },
    { id: 'views_100k', threshold: 100_000, label: '100K Views' },
    { id: 'views_50k', threshold: 50_000, label: '50K Views' },
    { id: 'views_20k', threshold: 20_000, label: '20K Views' },
    { id: 'views_10k', threshold: 10_000, label: '10K Views' },
    { id: 'views_5k', threshold: 5_000, label: '5K Views' },
    { id: 'views_1k', threshold: 1_000, label: '1K Views' },
];

export const LIKE_MILESTONES = [
    { id: 'likes_10k', threshold: 10_000, label: '10K Likes' },
    { id: 'likes_5k', threshold: 5_000, label: '5K Likes' },
    { id: 'likes_1k', threshold: 1_000, label: '1K Likes' },
    { id: 'likes_500', threshold: 500, label: '500 Likes' },
];

export async function checkAndRecordMilestones(params: {
    post: any;
    variant: any;
    metrics: PostMetrics;
    companyId: string;
    db: any;
    now: Date;
}): Promise<MilestoneAchieved[]> {
    const { post, variant, metrics, companyId, db, now } = params;
    const meta = asObj(variant.platformMeta);
    const existing = new Set<string>((meta.milestones || []).map((m: any) => m.id));
    const newMilestones: MilestoneAchieved[] = [];

    const views = metrics.views ?? 0;
    for (const m of VIEW_MILESTONES) {
        if (views >= m.threshold && !existing.has(m.id)) {
            newMilestones.push({ id: m.id, type: 'views', threshold: m.threshold, label: m.label, achievedAt: now.toISOString() });
            existing.add(m.id);
        }
    }

    const likes = metrics.likes ?? 0;
    for (const m of LIKE_MILESTONES) {
        if (likes >= m.threshold && !existing.has(m.id)) {
            newMilestones.push({ id: m.id, type: 'likes', threshold: m.threshold, label: m.label, achievedAt: now.toISOString() });
            existing.add(m.id);
        }
    }

    if (newMilestones.length === 0) return [];

    const updatedMilestones = [...(meta.milestones || []), ...newMilestones];
    await db.socialPostVariant.updateMany({
        where: { id: variant.id, postId: post.id },
        data: { platformMeta: { ...meta, metrics, milestones: updatedMilestones } },
    });

    if (db.notification?.create && (post.createdById || post.userId)) {
        const recipientId = post.createdById || post.userId;
        for (const m of newMilestones) {
            const platformName = String(variant.platform).toUpperCase();
            const postTitle = post.title || post.content?.slice(0, 40) || 'Your video';
            const advice = m.threshold >= 10_000
                ? 'Your content is surging in the algorithm! Pin your top comments, reply to active viewers, and post a follow-up reel today to capture this viral wave.'
                : 'Great momentum! Keep interacting with viewers to boost retention and reach the next milestone.';

            await db.notification.create({
                data: {
                    userId: recipientId,
                    type: 'social_post_milestone',
                    title: `🚀 Milestone Hit: ${m.label} on ${platformName}!`,
                    message: `"${postTitle}" just crossed ${m.label}. ${advice}`,
                    link: post.projectId ? `/social-projects/${post.projectId}?post=${post.id}` : `/social-projects`,
                },
            }).catch((e: any) => console.warn('[post-metrics] milestone notification failed:', e?.message));
        }
    }

    return newMilestones;
}

export interface RefreshOutcome {
    checked: number;
    updated: number;
    skippedFresh: number;
    failed: { postId: string; platform: string; reason: string }[];
}

/**
 * Refreshes stored metrics for a project's posts published in the last `days` (default 90). Posts measured less
 * than `staleHours` ago (default 6) are skipped. Runs accounts one at a time to stay inside provider rate limits.
 */
export async function refreshProjectPostMetrics(
    params: { companyId: string; projectId: string; platform?: string; days?: number; staleHours?: number; maxPosts?: number; now?: Date },
    deps: { db?: any; fetchJson?: MetricsFetcher; getToken?: (account: any) => Promise<string> } = {},
): Promise<RefreshOutcome> {
    const companyId = requireCompanyId(params.companyId);
    const db = deps.db ?? getDb();
    const now = params.now || new Date();
    const project = await db.project.findFirst({ where: { id: params.projectId, companyId }, select: { id: true } });
    if (!project) throw new SocialDomainError('NOT_FOUND', 404, 'Project not found');

    const since = new Date(now.getTime() - (params.days ?? 90) * 86_400_000);
    const staleBefore = now.getTime() - (params.staleHours ?? 6) * 3_600_000;
    const posts: any[] = await db.socialPost.findMany({
        where: { companyId, projectId: params.projectId, status: 'published', publishedAt: { gte: since } },
        orderBy: { publishedAt: 'desc' },
        take: Math.min(params.maxPosts ?? 60, 200),
        select: {
            id: true, socialAccountId: true, createdById: true, title: true, content: true, projectId: true,
            variants: { select: { id: true, platform: true, externalId: true, publishStatus: true, platformMeta: true, socialAccountId: true } },
        },
    });
    const wanted = params.platform ? new Set(accountPlatforms(params.platform)) : null;
    const accounts = new Map<string, any>();
    const tokens = new Map<string, string | Error>();
    const getToken = deps.getToken ?? ((account: any) => SocialTokenVault.getAccessToken(account));
    const outcome: RefreshOutcome = { checked: 0, updated: 0, skippedFresh: 0, failed: [] };

    for (const post of posts) {
        for (const v of post.variants || []) {
            if (v.publishStatus !== 'published' || !isRealExternalId(v.externalId)) continue;
            if (wanted && !wanted.has(String(v.platform).toLowerCase()) && !wanted.has(normalizePlatform(v.platform) || '')) continue;
            const meta = asObj(v.platformMeta);
            const last = Date.parse(asObj(meta.metrics).fetchedAt || '');
            if (Number.isFinite(last) && last > staleBefore) { outcome.skippedFresh += 1; continue; }
            const accountId = v.socialAccountId || post.socialAccountId;
            if (!accountId) continue;
            outcome.checked += 1;
            try {
                if (!accounts.has(accountId)) {
                    accounts.set(accountId, await db.socialAccount.findFirst({ where: { id: accountId, companyId }, select: VAULT_ACCOUNT_SELECT }));
                }
                const account = accounts.get(accountId);
                if (!account) throw new Error('The account that published this post is no longer connected.');
                if (!tokens.has(accountId)) tokens.set(accountId, await getToken(account).catch((e: any) => (e instanceof Error ? e : new Error(String(e)))));
                const token = tokens.get(accountId)!;
                if (token instanceof Error) throw token;
                const metrics = await fetchPostMetrics({ platform: v.platform, externalId: v.externalId, token, account, now }, deps.fetchJson);
                await db.socialPostVariant.updateMany({ where: { id: v.id, postId: post.id }, data: { platformMeta: { ...meta, metrics } } });
                await checkAndRecordMilestones({ post, variant: v, metrics, companyId, db, now });
                outcome.updated += 1;
            } catch (err: any) {
                outcome.failed.push({ postId: post.id, platform: v.platform, reason: String(err?.message || err).slice(0, 240) });
            }
        }
    }
    return outcome;
}

export interface RankedOwnPost {
    postId: string;
    variantId: string;
    title: string | null;
    hook: string;
    url: string | null;
    publishedAt: string | null;
    metrics: PostMetrics;
    /** The number the ranking uses for this post (see `basis`). */
    value: number;
    outlierMultiple: number;
    isOutlier: boolean;
    formulaName: string | null;
}

/** Minimum measured posts before a median means anything. */
export const MIN_POSTS_FOR_BASELINE = 5;

function median(values: number[]): number {
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const firstLine = (text: string) => (text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';

/**
 * Ranks the account's own measured posts by multiple of its median. Uses views when the platform reports them,
 * else reach, else engagements (likes + comments + shares + saves); the basis is returned so the UI can say so.
 */
export async function rankOwnPosts(
    params: { companyId: string; projectId: string; platform: string; days?: number; now?: Date },
    deps: { db?: any } = {},
) {
    const companyId = requireCompanyId(params.companyId);
    const db = deps.db ?? getDb();
    const now = params.now || new Date();
    const platforms = accountPlatforms(params.platform);
    const since = new Date(now.getTime() - (params.days ?? 90) * 86_400_000);
    const posts: any[] = await db.socialPost.findMany({
        where: { companyId, projectId: params.projectId, status: 'published', publishedAt: { gte: since }, variants: { some: { platform: { in: platforms } } } },
        orderBy: { publishedAt: 'desc' },
        take: 200,
        select: {
            id: true, title: true, content: true, publishedAt: true, calendarPieceId: true,
            variants: { select: { id: true, platform: true, customContent: true, externalUrl: true, publishedAt: true, platformMeta: true } },
        },
    });
    const measured: { post: any; v: any; m: PostMetrics }[] = [];
    let published = 0;
    for (const post of posts) {
        for (const v of post.variants || []) {
            if (!platforms.includes(String(v.platform).toLowerCase())) continue;
            published += 1;
            const m = asObj(asObj(v.platformMeta).metrics);
            if (m.fetchedAt) measured.push({ post, v, m: m as PostMetrics });
        }
    }
    const engagement = (m: PostMetrics) => (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
    const has = (k: 'views' | 'reach') => measured.length > 0 && measured.filter((x) => typeof x.m[k] === 'number').length >= Math.ceil(measured.length * 0.7);
    const basis: 'views' | 'reach' | 'engagements' = has('views') ? 'views' : has('reach') ? 'reach' : 'engagements';
    const valueOf = (m: PostMetrics): number | null => (basis === 'engagements' ? engagement(m) : typeof m[basis] === 'number' ? (m[basis] as number) : null);
    const usable = measured.map((x) => ({ ...x, value: valueOf(x.m) })).filter((x): x is typeof x & { value: number } => x.value !== null);

    if (usable.length < MIN_POSTS_FOR_BASELINE) {
        return { platform: params.platform, basis, published, measured: measured.length, baseline: null, ranked: [] as RankedOwnPost[], outliers: 0, provenFormulas: [], needsMore: MIN_POSTS_FOR_BASELINE - usable.length, lastFetchedAt: latest(measured.map((x) => x.m.fetchedAt)) };
    }
    const baseline = median(usable.map((x) => x.value));
    const ranked: RankedOwnPost[] = usable.map(({ post, v, m, value }) => {
        const hook = firstLine(v.customContent || post.content || '') || (post.title || '');
        const multiple = baseline > 0 ? Math.round((value / baseline) * 10) / 10 : 0;
        return {
            postId: post.id, variantId: v.id, title: post.title || null, hook: hook.slice(0, 240), url: v.externalUrl || null,
            publishedAt: (v.publishedAt || post.publishedAt)?.toISOString?.() ?? null,
            metrics: m, value, outlierMultiple: multiple, isOutlier: multiple >= 3, formulaName: HookScorer.classifyFormula(hook)?.name ?? null,
        };
    }).sort((a, b) => b.outlierMultiple - a.outlierMultiple);
    const formulas = new Map<string, number>();
    for (const r of ranked.filter((x) => x.isOutlier && x.formulaName)) formulas.set(r.formulaName!, (formulas.get(r.formulaName!) || 0) + 1);
    return {
        platform: params.platform, basis, published, measured: measured.length, baseline, ranked,
        outliers: ranked.filter((r) => r.isOutlier).length,
        provenFormulas: Array.from(formulas, ([formulaName, count]) => ({ formulaName, count })).sort((a, b) => b.count - a.count),
        needsMore: 0,
        lastFetchedAt: latest(measured.map((x) => x.m.fetchedAt)),
    };
}

function latest(dates: (string | undefined)[]): string | null {
    const t = dates.map((d) => Date.parse(d || '')).filter(Number.isFinite);
    return t.length ? new Date(Math.max(...t)).toISOString() : null;
}

/**
 * Writes what the ranking learned into the project's agent memory (kind `performance`, one row per post), so the
 * calendar strategist sees which pillars, formats and hook types earn the most per view on the next run.
 */
export async function rememberPostPerformance(
    params: { companyId: string; projectId: string; platform: string; ranked: RankedOwnPost[] },
    deps: { db?: any } = {},
): Promise<number> {
    const db = deps.db ?? getDb();
    const { companyId, projectId } = params;
    let written = 0;
    for (const r of params.ranked.slice(0, 60)) {
        const views = r.metrics.views ?? r.metrics.reach;
        if (!views) continue; // an engagement rate needs a view or reach count
        const post = await db.socialPost.findFirst({ where: { id: r.postId, companyId, projectId }, select: { mediaType: true, calendarPieceId: true } });
        const piece = post?.calendarPieceId ? await db.calendarContentPiece.findFirst({ where: { id: post.calendarPieceId, companyId }, select: { pillar: true, videoScriptOrHooks: true } }) : null;
        let hookType: string | null = null;
        try { hookType = JSON.parse(piece?.videoScriptOrHooks || '{}')?.hookType || null; } catch { hookType = null; }
        const metrics = { views, likes: r.metrics.likes ?? 0, comments: r.metrics.comments ?? 0, shares: r.metrics.shares ?? 0, saves: r.metrics.saves ?? 0 };
        const data = {
            text: `${params.platform}${post?.mediaType ? ` ${post.mediaType}` : ''}`,
            payload: {
                platform: params.platform, format: post?.mediaType || null, pillar: piece?.pillar || null, hookType, metrics,
                engagementRate: (metrics.likes + metrics.comments + metrics.shares + metrics.saves) / views,
                outlierMultiple: r.outlierMultiple, hook: r.hook, formulaName: r.formulaName,
            },
        };
        const where = { companyId, projectId, kind: 'performance', key: `post:${r.postId}:${params.platform}` };
        const existing = await db.agentMemory.findFirst({ where });
        if (existing) await db.agentMemory.updateMany({ where: { id: existing.id, companyId, projectId }, data: { ...data, updatedAt: new Date() } });
        else await db.agentMemory.create({ data: { ...where, scope: 'strategist', weight: 1, ...data } });
        written += 1;
    }
    return written;
}

/**
 * Background refresh: every SOCIAL_POST_METRICS_INTERVAL_MS (default 3h) walks the projects that published in the
 * last 30 days, refreshes their post metrics and updates the strategist's performance memory. Safe on several
 * instances: fresh posts are skipped, so a second worker only repeats cheap reads. Disable with
 * SOCIAL_POST_METRICS_ENABLED=false.
 */
export class PostMetricsScheduler {
    private static timer: NodeJS.Timeout | null = null;
    private static running = false;

    static async tick(opts: { maxProjects?: number; now?: Date } = {}, deps: { db?: any; fetchJson?: MetricsFetcher; getToken?: (account: any) => Promise<string> } = {}) {
        const db = deps.db ?? getDb();
        const now = opts.now || new Date();
        const rows: any[] = await db.socialPost.findMany({
            where: { status: 'published', publishedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) }, projectId: { not: null } },
            distinct: ['projectId'],
            select: { projectId: true, companyId: true },
            take: opts.maxProjects ?? 200,
        });
        const result = { projects: rows.length, updated: 0, failed: 0 };
        for (const row of rows) {
            try {
                const r = await refreshProjectPostMetrics({ companyId: row.companyId, projectId: row.projectId, now }, deps);
                result.updated += r.updated;
                result.failed += r.failed.length;
                if (!r.updated) continue;
                const platforms = new Set<string>();
                const variants: any[] = await db.socialPostVariant.findMany({ where: { publishStatus: 'published', post: { companyId: row.companyId, projectId: row.projectId } }, select: { platform: true }, distinct: ['platform'] });
                for (const v of variants) platforms.add(normalizePlatform(v.platform) || v.platform);
                for (const platform of platforms) {
                    const ranked = await rankOwnPosts({ companyId: row.companyId, projectId: row.projectId, platform, now }, deps);
                    if (ranked.ranked.length) await rememberPostPerformance({ companyId: row.companyId, projectId: row.projectId, platform, ranked: ranked.ranked }, deps);
                }
            } catch (err: any) {
                result.failed += 1;
                console.error(`[PostMetricsScheduler] project ${row.projectId} failed: ${err?.message || err}`);
            }
        }
        return result;
    }

    static start(opts: { intervalMs?: number; log?: (msg: string) => void } = {}) {
        if (this.timer || process.env.SOCIAL_POST_METRICS_ENABLED === 'false') return;
        const interval = opts.intervalMs ?? (Number(process.env.SOCIAL_POST_METRICS_INTERVAL_MS) || 3 * 3_600_000);
        const log = opts.log ?? ((m: string) => console.log(m));
        const run = async () => {
            if (this.running) return;
            this.running = true;
            try {
                const r = await this.tick();
                if (r.updated || r.failed) log(`[PostMetricsScheduler] projects=${r.projects} updated=${r.updated} failed=${r.failed}`);
            } catch (e: any) {
                log(`[PostMetricsScheduler] tick failed: ${e?.message || e}`);
            } finally {
                this.running = false;
            }
        };
        this.timer = setInterval(run, interval);
        this.timer.unref?.();
        // First run a few minutes after boot so it never competes with startup.
        setTimeout(run, Math.min(interval, 5 * 60_000)).unref?.();
        log(`[PostMetricsScheduler] refreshing post metrics every ${Math.round(interval / 60_000)} min`);
    }

    static stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}
