export type AgentMemoryKind = 'proposal_accepted' | 'proposal_rejected' | 'preference' | 'performance';
export type AgentMemoryScope = 'director' | 'strategist' | 'all';
export interface RecordMemoryDto {
    companyId: string;
    projectId: string;
    kind: AgentMemoryKind;
    scope?: AgentMemoryScope;
    key?: string;
    text: string;
    payload?: any;
    weight?: number;
}
export declare class AgentMemoryService {
    /**
     * Records a new memory. If a key is provided and kind is 'preference', it overwrites the existing entry for that key.
     */
    static recordMemory(dto: RecordMemoryDto): Promise<any>;
    /**
     * Retrieves memories compacted as a string context for an agent prompt.
     */
    static getMemoryContext(companyId: string, projectId: string, scope: AgentMemoryScope): Promise<string>;
}
