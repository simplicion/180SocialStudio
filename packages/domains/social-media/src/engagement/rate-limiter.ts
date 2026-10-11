/**
 * Per-account action limiter and short-lived claims for 180 Engagement.
 *
 * - Leaky bucket (GCRA) per social account: SOCIAL_ENGAGEMENT_RATE_LIMIT_PER_MIN actions per minute (default 30),
 *   burst up to the same number. Every like / public reply / DM / AI reply costs one unit. A caller that is refused
 *   gets `retryAfterMs` and must defer the work (it is never dropped).
 * - Claims (SET NX with a TTL) make webhook processing and the one-DM-per-user-per-post guard safe against Meta's
 *   duplicate deliveries and concurrent workers.
 *
 * Backend: Redis (REDIS_URL, via ioredis) so the limit holds across API instances. Without Redis an in-memory store is
 * used, but only outside production; in production a missing REDIS_URL is a loud 503 RATE_LIMITER_UNAVAILABLE.
 */
import { SocialDomainError } from '../tenant-scope';
import { intEnv } from '../publishing/config';

export interface RateDecision {
    allowed: boolean;
    /** When refused: how long until `cost` units fit. 0 when allowed. */
    retryAfterMs: number;
}

/** Storage used by the limiter; Redis in production, memory in dev/tests. Tests may inject their own. */
export interface LimiterStore {
    /** GCRA: atomically consume `cost` units if they fit. */
    take(key: string, cost: number, limitPerMin: number, nowMs: number): Promise<RateDecision>;
    /** SET key NX PX ttl. True when this caller got the claim. */
    claim(key: string, ttlMs: number): Promise<boolean>;
    release(key: string): Promise<void>;
}

export class MemoryLimiterStore implements LimiterStore {
    private tat = new Map<string, number>();
    private claims = new Map<string, number>();

    async take(key: string, cost: number, limitPerMin: number, nowMs: number): Promise<RateDecision> {
        const interval = 60_000 / limitPerMin;
        const burst = 60_000; // one minute worth of units
        const tat = Math.max(this.tat.get(key) ?? nowMs, nowMs);
        const newTat = tat + cost * interval;
        const allowAt = newTat - burst;
        if (allowAt > nowMs) return { allowed: false, retryAfterMs: Math.ceil(allowAt - nowMs) };
        this.tat.set(key, newTat);
        return { allowed: true, retryAfterMs: 0 };
    }

    async claim(key: string, ttlMs: number): Promise<boolean> {
        const now = Date.now();
        const until = this.claims.get(key);
        if (until && until > now) return false;
        this.claims.set(key, now + ttlMs);
        if (this.claims.size > 50_000) {
            for (const [k, v] of this.claims) if (v <= now) this.claims.delete(k);
        }
        return true;
    }

    async release(key: string): Promise<void> {
        this.claims.delete(key);
    }
}

// GCRA in one round trip: KEYS[1] = bucket, ARGV = cost, interval ms, burst ms, now ms.
const GCRA_LUA = `
local tat = tonumber(redis.call('GET', KEYS[1]) or ARGV[4])
local now = tonumber(ARGV[4])
if tat < now then tat = now end
local newTat = tat + tonumber(ARGV[1]) * tonumber(ARGV[2])
local allowAt = newTat - tonumber(ARGV[3])
if allowAt > now then return math.ceil(allowAt - now) end
redis.call('SET', KEYS[1], newTat, 'PX', math.ceil(newTat - now) + 1000)
return 0`;

export class RedisLimiterStore implements LimiterStore {
    constructor(private redis: any) {}

    async take(key: string, cost: number, limitPerMin: number, nowMs: number): Promise<RateDecision> {
        const interval = 60_000 / limitPerMin;
        const wait = Number(await this.redis.eval(GCRA_LUA, 1, key, cost, interval, 60_000, nowMs));
        return wait > 0 ? { allowed: false, retryAfterMs: wait } : { allowed: true, retryAfterMs: 0 };
    }

    async claim(key: string, ttlMs: number): Promise<boolean> {
        return (await this.redis.set(key, '1', 'PX', ttlMs, 'NX')) === 'OK';
    }

    async release(key: string): Promise<void> {
        await this.redis.del(key);
    }
}

let injected: LimiterStore | null = null;
let resolved: LimiterStore | null = null;

function resolveStore(): LimiterStore {
    if (injected) return injected;
    if (resolved) return resolved;
    const url = process.env.REDIS_URL?.trim();
    if (url) {
        // ioredis is provided by the host app (backend / worker); resolved lazily so the package stays importable.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Redis = require('ioredis');
        resolved = new RedisLimiterStore(new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false }));
        return resolved;
    }
    if (process.env.NODE_ENV === 'production') {
        console.error('[EngagementRateLimiter] REDIS_URL is not set; engagement actions are refused in production.');
        throw new SocialDomainError('RATE_LIMITER_UNAVAILABLE', 503, 'REDIS_URL is not configured; the engagement rate limiter needs Redis in production.');
    }
    resolved = new MemoryLimiterStore();
    return resolved;
}

export class EngagementRateLimiter {
    /** Actions per minute per social account (env SOCIAL_ENGAGEMENT_RATE_LIMIT_PER_MIN, default 30). */
    static limitPerMinute(): number {
        return intEnv('SOCIAL_ENGAGEMENT_RATE_LIMIT_PER_MIN', 30);
    }

    /** Test / host hook: use this store (null restores env-based resolution). */
    static useStore(store: LimiterStore | null) {
        injected = store;
        resolved = null;
    }

    /** Consume `cost` action units for the account, or say how long to wait. */
    static async take(socialAccountId: string, cost = 1, nowMs = Date.now()): Promise<RateDecision> {
        if (cost <= 0) return { allowed: true, retryAfterMs: 0 };
        const limit = this.limitPerMinute();
        if (cost > limit) cost = limit; // a single event can never need more than one bucket
        return resolveStore().take(`eng:rl:${socialAccountId}`, cost, limit, nowMs);
    }

    static async claim(key: string, ttlMs: number): Promise<boolean> {
        return resolveStore().claim(`eng:claim:${key}`, ttlMs);
    }

    static async release(key: string): Promise<void> {
        await resolveStore().release(`eng:claim:${key}`).catch(() => undefined);
    }
}
