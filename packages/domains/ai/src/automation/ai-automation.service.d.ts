import { AISettings } from '../kernel/ai-provider.service';
export declare class AIAutomationService {
    /**
     * Classify content using the company's configured AI provider
     */
    static classifyDocument(text: string, settings: AISettings): Promise<{
        category: string;
    }>;
    /**
     * Detect priority for a task based on title and description
     */
    static detectTaskPriority(title: string, description: string, settings: AISettings): Promise<{
        priority: string;
    }>;
    /**
     * Predict project risk based on tasks
     */
    static predictProjectRisk(tasks: any[], settings: AISettings): Promise<{
        risk: string;
        reason: string;
    }>;
    /**
     * Draft a follow-up email based on an opportunity or lead context
     */
    static draftSalesEmail(context: string, settings: AISettings): Promise<{
        draft: string;
    }>;
    /**
     * Contextual conversational AI assistant for a sales representative
     */
    static salesAssistantChat(query: string, contextData: any, settings: AISettings): Promise<{
        reply: string;
    }>;
    /**
     * Generate an advanced forecast analysis relying on historical and current pipeline data.
     */
    static generateAdvancedForecast(contextData: any, settings: AISettings): Promise<any>;
}
export declare const aiAutomationService: typeof AIAutomationService;
