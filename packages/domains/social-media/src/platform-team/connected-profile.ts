/**
 * Profile audit from the project's CONNECTED account, through each network's official API (no scraping):
 *   Instagram  {ig-user}?fields=... + {ig-user}/media (caption, type, likes, comments)
 *   Facebook   {page}?fields=... + {page}/posts (reactions, comments)
 *   YouTube    channels (snippet, branding, statistics) + latest uploads with statistics
 *   LinkedIn   no profile API for apps like ours -> PROFILE_API_UNAVAILABLE (the UI keeps manual entry)
 *
 * On top of the rubric audit of the profile fields, the recent posts give a content-consistency read: posting
 * cadence regularity, format mix, average hook strength of the opening lines, and engagement rate vs followers.
 * Every number comes from the API response or deterministic code.
 */
import { CraftPlatform, HookScorer, PlatformProfileInput, auditPlatformProfile } from '@workspace/ai/content/craft';
import { metaGraphUrl } from '../publishing/config';
import { expectOk, getDb, providerFetch } from '../publishing/http';
import { SocialTokenVault } from '../publishing/token-vault';
import { SocialDomainError, VAULT_ACCOUNT_SELECT, requireCompanyId } from '../tenant-scope';
import type { MetricsFetcher } from './post-metrics';

export interface RecentPost { text: string; publishedAt: string | null; format: 'reel' | 'carousel' | 'static' | 'text'; likes: number | null; comments: number | null; views: number | null }

export interface ConnectedProfile { input: PlatformProfileInput; followers: number | null; posts: RecentPost[] }

export interface ContentConsistency {
    postsAnalyzed: number;
    postsPerWeek: number | null;
    /** 0-100: 100 = evenly spaced posts. */
    cadenceRegularity: number | null;
    formatMix: Record<string, number>;
    avgHookScore: number | null;
    /** Median (likes + comments) / followers, in percent. */
    engagementRatePct: number | null;
    score: number | null;
    findings: string[];
}

const num = (v: unknown): number | null => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const firstLine = (t: unknown) => String(t || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 240) || '';

const defaultFetch: MetricsFetcher = async (platform, url, token, what, headers = {}) => {
    const res = await providerFetch(platform, url, { headers: { Authorization: `Bearer ${token}`, ...headers }, timeoutMs: 15_000 });
    return expectOk(platform, res, what);
};

const IG_FORMAT: Record<string, RecentPost['format']> = { VIDEO: 'reel', REELS: 'reel', CAROUSEL_ALBUM: 'carousel', IMAGE: 'static' };

async function instagram(id: string, token: string, f: MetricsFetcher): Promise<ConnectedProfile> {
    const p = await f('instagram', metaGraphUrl(`${id}?fields=username,name,biography,website,followers_count,media_count,profile_picture_url`, token, 'instagram'), token, 'Instagram profile');
    const media = await f('instagram', metaGraphUrl(`${id}/media?fields=caption,timestamp,media_type,media_product_type,like_count,comments_count&limit=24`, token, 'instagram'), token, 'Instagram media');
    return {
        followers: num(p.followers_count),
        input: { handle: String(p.username || ''), displayName: p.name || '', bio: p.biography || '', linkUrl: p.website || undefined, hasProfilePhoto: !!p.profile_picture_url },
        posts: (media.data || []).map((m: any) => ({
            text: String(m.caption || ''), publishedAt: m.timestamp || null,
            format: m.media_product_type === 'REELS' ? 'reel' : IG_FORMAT[m.media_type] || 'static',
            likes: num(m.like_count), comments: num(m.comments_count), views: null,
        })),
    };
}

