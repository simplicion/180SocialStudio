/**
 * Competitor radar: recent public posts of accounts the creator chose to watch, read ONLY through each network's
 * official API with the project's own connected account. No scraping, no logged-out page fetching.
 *
 *   Instagram  Business Discovery (`{ig-user}?fields=business_discovery.username(handle){...media{...}}`).
 *              Works for business/creator accounts; returns likes and comments, and view counts where Meta exposes
 *              them. Needs the account connected through Facebook Login.
 *   YouTube    Data API: channels?forHandle -> uploads playlist -> videos statistics (public view counts).
 *   X          /2/users/by/username + /2/users/{id}/tweets with public_metrics (paid read access).
 *   LinkedIn, Facebook, TikTok: the platforms offer no API for other accounts' posts to apps like ours, so these
 *              return COMPETITOR_API_UNAVAILABLE and the UI keeps manual entry.
 *
 * Posts are ranked against the watched account's own median (never across accounts), on views when the API gives
 * them and on likes + comments otherwise. The basis is returned with every account.
 */
import { HookScorer } from '@workspace/ai/content/craft';
import { metaGraphUrl, normalizePlatform } from '../publishing/config';
import { getDb } from '../publishing/http';
import { SocialTokenVault } from '../publishing/token-vault';
import { SocialDomainError, VAULT_ACCOUNT_SELECT, requireCompanyId } from '../tenant-scope';
import type { MetricsFetcher } from './post-metrics';
import { expectOk, providerFetch } from '../publishing/http';

export const RADAR_PLATFORMS = ['instagram', 'youtube', 'x'] as const;
export const MAX_WATCHED = 10;
const HANDLE_RE = /^[A-Za-z0-9._-]{1,60}$/;

export interface RadarPost {
    account: string;
    url: string | null;
    hook: string;
    publishedAt: string | null;
    views: number | null;
    likes: number | null;
    comments: number | null;
    value: number;
    outlierMultiple: number;
    isOutlier: boolean;
    formulaName: string | null;
}

export interface RadarAccount {
    handle: string;
    followers: number | null;
    basis: 'views' | 'engagements';
    baseline: number | null;
    posts: RadarPost[];
    error?: string;
}

const defaultFetch: MetricsFetcher = async (platform, url, token, what, headers = {}) => {
    const res = await providerFetch(platform, url, { headers: { Authorization: `Bearer ${token}`, ...headers }, timeoutMs: 15_000 });
    return expectOk(platform, res, what);
};

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const firstLine = (t: unknown) => String(t || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 240) || '';

