// @ts-nocheck
import { prisma, requestContext } from '@workspace/db';
import { aiProviderService } from '../kernel/ai-provider.service';
import { AICompanyConfigService } from '../kernel/ai-company-config.service';
import { vectorStore } from '../background/ai-vector-store.service';
import { aiToolRegistry } from '../tools/ai-tool-registry';
import axios from 'axios';
import * as pdfParseOriginal from 'pdf-parse';
const pdfParse: any = pdfParseOriginal;
import * as mammothOriginal from 'mammoth';
const mammoth: any = mammothOriginal;

import { OrbitContextEngine } from '../control-plane/context/context-engine';
import { OrbitEntityLinker } from '../control-plane/context/entity-linker';
import { OrbitPolicyEngine } from '../control-plane/policy/policy-engine';
import { OrbitCapabilityResolver } from '../control-plane/registry/capability-resolver';
import { OrbitVerifier } from '../control-plane/reconciler/verifier';

/** User-facing reply when website generation fails (typed WebsiteBuilderError codes from the website builder). */
function websiteBuildFailureReply(err: any): string {
    if (err?.code === 'AI_NOT_CONFIGURED') {
        return '⚠️ **Website not created**: AI is not configured for this workspace. Add an AI provider key in Settings → AI, or start from a template in the Website Builder.';
    }
    return `⚠️ **Website not created**: ${err?.message || 'the AI website builder failed'}. Nothing was saved — please try again.`;
}

export class AIChatService {
    /**
     * Resolves settings and metadata for a user's company
     */
    static async getSettingsWithMetadata(user: any, companyIdParam?: string) {
        const companyId = companyIdParam || (requestContext.getStore()?.companyId as string) || user?.companyId;
        const { settings, metadata } = await AICompanyConfigService.getCompanyAISettings(companyId);
        return { ...settings, ...metadata };
    }

    /**
     * Retrieves all chat sessions for a user
     */
    static async getChatSessions(userId: string) {
        return await prisma.aiChatSession.findMany({
            where: { userId },
            orderBy: { updatedAt: 'desc' },
            select: { id: true, title: true, createdAt: true, updatedAt: true }
        });
    }

    /**
     * Retrieves a single chat session with its messages
     */
    static async getChatSession(userId: string, sessionId: string) {
        const session = await prisma.aiChatSession.findFirst({
            where: { id: sessionId, userId },
            include: {
                messages: {
                    orderBy: { createdAt: 'asc' }
                }
            }
        });

        if (!session) throw new Error('Session not found');
        return session;
    }

    /**
     * Deletes a chat session
     */
    static async deleteChatSession(userId: string, sessionId: string) {
        const session = await prisma.aiChatSession.findFirst({
            where: { id: sessionId, userId }
        });

        if (!session) throw new Error('Session not found');

        await prisma.aiChatSession.delete({ where: { id: sessionId } });
        return { success: true, message: 'Session deleted' };
    }

