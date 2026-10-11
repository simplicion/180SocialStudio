"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiJobsService = exports.aiJobsService = exports.AIJobsService = void 0;
// @ts-nocheck
const db_1 = require("@workspace/db");
const ai_provider_service_1 = require("../kernel/ai-provider.service");
let intervalId = null;
class AIJobsService {
    init(intervalMs) {
        return AIJobsService.init(intervalMs);
    }
    stop() {
        return AIJobsService.stop();
    }
    static init(intervalMs = 60 * 1000) {
        console.log('[AIJobsService] Background Jobs Initialized');
        if (intervalId)
            clearInterval(intervalId);
        intervalId = setInterval(async () => {
            await this.scanDeadlines();
        }, intervalMs);
    }
    static stop() {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
    }
    static async scanDeadlines() {
        try {
            const threeDaysFromNow = new Date();
            threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
            const impendingTasks = await db_1.prisma.task.findMany({
                where: {
                    dueDate: {
                        lte: threeDaysFromNow,
                        gte: new Date()
                    },
                    status: {
                        not: 'completed'
                    }
                },
                take: 10
            }).catch(() => []);
            for (const task of impendingTasks) {
                if (!task.assigneeId)
                    continue;
                const latestSession = await db_1.prisma.aiChatSession.findFirst({
                    where: { userId: task.assigneeId },
                    orderBy: { updatedAt: 'desc' }
                }).catch(() => null);
                if (latestSession) {
                    const existingAlert = await db_1.prisma.aiChatMessage.findFirst({
                        where: {
                            sessionId: latestSession.id,
                            role: 'assistant',
                            content: { contains: task.id }
                        }
                    }).catch(() => null);
                    if (!existingAlert) {
                        console.log(`[AIJobsService] Sending proactive alert for Task: ${task.title}`);
                        const prompt = `System Prompt: You are a proactive AI assistant. The user has a task named "${task.title}" due soon. Write a very brief (2 sentences max) proactive message to the user reminding them and asking if they need help drafting anything related to it. Do not include placeholders, write a direct message.`;
                        const generatedMsg = await ai_provider_service_1.aiProviderService.getInsights(prompt, { aiProvider: 'none' });
                        await db_1.prisma.aiChatMessage.create({
                            data: {
                                sessionId: latestSession.id,
                                role: 'assistant',
                                content: `🔔 **Proactive Alert:**\n${generatedMsg}\n\n*(Ref Task: ${task.id})*`
                            }
                        }).catch(() => { });
                    }
                }
            }
        }
        catch (error) {
            console.error('[AIJobsService] Error in scanDeadlines:', error);
        }
    }
}
exports.AIJobsService = AIJobsService;
exports.aiJobsService = AIJobsService;
exports.AiJobsService = AIJobsService;
