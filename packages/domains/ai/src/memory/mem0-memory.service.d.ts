export interface MemoryItem {
    id: string;
    category: 'session' | 'user' | 'company' | 'entity';
    key: string;
    value: any;
    updatedAt: Date;
}
export declare class Mem0MemoryService {
    private static sessionCache;
    private static readonly REDIS_PREFIX;
    private static readonly SESSION_TTL;
    /**
     * Records a message in working session memory (Redis distributed + in-memory fallback)
     */
    static recordTurn(sessionId: string, sender: 'user' | 'assistant', text: string, metadata?: any): Promise<void>;
    /**
     * Gets the conversation history for the given session (Redis first, fallback to memory)
     */
    static getSessionHistoryAsync(sessionId: string): Promise<{
        sender: string;
        text: string;
        timestamp: Date;
    }[]>;
    /**
     * Synchronous getSessionHistory (matches legacy synchronous callers)
     */
    static getSessionHistory(sessionId: string): {
        sender: string;
        text: string;
        timestamp: Date;
    }[];
    /**
     * Stores pending draft state during multi-turn clarification (Redis + in-memory)
     */
    static setDraftState(sessionId: string, draftState: any): Promise<void>;
    /**
     * Retrieves pending draft state (Redis first, then in-memory)
     */
    static getDraftStateAsync(sessionId: string): Promise<any>;
    static getDraftState(sessionId: string): any;
    /**
     * Clears session memory across Redis and in-memory Map
     */
    static clearSession(sessionId: string): Promise<void>;
    /**
     * Long-term memory store: Saves company/user knowledge into Vector Store for semantic recall
     */
    static saveLongTermMemory(params: {
        id: string;
        category: 'user' | 'company' | 'entity';
        text: string;
        companyId: string;
        metadata?: any;
    }): Promise<void>;
    /**
     * Long-term memory recall: Searches semantic memory for relevant company knowledge
     */
    static recallLongTermMemory(query: string, companyId: string, topK?: number): Promise<import("../background/ai-vector-store.service").VectorDocument[]>;
}