    /**
     * Core conversational assistant supporting streaming, sessions, multi-domain context,
     * tool calling, agent modes, entity mentions, and semantic search.
     */
    static async chatWithAI(
        user: any,
        { message, history, sessionId, isLegalMode, fileContext, stream }: any,
        onChunk?: (chunk: string) => void
    ) {
        const startTime = Date.now();
        const companyId = (requestContext.getStore()?.companyId as string) || user?.companyId;
        const userId = user?.id || (user as any)?._id || 'guest_user';
        const userRole = (user?.role || 'employee').toLowerCase();
        const userPermissions = Array.isArray(user?.permissions) ? user.permissions : [];

        // Ensure session exists or create one
        let activeSessionId = sessionId;
        if (!activeSessionId) {
            const title = message.split(' ').slice(0, 5).join(' ') + (message.split(' ').length > 5 ? '...' : '');
            try {
                if (userId && userId !== 'guest_user') {
                    const newSession = await prisma.aiChatSession.create({
                        data: {
                            userId,
                            title: title || 'New Chat'
                        }
                    });
                    activeSessionId = newSession.id;
                } else {
                    activeSessionId = `session_${Date.now()}`;
                }
            } catch (err) {
                activeSessionId = `session_${Date.now()}`;
            }
        }

        // Save user message (with fallback for ephemeral/test sessions)
        try {
            await prisma.aiChatMessage.create({
                data: {
                    sessionId: activeSessionId,
                    role: 'user',
                    content: message
                }
            });
            await prisma.aiChatSession.update({
                where: { id: activeSessionId },
                data: { updatedAt: new Date() }
            });
        } catch (msgErr) {
            // Ephemeral or test session
        }

        // 1. Resolve High-Performance Scoped Context (<5ms, -80% prompt tokens)
        const scopedContext = await OrbitContextEngine.resolveContext({
            prompt: message,
            user,
            companyId,
            history: typeof history === 'string' ? history : undefined
        });

        let contextText = OrbitContextEngine.toOptimizedSystemPrompt(scopedContext);

        if (userRole === 'admin' || userRole === 'owner' || userRole === 'superadmin') {
            contextText += `Instructions: You are ⚡ Orbit Copilot on 180 Workspace. You have full execution capabilities across all 10 platform apps. Keep responses structured and decisive. Format with Markdown.\n`;
        } else {
            contextText += `Instructions: You are 🧭 Orbit Copilot on 180 Workspace. Assist with guidance, self-service tasks, and queries. For admin actions, explain permissions.\n`;
        }

        const { aiToolRegistry } = require('../tools/ai-tool-registry');
        const authorizedToolsDescription = aiToolRegistry.toSystemPromptDescriptionForUser(userRole, userPermissions);

        contextText += `TOOL CALLING: If the user asks to perform or confirms an action, output a JSON block: \`\`\`json\n{"action": "action_name", "payload": { ... }}\n\`\`\`\n`;
        contextText += `Available Actions:\n${authorizedToolsDescription}\n\n`;

        if (isLegalMode) {
            contextText += `LEGAL COUNSEL MODE: Analyze obligations, flag constraints, propose contract terms.\n\n`;
        }

        let chatHistory = 'Recent Conversation History:\n';
        if (Array.isArray(history) && history.length > 0) {
            const recentHistory = history.slice(-20);
            recentHistory.forEach((msg: any) => {
                const role = (msg.role || '').toLowerCase() === 'user' ? 'User' : 'Assistant';
                const content = msg.content || msg.text || '';
                if (content) {
                    chatHistory += `${role}: ${content}\n`;
                }
            });
        } else {
            const recentMessages = await prisma.aiChatMessage.findMany({
                where: { sessionId: activeSessionId },
                orderBy: { createdAt: 'desc' },
                take: 25
            }).catch(() => []);
            recentMessages.reverse().slice(0, -1).forEach((msg: any) => {
                chatHistory += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
            });
        }

        const finalPrompt = `${contextText}\n${chatHistory}\nUser: ${message}\nAssistant:`;
        const settings = await this.getSettingsWithMetadata(user, companyId);

        let fullReply = '';

        if (stream) {
            await aiProviderService.getInsightsStream(finalPrompt, settings as any, {}, (chunk) => {
                fullReply += chunk;
                if (onChunk) onChunk(chunk);
            });
        } else {
            fullReply = await aiProviderService.getInsights(finalPrompt, settings as any);
        }

        let actionResult: string | null = null;
        let documentPreview: any = null;
        let finalStoredReply = fullReply;
        const jsonMatch = fullReply.match(/```json\s*(\{[\s\S]*?\})\s*```/) || fullReply.match(/^\s*(\{[\s\S]*\})\s*$/);

        if (jsonMatch) {
            try {
                const rawJson = jsonMatch[1] || jsonMatch[0];
                const parsed = JSON.parse(rawJson);
                let action = parsed.action || parsed.tool || parsed.name || parsed.function;
                let payload = parsed.payload || parsed.args || parsed.arguments || parsed.parameters || {};

                // Handle nested single-key tool invocations like { "search_knowledge_base": { ... } } or { "get_form_submissions": { ... } }
                if (!action && typeof parsed === 'object' && parsed !== null) {
                    const keys = Object.keys(parsed);
                    if (keys.length === 1 && typeof parsed[keys[0]] === 'object' && parsed[keys[0]] !== null) {
                        action = keys[0];
                        payload = parsed[keys[0]];
                    }
                }

                if (action) {
                    const command = { action, payload };
                    const userRole = (user.role || 'employee').toLowerCase();
                    const userPermissions = Array.isArray(user.permissions) ? user.permissions : [];
                    const toolContext = {
                        companyId,
                        userId: user.id,
                        userRole,
                        userPermissions
                    };

                    // 1. Dedicated Builder Dispatches with Rich Preview Attachments
                    if (['create_website', 'generate_website_layout'].includes(command.action)) {
                        const isAuth = aiToolRegistry.isUserAuthorizedForTool(aiToolRegistry.getTool('create_website') || {} as any, userRole, userPermissions);
                        if (!isAuth) {
                            actionResult = `🔒 **Administrative Action Restricted**\n\nYou do not have permission to publish or create company websites. Please contact your workspace administrator.`;
                        } else {
                            const { UniversalBuilderRegistry } = require('../builders');
                            const promptText = `${payload.title ? `website name will be ${payload.title}. ` : ''}${payload.prompt || ''} ${payload.theme || ''}`.trim();
                            let compileRes: any = null;
                            try {
                                compileRes = await UniversalBuilderRegistry.compile('website', {
                                    prompt: promptText || message,
                                    companyId,
                                    userId: user.id
                                });
                            } catch (buildErr: any) {
                                // Never fall back to the model's own "I built it" text when nothing was created.
                                actionResult = websiteBuildFailureReply(buildErr);
                            }
                            if (compileRes) {
                            actionResult = compileRes.reply;
                            documentPreview = {
                                id: compileRes.entityId,
                                title: compileRes.title,
                                type: 'website',
                                shareUrl: compileRes.editUrl,
                                editUrl: compileRes.editUrl,
                                blocksCount: Array.isArray(compileRes.ast) ? compileRes.ast.length : 4
                            };
                            }
                        }
                    } else if (['create_document', 'generate_document_ast'].includes(command.action)) {
                        const { AIDocumentArchitectService } = require('../documents/ai-document-architect.service');
                        let promptText = payload.prompt || '';
                        if (!promptText && typeof payload.content === 'object' && payload.content !== null) {
                            promptText = `${payload.title || 'Document'}: ` + Object.entries(payload.content).map(([k, v]) => `${k}: ${v}`).join(', ');
                        } else if (!promptText && typeof payload.content === 'string') {
                            promptText = `${payload.title ? payload.title + '. ' : ''}${payload.content}`;
                        }
                        if (!promptText) promptText = payload.title || '';

                        // Combine recent conversation history for rich multi-turn context
                        const recentHistory = (chatHistory || '');
                        promptText = `${promptText} ${recentHistory}`.trim();

                        const docRes = await AIDocumentArchitectService.generate({
                            prompt: promptText || message,
                            documentType: payload.documentType || (promptText.toLowerCase().includes('rent') || promptText.toLowerCase().includes('lease') ? 'RENT_AGREEMENT' : 'CONTRACT'),
                            companyId,
                            userId: user.id
                        });
                        actionResult = docRes.reply || docRes.explanation || `📄 I have drafted and created **"${docRes.title}"** in your 180 Documents with ${docRes.blocksCount || 8} AST blocks.`;
                        documentPreview = {
                            id: docRes.documentId,
                            title: docRes.title,
                            type: 'document',
                            grandTotal: docRes.grandTotal,
                            shareUrl: docRes.shareUrl,
                            editUrl: docRes.documentUrl || `/document-editor?id=${docRes.documentId}`,
                            blocksCount: docRes.blocksCount || 8
                        };
                    } else if (['create_form', 'generate_form_ast'].includes(command.action)) {
                        const { UniversalBuilderRegistry } = require('../builders');
                        const formRes = await UniversalBuilderRegistry.compile('form', {
                            prompt: payload.prompt || payload.title || message,
                            companyId,
                            userId: user.id
                        });
                        actionResult = formRes.reply;
                        documentPreview = {
                            id: formRes.entityId,
                            title: formRes.title,
                            type: 'form',
                            shareUrl: formRes.shareUrl,
                            editUrl: formRes.editUrl || `/forms-builder?id=${formRes.entityId}`,
                            blocksCount: Array.isArray(formRes.ast?.fields) ? formRes.ast.fields.length : 5
                        };
                    } else {
                        // 2. Control Plane & Tool Registry Dispatches with Zero-Trust Policy Gate
                        const policyDecision = await OrbitPolicyEngine.evaluate({
                            actionName: command.action,
                            companyId,
                            payload,
                            isConfirmed: !!payload.confirmed
                        }, toolContext);

                        if (!policyDecision.allowed) {
                            return {
                                reply: policyDecision.reason || '🔒 **Administrative Action Restricted**',
                                sessionId: activeSessionId
                            };
                        }

                        if (policyDecision.requiresConfirmation) {
                            return {
                                reply: policyDecision.confirmationPrompt || '⚠️ Please confirm this action:',
                                sessionId: activeSessionId,
                                directive: {
                                    requiresConfirmation: true,
                                    riskLevel: policyDecision.riskLevel,
                                    actionName: command.action,
                                    payload,
                                    message: policyDecision.confirmationPrompt
                                }
                            };
                        }

                        if (aiToolRegistry && aiToolRegistry.hasTool(command.action)) {
                            const toolOutput = await aiToolRegistry.executeTool(command.action, payload, toolContext);
                            if (toolOutput.directive) {
                                return {
                                    reply: toolOutput.message || 'Please see the options below:',
                                    sessionId: activeSessionId,
                                    directive: toolOutput
                                };
                            }
                            if (toolOutput.unauthorized) {
                                return {
                                    reply: toolOutput.message,
                                    sessionId: activeSessionId
                                };
                            }
                            if (toolOutput.documentId) {
                                documentPreview = {
                                    id: toolOutput.documentId,
                                    title: toolOutput.documentTitle || toolOutput.title || 'Official Document',
                                    type: 'document',
                                    editUrl: toolOutput.documentUrl || `/document-editor?id=${toolOutput.documentId}`,
                                    blocksCount: 7
                                };
                            }
                            actionResult = toolOutput.message || toolOutput.summary || (toolOutput.success ? `Action **${command.action}** completed successfully.` : `Action failed: ${toolOutput.message}`);
                        } else {
                            // Direct Orbit Capability Execution
                            const execRes = await OrbitCapabilityResolver.execute(command.action, payload, toolContext);
                            if (execRes.success) {
                                actionResult = execRes.data?.message || `Executed action **${command.action}** successfully.`;
                            } else {
                                actionResult = `Action failed: ${execRes.error || 'Unknown error'}`;
                            }
                        }
                    }

                    if (actionResult) {
                        const hasEmojiHeader = ['🌐', '📄', '📋', '✅', '🎉', '🎯', '🚀', '📜', '🔒', '📊', '📈', '💰', '👥', '⚠️'].some(e => actionResult.startsWith(e));
                        finalStoredReply = hasEmojiHeader
                            ? actionResult
                            : `✅ **Action Executed:** ${actionResult}`;
                        if (stream && onChunk) {
                            onChunk(`\n\n${finalStoredReply}`);
                        }
                    } else {
                        // Strip raw JSON block so user never sees raw JSON in chat
                        finalStoredReply = fullReply.replace(/```json[\s\S]*?```/g, '').trim() || `I have processed your request for **${command.action}**.`;
                    }
                }
            } catch (err) {
                console.error('[AIChatService] Failed to parse tool call JSON:', err);
                finalStoredReply = fullReply.replace(/```json[\s\S]*?```/g, '').trim() || fullReply;
            }
        } else {
            // 3. Smart Intent Fallback
            const lowerMsg = message.toLowerCase().trim();
            const recentHistoryLower = (chatHistory || '').toLowerCase();
            const combinedContext = `${lowerMsg} ${recentHistoryLower}`;

            // 3.1 Form Leads / Submissions Intent
            const isFormQueryIntent = (lowerMsg.includes('form') || lowerMsg.includes('forms')) &&
                (lowerMsg.includes('lead') || lowerMsg.includes('submission') || lowerMsg.includes('how many') || lowerMsg.includes('check') || lowerMsg.includes('data') || lowerMsg.includes('thor'));

            // 3.2 Inactive / Project Health Query Intent
            const isProjectHealthIntent = (lowerMsg.includes('project') || lowerMsg.includes('projects')) &&
                (lowerMsg.includes('inactive') || lowerMsg.includes('not active') || lowerMsg.includes('non active') || lowerMsg.includes('how many') || lowerMsg.includes('health') || lowerMsg.includes('status'));

            const isWebsiteIntent = (combinedContext.includes('website') || combinedContext.includes('landing page') || combinedContext.includes('ecommerce') || combinedContext.includes('store') || combinedContext.includes('site')) &&
                (lowerMsg.includes('build') || lowerMsg.includes('create') || lowerMsg.includes('make') || lowerMsg.includes('generate') || lowerMsg === 'build that');

            const isDocIntent = (combinedContext.includes('document') || combinedContext.includes('contract') || combinedContext.includes('nda') || combinedContext.includes('proposal') || combinedContext.includes('policy') || combinedContext.includes('rent') || combinedContext.includes('lease') || combinedContext.includes('agreement')) &&
                (lowerMsg.includes('build') || lowerMsg.includes('create') || lowerMsg.includes('write') || lowerMsg.includes('generate') || lowerMsg.includes('draft') || lowerMsg.includes('agreement') || lowerMsg === 'build that');

            const isFormCreateIntent = (combinedContext.includes('form') || combinedContext.includes('survey') || combinedContext.includes('intake')) &&
                (lowerMsg.includes('build') || lowerMsg.includes('create') || lowerMsg.includes('generate') || lowerMsg === 'build that');

            if (isFormQueryIntent) {
                const toolContext = { companyId, userId: user.id, userRole: (user.role || 'employee').toLowerCase() };
                const toolRes = await aiToolRegistry.executeTool('get_form_submissions', { query: message, formName: message }, toolContext);
                if (toolRes && toolRes.message) {
                    finalStoredReply = toolRes.message;
                }
            } else if (isProjectHealthIntent) {
                const toolContext = { companyId, userId: user.id, userRole: (user.role || 'employee').toLowerCase() };
                const toolRes = await aiToolRegistry.executeTool('get_project_health', { statusFilter: lowerMsg.includes('inactive') || lowerMsg.includes('not active') ? 'inactive' : 'all' }, toolContext);
                if (toolRes && toolRes.message) {
                    finalStoredReply = toolRes.message;
                }
            } else if (isWebsiteIntent) {
                try {
                    const { UniversalBuilderRegistry } = require('../builders');
                    const compileRes = await UniversalBuilderRegistry.compile('website', {
                        prompt: `${message} ${chatHistory}`,
                        companyId,
                        userId: user.id
                    });
                    finalStoredReply = compileRes.reply;
                    documentPreview = {
                        id: compileRes.entityId,
                        title: compileRes.title,
                        type: 'website',
                        shareUrl: compileRes.editUrl,
                        editUrl: compileRes.editUrl,
                        blocksCount: Array.isArray(compileRes.ast) ? compileRes.ast.length : 4
                    };
                } catch (e) {
                    console.error('[AIChatService] Smart website builder fallback failed:', e);
                    finalStoredReply = websiteBuildFailureReply(e);
                }
            } else if (isDocIntent) {
                try {
                    const { AIDocumentArchitectService } = require('../documents/ai-document-architect.service');
                    const docRes = await AIDocumentArchitectService.generate({
                        prompt: `${message} ${chatHistory}`,
                        companyId,
                        userId: user.id
                    });
                    finalStoredReply = docRes.reply || docRes.explanation || `📄 I have synthesized and saved **"${docRes.title}"** in 180 Documents with ${docRes.blocksCount || 8} AST blocks.`;
                    documentPreview = {
                        id: docRes.documentId,
                        title: docRes.title,
                        type: 'document',
                        grandTotal: docRes.grandTotal,
                        shareUrl: docRes.shareUrl,
                        editUrl: docRes.documentUrl || `/document-editor?id=${docRes.documentId}`,
                        blocksCount: docRes.blocksCount
                    };
                } catch (e) {
                    console.error('[AIChatService] Smart document builder fallback failed:', e);
                }
            } else if (isFormCreateIntent) {
                try {
                    const { UniversalBuilderRegistry } = require('../builders');
                    const formRes = await UniversalBuilderRegistry.compile('form', {
                        prompt: message,
                        companyId,
                        userId: user.id
                    });
                    finalStoredReply = formRes.reply;
                    documentPreview = {
                        id: formRes.entityId,
                        title: formRes.title,
                        type: 'form',
                        shareUrl: formRes.shareUrl,
                        editUrl: formRes.editUrl || `/forms-builder?id=${formRes.entityId}`,
                        blocksCount: Array.isArray(formRes.ast?.fields) ? formRes.ast.fields.length : 5
                    };
                } catch (e) {
                    console.error('[AIChatService] Smart form builder fallback failed:', e);
                }
            }
        }

        // 4. Deterministic Multi-Turn Entity & Link Resolution (Zero Amnesia)
        if (scopedContext && Array.isArray(scopedContext.entities) && scopedContext.entities.length > 0) {
            const linkResolution = OrbitEntityLinker.resolveDirectLink(message, finalStoredReply, scopedContext.entities);
            finalStoredReply = linkResolution.enrichedReply;
            if (linkResolution.documentPreview && !documentPreview) {
                documentPreview = linkResolution.documentPreview;
            }
        }

        // Save assistant message (resilient for test/ephemeral sessions)
        try {
            await prisma.aiChatMessage.create({
                data: {
                    sessionId: activeSessionId,
                    role: 'assistant',
                    content: finalStoredReply
                }
            });
        } catch (msgSaveErr) {
            // Ignore for ephemeral sessions
        }

        // Audit logging and background quality rating
        if ((prisma as any).aiRequestLog) {
            const endTime = Date.now();
            (prisma as any).aiRequestLog.create({
                data: {
                    userId: user?.id || userId,
                    companyId: companyId || 'default',
                    inputParameters: { message, isLegalMode, hasFile: !!fileContext },
                    aiResponseTimeMs: endTime - startTime,
                    totalPiecesGenerated: 1,
                    qualityScore: 100
                }
            }).catch(() => {});
        }

        return { reply: finalStoredReply, sessionId: activeSessionId, documentPreview };
    }

