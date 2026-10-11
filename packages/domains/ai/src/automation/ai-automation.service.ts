import { aiProviderService, AISettings } from '../kernel/ai-provider.service';

export class AIAutomationService {
    /**
     * Classify content using the company's configured AI provider
     */
    static async classifyDocument(text: string, settings: AISettings) {
        if (!text) return { category: 'General' };

        try {
            const prompt = `Classify the following document content/description into one of these categories: [Invoice, Contract, Report, Identity, Technical, Personal, General]. Return only the category name.\n\nContent: ${text}`;
            const category = await aiProviderService.getInsights(prompt, settings);
            return { category: category.trim() || 'General' };
        } catch (err: any) {
            console.error('[AIAutomationService] Classification failed:', err.message);
            return { category: 'General' };
        }
    }

    /**
     * Detect priority for a task based on title and description
     */
    static async detectTaskPriority(title: string, description: string, settings: AISettings) {
        try {
            const prompt = `Analyze the following task and determine its priority (High, Medium, Low). Return only the priority name.\n\nTask Title: ${title}\nDescription: ${description}`;
            const priority = await aiProviderService.getInsights(prompt, settings);
            return { priority: priority.trim() || 'Medium' };
        } catch (err) {
            return { priority: 'Medium' };
        }
    }

    /**
     * Predict project risk based on tasks
     */
    static async predictProjectRisk(tasks: any[], settings: AISettings) {
        try {
            const taskData = tasks.map(t => `- ${t.title}: ${t.status}, due ${t.dueDate}`).join('\n');
            const prompt = `Analyze these project tasks and determine the overall project risk (High, Medium, Low). Also provide a brief reason.\n\nTasks:\n${taskData}`;
            const response = await aiProviderService.getInsights(prompt, settings);

            let risk = 'Low';
            if (response.toLowerCase().includes('high')) risk = 'High';
            else if (response.toLowerCase().includes('medium')) risk = 'Medium';

            return { risk, reason: response };
        } catch (err) {
            return { risk: 'Low', reason: 'Analytics unavailable' };
        }
    }

    /**
     * Draft a follow-up email based on an opportunity or lead context
     */
    static async draftSalesEmail(context: string, settings: AISettings) {
        try {
            const prompt = `You are a professional B2B sales representative drafting an email.
Do not use placeholders, just write a clean, concise, active-voice email.
Context about the prospect and deal:
${context}

Draft a highly engaging, short follow-up or introductory email based on the context above.`;

            const content = await aiProviderService.getInsights(prompt, settings);
            return { draft: content.trim() };
        } catch (err: any) {
            console.error('[AIAutomationService] Draft email failed:', err.message);
            return { draft: 'Hello,\n\nI am reaching out regarding our recent connection. Let me know when you are available to chat.\n\nBest regards,' };
        }
    }

    /**
     * Contextual conversational AI assistant for a sales representative
     */
    static async salesAssistantChat(query: string, contextData: any, settings: AISettings) {
        try {
            const prompt = `You are a helpful and intelligent Sales Assistant CRM AI.
You have access to the following context about the user's sales pipeline, leads, and metrics:
${JSON.stringify(contextData, null, 2)}

The user asks: "${query}"

Answer the user strictly based on the provided context data. If the answer is not in the context, say so. Keep it professional, concise, and helpful.`;

            const reply = await aiProviderService.getInsights(prompt, settings);
            return { reply: reply.trim() };
        } catch (err: any) {
            console.error('[AIAutomationService] Sales Chat failed:', err.message);
            return { reply: 'Sorry, I am having trouble connecting to the AI provider.' };
        }
    }

    /**
     * Generate an advanced forecast analysis relying on historical and current pipeline data.
     */
    static async generateAdvancedForecast(contextData: any, settings: AISettings) {
        try {
            const prompt = `You are an expert Chief Revenue Officer and Data Scientist.
Analyze the following sales pipeline and historical win/loss data to predict future revenue and provide actionable forecasting insights.

Data Context:
${JSON.stringify(contextData, null, 2)}

Provide a highly realistic assessment. Respond in this EXACT JSON structure, do not include markdown \`\`\`json wrappers, just raw JSON:
{
  "aiPredictedQuarterlyRevenue": number,
  "aiPredictedYearlyRevenue": number,
  "growthTrajectory": "Accelerating" | "Stable" | "Declining",
  "confidenceScore": number,
  "keyInsights": [ "insight 1", "insight 2" ],
  "riskFactors": [ "risk 1", "risk 2" ],
  "recommendedActions": [ "action 1", "action 2" ]
}
Make sure revenue numbers are realistic given the current pipeline and historical win rates.`;

            const reply = await aiProviderService.getInsights(prompt, settings);
            let jsonString = reply.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(jsonString);
            return result;
        } catch (err: any) {
            console.error('[AIAutomationService] Forecast generation failed:', err.message);
            return null;
        }
    }
}

export const aiAutomationService = AIAutomationService;
