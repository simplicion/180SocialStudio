"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AICRMCopilotService = void 0;
const ai_provider_service_1 = require("../kernel/ai-provider.service");
const ai_company_config_service_1 = require("../kernel/ai-company-config.service");
class AICRMCopilotService {
    /**
     * Drafts customized sales & follow-up emails using client context
     */
    static async generateEmailDraft(params) {
        const { recipientName, recipientEmail, purpose, dealValue, companyId } = params;
        const { settings, companyName } = await ai_company_config_service_1.AICompanyConfigService.getCompanyAISettings(companyId);
        const systemPrompt = `You are the Senior Sales Executive for ${companyName}.
Draft a highly persuasive, concise, and professional email to ${recipientName} (${recipientEmail}).

PURPOSE: ${purpose}
${dealValue ? `DEAL VALUE: ${dealValue}` : ''}

Output format:
Subject: [Compelling Subject Line]
Body: [Professional Email Body]`;
        const client = await ai_provider_service_1.aiProviderService.getClient(settings);
        if (client) {
            try {
                const response = await client.generate(systemPrompt, { max_tokens: 1000 });
                const lines = response.split('\n');
                const subjectLine = lines.find(l => l.startsWith('Subject:'))?.replace('Subject:', '').trim() || `Following up regarding our discussion - ${companyName}`;
                const body = lines.filter(l => !l.startsWith('Subject:')).join('\n').trim();
                return {
                    success: true,
                    subject: subjectLine,
                    body: body || response
                };
            }
            catch (err) {
                console.warn('[AICRMCopilotService] LLM error:', err.message);
            }
        }
        // Fallback email template
        return {
            success: true,
            subject: `Next Steps: Partnership with ${companyName}`,
            body: `Hi ${recipientName},\n\nI hope this note finds you well.\n\nFollowing up on our recent conversation regarding ${purpose}. We have prepared the preliminary scope of deliverables and are excited to support your objectives.\n\nPlease let me know if you have 10 minutes this week for a brief alignment call.\n\nBest regards,\n${companyName} Team`
        };
    }
}
exports.AICRMCopilotService = AICRMCopilotService;
