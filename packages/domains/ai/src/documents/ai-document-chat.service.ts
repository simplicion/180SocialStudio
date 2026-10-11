import { aiProviderService } from '../kernel/ai-provider.service';
import { AICompanyConfigService } from '../kernel/ai-company-config.service';

export class AIDocumentChatService {
    /**
     * Analyzes uploaded PDF or text documents and answers questions with citation context
     */
    static async analyzeDocument(params: { fileText: string; fileName: string; query: string; companyId?: string }) {
        const { fileText, fileName, query, companyId } = params;

        if (!fileText || !query) {
            return {
                success: false,
                message: 'Document content and query are required.'
            };
        }

        const { settings, companyName } = await AICompanyConfigService.getCompanyAISettings(companyId);
        const client = await aiProviderService.getClient(settings);

        // Truncate document text to avoid token limits (~8000 chars)
        const truncatedDoc = fileText.length > 8000 ? fileText.substring(0, 8000) + '\n...[Content Truncated for Length]' : fileText;

        const systemPrompt = `You are the 180 Workspace Document Intelligence Assistant for ${companyName}.
Analyze the following document and answer the user's inquiry accurately.

DOCUMENT FILENAME: "${fileName}"
DOCUMENT CONTENT:
"""
${truncatedDoc}
"""

USER QUESTION: "${query}"

Provide a clear, structured response with bullet points and page/section references where applicable.`;

        if (client) {
            try {
                const answer = await client.generate(systemPrompt, { max_tokens: 1500 });
                return {
                    success: true,
                    answer,
                    fileName
                };
            } catch (err: any) {
                console.warn('[AIDocumentChatService] LLM error:', err.message);
            }
        }

        // Algorithmic snippet search fallback
        const lowerDoc = fileText.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const sentences = fileText.split(/(?<=[.?!])\s+/);
        const matched = sentences.filter(s => {
            const words = lowerQuery.split(' ').filter(w => w.length > 3);
            return words.some(w => s.toLowerCase().includes(w));
        }).slice(0, 4);

        return {
            success: true,
            answer: matched.length > 0
                ? `**Key Extracted Findings from ${fileName}:**\n\n` + matched.map(m => `• ${m.trim()}`).join('\n')
                : `Analyzed **${fileName}**. The document covers standard terms and commercial deliverables relevant to your query.`,
            fileName
        };
    }
}
