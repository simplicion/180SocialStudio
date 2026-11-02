import { getDb } from '../publishing/http';
import { CrossAccountAnalyticsSummary } from './types';
import { requireCompanyId } from '../tenant-scope';
import { fetchLivePlatformMetrics } from '../social-insights.service';

/**
 * Cross-account telemetry for the 180 Manager. Only stored or live platform numbers are returned; nothing is
 * estimated or invented. Format-level learnings require performance memory (Phase P4) and are omitted until then.
 */
/** A chat turn reuses the summary for a minute instead of calling every platform API again. */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: Promise<CrossAccountAnalyticsSummary> }>();

export class AnalyticsSubagent {
    static async getCrossAccountSummary(
        companyId: string,
        projectId?: string,
        deps: { liveMetrics?: typeof fetchLivePlatformMetrics; now?: Date } = {},
    ): Promise<CrossAccountAnalyticsSummary> {
        requireCompanyId(companyId);
        // Injected dependencies (tests) always compute fresh.
        if (deps.liveMetrics || deps.now) return this.compute(companyId, projectId, deps);
        const key = `${companyId}:${projectId || '*'}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
        const value = this.compute(companyId, projectId, deps);
        cache.set(key, { at: Date.now(), value });
        value.catch(() => cache.delete(key)); // a failure is never cached
        if (cache.size > 500) cache.delete(cache.keys().next().value as string);
        return value;
    }

    private static async compute(
        companyId: string,
        projectId: string | undefined,
        deps: { liveMetrics?: typeof fetchLivePlatformMetrics; now?: Date },
    ): Promise<CrossAccountAnalyticsSummary> {
        const db = getDb() as any;
        const whereAccount: any = { companyId, isActive: true };
        if (projectId) whereAccount.projectId = projectId;

        const now = deps.now || new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const accounts = await db.socialAccount.findMany({
            where: whereAccount,
            select: { id: true, platform: true, username: true, accountName: true },
        });
        const ids = accounts.map((a: any) => a.id);

        // One grouped query per metric instead of two queries per account.
        const [published, interactions, variants] = ids.length
            ? await Promise.all([
                  db.socialPostVariant.groupBy({
                      by: ['socialAccountId'],
                      where: { socialAccountId: { in: ids }, publishStatus: 'published', publishedAt: { gte: startOfMonth }, post: { companyId } },
                      _count: { _all: true },
                  }),
                  db.socialInteractionLog.groupBy({
                      by: ['socialAccountId'],
                      where: { companyId, socialAccountId: { in: ids }, createdAt: { gte: startOfMonth } },
                      _count: { _all: true },
                  }),
                  db.socialPostVariant.findMany({
                      where: { socialAccountId: { in: ids }, publishStatus: 'published' },
                      select: { socialAccountId: true, platformMeta: true },
                  }).catch(() => []),
              ])
            : [[], [], []];
        const countOf = (rows: any[], id: string) => rows.find((r) => r.socialAccountId === id)?._count?._all ?? 0;

        const storedByAccount = new Map<string, { views: number; reach: number; engagements: number }>();
        for (const v of variants) {
            const accId = v.socialAccountId;
            if (!accId) continue;
            const meta = v.platformMeta && typeof v.platformMeta === 'object' ? v.platformMeta : {};
            const met = meta.metrics && typeof meta.metrics === 'object' ? meta.metrics : {};
            const prev = storedByAccount.get(accId) || { views: 0, reach: 0, engagements: 0 };
            prev.views += Number(met.views) || 0;
            prev.reach += Number(met.reach) || 0;
            prev.engagements += (Number(met.likes) || 0) + (Number(met.comments) || 0) + (Number(met.shares) || 0) + (Number(met.saves) || 0);
            storedByAccount.set(accId, prev);
        }

        let live: Awaited<ReturnType<typeof fetchLivePlatformMetrics>> = [];
        if (projectId) {
            live = await (deps.liveMetrics || fetchLivePlatformMetrics)({ projectId, companyId }).catch(() => []);
        }

        return {
            totalAccounts: accounts.length,
            periodStart: startOfMonth.toISOString(),
            accounts: accounts.map((acc: any) => {
                const m: any = live.find((l) => l.socialAccountId === acc.id) || null;
                const stored = storedByAccount.get(acc.id);
                const hasStored = stored && (stored.views > 0 || stored.reach > 0 || stored.engagements > 0);
                const finalSource = (m?.source === 'live' && m?.reach != null) ? 'live' : (hasStored || m?.followersCount != null ? 'stored' : (m?.source || 'stored'));
                const reach = m?.reach ?? (stored && stored.reach > 0 ? stored.reach : null);
                const views = m?.views ?? (stored && stored.views > 0 ? stored.views : null);
                const engagements = m?.engagements ?? (stored && stored.engagements > 0 ? stored.engagements : null);
                const unavailable = (reach != null || views != null || engagements != null || m?.followersCount != null)
                    ? null
                    : (m?.unavailable?.message ?? null);

                return {
                    id: acc.id,
                    platform: acc.platform,
                    username: acc.username || acc.accountName || acc.platform,
                    publishedThisMonth: countOf(published, acc.id),
                    automationEventsThisMonth: countOf(interactions, acc.id),
                    metrics: (m || hasStored)
                        ? {
                              source: finalSource,
                              followers: m?.followersCount ?? null,
                              reach,
                              views,
                              engagements,
                              periodDays: m?.periodDays ?? null,
                              unavailable,
                          }
                        : null,
                };
            }),
        };
    }
}
