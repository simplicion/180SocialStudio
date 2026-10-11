import Redis from 'ioredis';
export declare const redisClient: Redis;
export declare const getCache: (key: string) => Promise<any | null>;
export declare const setCache: (key: string, value: any, ttlSeconds?: number) => Promise<void>;
export declare const delCache: (key: string) => Promise<void>;
export declare const getCachedData: (key: string) => Promise<any | null>;
export declare const setCachedData: (key: string, value: any, ttlSeconds?: number) => Promise<void>;
export declare const clearCache: (key: string) => Promise<void>;
