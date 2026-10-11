"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIBusinessInsightsService = void 0;
// @ts-nocheck
const db_1 = require("@workspace/db");
const ai_provider_service_1 = require("../kernel/ai-provider.service");
const ai_company_config_service_1 = require("../kernel/ai-company-config.service");
class AIBusinessInsightsService {
    /**
     * Fully dynamic computation of business telemetry & live LLM executive synthesis.
     * ZERO hardcoding - queries real workspace tables and generates real AI summaries.
     */
    static async getDashboardInsights(companyId) {
        if (!companyId) {
            return {
                isConfigured: false,
                summary: '',
                metrics: {}
            };
        }
        // 1. Fetch real-time live database counts
        const [usersCount, projectsCount, completedProjectsCount, tasksCount, overdueTasksCount, completedTasksCount, leadsCount, unpaidInvoicesCount] = await Promise.all([
            db_1.prisma.user.count({ where: { companyId, isActive: true } }).catch(() => 0),
            db_1.prisma.project.count({ where: { companyId, status: { not: 'completed' } } }).catch(() => 0),
            db_1.prisma.project.count({ where: { companyId, status: 'completed' } }).catch(() => 0),
            db_1.prisma.task.count({ where: { companyId, status: { not: 'done' } } }).catch(() => 0),
            db_1.prisma.task.count({ where: { companyId, status: { not: 'done' }, dueDate: { lt: new Date() } } }).catch(() => 0),
            db_1.prisma.task.count({ where: { companyId, status: 'done' } }).catch(() => 0),
            db_1.prisma.lead.count({ where: { companyId } }).catch(() => 0),
            db_1.prisma.invoice ? db_1.prisma.invoice.count({ where: { companyId, status: { in: ['sent', 'overdue', 'pending'] } } }).catch(() => 0) : 0,
        ]);
        const metrics = {
            activeEmployees: usersCount,
            activeProjects: projectsCount,
            completedProjects: completedProjectsCount,
            pendingTasks: tasksCount,
            overdueTasks: overdueTasksCount,
            completedTasks: completedTasksCount,
            leadsCount,
            unpaidInvoices: unpaidInvoicesCount
        };
        // 2. Check if company has an active AI provider configured
        const { settings, companyName } = await ai_company_config_service_1.AICompanyConfigService.getCompanyAISettings(companyId);
        const isConfigured = Boolean((settings.aiProvider === 'gemini' && !!settings.geminiKey) ||
            (settings.aiProvider === 'openai' && !!settings.openaiKey) ||
            (settings.aiProvider === 'claude' && !!settings.claudeKey) ||
            (settings.aiProvider === 'custom' && !!settings.customAiKey && !!settings.customAiUrl));
        if (!isConfigured) {
            return {
                isConfigured: false,
                summary: '',
                metrics
            };
        }
        // 3. Prompt live LLM with actual company telemetry for dynamic AI synthesis
        const prompt = `You are the executive AI advisor for ${companyName}.
Analyze the following real-time workspace metrics and produce a concise 2-sentence executive summary with actionable CEO guidance:
- Active Team Members: ${usersCount}
- Active Projects: ${projectsCount} (Completed: ${completedProjectsCount})
- Pending Tasks: ${tasksCount} (Overdue: ${overdueTasksCount}, Completed: ${completedTasksCount})
- Sales Leads in Pipeline: ${leadsCount}
- Unpaid Invoices: ${unpaidInvoicesCount}
Synthesize these actual numbers directly into your analysis.`;
        const aiSummary = await ai_provider_service_1.aiProviderService.getInsights(prompt, settings);
        const isError = aiSummary.includes('Failed to generate') || aiSummary.includes('check your API key');
        return {
            isConfigured: !isError,
            error: isError ? aiSummary : null,
            summary: isError ? '' : aiSummary,
            text: isError ? '' : aiSummary,
            metrics
        };
    }
}
exports.AIBusinessInsightsService = AIBusinessInsightsService;
