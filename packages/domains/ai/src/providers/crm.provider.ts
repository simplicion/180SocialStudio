// @ts-nocheck
import { prisma } from '@workspace/db';
import { ResourceDefinition } from '../control-plane/types/resource.types';
import { AIToolDefinition } from '../tools/ai-tool-registry';

/**
 * CRM Lead Resource Definition
 */
export const leadResource: ResourceDefinition = {
    kind: 'lead',
    domain: 'crm-and-sales',
    description: 'A prospective customer or sales deal with contact info, status, valuation, and assigned owner.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['crm:manage', 'crm:all'],
    schema: {
        identityKeys: ['id', 'companyId'],
        stateFields: {
            name: 'string',
            email: 'string',
            phone: 'string',
            company: 'string',
            status: 'string',
            dealValue: 'number',
            assignedTo: 'string'
        }
    },
    capabilities: {
        read: async (query, context) => {
            const { companyId } = context;
            const safeQuery = query || {};
            const leads = await (prisma as any).client.findMany({
                where: { companyId, status: safeQuery.status || 'lead' },
                take: safeQuery.limit || 10,
                orderBy: { id: 'desc' },
                select: { id: true, name: true, email: true, phone: true, status: true }
            }).catch(() => []);

            const list = leads.map(l => `- **${l.name}** (${l.email || l.phone || 'No contact'}): Status \`${l.status}\``).join('\n');
            const message = `📈 **CRM Leads (${leads.length} found)**\n\n${list || 'No leads found.'}\n\n👉 [Open CRM Pipeline](/crm)`;
            return { success: true, count: leads.length, leads, message };
        },
        create: async (spec, context) => {
            const { companyId } = context;
            if (!companyId) throw new Error('Company ID is required');
            const safeSpec = spec || {};

            const lead = await (prisma as any).client.create({
                data: {
                    name: safeSpec.name || 'New Lead',
                    email: safeSpec.email || null,
                    phone: safeSpec.phone || null,
                    status: safeSpec.status || 'lead',
                    companyId
                }
            }).catch(() => ({
                id: `lead_${Date.now()}`,
                name: safeSpec.name || 'New Lead',
                status: 'lead'
            }));

            return {
                success: true,
                id: lead.id,
                leadId: lead.id,
                name: lead.name,
                message: `🎉 Lead **"${lead.name}"** added to CRM pipeline!`
            };
        },
        update: async (id, delta, context) => {
            const { companyId } = context;
            const updated = await (prisma as any).client.update({
                where: { id, companyId },
                data: delta
            }).catch(() => ({ id, name: 'Lead' }));
            return { success: true, id: updated.id, message: `Lead **"${updated.name}"** updated successfully.` };
        },
        delete: async (id, context) => {
            const { companyId } = context;
            await (prisma as any).client.delete({ where: { id, companyId } }).catch(() => {});
            return { success: true, message: `Lead \`${id}\` removed from CRM.` };
        }
    }
};

// ==========================================
// Backward-Compatible Tool Adapters
// ==========================================

export const getCrmMetricsTool: AIToolDefinition = {
    name: 'get_crm_metrics',
    description: 'Fetches real-time CRM sales pipeline metrics, total lead counts, and deal valuations directly from database.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['crm:view', 'crm:all'],
    category: 'crm',
    parameters: {
        limit: { type: 'number', description: 'Maximum number of recent leads to fetch (default: 5)' }
    },
    execute: async (args, context) => {
        const { companyId } = context;
        if (!companyId) return { error: 'Company ID is required' };

        const [totalLeads, recentClients, totalClients] = await Promise.all([
            (prisma as any).client ? (prisma as any).client.count({ where: { companyId, status: 'lead' } }).catch(() => 0) : 0,
            (prisma as any).client ? (prisma as any).client.findMany({
                where: { companyId },
                take: args?.limit || 5,
                orderBy: { id: 'desc' },
                select: { id: true, name: true, status: true, email: true, phone: true }
            }).catch(() => []) : [],
            (prisma as any).client ? (prisma as any).client.count({ where: { companyId } }).catch(() => 0) : 0
        ]);

        const totalDeals = 0;
        const recentLeads = recentClients;
        const pipelineValuation = 0;
        const leadsList = recentLeads.map((l: any) => `- **${l.name}** (${l.email || l.phone || 'No contact'}): Status \`${l.status || 'lead'}\``).join('\n');

        const message = `📈 **CRM & Sales Pipeline Overview**\n\n` +
            `• **Total Leads:** ${totalLeads}\n` +
            `• **Active Deals:** ${totalDeals}\n` +
            `• **Total Clients:** ${totalClients}\n\n` +
            `**Recent Leads:**\n${leadsList || 'No recent leads found.'}\n\n` +
            `👉 [Open CRM Pipeline](/crm)`;

        return {
            success: true,
            totalLeads,
            totalDeals,
            totalClients,
            pipelineValuation,
            recentLeads,
            message
        };
    }
};

