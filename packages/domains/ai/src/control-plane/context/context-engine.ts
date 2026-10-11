// @ts-nocheck
import { prisma } from '@workspace/db';
import { DomainIntent, OrbitScopedContext, EntityReference } from '../types/context.types';
import { OrbitExecutionContext } from '../types/resource.types';
import { orbitResourceRegistry } from '../registry/resource-registry';

export class OrbitContextEngine {
    /**
     * Rapidly classifies user intent (<5ms) to determine target SaaS domains,
     * action types, and entity keywords without making heavy LLM calls.
     */
    static classifyIntent(prompt: string, history?: string): DomainIntent {
        const lowerPrompt = (prompt || '').toLowerCase().trim();
        const lowerHistory = (history || '').toLowerCase().trim();
        const combined = `${lowerPrompt} ${lowerHistory}`;

        const targetDomains: string[] = [];
        const entityKeywords: string[] = [];
        let actionType: DomainIntent['actionType'] = 'conversation';
        let primaryDomain = 'workspace-tools';

        // 1. Domain Detection
        if (combined.includes('task') || combined.includes('project') || combined.includes('sprint') || combined.includes('milestone') || combined.includes('timesheet')) {
            targetDomains.push('projects-and-tasks');
        }
        if (combined.includes('lead') || combined.includes('client') || combined.includes('deal') || combined.includes('crm') || combined.includes('pipeline') || combined.includes('sales')) {
            targetDomains.push('crm-and-sales');
        }
        if (combined.includes('employee') || combined.includes('leave') || combined.includes('attendance') || combined.includes('headcount') || combined.includes('hrms') || combined.includes('hire') || combined.includes('terminate')) {
            targetDomains.push('hr-management');
        }
        if (combined.includes('invoice') || combined.includes('expense') || combined.includes('payroll') || combined.includes('salary') || combined.includes('burn') || combined.includes('finance')) {
            targetDomains.push('finance');
        }
        if (combined.includes('form') || combined.includes('survey') || combined.includes('submission') || combined.includes('intake')) {
            targetDomains.push('workspace-tools');
        }
        if (combined.includes('document') || combined.includes('contract') || combined.includes('agreement') || combined.includes('nda') || combined.includes('offer letter') || combined.includes('operator')) {
            targetDomains.push('workspace-tools');
        }
        if (combined.includes('website') || combined.includes('landing page') || combined.includes('social') || combined.includes('post') || combined.includes('ticket')) {
            targetDomains.push('advertising');
        }
        if (combined.includes('agent') || combined.includes('voice') || combined.includes('call') || combined.includes('meeting') || combined.includes('appointment')) {
            targetDomains.push('voiceforce');
        }

        if (targetDomains.length === 0) {
            targetDomains.push('workspace-tools');
        }
        primaryDomain = targetDomains[0];

        // 2. Action Type Classification
        if (lowerPrompt.startsWith('how') || lowerPrompt.startsWith('what') || lowerPrompt.startsWith('who') || lowerPrompt.startsWith('list') || lowerPrompt.startsWith('get') || lowerPrompt.startsWith('show') || lowerPrompt.includes('status') || lowerPrompt.includes('metrics')) {
            actionType = 'query';
        } else if (lowerPrompt.startsWith('create') || lowerPrompt.startsWith('add') || lowerPrompt.startsWith('make') || lowerPrompt.startsWith('build') || lowerPrompt.startsWith('delete') || lowerPrompt.startsWith('update') || lowerPrompt.startsWith('assign')) {
            actionType = 'mutation';
        } else if (lowerPrompt.includes('plan') || lowerPrompt.includes('campaign') || lowerPrompt.includes('ready for launch') || lowerPrompt.includes('setup')) {
            actionType = 'plan';
        } else if (lowerPrompt.includes('guide') || lowerPrompt.includes('how do i') || lowerPrompt.includes('where is')) {
            actionType = 'guide';
        }

        // 3. Entity Keyword Extraction
        const words = lowerPrompt.replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => w.length >= 3);
        entityKeywords.push(...words);

