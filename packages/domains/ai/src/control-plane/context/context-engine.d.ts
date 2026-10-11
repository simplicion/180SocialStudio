import { DomainIntent, OrbitScopedContext } from '../types/context.types';
export declare class OrbitContextEngine {
    /**
     * Rapidly classifies user intent (<5ms) to determine target SaaS domains,
     * action types, and entity keywords without making heavy LLM calls.
     */
    static classifyIntent(prompt: string, history?: string): DomainIntent;
    /**
     * Resolves scoped, targeted context for the LLM.
     * Queries ONLY the resources relevant to the classified domain intent,
     * reducing prompt tokens from 6,000+ to under 400.
     */
    static resolveContext(params: {
        prompt: string;
        user: any;
        companyId?: string;
        history?: string;
        activeEntityRef?: {
            kind: string;
            id: string;
        };
        activeRoute?: string;
    }): Promise<OrbitScopedContext>;
    /**
     * Converts ScopedContext into a tight, optimized Markdown System Context string (<300 tokens)
     */
    static toOptimizedSystemPrompt(context: OrbitScopedContext): string;
}
