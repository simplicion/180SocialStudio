/**
 * OAuth access token for the YouTube research lane when YOUTUBE_API_KEY is not configured. Uses the platform's own
 * Google OAuth client (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, YouTube Data API enabled) through a connected channel:
 *
 *   1. the project's own connected YouTube channel (tenant-scoped);
 *   2. otherwise the platform research channel, YOUTUBE_RESEARCH_ACCOUNT_ID: the SocialAccount id of a YouTube
 *      channel the platform operator connected for this purpose (e.g. the 180 team's own channel).
 *
 * The token is only used for public YouTube search and video statistics (search.list / videos.list, covered by the
 * youtube.readonly scope the connect flow already requests); nothing is read from or written to that channel, and no
 * data of the research channel's project ever reaches another tenant. Returns null when neither exists (the lane is
 * then reported as skipped).
 */
import { getDb } from '../publishing/http';
import { SocialTokenVault } from '../publishing/token-vault';
import { VAULT_ACCOUNT_SELECT, requireCompanyId } from '../tenant-scope';

export function youtubeTokenProvider(
    params: { companyId: string; projectId: string },
    deps: { db?: any; getToken?: (account: any) => Promise<string>; env?: NodeJS.ProcessEnv } = {},
): () => Promise<string | null> {
    return async () => {
        const companyId = requireCompanyId(params.companyId);
        const db = deps.db ?? getDb();
        const getToken = deps.getToken ?? ((a: any) => SocialTokenVault.getAccessToken(a));
        const own = await db.socialAccount.findFirst({
            where: { companyId, projectId: params.projectId, platform: 'youtube', isActive: true },
            select: VAULT_ACCOUNT_SELECT,
        });
        if (own) {
            try {
                return await getToken(own);
            } catch {
                /* expired/revoked: fall through to the research channel */
            }
        }
        const researchId = ((deps.env ?? process.env).YOUTUBE_RESEARCH_ACCOUNT_ID || '').trim();
        if (!researchId) return null;
        const shared = await db.socialAccount.findFirst({
            where: { id: researchId, platform: 'youtube', isActive: true },
            select: VAULT_ACCOUNT_SELECT,
        });
        if (!shared) return null;
        try {
            return await getToken(shared);
        } catch {
            return null;
        }
    };
}
