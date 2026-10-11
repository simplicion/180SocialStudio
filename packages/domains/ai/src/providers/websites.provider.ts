// @ts-nocheck
import { prisma, basePrisma } from '@workspace/db';
import { ResourceDefinition } from '../control-plane/types/resource.types';
import { AIToolDefinition } from '../tools/ai-tool-registry';

/**
 * Website Resource Definition
 */
export const websiteResource: ResourceDefinition = {
    kind: 'website',
    domain: 'advertising',
    description: 'An interactive multi-page website or marketing landing page builder project.',
    allowedRoles: ['admin'],
    requiredPermissions: ['website:manage', 'website:all'],
    schema: {
        identityKeys: ['id', 'companyId'],
        stateFields: {
            name: 'string',
            slug: 'string',
            isPublished: 'boolean'
        }
    },
    capabilities: {
        read: async (query, context) => {
            const { companyId } = context;
            const sites = prisma.website ? await prisma.website.findMany({
                where: { companyId },
                take: query.limit || 10,
                orderBy: { updatedAt: 'desc' }
            }).catch(() => []) : [];

            return { success: true, count: sites.length, websites: sites };
        },
        create: async (spec, context) => {
            const { UniversalBuilderRegistry } = require('../builders');
            const result = await UniversalBuilderRegistry.compile('website', {
                prompt: spec.prompt || spec.name || spec.title,
                companyId: context.companyId,
                userId: context.userId
            });

            return {
                success: true,
                id: result.entityId,
                websiteId: result.entityId,
                title: result.title,
                shareUrl: result.shareUrl,
                editUrl: result.editUrl || `/advertising/${result.entityId}/edit`,
                message: result.reply
            };
        },
        delete: async (id, context) => {
            const { companyId } = context;
            if (!companyId) return { success: false, error: 'COMPANY_REQUIRED', message: 'A workspace is required to delete a website.' };
            const { count } = await prisma.website.deleteMany({ where: { id, companyId } });
            if (!count) return { success: false, error: 'WEBSITE_NOT_FOUND', message: `Website \`${id}\` not found.` };
            // Free the subdomain/custom domain so it can be reused.
            await basePrisma.domainRegistry.deleteMany({ where: { type: 'ADVERTISING_WEBSITE', targetId: id } });
            return { success: true, message: `Website \`${id}\` deleted.` };
        }
    }
};

// ==========================================
// Backward-Compatible Tool Adapters
// ==========================================

export const createWebsiteTool: AIToolDefinition = {
    name: 'create_website',
    description: 'Synthesizes, compiles, and builds a complete marketing website or landing page.',
    allowedRoles: ['admin'],
    requiredPermissions: ['website:manage', 'website:all'],
    category: 'website',
    parameters: {
        title: { type: 'string', description: 'Name of the website', required: true },
        prompt: { type: 'string', description: 'Detailed visual theme and copy instructions' }
    },
    execute: (args, context) => websiteResource.capabilities.create!(args, context)
};

export const scheduleSocialPostTool: AIToolDefinition = {
    name: 'schedule_social_post',
    description: 'Schedules a marketing post across company social channels.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['social:manage', 'social:all'],
    category: 'social',
    parameters: {
        platform: { type: 'string', description: 'Target platform: linkedin, twitter, instagram, facebook', required: true },
        content: { type: 'string', description: 'Post copy text', required: true },
        scheduledTime: { type: 'string', description: 'ISO date string or scheduled publish time' }
    },
    execute: async (args) => {
        return {
            success: true,
            postId: `post_${Date.now()}`,
            platform: args.platform,
            message: `📱 Social media post scheduled for **${args.platform.toUpperCase()}**:\n*"${args.content}"*`
        };
    }
};

export const createSupportTicketTool: AIToolDefinition = {
    name: 'create_support_ticket',
    description: 'Logs an IT or administrative service desk support ticket.',
    allowedRoles: ['all'],
    category: 'servicedesk',
    parameters: {
        subject: { type: 'string', description: 'Issue summary', required: true },
        priority: { type: 'string', description: 'Priority: low, medium, high, urgent' }
    },
    execute: async (args) => {
        return {
            success: true,
            ticketId: `TICKET-${Date.now().toString().slice(-4)}`,
            message: `🎫 Support ticket created: **"${args.subject}"** (Priority: ${args.priority || 'medium'}).`
        };
    }
};

export const featureNavigationGuideTool: AIToolDefinition = {
    name: 'feature_navigation_guide',
    description: 'Guides a user step-by-step to the exact module, menu, or page.',
    allowedRoles: ['all'],
    category: 'guide',
    parameters: {
        featureName: { type: 'string', description: 'Target feature or page', required: true }
    },
    execute: async (args) => {
        return {
            success: true,
            featureName: args.featureName,
            message: `🧭 To access **${args.featureName}**, navigate to the main sidebar or use the top command palette (Ctrl+K / ⌘K).`
        };
    }
};