async function facebook(id: string, token: string, f: MetricsFetcher): Promise<ConnectedProfile> {
    const p = await f('facebook', metaGraphUrl(`${id}?fields=name,username,about,description,website,fan_count,followers_count,picture{is_silhouette},cover`, token, 'facebook'), token, 'Facebook page');
    const posts = await f('facebook', metaGraphUrl(`${id}/posts?fields=message,created_time,attachments{media_type},reactions.summary(true).limit(0),comments.summary(true).limit(0)&limit=24`, token, 'facebook'), token, 'Facebook posts');
    return {
        followers: num(p.followers_count) ?? num(p.fan_count),
        input: {
            handle: String(p.username || p.name || ''), displayName: p.name || '', bio: p.about || '', about: p.description || '', linkUrl: p.website || undefined,
            hasProfilePhoto: p.picture?.data ? !p.picture.data.is_silhouette : undefined, hasBanner: !!p.cover,
        },
        posts: (posts.data || []).map((m: any) => {
            const type = String(m.attachments?.data?.[0]?.media_type || '').toLowerCase();
            return {
                text: String(m.message || ''), publishedAt: m.created_time || null,
                format: type.includes('video') ? 'reel' : type.includes('album') ? 'carousel' : type ? 'static' : 'text',
                likes: num(m.reactions?.summary?.total_count), comments: num(m.comments?.summary?.total_count), views: null,
            } as RecentPost;
        }),
    };
}

async function youtube(id: string, token: string, f: MetricsFetcher): Promise<ConnectedProfile> {
    const yt = 'https://www.googleapis.com/youtube/v3';
    const ch = (await f('youtube', `${yt}/channels?part=snippet,brandingSettings,statistics,contentDetails&id=${encodeURIComponent(id)}`, token, 'YouTube channel')).items?.[0];
    if (!ch) throw new SocialDomainError('NOT_FOUND', 404, 'YouTube returned no channel for the connected account.');
    const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
    let posts: RecentPost[] = [];
    if (uploads) {
        const list = await f('youtube', `${yt}/playlistItems?part=contentDetails&maxResults=24&playlistId=${encodeURIComponent(uploads)}`, token, 'YouTube uploads');
        const ids: string[] = (list.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
        if (ids.length) {
            const vids = await f('youtube', `${yt}/videos?part=snippet,statistics&id=${ids.map(encodeURIComponent).join(',')}`, token, 'YouTube videos');
            posts = (vids.items || []).map((v: any) => ({
                text: String(v.snippet?.title || ''), publishedAt: v.snippet?.publishedAt || null, format: 'reel',
                likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount), views: num(v.statistics?.viewCount),
            }));
        }
    }
    const s = ch.snippet || {};
    return {
        followers: ch.statistics?.hiddenSubscriberCount ? null : num(ch.statistics?.subscriberCount),
        input: {
            handle: String(s.customUrl || s.title || ''), displayName: s.title || '', bio: s.description || '', about: s.description || '',
            hasProfilePhoto: !!s.thumbnails?.default?.url, hasBanner: !!ch.brandingSettings?.image?.bannerExternalUrl,
            hasCustomUrl: !!s.customUrl, keyword: ch.brandingSettings?.channel?.keywords || undefined,
        },
        posts,
    };
}

export async function fetchConnectedProfile(platform: CraftPlatform, params: { companyId: string; projectId: string }, deps: { db?: any; getToken?: (a: any) => Promise<string>; fetchJson?: MetricsFetcher } = {}): Promise<ConnectedProfile> {
    if (platform === 'linkedin') {
        throw new SocialDomainError('PROFILE_API_UNAVAILABLE', 422, 'LinkedIn does not share profile fields with apps like this one. Fill in the fields by hand.');
    }
    const companyId = requireCompanyId(params.companyId);
    const db = deps.db ?? getDb();
    const account = await db.socialAccount.findFirst({ where: { companyId, projectId: params.projectId, platform, isActive: true }, select: VAULT_ACCOUNT_SELECT });
    if (!account?.platformAccountId) throw new SocialDomainError('ACCOUNT_REQUIRED', 409, `Connect your ${platform} account first, or fill in the fields by hand.`);
    const token = await (deps.getToken ?? ((a: any) => SocialTokenVault.getAccessToken(a)))(account);
    const f = deps.fetchJson ?? defaultFetch;
    const id = encodeURIComponent(account.platformAccountId);
    return platform === 'instagram' ? instagram(id, token, f) : platform === 'facebook' ? facebook(id, token, f) : youtube(account.platformAccountId, token, f);
}

