export interface AISettings {
    aiProvider: 'gemini' | 'openai' | 'claude' | 'groq' | 'cartesia' | 'custom' | string;
    geminiKey?: string;
    openaiKey?: string;
    claudeKey?: string;
    groqKey?: string;
    cartesiaKey?: string;
    customAiKey?: string;
    customAiUrl?: string;
    customAiModel?: string;
}
export interface ToolCallResponse {
    text: string;
    toolCalls?: Array<{
        id?: string;
        name: string;
        args: Record<string, any>;
    }>;
}
export interface AIClient {
    provider: string;
    generate: (prompt: string, options?: any) => Promise<string>;
    generateStream: (prompt: string, options?: any, onChunk?: (chunk: string) => void) => Promise<string>;
    generateWithTools?: (prompt: string, tools: any[], options?: any) => Promise<ToolCallResponse>;
}
export declare class AIProviderService {
    private static instance;
    static getInstance(): AIProviderService;
    /**
     * Instantiates an active LLM client from configured company settings.
     * All providers now support `generate`, `generateStream`, and `generateWithTools`.
     */
    getClient(settings: AISettings): Promise<AIClient | null>;
    /**
     * Convenience method: Generate insights using the company's AI provider.
     * Direct port of old `aiService.getInsights()`.
     */
    getInsights(prompt: string, settings: AISettings, options?: any): Promise<string>;
    /**
     * Convenience method: Stream insights using the company's AI provider.
     * Direct port of old `aiService.getInsightsStream()`.
     */
    getInsightsStream(prompt: string, settings: AISettings, options?: any, onChunk?: (chunk: string) => void): Promise<string>;
    /**
     * Live test connection for any provider
     */
    testConnection(provider: string, apiKey: string, customUrl?: string, customModel?: string): Promise<{
        success: boolean;
        message: string;
        text?: string;
    }>;
}
export declare const aiProviderService: AIProviderService;
export declare const AiService: typeof AIProviderService;
export declare const aiService: AIProviderService;
