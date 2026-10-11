// @ts-nocheck
import { prisma } from '@workspace/db';
const cacheStore = new Map<string, any>();
const getCache = async (k: string) => cacheStore.get(k) || null;
const setCache = async (k: string, v: any, ttl?: number) => { cacheStore.set(k, v); };
const delCache = async (k: string) => { cacheStore.delete(k); };
import { vectorStore } from '../background/ai-vector-store.service';

export interface MemoryItem {
    id: string;
    category: 'session' | 'user' | 'company' | 'entity';
    key: string;
    value: any;
    updatedAt: Date;
}

export class Mem0MemoryService {
    // In-memory fallback cache if Redis is unavailable
    private static sessionCache: Map<string, { history: any[]; draftState?: any; lastActive: number }> = new Map();
    private static readonly REDIS_PREFIX = 'ai:mem0:session:';
    private static readonly SESSION_TTL = 86400 * 7; // 7 days retention

    /**
     * Records a message in working session memory (Redis distributed + in-memory fallback)
     */
    static async recordTurn(sessionId: string, sender: 'user' | 'assistant', text: string, metadata?: any) {
        if (!sessionId) return;

        const turn = {
            sender,
            text,
            metadata,
            timestamp: new Date()
        };

        // 1. In-memory local update
        const localSession = this.sessionCache.get(sessionId) || { history: [], lastActive: Date.now() };
        localSession.history.push(turn);
        if (localSession.history.length > 30) {
            localSession.history.shift();
        }
        localSession.lastActive = Date.now();
        this.sessionCache.set(sessionId, localSession);

        // 2. Redis distributed persistence
        try {
            const redisKey = `${this.REDIS_PREFIX}${sessionId}`;
            let sessionData = await getCache(redisKey);
            if (!sessionData) {
                sessionData = { history: [], draftState: null };
            }
            if (!Array.isArray(sessionData.history)) {
                sessionData.history = [];
            }
            sessionData.history.push(turn);
            if (sessionData.history.length > 30) {
                sessionData.history.shift();
            }
            sessionData.lastActive = Date.now();
            await setCache(redisKey, sessionData, this.SESSION_TTL);
        } catch (err) {
            // Silently fall back to in-memory cache
        }
    }

    /**
     * Gets the conversation history for the given session (Redis first, fallback to memory)
     */
    static async getSessionHistoryAsync(sessionId: string): Promise<{ sender: string; text: string; timestamp: Date }[]> {
        if (!sessionId) return [];

        try {
            const redisKey = `${this.REDIS_PREFIX}${sessionId}`;
            const redisData = await getCache(redisKey);
            if (redisData && Array.isArray(redisData.history) && redisData.history.length > 0) {
                return redisData.history;
            }
        } catch (err) {
            // Fall back to memory
        }

        return this.sessionCache.get(sessionId)?.history || [];
    }

    /**
     * Synchronous getSessionHistory (matches legacy synchronous callers)
     */
    static getSessionHistory(sessionId: string): { sender: string; text: string; timestamp: Date }[] {
        if (!sessionId) return [];
        return this.sessionCache.get(sessionId)?.history || [];
    }

    /**
     * Stores pending draft state during multi-turn clarification (Redis + in-memory)
     */
    static async setDraftState(sessionId: string, draftState: any) {
        if (!sessionId) return;

        // Local cache
        const local = this.sessionCache.get(sessionId) || { history: [], lastActive: Date.now() };
        local.draftState = draftState;
        local.lastActive = Date.now();
        this.sessionCache.set(sessionId, local);

        // Redis
        try {
            const redisKey = `${this.REDIS_PREFIX}${sessionId}`;
            const sessionData = (await getCache(redisKey)) || { history: [] };
            sessionData.draftState = draftState;
            sessionData.lastActive = Date.now();
            await setCache(redisKey, sessionData, this.SESSION_TTL);
        } catch (e) {
            // Ignore Redis failures
        }
    }

    /**
     * Retrieves pending draft state (Redis first, then in-memory)
     */
    static async getDraftStateAsync(sessionId: string): Promise<any> {
        if (!sessionId) return null;

        try {
            const redisKey = `${this.REDIS_PREFIX}${sessionId}`;
            const sessionData = await getCache(redisKey);
            if (sessionData && sessionData.draftState !== undefined) {
                return sessionData.draftState;
            }
        } catch (e) {
            // Fall back
        }

        return this.sessionCache.get(sessionId)?.draftState || null;
    }

    static getDraftState(sessionId: string): any {
        if (!sessionId) return null;
        return this.sessionCache.get(sessionId)?.draftState || null;
    }

    /**
     * Clears session memory across Redis and in-memory Map
     */
    static async clearSession(sessionId: string) {
        if (!sessionId) return;
        this.sessionCache.delete(sessionId);
        try {
            await delCache(`${this.REDIS_PREFIX}${sessionId}`);
        } catch (e) {
            // Ignore
        }
    }

    /**
     * Long-term memory store: Saves company/user knowledge into Vector Store for semantic recall
     */
    static async saveLongTermMemory(params: {
        id: string;
        category: 'user' | 'company' | 'entity';
        text: string;
        companyId: string;
        metadata?: any;
    }) {
        const { id, category, text, companyId, metadata } = params;
        await vectorStore.addDocument(id, text, {
            companyId,
            category,
            ...metadata,
            storedAt: new Date().toISOString()
        });
    }

    /**
     * Long-term memory recall: Searches semantic memory for relevant company knowledge
     */
    static async recallLongTermMemory(query: string, companyId: string, topK: number = 3) {
        return await vectorStore.search(query, topK, (meta: any) => meta.companyId === companyId);
    }
}
