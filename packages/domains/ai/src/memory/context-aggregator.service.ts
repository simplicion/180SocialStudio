// @ts-nocheck
import { prisma } from '@workspace/db';

export interface WorkspaceCompanyContext {
    companyName: string;
    todayDate: string;
    clients: { id: string; name: string; email: string; companyName?: string }[];
    employees: { id: string; name: string; email: string; designation?: string }[];
    activeProjectsCount: number;
    openTasksCount: number;
    recentLeads: { id: string; title: string; status: string; value?: number }[];
}

export class ContextAggregatorService {
    /**
     * Gathers a lightning-fast snapshot of the company's operational state
     */
    static async getCompanyContext(companyId?: string): Promise<WorkspaceCompanyContext> {
        const todayDate = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

        if (!companyId) {
            return {
                companyName: '180 Workspace Enterprise',
                todayDate,
                clients: [],
                employees: [],
                activeProjectsCount: 0,
                openTasksCount: 0,
                recentLeads: []
            };
        }

        try {
            const [company, clients, employees, projectsCount, tasksCount, leads] = await Promise.all([
                prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }).catch(() => null),
                prisma.client.findMany({ where: { companyId }, take: 10, select: { id: true, name: true, email: true, companyName: true } }).catch(() => []),
                prisma.user.findMany({ 
                    where: { companyId }, 
                    take: 10, 
                    select: { id: true, name: true, email: true, designation: { select: { name: true } } } 
                }).catch(() => []),
                prisma.project.count({ where: { companyId, status: { not: 'COMPLETED' } } }).catch(() => 0),
                prisma.task.count({ where: { companyId, status: { not: 'DONE' } } }).catch(() => 0),
                prisma.lead.findMany({ 
                    take: 5, 
                    orderBy: { createdAt: 'desc' }, 
                    select: { id: true, name: true, status: true, value: true } 
                }).catch(() => [])
            ]);

            return {
                companyName: company?.name || '180 Workspace Enterprise',
                todayDate,
                clients: clients.map((c: any) => ({ id: c.id, name: c.name, email: c.email, companyName: c.companyName || undefined })),
                employees: employees.map((e: any) => ({ id: e.id, name: e.name, email: e.email, designation: e.designation?.name })),
                activeProjectsCount: projectsCount,
                openTasksCount: tasksCount,
                recentLeads: leads.map((l: any) => ({ id: l.id, title: l.name, status: l.status, value: Number(l.value) || 0 }))
            };
        } catch (error) {
            console.warn('[ContextAggregatorService] Could not aggregate full context:', error);
            return {
                companyName: '180 Workspace Enterprise',
                todayDate,
                clients: [],
                employees: [],
                activeProjectsCount: 0,
                openTasksCount: 0,
                recentLeads: []
            };
        }
    }
}
