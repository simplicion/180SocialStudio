import Redis from 'ioredis';

// Re-use connection from .env
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Initialize a single shared Redis client instance
export const redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
});

redisClient.on('error', (err: any) => {
    console.error('[Redis Cache] Error:', err);
});

redisClient.on('connect', () => {
    console.log('[Redis Cache] Connected successfully');
});

export const getCache = async (key: string): Promise<any | null> => {
    try {
        const data = await redisClient.get(key);
        if (data) return JSON.parse(data);
        return null;
    } catch (e) {
        console.error('[Redis Cache] Get error for key', key, e);
        return null;
    }
};

export const setCache = async (key: string, value: any, ttlSeconds: number = 300): Promise<void> => {
    try {
        await redisClient.setex(key, ttlSeconds, JSON.stringify(value));
    } catch (e) {
        console.error('[Redis Cache] Set error for key', key, e);
    }
};

export const delCache = async (key: string): Promise<void> => {
    try {
        await redisClient.del(key);
    } catch (e) {
        console.error('[Redis Cache] Del error for key', key, e);
    }
};

// Aliases used across the codebase
export const getCachedData = getCache;
export const setCachedData = setCache;
export const clearCache = delCache;
