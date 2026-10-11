import { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;

let redisClient: Redis | null = null;

try {
  redisClient = new Redis(REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: false,
    commandTimeout: 5000,
    lazyConnect: true,
    retryStrategy: (times) => {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });

  redisClient.on('connect', () => console.log('? [Social Studio Redis] Connected'));
  redisClient.on('error', (err) => {
    // Non-blocking warning for local development
    if (process.env.NODE_ENV !== 'production') {
      // suppress verbose logs
    }
  });
} catch {
  redisClient = null;
}

export const redis = redisClient;
export default redis;