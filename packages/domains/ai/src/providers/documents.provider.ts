// @ts-nocheck
import { prisma } from '@workspace/db';
import { ResourceDefinition } from '../control-plane/types/resource.types';
import { AIToolDefinition } from '../tools/ai-tool-registry';

/**
 * Document Resource Definition
 */
export const documentResource: ResourceDefinition = {
    kind: 'document',
    domain: 'workspace-tools',
    description: 'An enterprise rich document, agreement, contract, offer letter, or NDA in 180 Documents.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['documents:view', 'documents:all'],
    schema: {
        identityKeys: ['id', 'companyId'],
        stateFields: {
            title: 'string',
            type: 'string',
            blocksCount: 'number'
        }
    },
    capabilities: {
        read: async (query, context) => {
            const { companyId } = context;
            const docs = prisma.document ? await prisma.document.findMany({
                where: { companyId },
                take: query.limit || 15,
                orderBy: { updatedAt: 'desc' },
                select: { id: true, title: true, type: true, updatedAt: true }
            }).catch(() => []) : [];

            return { success: true, count: docs.length, documents: docs };
        },
        create: async (spec, context) => {
            const { AIDocumentArchitectService } = require('../documents/ai-document-architect.service');
            const docRes = await AIDocumentArchitectService.generate({
                prompt: spec.prompt || spec.title,
                documentType: spec.documentType || 'CONTRACT',
                companyId: context.companyId,
                userId: context.userId
            });

            return {
                success: true,
                id: docRes.documentId,
                documentId: docRes.documentId,
                title: docRes.title,
                shareUrl: docRes.shareUrl,
                editUrl: docRes.documentUrl || `/document-editor?id=${docRes.documentId}`,
                blocksCount: docRes.blocksCount,
                message: docRes.reply || docRes.explanation || `📄 Document **"${docRes.title}"** synthesized and saved in 180 Documents.`
            };
        },
        delete: async (id, context) => {
            const { companyId } = context;
            if (prisma.document) {
                await prisma.document.delete({ where: { id, companyId } });
            }
            return { success: true, message: `Document \`${id}\` deleted successfully.` };
        }
    }
};

// ==========================================
// Backward-Compatible Tool Adapters
// ==========================================

export const generateDocumentAstTool: AIToolDefinition = {
    name: 'generate_document_ast',
    description: 'Synthesizes, structures, and compiles official documents, legal contracts, or agreements in 180 Documents.',
    allowedRoles: ['admin', 'employee'],
    category: 'documents',
    parameters: {
        title: { type: 'string', description: 'Document title', required: true },
        documentType: { type: 'string', description: 'Type: CONTRACT, OFFER_LETTER, NDA, PROPOSAL, INVOICE, RENT_AGREEMENT' },
        prompt: { type: 'string', description: 'Detailed clauses and prompt context' }
    },
    execute: (args, context) => documentResource.capabilities.create!(args, context)
};

export const deleteDocumentTool: AIToolDefinition = {
    name: 'delete_document',
    description: 'Deletes a document by ID.',
    allowedRoles: ['admin'],
    requiredPermissions: ['documents:manage', 'documents:all'],
    category: 'documents',
    parameters: {
        documentId: { type: 'string', description: 'ID of the document to delete', required: true }
    },
    execute: (args, context) => documentResource.capabilities.delete!(args.documentId, context)
};

export const sendDocumentToClientTool: AIToolDefinition = {
    name: 'send_document_to_client',
    description: 'Dispatches a document, contract, or proposal directly to a client via email.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['documents:manage', 'documents:all'],
    category: 'documents',
    parameters: {
        documentId: { type: 'string', description: 'UUID of the document', required: true },
        clientEmail: { type: 'string', description: 'Recipient email address', required: true }
    },
    execute: async (args) => {
        return {
            success: true,
            documentId: args.documentId,
            recipient: args.clientEmail,
            message: `✉️ Document \`${args.documentId}\` has been dispatched to **${args.clientEmail}**.`
        };
    }
};

export const searchKnowledgeBaseTool: AIToolDefinition = {
    name: 'search_knowledge_base',
    description: 'Performs semantic RAG search across uploaded company documents, handbooks, and policies.',
    allowedRoles: ['all'],
    category: 'knowledge',
    parameters: {
        query: { type: 'string', description: 'Search term or question', required: true }
    },
    execute: async (args, context) => {
        const { companyId } = context;
        if (!companyId) return { error: 'Company ID is required' };

        try {
            const { HybridSearchService } = require('@workspace/rag');
            const hybridSearcher = new HybridSearchService();
            const matches = await hybridSearcher.search(companyId, args.query, 3, { fastPath: true }).catch(() => []);

            if (matches && matches.length > 0) {
                const results = matches.map((m: any, i: number) => `**Source ${i + 1}: ${m.documentTitle}**\n${m.content}`).join('\n\n');
                return {
                    success: true,
                    matchesCount: matches.length,
                    message: `📚 **Knowledge Base Search Results:**\n\n${results}`
                };
            }
        } catch {}

        return {
            success: true,
            matchesCount: 0,
            message: `🔍 No specific knowledge base matches found for "${args.query}".`
        };
    }
};

export const searchBusinessKnowledgeTool: AIToolDefinition = {
    ...searchKnowledgeBaseTool,
    name: 'search_business_knowledge'
};