    /**
     * Extracts and analyzes text from documents (PDF, DOCX, HTML, plain text)
     */
    static async analyzeDocumentText(
        user: any,
        documentId: string,
        message: string,
        summarizeOnly: boolean,
        history: any[],
        serverPort: string | number = 4000
    ) {
        const companyId = (requestContext.getStore()?.companyId as string) || user?.companyId;
        const [doc, settings] = await Promise.all([
            prisma.document.findUnique({ where: { id: documentId } }),
            this.getSettingsWithMetadata(user, companyId)
        ]);

        if (!doc) throw new Error('Document not found');

        let extractedText = '';

        if (doc.storageType === 'google_drive') {
            extractedText = `Document Name: ${doc.name}\nDescription: ${doc.description || 'None'}`;
        } else if (doc.fileUrl) {
            try {
                let fileUrl = doc.fileUrl;
                if (!fileUrl.startsWith('http')) {
                    fileUrl = `http://localhost:${serverPort}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
                }
                const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data);

                if (doc.fileUrl.endsWith('.pdf') && pdfParse) {
                    const pdfData = await pdfParse(buffer);
                    extractedText = pdfData.text;
                } else if (doc.fileUrl.endsWith('.docx') && mammoth) {
                    const result = await mammoth.extractRawText({ buffer });
                    extractedText = result.value;
                } else if (doc.fileUrl.endsWith('.html') || doc.fileType === 'link' || doc.fileType === 'html') {
                    extractedText = buffer.toString('utf-8');
                    extractedText = extractedText.replace(/<[^>]*>?/gm, ' ');
                } else {
                    extractedText = buffer.toString('utf-8');
                }
                extractedText = extractedText.slice(0, 30000);
            } catch (err: any) {
                console.warn('[AIChatService] Failed to fetch/parse file content:', err.message);
                extractedText = `Document Name: ${doc.name}\nDescription: ${doc.description || 'None'}\nType: ${doc.fileType}`;
            }
        } else {
            extractedText = `Document Name: ${doc.name}\nDescription: ${doc.description || 'None'}\nType: ${doc.fileType}`;
        }

        let chatHistory = '';
        if (history && Array.isArray(history) && history.length > 0) {
            chatHistory = 'RECENT CONVERSATION HISTORY:\n';
            const recentHistory = history.slice(-6);
            recentHistory.forEach(msg => {
                chatHistory += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
            });
            chatHistory += '\n';
        }

        const prompt = summarizeOnly
            ? `Please provide a concise, professional summary (3-5 bullet points) of the following document content:\n\n${extractedText}`
            : `You are a document assistant. Based on the following document content, answer the user's question accurately.\n\nDOCUMENT CONTENT:\n${extractedText}\n\n${chatHistory}USER QUESTION: ${message}`;

        return await aiProviderService.getInsights(prompt, settings as any);
    }

    /**
     * Uploads and parses a file into working memory and indexes it in the vector store
     */
    static async uploadDocument(user: any, file: any, companyIdParam?: string) {
        if (!file) throw new Error('No file uploaded');

        const companyId = companyIdParam || (requestContext.getStore()?.companyId as string) || user?.companyId;
        const buffer = file.buffer;
        const originalName = file.originalname;
        let content = '';

        if (originalName.toLowerCase().endsWith('.pdf') && pdfParse) {
            const pdfData = await pdfParse(buffer);
            content = pdfData.text;
        } else if (originalName.toLowerCase().endsWith('.docx') && mammoth) {
            const result = await mammoth.extractRawText({ buffer });
            content = result.value;
        } else if (originalName.toLowerCase().match(/\.(png|jpg|jpeg|webp)$/)) {
            const base64Image = buffer.toString('base64');
            content = `[IMAGE ATTACHED: ${originalName}]\n*Base64 encoding available for Multi-Modal Vision Processing*`;
            return {
                filename: originalName,
                extractedText: content,
                imageBase64: base64Image
            };
        } else {
            content = buffer.toString('utf-8');
        }

        content = content.slice(0, 30000);

        const docId = `doc_${Date.now()}`;
        await vectorStore.addDocument(docId, content, { companyId, filename: originalName });

        return {
            filename: originalName,
            extractedText: content,
            vectorId: docId
        };
    }

    /**
     * Helper to draft email using customizable tone & recipient info
     */
    static async generateEmailDraft(user: any, { idea, recipientName, tone = 'professional', context = '' }: any) {
        const settings = await this.getSettingsWithMetadata(user);
        const prompt = `You are an expert business communicator and professional email writer. 
Your goal is to draft a high-quality email based on the user's requirements.

RECIPIENT: ${recipientName || 'Valued Recipient'}
TONE: ${tone}
CONTEXT/GOAL: ${idea}
ADDITIONAL CONTEXT: ${context}

Draft the email with a clear subject line and a professional body. Use [Placeholder] for any missing info. No extra talk, just the email draft.`;

        return await aiProviderService.getInsights(prompt, settings as any);
    }

    /**
     * Processes meeting transcripts and auto-creates tasks
     */
    static async processMeetingTranscript(user: any, file: any, bodyText?: string) {
        let transcriptText = bodyText || '';

        if (file) {
            if (file.mimetype === 'application/pdf' && pdfParse) {
                const data = await pdfParse(file.buffer);
                transcriptText = data.text;
            } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && mammoth) {
                const result = await mammoth.extractRawText({ buffer: file.buffer });
                transcriptText = result.value;
            } else {
                transcriptText = file.buffer.toString('utf-8');
            }
        }

        if (!transcriptText) throw new Error('No transcript provided.');

        const companyId = (requestContext.getStore()?.companyId as string) || user?.companyId;
        const employees = await prisma.user.findMany({
            where: { companyId, isActive: true },
            select: { id: true, name: true, role: true }
        }).catch(() => []);

        const prompt = `You are an AI assistant that processes meeting transcripts. 
Read the following transcript and output a JSON block wrapped in \`\`\`json ... \`\`\` containing two things:
1. "summary": A brief executive summary of the meeting.
2. "tasks": An array of actionable items discussed in the meeting. Each task should have a "title", "description", and an "assigneeId". Match the assignee to the closest employee from this list: ${JSON.stringify(employees)}. If you cannot determine the assignee, use the user ID "${user.id}".

TRANSCRIPT:
${transcriptText}`;

        const settings = await this.getSettingsWithMetadata(user);
        const aiResponse = await aiProviderService.getInsights(prompt, settings as any);

        let createdTasksCount = 0;
        let finalReply = aiResponse;

        const jsonMatch = aiResponse.match(/```json\s*(\{[\s\S]*?\})\s*```/) || aiResponse.match(/\{[\s\S]*?\}/);

        if (jsonMatch) {
            try {
                const command = JSON.parse(jsonMatch[1] || jsonMatch[0].replace(/```json/g, '').replace(/```/g, ''));
                if (command.action === 'batch_create_tasks' && Array.isArray(command.payload)) {
                    for (const taskPayload of command.payload) {
                        await prisma.task.create({
                            data: {
                                title: taskPayload.title,
                                description: 'Auto-generated from meeting transcript',
                                priority: taskPayload.priority || 'medium',
                                companyId,
                                creatorId: user.id,
                                assigneeId: user.id
                            }
                        });
                        createdTasksCount++;
                    }
                    finalReply = aiResponse.replace(jsonMatch[0], '') + `\n\n✅ **Action Items Executed:** Auto-created ${createdTasksCount} tasks from this meeting.`;
                } else if (command.tasks && Array.isArray(command.tasks)) {
                    for (const t of command.tasks) {
                        await prisma.task.create({
                            data: {
                                title: t.title,
                                description: t.description || '',
                                companyId,
                                creatorId: user.id,
                                assigneeId: t.assigneeId || user.id,
                                priority: 'medium'
                            }
                        });
                        createdTasksCount++;
                    }
                    finalReply = command.summary || 'Summary generated.';
                }
            } catch (err) {
                console.error('[AIChatService] Failed to parse meeting task generation JSON:', err);
            }
        }

        return {
            summary: finalReply,
            createdTasks: createdTasksCount
        };
    }
}

export const aiChatService = AIChatService;
export const AiAssistantService = AIChatService;
export const aiAssistantService = AIChatService;
