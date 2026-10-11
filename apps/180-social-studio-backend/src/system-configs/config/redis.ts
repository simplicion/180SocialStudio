import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

let redisInstance: Redis | null = null;

if (REDIS_URL) {
  try {
    redisInstance = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      enableOfflineQueue: false,
      commandTimeout: 15000,
      retryStrategy: (times) => Math.min(times * 100, 5000),
    });
    redisInstance.on('error', (err: any) => {
      // Graceful fallback to memory without crash
    });
  } catch {
    redisInstance = null;
  }
}

export const redis = redisInstance;
