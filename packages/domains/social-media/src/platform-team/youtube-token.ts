/**
 * OAuth access token of the project's connected YouTube channel, for the research lane when YOUTUBE_API_KEY is not
 * configured. Tenant-scoped; returns null when no channel is connected (the lane is then reported as skipped).
 */
import { getDb } from '../publishing/http';
import { SocialTokenVault } from '../publishing/token-vault';
import { VAULT_ACCOUNT_SELECT, requireCompanyId } from '../tenant-scope';

export function youtubeTokenProvider(
    params: { companyId: string; projectId: string },
    deps: { db?: any; getToken?: (account: any) => Promise<string> } = {},
): () => Promise<string | null> {
    return async () => {
        const companyId = requireCompanyId(params.companyId);
        const db = deps.db ?? getDb();
        const account = await db.socialAccount.findFirst({
            where: { companyId, projectId: params.projectId, platform: 'youtube', isActive: true },
            select: VAULT_ACCOUNT_SELECT,
        });
        if (!account) return null;
        return (deps.getToken ?? ((a: any) => SocialTokenVault.getAccessToken(a)))(account);
    };
}
