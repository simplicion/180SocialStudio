"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCache = exports.setCachedData = exports.getCachedData = exports.delCache = exports.setCache = exports.getCache = exports.redisClient = void 0;
const ioredis_1 = __importDefault(require("ioredis"));
// Re-use connection from .env
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
// Initialize a single shared Redis client instance
exports.redisClient = new ioredis_1.default(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false
});
exports.redisClient.on('error', (err) => {
    console.error('[Redis Cache] Error:', err);
});
exports.redisClient.on('connect', () => {
    console.log('[Redis Cache] Connected successfully');
});
const getCache = async (key) => {
    try {
        const data = await exports.redisClient.get(key);
        if (data)
            return JSON.parse(data);
        return null;
    }
    catch (e) {
        console.error('[Redis Cache] Get error for key', key, e);
        return null;
    }
};
exports.getCache = getCache;
const setCache = async (key, value, ttlSeconds = 300) => {
    try {
        await exports.redisClient.setex(key, ttlSeconds, JSON.stringify(value));
    }
    catch (e) {
        console.error('[Redis Cache] Set error for key', key, e);
    }
};
exports.setCache = setCache;
const delCache = async (key) => {
    try {
        await exports.redisClient.del(key);
    }
    catch (e) {
        console.error('[Redis Cache] Del error for key', key, e);
    }
};
exports.delCache = delCache;
// Aliases used across the codebase
exports.getCachedData = exports.getCache;
exports.setCachedData = exports.setCache;
exports.clearCache = exports.delCache;
