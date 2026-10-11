// @ts-nocheck
import { prisma } from '@workspace/db';
import { aiProviderService } from '../kernel/ai-provider.service';

let intervalId: any = null;

export class AIJobsService {
    init(intervalMs?: number) {
        return AIJobsService.init(intervalMs);
    }

    stop() {
        return AIJobsService.stop();
    }

    static init(intervalMs: number = 60 * 1000) {
        console.log('[AIJobsService] Background Jobs Initialized');
        if (intervalId) clearInterval(intervalId);

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

            const impendingTasks = await prisma.task.findMany({
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
                if (!task.assigneeId) continue;

                const latestSession = await prisma.aiChatSession.findFirst({
                    where: { userId: task.assigneeId },
                    orderBy: { updatedAt: 'desc' }
                }).catch(() => null);

                if (latestSession) {
                    const existingAlert = await prisma.aiChatMessage.findFirst({
                        where: {
                            sessionId: latestSession.id,
                            role: 'assistant',
                            content: { contains: task.id }
                        }
                    }).catch(() => null);

                    if (!existingAlert) {
                        console.log(`[AIJobsService] Sending proactive alert for Task: ${task.title}`);

                        const prompt = `System Prompt: You are a proactive AI assistant. The user has a task named "${task.title}" due soon. Write a very brief (2 sentences max) proactive message to the user reminding them and asking if they need help drafting anything related to it. Do not include placeholders, write a direct message.`;

                        const generatedMsg = await aiProviderService.getInsights(prompt, { aiProvider: 'none' } as any);

                        await prisma.aiChatMessage.create({
                            data: {
                                sessionId: latestSession.id,
                                role: 'assistant',
                                content: `🔔 **Proactive Alert:**\n${generatedMsg}\n\n*(Ref Task: ${task.id})*`
                            }
                        }).catch(() => {});
                    }
                }
            }
        } catch (error) {
            console.error('[AIJobsService] Error in scanDeadlines:', error);
        }
    }
}

export const aiJobsService = AIJobsService;
export const AiJobsService = AIJobsService;
