// @ts-nocheck
import { prisma } from '@workspace/db';
import { ResourceDefinition } from '../control-plane/types/resource.types';
import { AIToolDefinition } from '../tools/ai-tool-registry';

/**
 * Form Resource Definition
 */
export const formResource: ResourceDefinition = {
    kind: 'form',
    domain: 'workspace-tools',
    description: 'An interactive form builder intake with custom fields, submissions, and lead capture.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['forms:view', 'forms:all'],
    schema: {
        identityKeys: ['id', 'companyId'],
        stateFields: {
            title: 'string',
            slug: 'string',
            viewsCount: 'number'
        },
        relationships: {
            submissions: { targetKind: 'form_submission', type: 'one-to-many' }
        }
    },
    capabilities: {
        read: async (query, context) => {
            const { companyId } = context;
            const forms = await prisma.form.findMany({
                where: { companyId },
                include: { fields: true }
            }).catch(() => []);

            return { success: true, count: forms.length, forms };
        },
        create: async (spec, context) => {
            const { UniversalBuilderRegistry } = require('../builders');
            const result = await UniversalBuilderRegistry.compile('form', {
                prompt: spec.prompt || spec.title,
                companyId: context.companyId,
                userId: context.userId
            });

            return {
                success: true,
                id: result.entityId,
                formId: result.entityId,
                title: result.title,
                shareUrl: result.shareUrl,
                editUrl: result.editUrl || `/forms-builder?id=${result.entityId}`,
                message: result.reply
            };
        },
        delete: async (id, context) => {
            const { companyId } = context;
            await prisma.form.delete({ where: { id, companyId } });
            return { success: true, message: `Form \`${id}\` deleted successfully.` };
        }
    }
};

// ==========================================
// Backward-Compatible Tool Adapters
// ==========================================

export const generateFormAstTool: AIToolDefinition = {
    name: 'generate_form_ast',
    description: 'Synthesizes and creates a fully interactive web form or intake survey in 180 Forms.',
    allowedRoles: ['admin', 'employee'],
    category: 'forms',
    parameters: {
        title: { type: 'string', description: 'Form title or objective', required: true },
        prompt: { type: 'string', description: 'Detailed prompt for fields' }
    },
    execute: (args, context) => formResource.capabilities.create!(args, context)
};

export const deleteFormTool: AIToolDefinition = {
    name: 'delete_form',
    description: 'Deletes a form and its associated submissions.',
    allowedRoles: ['admin'],
    requiredPermissions: ['forms:manage', 'forms:all'],
    category: 'forms',
    parameters: {
        formId: { type: 'string', description: 'ID of the form to delete', required: true }
    },
    execute: (args, context) => formResource.capabilities.delete!(args.formId, context)
};

export const getFormSubmissionsTool: AIToolDefinition = {
    name: 'get_form_submissions',
    description: 'Retrieves all leads, submission records, and form analytics for a specific form or across all workspace forms.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['forms:view', 'forms:all', 'crm:view'],
    category: 'forms',
    parameters: {
        formName: { type: 'string', description: 'Name, title, or slug of the form to query' },
        limit: { type: 'number', description: 'Maximum submissions to return (default: 10)' }
    },
    execute: async (args, context) => {
        const { companyId } = context;
        if (!companyId) return { error: 'Company ID is required' };

        const rawInput = (args.formName || args.title || args.form || args.query || '').toString().trim();
        const cleanedKeyword = rawInput
            .replace(/^(hey|hi|please|could you|can you|check|look up|find|search|tell me|how many|leads are there in|leads in|form called|form named|the form|form)\s+/gi, '')
            .replace(/\s+(form|submissions|leads|data|leads data|how many|tell me)$/gi, '')
            .trim();

        const formQuery = (cleanedKeyword || rawInput).toLowerCase();

        const forms = await prisma.form.findMany({
            where: { companyId },
            include: {
                fields: true,
                submissions: {
                    orderBy: { submittedAt: 'desc' },
                    take: args.limit || 20,
                    include: {
                        values: { include: { field: true } }
                    }
                }
            }
        });

        if (forms.length === 0) {
            return {
                success: true,
                totalForms: 0,
                message: `📋 **Forms Overview**\n\nNo forms have been created in this workspace yet. You can ask me to create a new form anytime!`
            };
        }

        let matchedForm = null;
        if (formQuery) {
            matchedForm = forms.find(f => {
                const titleLower = f.title.toLowerCase();
                const slugLower = f.slug.toLowerCase();
                return titleLower.includes(formQuery) || formQuery.includes(titleLower) || slugLower === formQuery || slugLower.includes(formQuery);
            });
        }

        if (matchedForm) {
            const count = matchedForm.submissions.length;
            if (count === 0) {
                return {
                    success: true,
                    formId: matchedForm.id,
                    formTitle: matchedForm.title,
                    submissionsCount: 0,
                    message: `📋 **Form: "${matchedForm.title}"** (Slug: \`${matchedForm.slug}\`)\n\n• **Status:** Active\n• **Total Leads / Submissions:** 0\n• **Views:** ${matchedForm.viewsCount || 0}\n\nNo submissions recorded yet.\n\n👉 [Open Form in 180 Forms](/forms/${matchedForm.id})`
                };
            }

            const submissionsList = matchedForm.submissions.map((s, idx) => {
                const dateStr = new Date(s.submittedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                const fieldValues = s.values.map(v => `  - **${v.field?.label || 'Field'}:** ${v.value || v.fileName || 'N/A'}`).join('\n');
                return `**Lead #${idx + 1}** *(Submitted ${dateStr})*:\n${fieldValues || '  - *(No response fields)*'}`;
            }).join('\n\n');

            return {
                success: true,
                formId: matchedForm.id,
                formTitle: matchedForm.title,
                submissionsCount: count,
                message: `📋 **Form Leads for "${matchedForm.title}"**\n\nFound **${count} lead(s) / submission(s)**:\n\n${submissionsList}\n\n👉 [Open Form Analytics in 180 Forms](/forms/${matchedForm.id})`
            };
        }

        const totalSubs = forms.reduce((acc, f) => acc + f.submissions.length, 0);
        const formsOverview = forms.map(f => `- **"${f.title}"** (Slug: \`${f.slug}\`): **${f.submissions.length} leads / submissions** (Views: ${f.viewsCount || 0})`).join('\n');

        return {
            success: true,
            totalForms: forms.length,
            totalSubmissions: totalSubs,
            message: `📋 **Workspace Forms Overview** (${forms.length} forms, ${totalSubs} total leads):\n\n${formsOverview}\n\n👉 [Open 180 Forms Manager](/forms)`
        };
    }
};