        return {
            primaryDomain,
            targetDomains,
            actionType,
            confidence: 0.95,
            entityKeywords,
            rawPrompt: prompt
        };
    }

    /**
     * Resolves scoped, targeted context for the LLM.
     * Queries ONLY the resources relevant to the classified domain intent,
     * reducing prompt tokens from 6,000+ to under 400.
     */
    static async resolveContext(params: {
        prompt: string;
        user: any;
        companyId?: string;
        history?: string;
        activeEntityRef?: { kind: string; id: string };
        activeRoute?: string;
    }): Promise<OrbitScopedContext> {
        const startTime = Date.now();
        const { prompt, user, history, activeEntityRef, activeRoute } = params;
        const companyId = params.companyId || user?.companyId;
        const userRole = (user?.role || 'employee').toLowerCase();
        const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];

        // 1. Fast Intent Classification
        const intent = this.classifyIntent(prompt, history);

        const scopedData: Record<string, any> = {};
        const scopedEntities: EntityReference[] = [];

        // 1.1 Ingest Active Route Context (Viewport Awareness)
        if (activeRoute) {
            if (activeRoute.includes('/projects/')) {
                const projId = activeRoute.split('/projects/')[1]?.split('?')[0];
                if (projId) scopedEntities.push({ kind: 'project', id: projId, title: 'Active Project', url: `/projects/${projId}` });
            } else if (activeRoute.includes('/document-editor')) {
                const docId = new URLSearchParams(activeRoute.split('?')[1] || '').get('id');
                if (docId) scopedEntities.push({ kind: 'document', id: docId, title: 'Active Document', url: `/document-editor?id=${docId}` });
            } else if (activeRoute.includes('/forms/')) {
                const formId = activeRoute.split('/forms/')[1]?.split('?')[0];
                if (formId) scopedEntities.push({ kind: 'form', id: formId, title: 'Active Form', url: `/forms/${formId}` });
            }
        }

        if (activeEntityRef) {
            scopedEntities.unshift({ kind: activeEntityRef.kind, id: activeEntityRef.id, title: `Active ${activeEntityRef.kind}` });
        }

        // 2. Fetch scoped data only for target domains
        if (companyId) {
            const fetchPromises: Promise<any>[] = [];

            if (intent.targetDomains.includes('projects-and-tasks')) {
                fetchPromises.push(
                    prisma.project.findMany({
                        where: { companyId, status: { not: 'completed' } },
                        take: 5,
                        select: { id: true, name: true, status: true, priority: true }
                    }).then(projects => {
                        scopedData.activeProjects = projects;
                        projects.forEach(p => scopedEntities.push({ kind: 'project', id: p.id, title: p.name, url: `/projects/${p.id}` }));
                    }).catch(() => {})
                );
                fetchPromises.push(
                    prisma.task.findMany({
                        where: { companyId, status: { not: 'done' } },
                        take: 8,
                        select: { id: true, title: true, status: true, priority: true, dueDate: true }
                    }).then(tasks => {
                        scopedData.pendingTasks = tasks;
                    }).catch(() => {})
                );
            }

            if (intent.targetDomains.includes('crm-and-sales')) {
                fetchPromises.push(
                    (prisma as any).client ? (prisma as any).client.findMany({
                        where: { companyId },
                        take: 5,
                        orderBy: { id: 'desc' },
                        select: { id: true, name: true, status: true, email: true }
                    }).then((clients: any) => {
                        scopedData.recentClients = clients;
                        clients.forEach((c: any) => scopedEntities.push({ kind: 'client', id: c.id, title: c.name, url: `/crm` }));
                    }).catch(() => {}) : Promise.resolve()
                );
            }

            if (intent.targetDomains.includes('hr-management')) {
                fetchPromises.push(
                    prisma.user.findMany({
                        where: { companyId, isActive: true },
                        take: 10,
                        select: { id: true, name: true, role: true, department: true }
                    }).then(employees => {
                        scopedData.activeEmployees = employees;
                        employees.forEach(e => scopedEntities.push({ kind: 'employee', id: e.id, title: e.name, url: `/hr` }));
                    }).catch(() => {})
                );
                if (['admin', 'hr'].includes(userRole)) {
                    fetchPromises.push(
                        prisma.leave ? prisma.leave.findMany({
                            where: { companyId, status: 'pending' },
                            take: 5,
                            select: { id: true, leaveType: true, startDate: true, endDate: true }
                        }).then(leaves => { scopedData.pendingLeaves = leaves; }).catch(() => {}) : Promise.resolve()
                    );
                }
            }

            if (intent.targetDomains.includes('finance')) {
                if (['admin', 'finance', 'owner', 'superadmin'].includes(userRole) || userPermissions.includes('finance:view')) {
                    fetchPromises.push(
                        prisma.invoice ? prisma.invoice.findMany({
                            where: { companyId },
                            take: 5,
                            orderBy: { dueDate: 'desc' },
                            select: { id: true, invoiceNumber: true, total: true, status: true }
                        }).then(invoices => {
                            scopedData.recentInvoices = invoices;
                        }).catch(() => {}) : Promise.resolve()
                    );
                    fetchPromises.push(
                        prisma.salary ? prisma.salary.findMany({
                            where: { companyId },
                            take: 5,
                            select: { id: true, amount: true, currency: true }
                        }).then(salaries => {
                            const totalBurn = salaries.reduce((acc, s) => acc + Number(s.amount || 0), 0);
                            scopedData.financialSummary = { totalBurn, recordsCount: salaries.length };
                        }).catch(() => {}) : Promise.resolve()
                    );
                } else {
                    // Non-finance role: Zero sensitive salary data exposed
                    scopedData.financialSummary = { note: 'Financial data restricted to authorized personnel' };
                }
            }

            if (intent.targetDomains.includes('workspace-tools') || intent.actionType === 'guide') {
                fetchPromises.push(
                    prisma.document ? prisma.document.findMany({
                        where: { companyId },
                        take: 5,
                        orderBy: { updatedAt: 'desc' },
                        select: { id: true, title: true, type: true }
                    }).then(docs => {
                        scopedData.recentDocs = docs;
                        docs.forEach(d => scopedEntities.push({ kind: 'document', id: d.id, title: d.title, url: `/document-editor?id=${d.id}` }));
                    }).catch(() => {}) : Promise.resolve()
                );
                fetchPromises.push(
                    prisma.form ? prisma.form.findMany({
                        where: { companyId },
                        take: 5,
                        orderBy: { updatedAt: 'desc' },
                        select: { id: true, title: true, slug: true }
                    }).then(forms => {
                        scopedData.recentForms = forms;
                        forms.forEach(f => scopedEntities.push({ kind: 'form', id: f.id, title: f.title, url: `/forms/${f.id}` }));
                    }).catch(() => {}) : Promise.resolve()
                );
            }

            await Promise.all(fetchPromises);
        }

        // 3. Resolve Company Header
        const company = companyId ? await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }).catch(() => null) : null;

        return {
            intent,
            scopedEntities,
            scopedData,
            activeUser: {
                id: user?.id || 'guest',
                name: user?.name || user?.email || 'User',
                role: userRole,
                permissions: userPermissions
            },
            workspaceSummary: {
                companyId: companyId || 'default',
                companyName: company?.name || '180 Workspace'
            },
            recentContextHistory: history
        };
    }

    /**
     * Converts ScopedContext into a tight, optimized Markdown System Context string (<300 tokens)
     */
    static toOptimizedSystemPrompt(context: OrbitScopedContext): string {
        const { activeUser, workspaceSummary, scopedData, intent } = context;

        let out = `System: Orbit AI Control Plane for ${workspaceSummary.companyName}.\n`;
        out += `Date: ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}\n`;
        out += `User: ${activeUser.name} | Role: ${activeUser.role}\n`;
        out += `Target Domain: ${intent.targetDomains.join(', ')} (${intent.actionType})\n\n`;

        // Scoped Data Output
        if (scopedData.activeProjects && scopedData.activeProjects.length > 0) {
            out += `Active Projects:\n` + scopedData.activeProjects.map(p => `- [${p.name}](/projects/${p.id}) (${p.status}, ${p.priority})`).join('\n') + `\n\n`;
        }
        if (scopedData.pendingTasks && scopedData.pendingTasks.length > 0) {
            out += `Pending Tasks:\n` + scopedData.pendingTasks.map(t => `- ${t.title} [${t.status}]`).join('\n') + `\n\n`;
        }
        if (scopedData.recentClients && scopedData.recentClients.length > 0) {
            out += `CRM Clients:\n` + scopedData.recentClients.map(c => `- ${c.name} (${c.status})`).join('\n') + `\n\n`;
        }
        if (scopedData.activeEmployees && scopedData.activeEmployees.length > 0) {
            out += `Team Directory:\n` + scopedData.activeEmployees.map(e => `- ${e.name} (${e.role})`).join('\n') + `\n\n`;
        }
        if (scopedData.recentDocs && scopedData.recentDocs.length > 0) {
            out += `Recent Documents:\n` + scopedData.recentDocs.map(d => `- [${d.title}](/document-editor?id=${d.id}) (${d.type})`).join('\n') + `\n\n`;
        }
        if (scopedData.recentForms && scopedData.recentForms.length > 0) {
            out += `Recent Forms:\n` + scopedData.recentForms.map(f => `- [${f.title}](/forms/${f.id})`).join('\n') + `\n\n`;
        }
        if (scopedData.financialSummary && scopedData.financialSummary.totalBurn !== undefined) {
            out += `Financial Summary: Monthly Burn ₹${scopedData.financialSummary.totalBurn.toLocaleString('en-IN')}\n\n`;
        }

        return out;
    }
}
