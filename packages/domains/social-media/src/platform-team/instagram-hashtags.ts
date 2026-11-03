/**
 * Instagram hashtag top media through the OFFICIAL Graph API with the project's own connected business/creator
 * account (Hashtag Search: ig_hashtag_search -> {hashtag-id}/top_media). No scraping.
 *
 * Meta allows 30 unique hashtags per 7 days per account; a request past that fails and the research lane reports
 * the error instead of failing the report. Returns null when the project has no connected Instagram account.
 */
import type { InstagramMedia } from '@workspace/ai/research';
import { metaGraphUrl } from '../publishing/config';
import { expectOk, getDb, providerFetch } from '../publishing/http';
import { SocialTokenVault } from '../publishing/token-vault';
import { VAULT_ACCOUNT_SELECT, requireCompanyId } from '../tenant-scope';

type FetchJson = (url: string, what: string) => Promise<any>;

const num = (v: unknown): number | null => (v === undefined || v === null || !Number.isFinite(Number(v)) ? null : Number(v));

export async function instagramHashtagReader(
    params: { companyId: string; projectId: string },
    deps: { db?: any; getToken?: (account: any) => Promise<string>; fetchJson?: FetchJson } = {},
): Promise<((hashtag: string) => Promise<InstagramMedia[]>) | null> {
    const companyId = requireCompanyId(params.companyId);
    const db = deps.db ?? getDb();
    const account = await db.socialAccount.findFirst({
        where: { companyId, projectId: params.projectId, platform: 'instagram', isActive: true },
        select: VAULT_ACCOUNT_SELECT,
    });
    if (!account?.platformAccountId) return null;
    const token = await (deps.getToken ?? ((a: any) => SocialTokenVault.getAccessToken(a)))(account);
    const fetchJson: FetchJson = deps.fetchJson ?? (async (url, what) =>
        expectOk('instagram', await providerFetch('instagram', url, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15_000 }), what));
    const userId = encodeURIComponent(account.platformAccountId);

    return async (hashtag: string) => {
        const tag = hashtag.replace(/^#/, '').toLowerCase();
        if (!/^[a-z0-9_]{2,40}$/.test(tag)) return [];
        const search = await fetchJson(metaGraphUrl(`ig_hashtag_search?user_id=${userId}&q=${encodeURIComponent(tag)}`, token, 'instagram'), 'Instagram hashtag search');
        const hashtagId = search?.data?.[0]?.id;
        if (!hashtagId) return [];
        const media = await fetchJson(
            metaGraphUrl(`${encodeURIComponent(hashtagId)}/top_media?user_id=${userId}&fields=caption,like_count,comments_count,permalink,timestamp&limit=25`, token, 'instagram'),
            'Instagram hashtag top media',
        );
        return (media?.data || [])
            .filter((m: any) => typeof m?.permalink === 'string')
            .map((m: any) => ({ permalink: m.permalink, caption: String(m.caption || ''), timestamp: m.timestamp || null, likes: num(m.like_count), comments: num(m.comments_count) }));
    };
}