export function cleanHandle(raw: unknown): string {
    const h = String(raw ?? '').trim().replace(/^https?:\/\/(www\.)?(instagram|youtube|x|twitter)\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
    if (!HANDLE_RE.test(h)) throw new SocialDomainError('INVALID_INPUT', 400, `"${String(raw).slice(0, 60)}" is not a valid handle.`);
    return h;
}

function median(values: number[]): number {
    const s = [...values].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

type RawPost = { url: string | null; text: string; publishedAt: string | null; views: number | null; likes: number | null; comments: number | null };

/** Ranks one account's posts against that account's own median. */
export function rankAccount(handle: string, followers: number | null, raw: RawPost[]): RadarAccount {
    const withViews = raw.filter((p) => typeof p.views === 'number').length;
    const basis: RadarAccount['basis'] = raw.length > 0 && withViews >= Math.ceil(raw.length * 0.7) ? 'views' : 'engagements';
    const valued = raw
        .map((p) => ({ p, value: basis === 'views' ? p.views : p.likes === null && p.comments === null ? null : (p.likes ?? 0) + (p.comments ?? 0) }))
        .filter((x): x is { p: RawPost; value: number } => x.value !== null);
    if (valued.length < 3) return { handle, followers, basis, baseline: null, posts: [] };
    const baseline = median(valued.map((x) => x.value));
    const posts = valued.map(({ p, value }) => {
        const hook = firstLine(p.text);
        const multiple = baseline > 0 ? Math.round((value / baseline) * 10) / 10 : 0;
        return {
            account: handle, url: p.url, hook, publishedAt: p.publishedAt, views: p.views, likes: p.likes, comments: p.comments,
            value, outlierMultiple: multiple, isOutlier: multiple >= 3, formulaName: hook ? HookScorer.classifyFormula(hook)?.name ?? null : null,
        };
    }).sort((a, b) => b.outlierMultiple - a.outlierMultiple);
    return { handle, followers, basis, baseline, posts };
}

async function scanInstagram(handle: string, account: any, token: string, fetchJson: MetricsFetcher): Promise<RadarAccount> {
    const fields = (withViews: boolean) =>
        `business_discovery.username(${handle}){followers_count,media.limit(30){caption,like_count,comments_count,media_type,permalink,timestamp${withViews ? ',view_count' : ''}}}`;
    const id = encodeURIComponent(account.platformAccountId);
    let r: any;
    try {
        r = await fetchJson('instagram', metaGraphUrl(`${id}?fields=${encodeURIComponent(fields(true))}`, token, 'instagram'), token, 'Instagram business discovery');
    } catch {
        // `view_count` is not offered on every API version; likes and comments are.
        r = await fetchJson('instagram', metaGraphUrl(`${id}?fields=${encodeURIComponent(fields(false))}`, token, 'instagram'), token, 'Instagram business discovery');
    }
    const bd = r.business_discovery;
    if (!bd) throw new SocialDomainError('NOT_FOUND', 404, `Instagram returned nothing for @${handle}. Only business and creator accounts can be watched.`);
    const media: any[] = bd.media?.data || [];
    return rankAccount(handle, num(bd.followers_count), media.map((m) => ({
        url: m.permalink || null, text: m.caption || '', publishedAt: m.timestamp || null,
        views: num(m.view_count), likes: num(m.like_count), comments: num(m.comments_count),
    })));
}

async function scanYouTube(handle: string, token: string, fetchJson: MetricsFetcher): Promise<RadarAccount> {
    const yt = 'https://www.googleapis.com/youtube/v3';
    const ch = await fetchJson('youtube', `${yt}/channels?part=contentDetails,statistics&forHandle=${encodeURIComponent(`@${handle}`)}`, token, 'YouTube channel');
    const channel = ch.items?.[0];
    if (!channel) throw new SocialDomainError('NOT_FOUND', 404, `YouTube has no channel with the handle @${handle}.`);
    const uploads = channel.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) return rankAccount(handle, null, []);
    const list = await fetchJson('youtube', `${yt}/playlistItems?part=contentDetails&maxResults=30&playlistId=${encodeURIComponent(uploads)}`, token, 'YouTube uploads');
    const ids: string[] = (list.items || []).map((i: any) => i.contentDetails?.videoId).filter(Boolean);
    if (!ids.length) return rankAccount(handle, null, []);
    const vids = await fetchJson('youtube', `${yt}/videos?part=snippet,statistics&id=${ids.map(encodeURIComponent).join(',')}`, token, 'YouTube videos');
    const stats = channel.statistics || {};
    return rankAccount(handle, stats.hiddenSubscriberCount ? null : num(stats.subscriberCount), (vids.items || []).map((v: any) => ({
        url: `https://www.youtube.com/watch?v=${v.id}`, text: v.snippet?.title || '', publishedAt: v.snippet?.publishedAt || null,
        views: num(v.statistics?.viewCount), likes: num(v.statistics?.likeCount), comments: num(v.statistics?.commentCount),
    })));
}

async function scanX(handle: string, token: string, fetchJson: MetricsFetcher): Promise<RadarAccount> {
    const base = (process.env.X_API_BASE_URL?.trim() || 'https://api.x.com').replace(/\/+$/, '');
    const u = await fetchJson('x', `${base}/2/users/by/username/${encodeURIComponent(handle)}?user.fields=public_metrics`, token, 'X user');
    if (!u.data?.id) throw new SocialDomainError('NOT_FOUND', 404, `X has no account @${handle}.`);
    const t = await fetchJson('x', `${base}/2/users/${encodeURIComponent(u.data.id)}/tweets?max_results=30&exclude=retweets,replies&tweet.fields=public_metrics,created_at`, token, 'X posts');
    return rankAccount(handle, num(u.data.public_metrics?.followers_count), (t.data || []).map((p: any) => ({
        url: `https://x.com/${handle}/status/${p.id}`, text: p.text || '', publishedAt: p.created_at || null,
        views: num(p.public_metrics?.impression_count), likes: num(p.public_metrics?.like_count), comments: num(p.public_metrics?.reply_count),
    })));
}

const asObj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

export interface RadarDeps { db?: any; fetchJson?: MetricsFetcher; getToken?: (account: any) => Promise<string>; now?: () => Date }

async function loadProject(db: any, projectId: string, companyId: string) {
    const project = await db.project.findFirst({ where: { id: projectId, companyId }, select: { id: true, socialSettings: true } });
    if (!project) throw new SocialDomainError('NOT_FOUND', 404, 'Project not found');
    return project;
}

function radarPlatform(platform: string): (typeof RADAR_PLATFORMS)[number] {
    const p = normalizePlatform(platform);
    if (!p || !(RADAR_PLATFORMS as readonly string[]).includes(p)) {
        throw new SocialDomainError('COMPETITOR_API_UNAVAILABLE', 422, `${platform} does not offer an API for other accounts' posts. Add posts by hand in "Rank posts" instead.`);
    }
    return p as (typeof RADAR_PLATFORMS)[number];
}

/** Watched handles and the last stored scan for a platform. */
export async function getRadar(params: { companyId: string; projectId: string; platform: string }, deps: RadarDeps = {}) {
    const companyId = requireCompanyId(params.companyId);
    const db = deps.db ?? getDb();
    const p = normalizePlatform(params.platform);
    const supported = !!p && (RADAR_PLATFORMS as readonly string[]).includes(p);
    const settings = asObj((await loadProject(db, params.projectId, companyId)).socialSettings);
    const radar = asObj(asObj(settings.competitorRadar)[p || params.platform]);
    return { platform: p || params.platform, supported, handles: Array.isArray(radar.handles) ? radar.handles : [], scan: radar.scan || null, maxHandles: MAX_WATCHED };
}

async function saveRadar(db: any, projectId: string, companyId: string, platform: string, patch: Record<string, any>) {
    const project = await loadProject(db, projectId, companyId);
    const settings = asObj(project.socialSettings);
    const all = asObj(settings.competitorRadar);
    const next = { ...settings, competitorRadar: { ...all, [platform]: { ...asObj(all[platform]), ...patch } } };
    await db.project.updateMany({ where: { id: projectId, companyId }, data: { socialSettings: next } });
}

export async function setRadarHandles(params: { companyId: string; projectId: string; platform: string; handles: unknown }, deps: RadarDeps = {}) {
    const companyId = requireCompanyId(params.companyId);
    const db = deps.db ?? getDb();
    const platform = radarPlatform(params.platform);
    if (!Array.isArray(params.handles)) throw new SocialDomainError('INVALID_INPUT', 400, '"handles" must be a list.');
    const handles = Array.from(new Set(params.handles.map(cleanHandle).map((h) => h.toLowerCase())));
    if (handles.length > MAX_WATCHED) throw new SocialDomainError('INVALID_INPUT', 400, `Watch at most ${MAX_WATCHED} accounts per platform.`);
    await saveRadar(db, params.projectId, companyId, platform, { handles });
    return getRadar(params, deps);
}

/** Reads the watched accounts' recent posts from the platform API, ranks them and stores the scan. */
export async function scanRadar(params: { companyId: string; projectId: string; platform: string }, deps: RadarDeps = {}) {
    const companyId = requireCompanyId(params.companyId);
    const db = deps.db ?? getDb();
    const platform = radarPlatform(params.platform);
    const fetchJson = deps.fetchJson ?? defaultFetch;
    const current = await getRadar(params, deps);
    if (!current.handles.length) throw new SocialDomainError('INVALID_INPUT', 400, 'Add at least one account to watch first.');

    const account = await db.socialAccount.findFirst({
        where: { companyId, projectId: params.projectId, platform: { in: platform === 'x' ? ['twitter', 'x'] : [platform] }, isActive: true },
        select: VAULT_ACCOUNT_SELECT,
    });
    if (!account) throw new SocialDomainError('ACCOUNT_REQUIRED', 409, `Connect your own ${platform} account first; the platform only allows reading other accounts through a connected one.`);
    const token = await (deps.getToken ?? ((a: any) => SocialTokenVault.getAccessToken(a)))(account);

    const accounts: RadarAccount[] = [];
    for (const handle of current.handles as string[]) {
        try {
            accounts.push(platform === 'instagram' ? await scanInstagram(handle, account, token, fetchJson) : platform === 'youtube' ? await scanYouTube(handle, token, fetchJson) : await scanX(handle, token, fetchJson));
        } catch (err: any) {
            accounts.push({ handle, followers: null, basis: 'engagements', baseline: null, posts: [], error: String(err?.message || err).slice(0, 300) });
        }
    }
    const outliers = accounts.flatMap((a) => a.posts.filter((p) => p.isOutlier)).sort((a, b) => b.outlierMultiple - a.outlierMultiple);
    const formulas = new Map<string, number>();
    for (const o of outliers) if (o.formulaName) formulas.set(o.formulaName, (formulas.get(o.formulaName) || 0) + 1);
    const scan = {
        fetchedAt: (deps.now?.() ?? new Date()).toISOString(),
        accounts: accounts.map((a) => ({ handle: a.handle, followers: a.followers, basis: a.basis, baseline: a.baseline, posts: a.posts.length, error: a.error || null })),
        // Keep the stored scan small: the strongest posts only.
        top: accounts.flatMap((a) => a.posts).sort((a, b) => b.outlierMultiple - a.outlierMultiple).slice(0, 40),
        outliers: outliers.length,
        provenFormulas: Array.from(formulas, ([formulaName, count]) => ({ formulaName, count })).sort((a, b) => b.count - a.count),
    };
    await saveRadar(db, params.projectId, companyId, platform, { scan });
    return { ...current, scan };
}