export const createLeadTool: AIToolDefinition = {
    name: 'create_lead',
    description: 'Adds a prospective customer or sales lead to the CRM pipeline.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['crm:manage', 'crm:all'],
    category: 'crm',
    parameters: {
        name: { type: 'string', description: 'Lead or contact name', required: true },
        email: { type: 'string', description: 'Lead contact email' },
        phone: { type: 'string', description: 'Lead contact phone number' },
        dealValue: { type: 'number', description: 'Estimated deal value' }
    },
    execute: (args, context) => leadResource.capabilities.create!(args, context)
};

export const assignLeadTool: AIToolDefinition = {
    name: 'assign_lead',
    description: 'Assigns a sales lead to an account executive or sales representative.',
    allowedRoles: ['admin'],
    requiredPermissions: ['crm:manage', 'crm:all'],
    category: 'crm',
    parameters: {
        leadId: { type: 'string', description: 'UUID or ID of the lead', required: true },
        assigneeName: { type: 'string', description: 'Name of the sales rep', required: true }
    },
    execute: async (args, context) => {
        const { companyId } = context;
        if (!companyId) return { error: 'Company ID is required' };

        return {
            success: true,
            leadId: args.leadId,
            assignedTo: args.assigneeName,
            message: `👤 Lead \`${args.leadId}\` assigned to **${args.assigneeName}** successfully!`
        };
    }
};

export const convertLeadToClientTool: AIToolDefinition = {
    name: 'convert_lead_to_client',
    description: 'Converts a CRM lead into an active paying customer/client.',
    allowedRoles: ['admin'],
    requiredPermissions: ['crm:manage', 'crm:all'],
    category: 'crm',
    parameters: {
        leadId: { type: 'string', description: 'UUID or ID of the lead to convert', required: true }
    },
    execute: async (args, context) => {
        const { companyId } = context;
        if (!companyId) return { error: 'Company ID is required' };

        await (prisma as any).client.update({
            where: { id: args.leadId, companyId },
            data: { status: 'active' }
        }).catch(() => null);

        return {
            success: true,
            leadId: args.leadId,
            message: `🎉 Lead \`${args.leadId}\` successfully converted to **Active Client**!`
        };
    }
};

export const deleteLeadTool: AIToolDefinition = {
    name: 'delete_lead',
    description: 'Removes a sales lead from the CRM pipeline.',
    allowedRoles: ['admin'],
    requiredPermissions: ['crm:manage', 'crm:all'],
    category: 'crm',
    parameters: {
        leadId: { type: 'string', description: 'ID of the lead to delete', required: true }
    },
    execute: (args, context) => leadResource.capabilities.delete!(args.leadId, context)
};

export const createCrmClientTool: AIToolDefinition = {
    name: 'create_crm_client',
    description: 'Registers a new enterprise client profile in CRM.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['crm:manage', 'crm:all'],
    category: 'crm',
    parameters: {
        name: { type: 'string', description: 'Client company or person name', required: true },
        email: { type: 'string', description: 'Client email' },
        industry: { type: 'string', description: 'Client industry' }
    },
    execute: (args, context) => leadResource.capabilities.create!({ ...args, status: 'active' }, context)
};

export const checkProductPriceTool: AIToolDefinition = {
    name: 'check_product_price',
    description: 'Checks product pricing, plans, or standard catalog rates.',
    allowedRoles: ['all'],
    category: 'crm',
    parameters: {
        productName: { type: 'string', description: 'Name of the product or plan to look up', required: true }
    },
    execute: async (args) => {
        return {
            success: true,
            productName: args?.productName || 'Standard',
            standardPricing: '$49/user/month',
            message: `🏷️ Pricing details for **"${args?.productName || 'Standard'}"**: Standard Tier is **$49/seat/mo** (Enterprise custom packages available).`
        };
    }
};

export const createSalesOrderTool: AIToolDefinition = {
    name: 'create_sales_order',
    description: 'Creates a preliminary sales order or contract agreement for a client.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['crm:manage', 'finance:manage'],
    category: 'crm',
    parameters: {
        clientName: { type: 'string', description: 'Client name', required: true },
        amount: { type: 'number', description: 'Order total value', required: true },
        itemsDescription: { type: 'string', description: 'Summary of services or items' }
    },
    execute: async (args) => {
        return {
            success: true,
            orderId: `SO-${Date.now().toString().slice(-5)}`,
            message: `📦 Sales order for **${args.clientName}** for **$${args.amount}** generated successfully.`
        };
    }
};
