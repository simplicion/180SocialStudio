/**
 * 24h cache of gathered research (the three gathering agents' outcomes). It holds public third-party data only, so
 * one company's research can serve another's identical query, saving YouTube quota and worker time.
 * Analyst output and brand fit are per project and are never cached here.
 */
import { createHash } from 'crypto';
import type { AgentOutcome } from './types';

export interface TrendCache {
    get(key: string): Promise<AgentOutcome[] | null>;
    set(key: string, value: AgentOutcome[], ttlMs: number): Promise<void>;
}

export const TREND_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Bump when the shape of cached outcomes changes. */
const CACHE_VERSION = 'v1';

export function trendCacheKey(parts: { searchQueries: string[]; hashtags: string[]; days: number; lanes: string[] }): string {
    const canon = JSON.stringify({
        v: CACHE_VERSION,
        q: parts.searchQueries.map((q) => q.toLowerCase().trim()),
        h: [...parts.hashtags].map((h) => h.toLowerCase()).sort(),
        d: parts.days,
        l: [...parts.lanes].sort(),
    });
    return `trend:${createHash('sha256').update(canon).digest('hex').slice(0, 40)}`;
}

export class MemoryTrendCache implements TrendCache {
    private readonly store = new Map<string, { value: AgentOutcome[]; expiresAt: number }>();
    constructor(private readonly now: () => number = Date.now) {}
    async get(key: string) {
        const hit = this.store.get(key);
        if (!hit) return null;
        if (hit.expiresAt <= this.now()) { this.store.delete(key); return null; }
        return hit.value;
    }
    async set(key: string, value: AgentOutcome[], ttlMs: number) {
        this.store.set(key, { value, expiresAt: this.now() + ttlMs });
    }
}

/** Backed by the TrendSignalCache table. A cache failure never fails research: it is treated as a miss. */
export class PrismaTrendCache implements TrendCache {
    constructor(private readonly db: any, private readonly now: () => Date = () => new Date()) {}
    async get(key: string) {
        try {
            const row = await this.db.trendSignalCache.findUnique({ where: { key } });
            if (!row || new Date(row.expiresAt) <= this.now()) return null;
            return row.payload as AgentOutcome[];
        } catch {
            return null;
        }
    }
    async set(key: string, value: AgentOutcome[], ttlMs: number) {
        const expiresAt = new Date(this.now().getTime() + ttlMs);
        try {
            await this.db.trendSignalCache.upsert({ where: { key }, create: { key, payload: value as any, expiresAt }, update: { payload: value as any, expiresAt } });
            // Opportunistic cleanup keeps the table small without a cron job.
            if (Math.random() < 0.05) await this.db.trendSignalCache.deleteMany({ where: { expiresAt: { lt: this.now() } } });
        } catch {
            /* best effort */
        }
    }
}
