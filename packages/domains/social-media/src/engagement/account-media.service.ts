/**
 * Recent posts of a connected account, read live from the platform, so an engagement rule can target a post that
 * was published outside 180 Workspace (comment → DM on an existing Reel). Nothing is stored or invented: a platform
 * without a listing API answers MEDIA_LISTING_UNSUPPORTED.
 */
import { getDb, providerFetch, expectOk } from '../publishing/http';
import { metaGraphUrl } from '../publishing/config';
import { SocialTokenVault } from '../publishing/token-vault';
import { SocialDomainError, notFound, requireCompanyId, VAULT_ACCOUNT_SELECT } from '../tenant-scope';

export interface AccountMediaItem {
    /** Platform media id: what comment webhooks report as `mediaId`. */
    id: string;
    platform: string;
    caption: string | null;
    mediaType: string | null;
    thumbnailUrl: string | null;
    permalink: string | null;
    timestamp: string | null;
    commentsCount: number | null;
}

export interface AccountMediaPage {
    items: AccountMediaItem[];
    /** Opaque cursor for the next page, null at the end. */
    nextCursor: string | null;
}

const PAGE_SIZE = 24;
/** Platform cursors are opaque base64-ish strings; anything else is rejected before it reaches a provider URL. */
const CURSOR_RE = /^[A-Za-z0-9_\-=%.]{1,512}$/;

export const MEDIA_LISTING_PLATFORMS = ['instagram', 'facebook'] as const;

export class AccountMediaService {
    static async listRecentMedia(companyId: string, accountId: string, opts: { cursor?: string | null } = {}): Promise<AccountMediaPage> {
        requireCompanyId(companyId);
        const account = await (getDb() as any).socialAccount.findFirst({
            where: { id: String(accountId), companyId, isActive: true },
            select: { ...VAULT_ACCOUNT_SELECT },
        });
        if (!account) throw notFound('Social account');
        const platform = String(account.platform).toLowerCase();
        if (!(MEDIA_LISTING_PLATFORMS as readonly string[]).includes(platform)) {
            throw new SocialDomainError(
                'MEDIA_LISTING_UNSUPPORTED',
                422,
                `Picking existing posts is available for Instagram and Facebook. For ${platform}, apply the automation to all posts of the account.`,
            );
        }
        const cursor = opts.cursor ? String(opts.cursor) : null;
        if (cursor && !CURSOR_RE.test(cursor)) throw new SocialDomainError('VALIDATION_FAILED', 400, 'Invalid cursor');

        const token = await SocialTokenVault.getAccessToken(account);
        const id = encodeURIComponent(account.platformAccountId);
        const after = cursor ? `&after=${encodeURIComponent(cursor)}` : '';

        if (platform === 'instagram') {
            const fields = 'id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp,comments_count';
            const url = metaGraphUrl(`${id}/media?fields=${fields}&limit=${PAGE_SIZE}${after}`, token, 'instagram');
            const body = await expectOk('instagram', await providerFetch('instagram', url, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15_000 }), 'Instagram media');
            return {
                items: (body?.data || []).map((m: any) => ({
                    id: String(m.id),
                    platform,
                    caption: typeof m.caption === 'string' ? m.caption.slice(0, 500) : null,
                    mediaType: m.media_product_type === 'REELS' ? 'REEL' : m.media_type ?? null,
                    // Videos expose thumbnail_url; images only media_url.
                    thumbnailUrl: m.thumbnail_url || (m.media_type === 'VIDEO' ? null : m.media_url) || null,
                    permalink: m.permalink ?? null,
                    timestamp: m.timestamp ?? null,
                    commentsCount: typeof m.comments_count === 'number' ? m.comments_count : null,
                })),
                nextCursor: body?.paging?.next ? body?.paging?.cursors?.after ?? null : null,
            };
        }

        const fields = 'id,message,full_picture,permalink_url,created_time,comments.summary(true).limit(0)';
        const url = metaGraphUrl(`${id}/posts?fields=${fields}&limit=${PAGE_SIZE}${after}`, token, 'facebook');
        const body = await expectOk('facebook', await providerFetch('facebook', url, { headers: { Authorization: `Bearer ${token}` }, timeoutMs: 15_000 }), 'Facebook page posts');
        return {
            items: (body?.data || []).map((p: any) => ({
                id: String(p.id),
                platform,
                caption: typeof p.message === 'string' ? p.message.slice(0, 500) : null,
                mediaType: 'POST',
                thumbnailUrl: p.full_picture ?? null,
                permalink: p.permalink_url ?? null,
                timestamp: p.created_time ?? null,
                commentsCount: typeof p.comments?.summary?.total_count === 'number' ? p.comments.summary.total_count : null,
            })),
            nextCursor: body?.paging?.next ? body?.paging?.cursors?.after ?? null : null,
        };
    }
}