function median(xs: number[]): number | null {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function contentConsistency(posts: RecentPost[], followers: number | null): ContentConsistency {
    const findings: string[] = [];
    const dated = posts.map((p) => Date.parse(p.publishedAt || '')).filter(Number.isFinite).sort((a, b) => b - a);
    let postsPerWeek: number | null = null, cadenceRegularity: number | null = null;
    if (dated.length >= 3) {
        const spanDays = Math.max(1, (dated[0] - dated[dated.length - 1]) / 86_400_000);
        postsPerWeek = Math.round((dated.length / spanDays) * 7 * 10) / 10;
        const gaps = dated.slice(1).map((t, i) => (dated[i] - t) / 86_400_000);
        const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
        const cv = meanGap > 0 ? Math.sqrt(gaps.reduce((a, b) => a + (b - meanGap) ** 2, 0) / gaps.length) / meanGap : 0;
        cadenceRegularity = Math.max(0, Math.min(100, Math.round(100 - cv * 50)));
        if (postsPerWeek < 2) findings.push(`You post about ${postsPerWeek} times a week. Two or more steady posts a week gives the algorithm enough to learn who to show you to.`);
        if (cadenceRegularity < 50) findings.push('Your posting is bursty (long gaps, then several posts). A steady rhythm keeps reach from resetting.');
        const daysSinceLast = (Date.now() - dated[0]) / 86_400_000;
        if (daysSinceLast > 14) findings.push(`Your last post was ${Math.round(daysSinceLast)} days ago.`);
    }
    const formatMix: Record<string, number> = {};
    for (const p of posts) formatMix[p.format] = (formatMix[p.format] || 0) + 1;
    for (const k of Object.keys(formatMix)) formatMix[k] = Math.round((formatMix[k] / Math.max(1, posts.length)) * 100);
    if (posts.length >= 6 && (formatMix.reel || 0) === 0) findings.push('No video in your recent posts. Short video reaches people who do not follow you yet.');

    const hooks = posts.map((p) => firstLine(p.text)).filter((h) => h.length > 3);
    const avgHookScore = hooks.length ? Math.round(hooks.reduce((a, h) => a + HookScorer.score(h, { spoken: false }).totalScore, 0) / hooks.length) : null;
    if (avgHookScore !== null && avgHookScore < 55) findings.push(`Your opening lines average ${avgHookScore}/100 on the hook score: most of them do not give a reason to stop scrolling. Use "Score your hook" before posting.`);

    const rates = followers && followers > 0 ? posts.map((p) => (p.likes === null && p.comments === null ? null : (((p.likes || 0) + (p.comments || 0)) / followers) * 100)).filter((r): r is number => r !== null) : [];
    const med = median(rates);
    const engagementRatePct = med === null ? null : Math.round(med * 100) / 100;
    if (engagementRatePct !== null && engagementRatePct < 1) findings.push(`A typical post gets ${engagementRatePct}% of your followers to like or comment. Under 1% usually means the content is not speaking to the people who followed you.`);

    const engagementScore = engagementRatePct === null ? null : engagementRatePct >= 3 ? 100 : engagementRatePct >= 1 ? 60 + ((engagementRatePct - 1) / 2) * 40 : Math.max(10, engagementRatePct * 60);
    const parts = [cadenceRegularity, avgHookScore, engagementScore].filter((x): x is number => x !== null);
    return {
        postsAnalyzed: posts.length, postsPerWeek, cadenceRegularity, formatMix, avgHookScore, engagementRatePct,
        score: parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null,
        findings,
    };
}

/** Rubric audit of the fetched profile fields + content consistency from recent posts. */
export async function auditConnectedProfile(platform: CraftPlatform, params: { companyId: string; projectId: string }, deps: Parameters<typeof fetchConnectedProfile>[2] = {}) {
    const profile = await fetchConnectedProfile(platform, params, deps);
    return {
        source: 'connected_account' as const,
        fields: profile.input,
        followers: profile.followers,
        audit: auditPlatformProfile(platform, profile.input),
        content: contentConsistency(profile.posts, profile.followers),
    };
}
