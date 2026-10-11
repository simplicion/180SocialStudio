import './builtin-tools';
export interface AgentExecutionResult {
    toolUsed?: string;
    toolOutput?: any;
    reply: string;
    tokensSavedPercentage: number;
    executionTimeMs: number;
}
export declare class AIAgentExecutor {
    /**
     * Executes the Orbit Control Plane "Algorithms First, AI Second" pipeline:
     * 1. Classifies intent via OrbitContextEngine (<5ms)
     * 2. Executes deterministic database capability in <15ms
     * 3. Synthesizes executive natural language answer if needed
     */
    static execute(params: {
        prompt: string;
        sessionId?: string;
        companyId?: string;
        userId?: string;
        userRole?: string;
        userPermissions?: string[];
    }): Promise<AgentExecutionResult>;
}
