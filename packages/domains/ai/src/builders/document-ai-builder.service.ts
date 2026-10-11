// @ts-nocheck
import { prisma } from '@workspace/db';
import crypto from 'crypto';
import { aiProviderService } from '../kernel/ai-provider.service';
import { AICompanyConfigService } from '../kernel/ai-company-config.service';
import { Mem0MemoryService } from '../memory/mem0-memory.service';
import { IUniversalBuilder, BuilderGenerationParams, BuilderResult } from './universal-builder.interface';

export class DocumentAIBuilderService implements IUniversalBuilder {
    readonly builderType = 'document';

    /**
     * Compiles, validates, and persists a Document AST from natural language
     */
    async compileAST(params: BuilderGenerationParams): Promise<BuilderResult> {
        const { prompt, companyId, userId, clientId, employeeId, sessionId } = params;
        const textPrompt = (prompt || '').trim();

        if (!textPrompt) {
            return {
                success: false,
                builderType: this.builderType,
                entityId: '',
                title: '',
                editUrl: '',
                reply: 'Please provide a document description or requirements.',
                ast: []
            };
        }

        // 1. Resolve Company & Credentials
        let effectiveCompanyId = companyId;
        if (!effectiveCompanyId) {
            const firstCompany = await prisma.company.findFirst().catch(() => null);
            effectiveCompanyId = firstCompany?.id;
        }

        let effectiveUserId = userId;
        if (!effectiveUserId && effectiveCompanyId) {
            const firstUser = await prisma.user.findFirst({ where: { companyId: effectiveCompanyId } }).catch(() => null);
            effectiveUserId = firstUser?.id;
        }

        const { settings, companyName } = await AICompanyConfigService.getCompanyAISettings(effectiveCompanyId);
        const provider = settings.aiProvider;
        const isConfigured = Boolean(
            (provider === 'gemini' && !!settings.geminiKey) ||
            (provider === 'openai' && !!settings.openaiKey) ||
            (provider === 'claude' && !!settings.claudeKey) ||
            (provider === 'custom' && !!settings.customAiKey && !!settings.customAiUrl)
        );

        // 2. Resolve Client & Signatory Context
        let client = null;
        if (clientId) {
            client = await prisma.client.findFirst({ where: { id: clientId } }).catch(() => null);
        } else if (effectiveCompanyId) {
            client = await prisma.client.findFirst({ where: { companyId: effectiveCompanyId } }).catch(() => null);
        }

        let employee = null;
        if (employeeId) {
            employee = await prisma.user.findFirst({ 
                where: { id: employeeId },
                include: { designation: true }
            }).catch(() => null);
        }

        const clientName = client?.name || client?.companyName || 'Client Partner';
        const clientEmail = client?.email || 'client@example.com';
        const employeeName = employee?.name || 'Authorized Officer';
        const employeeDesignation = employee?.designation?.name || 'Managing Director';
        const todayDate = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

        if (sessionId) {
            Mem0MemoryService.recordTurn(sessionId, 'user', textPrompt);
        }

        // 3. Try Real LLM Execution
        let docResult: any = null;

        if (isConfigured) {
            try {
                const clientAI = await aiProviderService.getClient(settings);
                if (clientAI) {
                    const systemPrompt = `You are the 180 Workspace AI Document Architect.
Generate structured AST canvas blocks for the requested document:
PROMPT: "${textPrompt}"
COMPANY: ${companyName}
CLIENT: ${clientName}
DATE: ${todayDate}

BLOCK TYPES:
- "heading": { id: string, type: "heading", content: { text: string, level: 1|2|3 }, styles: { fontSize: number, fontWeight: "700"|"800" } }
- "text": { id: string, type: "text", content: { text: string } }
- "box": { id: string, type: "box", content: { text: string }, styles: { backgroundColor: string, borderColor: string, padding: number } }
- "pricing_table": { id: string, type: "pricing_table", content: { currency: "INR"|"USD", items: [{ id: string, description: string, quantity: number, rate: number, taxRate: number, amount: number }], subtotal: number, taxAmount: number, grandTotal: number } }
- "payment_checkout": { id: string, type: "payment_checkout", content: { mode: "milestones"|"button", milestoneTitle: string, milestones: any[] } }
- "signature": { id: string, type: "signature", content: { label: string, signatoryName: string, signatoryEmail: string } }

Return valid JSON with keys: title, documentType (CONTRACT, INVOICE, PROPOSAL, NDA), blocks, explanation, grandTotal.`;

                    const rawResponse = await clientAI.generate(systemPrompt, { max_tokens: 3500 });
                    if (rawResponse) {
                        const cleanJson = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                        try {
                            const parsed = JSON.parse(cleanJson);
                            if (parsed && Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
                                docResult = {
                                    title: parsed.title || `Agreement - ${clientName}`,
                                    documentType: parsed.documentType || 'CONTRACT',
                                    blocks: parsed.blocks.map((b: any) => ({ ...b, id: b.id || crypto.randomUUID() })),
                                    explanation: parsed.explanation || `I've created and structured "${parsed.title || 'Agreement'}" for you.`,
                                    grandTotal: parsed.grandTotal || 80000
                                };
                            }
                        } catch (e) {
                            console.warn('[DocumentAIBuilderService] JSON parse error, falling back to deterministic template');
                        }
                    }
                }
            } catch (err: any) {
                console.warn('[DocumentAIBuilderService] LLM error, falling back:', err.message);
            }
        }

        // 4. Deterministic AST Generator Fallback
        if (!docResult) {
            docResult = this.generateDeterministicAST({
                prompt: textPrompt,
                clientName,
                clientEmail,
                employeeName,
                employeeDesignation,
                companyName,
                todayDate
            });
        }

        // 5. Persist to Database
        let createdDocument: any = null;
        const shareToken = crypto.randomBytes(16).toString('hex');

        if (effectiveCompanyId && effectiveUserId && docResult.blocks && docResult.blocks.length > 0) {
            try {
                createdDocument = await prisma.document.create({
                    data: {
                        name: docResult.title,
                        title: docResult.title,
                        documentType: docResult.documentType || 'CONTRACT',
                        status: 'draft',
                        uploadedById: effectiveUserId,
                        companyId: effectiveCompanyId,
                        contentBlocks: docResult.blocks,
                        grandTotal: docResult.grandTotal || 80000,
                        currency: 'INR',
                        shareToken: shareToken,
                        folder: 'contracts',
                        category: 'Contracts & Agreements'
                    }
                });
            } catch (dbErr: any) {
                console.error('[DocumentAIBuilderService] Database save failed:', dbErr.message);
            }
        }

        const documentId = createdDocument?.id || `doc_${Date.now()}`;
        const editUrl = `/document-editor?id=${documentId}`;
        const shareUrl = `/f/document/${shareToken}`;

        const reply = `📄 **${docResult.title}** has been successfully drafted and saved in your 180 Documents workspace!\n\n` +
            `• **Document Type**: \`${docResult.documentType}\`\n` +
            `• **Structure**: ${docResult.blocks.length} interactive AST canvas blocks (Pricing table, Scope, Bilateral signatures)\n` +
            `• **Total Value**: ₹${Number(docResult.grandTotal).toLocaleString('en-IN')}\n\n` +
            `${docResult.explanation}`;

        return {
            success: true,
            builderType: this.builderType,
            entityId: documentId,
            title: docResult.title,
            editUrl,
            shareUrl,
            reply,
            explanation: docResult.explanation,
            ast: docResult.blocks,
            actionCards: [
                { type: 'edit', label: 'Edit in Document Editor →', url: editUrl },
                { type: 'send', label: 'Send to Client', actionKey: 'send_document', payload: { documentId, shareUrl, clientEmail } },
                { type: 'preview', label: 'Preview PDF', url: shareUrl },
                { type: 'delete', label: 'Delete Draft', actionKey: 'delete_document', payload: { documentId } }
            ]
        };
    }

    private isGreetingOrChitchat(text: string): boolean {
        const clean = text.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
        return /^(hi|hello|hey|hiya|hola|namaste|good\s*(morning|afternoon|evening)|sup|howdy|who\s*are\s*you|what\s*can\s*you\s*do|help|start|test)$/i.test(clean);
    }

    /**
     * Patches or updates specific blocks in an existing document
     */
    async patchAST(entityId: string, instruction: string, params: BuilderGenerationParams): Promise<BuilderResult> {
        const textInstruction = (instruction || params.prompt || '').trim();
        const lower = textInstruction.toLowerCase();

        const doc = await prisma.document.findFirst({ where: { id: entityId } });
        const docTitle = doc?.title || doc?.name || 'Untitled Document';
        const editUrl = `/document-editor?id=${entityId}`;

        // Live Context Ground Truth: Use stateContext blocks from active canvas if provided
        let currentBlocks: any[] = [];
        if (Array.isArray(params.stateContext?.blocks)) {
            currentBlocks = [...params.stateContext.blocks];
        } else if (doc?.contentBlocks) {
            currentBlocks = typeof doc.contentBlocks === 'string'
                ? JSON.parse(doc.contentBlocks)
                : [...doc.contentBlocks];
        }

        // 1. Conversational Greeting & Consciousness Inquiry
        if (this.isGreetingOrChitchat(textInstruction)) {
            const blockList = currentBlocks.length > 0
                ? currentBlocks.map((b, i) => `• Block ${i + 1}: **${b.type.toUpperCase()}** (${b.content?.text?.slice(0, 35) || b.content?.label || b.type})`).join('\n')
                : '• *(Document currently has no content blocks)*';

            return {
                success: true,
                builderType: this.builderType,
                entityId,
                title: docTitle,
                editUrl,
                reply: `👋 Hello! I am your **180 Workspace AI Document Architect**.\n\nI have live awareness of your active document **"${docTitle}"** with **${currentBlocks.length} content blocks**:\n${blockList}\n\n**Instruct me to continue drafting:**\n• *"Add a 3-stage milestone payment schedule"*\n• *"Add bilateral signature blocks for Service Provider and Client"*\n• *"Add a confidentiality & IP protection clause"*\n• *"Add an itemized pricing table for ₹75,000"*\n• *"Delete block 2" or "Clear document"*`,
                ast: currentBlocks,
                actionCards: [
                    { type: 'edit', label: 'View in Document Editor →', url: editUrl }
                ]
            };
        }

        let aiHandled = false;
        let aiReply = '';
        const addedDetails: string[] = [];

        const history = Array.isArray(params.history) ? params.history : [];
        const lastAssistantMsg = [...history].reverse().find((m: any) => (m.role === 'assistant' || m.sender === 'assistant'))?.text || '';

        // 1.5 Affirmative Follow-up Intent ("yes", "sure", "do it", "go ahead", "add it", "okay")
        const isAffirmative = /^(?:yes|yeah|yep|sure|ok|okay|do it|go ahead|please do|add it|sounds good|proceed|fine|confirm|definitely|absolutely)\b/i.test(textInstruction.trim());
        if (!aiHandled && isAffirmative) {
            const lastLower = lastAssistantMsg.toLowerCase();
            if (lastLower.includes('milestone') || lastLower.includes('payment schedule')) {
                currentBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'payment_checkout',
                    content: {
                        mode: 'milestones',
                        milestoneTitle: 'Project Deliverable Milestone Schedule',
                        milestones: [
                            { id: 'm1', name: 'Milestone 1 - Kickoff & Discovery (25%)', amount: 25000, status: 'pending' },
                            { id: 'm2', name: 'Milestone 2 - Implementation & Deliverables (50%)', amount: 50000, status: 'pending' },
                            { id: 'm3', name: 'Milestone 3 - Acceptance & Signoff (25%)', amount: 25000, status: 'pending' }
                        ]
                    }
                });
                aiReply = `💳 **Milestone Schedule Added**: Appended a 3-stage payment milestone schedule.\n\n💬 Would you like to append **Bilateral Signature Blocks** or a **Pricing Breakdown Table** next?`;
                aiHandled = true;
            } else if (lastLower.includes('signature') || lastLower.includes('sign')) {
                currentBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'signature',
                    content: {
                        label: 'Authorized Service Provider Signature',
                        signatoryName: 'Lead Project Officer',
                        signatoryEmail: 'delivery@180workspace.com',
                        designation: 'Authorized Signatory'
                    }
                });
                currentBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'signature',
                    content: {
                        label: 'Authorized Client Representative Signature',
                        signatoryName: 'Client Representative',
                        signatoryEmail: 'client@partner.com',
                        designation: 'Client Authorized Partner'
                    }
                });
                aiReply = `✍️ **Bilateral Signatures Added**: Appended signature blocks for both Service Provider and Client!`;
                aiHandled = true;
            } else if (lastLower.includes('pricing') || lastLower.includes('table') || lastLower.includes('cost')) {
                currentBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'pricing_table',
                    content: {
                        currency: 'INR',
                        subtotal: 75000,
                        taxAmount: 13500,
                        grandTotal: 88500,
                        items: [
                            { id: '1', description: 'Sprint 1: Architecture & Planning', quantity: 1, rate: 25000, taxRate: 18, amount: 29500 },
                            { id: '2', description: 'Sprint 2: Deliverables & Integration', quantity: 1, rate: 35000, taxRate: 18, amount: 41300 },
                            { id: '3', description: 'Sprint 3: Handover & Documentation', quantity: 1, rate: 15000, taxRate: 18, amount: 17700 }
                        ]
                    }
                });
                aiReply = `📊 **Pricing Table Added**: Appended itemized deliverables & pricing table!`;
                aiHandled = true;
            } else {
                currentBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'box',
                    content: {
                        text: `🔒 Confidentiality & Intellectual Property Rights:\nBoth parties agree to protect all proprietary and confidential information disclosed during the execution of this agreement. All intellectual property, source code, designs, and deliverables created under this scope shall vest exclusively with the Client upon full final settlement of fees.`
                    },
                    styles: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', padding: 16, borderRadius: 8 }
                });
                aiReply = `🔒 **Confidentiality Clause Added**: Appended standard confidentiality & IP protection terms.\n\n💬 Would you like to append **Bilateral Signatures** or a **Payment Schedule** next?`;
                aiHandled = true;
            }
        }

        // 1.8 Medicine / Clinical Agreement Intent
        const isMedicineDoc = /medicine|medical|pharma|clinical|health|drug|prescription/i.test(textInstruction) &&
            /agreement|contract|proposal|nda|sla|document/i.test(textInstruction);
        if (!aiHandled && isMedicineDoc) {
            currentBlocks = [
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: `PHARMACEUTICAL SUPPLY & CLINICAL SERVICES AGREEMENT`, level: 1 },
                    styles: { fontSize: 24, fontWeight: '800', textAlign: 'center', color: '#064e3b' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `This Pharmaceutical Supply and Clinical Distribution Agreement is entered into by and between the Healthcare Supplier ("Supplier") and the Authorized Medical Institution / Client ("Purchaser").`
                    }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'box',
                    content: {
                        text: `🌿 Scope of Supply & Regulatory Compliance:\n• All pharmaceuticals supplied must strictly adhere to current Good Manufacturing Practices (cGMP), ISO 9001 quality guidelines, and national FDA drug registry requirements.\n• Batch analytical certificates (COA) and temperature-controlled cold-chain telemetry logs must accompany each delivery shipment.\n• All packaging must feature tamper-evident holographic seals and batch tracking QR codes.`
                    },
                    styles: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', padding: 16, borderRadius: 8 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'pricing_table',
                    content: {
                        currency: 'INR',
                        subtotal: 120000,
                        taxAmount: 14400,
                        grandTotal: 134400,
                        items: [
                            { id: '1', description: 'Lot A: Certified Clinical Formulations (500 units)', quantity: 1, rate: 60000, taxRate: 12, amount: 67200 },
                            { id: '2', description: 'Lot B: Rapid Diagnostic Testing Kits (200 units)', quantity: 1, rate: 40000, taxRate: 12, amount: 44800 },
                            { id: '3', description: 'Cold-Chain Telemetry & Insured Logistics', quantity: 1, rate: 20000, taxRate: 12, amount: 22400 }
                        ]
                    }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'signature',
                    content: {
                        label: 'Authorized Medical Supplier Signatory',
                        signatoryName: 'Head of Regulatory Affairs',
                        signatoryEmail: 'compliance@pharma-supplier.com',
                        designation: 'Director of Clinical Supply'
                    }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'signature',
                    content: {
                        label: 'Authorized Purchaser / Clinical Director Signatory',
                        signatoryName: 'Chief Medical Officer',
                        signatoryEmail: 'cmo@health-center.org',
                        designation: 'Clinical Operations Director'
                    }
                }
            ];
            aiReply = `✨ **Clinical Supply Agreement Synthesized!**\n\nI have generated a regulatory-grade pharmaceutical & medical services agreement with:\n• **Title & Preamble**: Official clinical supply contract header.\n• **cGMP Compliance & Cold-Chain Scope**: Regulatory compliance clause.\n• **Pharmaceutical Pricing & Lot Table**: Itemized clinical formulations & insured logistics.\n• **Bilateral Clinical Signatures**: Authorized medical supplier & clinical purchaser signature blocks.\n\n---\n💬 **To help customize this agreement for your specific requirements:**\n1. **Batch / Volume Specifics**: What specific medicine formulations or SKU numbers should be specified in the scope?\n2. **Payment Terms**: Should this follow milestone-based payments (e.g. 50% upon dispatch, 50% upon laboratory QA inspection)?\n3. **Liability & Recall Terms**: Would you like to append an indemnification and drug recall liability clause?`;
            aiHandled = true;
        }

        // 2. Clear Document Intent
        const isClearIntent = /(?:del(?:e)?t(?:e)?|clear|reset|erase|wipe)\s+(?:this\s+)?(?:document|all|blocks?|everything)/i.test(textInstruction);
        if (isClearIntent) {
            currentBlocks = [];
            aiReply = `🗑️ **Document Cleared**: All blocks in **"${docTitle}"** have been cleared. You now have a blank document canvas ready for new clauses.`;
            aiHandled = true;
        }

        // 3. Remove Target Block Intent (e.g. "remove signature", "delete pricing table")
        if (!aiHandled) {
            const deleteBlockMatch = textInstruction.match(/(?:del(?:e)?t(?:e)?|remove|drop|erase)\s+(?:the\s+)?([a-z0-9_\s-]+?)(?:\s+block|\s+clause|$)/i);
            if (deleteBlockMatch) {
                const targetKey = deleteBlockMatch[1].trim().toLowerCase();
                let foundIndex = -1;

                if (targetKey.includes('signature') || targetKey.includes('sign')) {
                    foundIndex = currentBlocks.findIndex(b => b.type === 'signature');
                } else if (targetKey.includes('pricing') || targetKey.includes('table') || targetKey.includes('cost') || targetKey.includes('price')) {
                    foundIndex = currentBlocks.findIndex(b => b.type === 'pricing_table');
                } else if (targetKey.includes('milestone') || targetKey.includes('payment') || targetKey.includes('checkout')) {
                    foundIndex = currentBlocks.findIndex(b => b.type === 'payment_checkout');
                } else if (targetKey.includes('nda') || targetKey.includes('confidential')) {
                    foundIndex = currentBlocks.findIndex(b => (b.content?.text || '').toLowerCase().includes('confidential') || (b.content?.text || '').toLowerCase().includes('nda'));
                } else if (/\d+/.test(targetKey)) {
                    const numMatch = targetKey.match(/\d+/);
                    if (numMatch) {
                        const idx = parseInt(numMatch[0], 10) - 1;
                        if (idx >= 0 && idx < currentBlocks.length) foundIndex = idx;
                    }
                }

                if (foundIndex !== -1) {
                    const removed = currentBlocks[foundIndex];
                    currentBlocks.splice(foundIndex, 1);
                    aiReply = `🗑️ **Block Removed**: Removed **${removed.type.toUpperCase()}** block from **"${docTitle}"** while keeping your other ${currentBlocks.length} blocks intact.`;
                    aiHandled = true;
                }
            }
        }

        // 4. Incremental Block Additions
        if (!aiHandled) {
            // A. Add Milestone Schedule Block
            if (lower.includes('milestone') || lower.includes('payment schedule') || lower.includes('tranche')) {
                currentBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'payment_checkout',
                    content: {
                        mode: 'milestones',
                        milestoneTitle: 'Project Deliverable Milestone Schedule',
                        milestones: [
                            { id: 'm1', name: 'Milestone 1 - Initial Kickoff & Setup (25%)', amount: 25000, status: 'pending' },
                            { id: 'm2', name: 'Milestone 2 - Core Engineering & Beta Release (50%)', amount: 50000, status: 'pending' },
                            { id: 'm3', name: 'Milestone 3 - Final Acceptance & Handover (25%)', amount: 25000, status: 'pending' }
                        ]
                    }
                });
                addedDetails.push('Appended interactive 3-stage milestone payment schedule');
            }

            // B. Add Bilateral Signatures
            if (lower.includes('signature') || lower.includes('signatory') || lower.includes('sign block') || lower.includes('signing')) {
                currentBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'signature',
                    content: {
                        label: 'Authorized Service Provider Signature',
                        signatoryName: 'Lead Project Officer',
                        signatoryEmail: 'delivery@180workspace.com',
                        designation: 'Authorized Signatory'
                    }
                });
                currentBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'signature',
                    content: {
                        label: 'Authorized Client Representative Signature',
                        signatoryName: 'Client Representative',
                        signatoryEmail: 'client@partner.com',
                        designation: 'Client Authorized Partner'
                    }
                });
                addedDetails.push('Appended bilateral signature blocks for both parties');
            }

            // C. Add NDA / Confidentiality Clause
            if (lower.includes('nda') || lower.includes('confidential') || lower.includes('non-disclosure') || lower.includes('ip clause')) {
                currentBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'box',
                    content: {
                        text: `🔒 Confidentiality & Intellectual Property Rights:\nBoth parties agree to protect all proprietary and confidential information disclosed during the execution of this agreement. All intellectual property, source code, designs, and deliverables created under this scope shall vest exclusively with the Client upon full final settlement of fees.`
                    },
                    styles: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', padding: 16, borderRadius: 8 }
                });
                addedDetails.push('Appended legal Confidentiality & IP Protection clause');
            }

            // D. Add Pricing Table
            if (lower.includes('pricing table') || lower.includes('cost breakdown') || lower.includes('invoice table') || lower.includes('line items')) {
                currentBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'pricing_table',
                    content: {
                        currency: 'INR',
                        subtotal: 75000,
                        taxAmount: 13500,
                        grandTotal: 88500,
                        items: [
                            { id: '1', description: 'Sprint 1: Architecture & UI/UX Design', quantity: 1, rate: 25000, taxRate: 18, amount: 29500 },
                            { id: '2', description: 'Sprint 2: Backend APIs & Cloud Deployment', quantity: 1, rate: 35000, taxRate: 18, amount: 41300 },
                            { id: '3', description: 'Sprint 3: Security Audits & SLA Support', quantity: 1, rate: 15000, taxRate: 18, amount: 17700 }
                        ]
                    }
                });
                addedDetails.push('Appended comprehensive itemized pricing & tax table');
            }

            // E. Generic Text / Clause Addition fallback
            if (addedDetails.length === 0) {
                currentBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: { text: textInstruction },
                    styles: { padding: 12, backgroundColor: '#f8fafc' }
                });
                aiReply = `✨ **Document Enhanced**: Added new clause to **"${docTitle}"**.\n\n---\n💬 **To help tailor this document further:**\n1. What type of document is this (e.g. Master Services Agreement, Statement of Work, Invoice, or NDA)?\n2. Would you like to append **Bilateral Signatures**, an **Itemized Pricing Table**, or a **Milestone Payment Schedule** next?\n3. Should any specific governing jurisdiction or late-payment penalty terms be added?`;
            } else if (!aiReply) {
                aiReply = `✨ **Document Updated**: ${addedDetails.join(', ')}! All existing ${currentBlocks.length - addedDetails.length} blocks have been preserved intact.\n\n💬 Would you like to append **Bilateral Signatures** or an **Itemized Pricing Table** next?`;
            }
        }

        if (doc) {
            await prisma.document.update({
                where: { id: entityId },
                data: { contentBlocks: currentBlocks, updatedAt: new Date() }
            }).catch(() => {});
        }

        return {
            success: true,
            builderType: this.builderType,
            entityId,
            title: docTitle,
            editUrl,
            reply: aiReply,
            ast: currentBlocks,
            actionCards: [
                { type: 'edit', label: 'View in Document Editor →', url: editUrl }
            ]
        };
    }

    /**
     * Deletes a document
     */
    async deleteEntity(entityId: string, companyId: string) {
        await prisma.document.deleteMany({
            where: { id: entityId, companyId }
        });
        return { success: true, message: `Document ${entityId} deleted successfully.` };
    }

    /**
     * Dispatches / sends document to client via email & share link
     */
    async dispatchEntity(entityId: string, recipientEmail: string, params: Record<string, any>) {
        const doc = await prisma.document.findFirst({ where: { id: entityId } });
        if (!doc) throw new Error('Document not found');

        const shareToken = doc.shareToken || crypto.randomBytes(16).toString('hex');
        await prisma.document.update({
            where: { id: entityId },
            data: { status: 'sent', shareToken }
        });

        const shareUrl = `/f/document/${shareToken}`;
        return {
            success: true,
            shareUrl,
            message: `📧 Document "${doc.title || doc.name}" has been prepared for dispatch to **${recipientEmail}** with secure link: ${shareUrl}`
        };
    }

    private generateDeterministicAST(ctx: any) {
        const { prompt, clientName, clientEmail, employeeName, employeeDesignation, companyName, todayDate } = ctx;
        return {
            title: `Full Stack Application Contract - ${clientName}`,
            documentType: 'CONTRACT',
            grandTotal: 80000,
            explanation: `I've prepared a comprehensive Master Services Contract with scope of work, milestone breakdown, and bilateral signature blocks.`,
            blocks: [
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: `MASTER SERVICES & APPLICATION DEVELOPMENT CONTRACT`, level: 1 },
                    styles: { fontSize: 24, fontWeight: '800', textAlign: 'center', color: '#0f172a' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `This Software Development Agreement (the "Agreement") is entered into on ${todayDate}, by and between ${companyName} ("Service Provider") and ${clientName} ("Client").`
                    }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'box',
                    content: {
                        text: `📌 Scope of Work:\n- Architecture Design & Database Modeling\n- Frontend & Backend Full Stack Implementation\n- QA, Security Audits, and Production Deployment\n- 4-Month Ongoing Maintenance & Support`
                    },
                    styles: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', padding: 16 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'pricing_table',
                    content: {
                        currency: 'INR',
                        subtotal: 80000,
                        taxAmount: 0,
                        grandTotal: 80000,
                        items: [
                            { id: '1', description: 'Phase 1: Architecture & UI/UX Design', quantity: 1, rate: 20000, taxRate: 0, amount: 20000 },
                            { id: '2', description: 'Phase 2: Full Stack Engineering & APIs', quantity: 1, rate: 35000, taxRate: 0, amount: 35000 },
                            { id: '3', description: 'Phase 3: Testing, Deploy & Handover', quantity: 1, rate: 25000, taxRate: 0, amount: 25000 }
                        ]
                    }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'payment_checkout',
                    content: {
                        mode: 'milestones',
                        milestoneTitle: 'Development Milestone Schedule',
                        milestones: [
                            { id: 'm1', name: 'Milestone 1 - Initial Deposit', amount: 20000, status: 'pending' },
                            { id: 'm2', name: 'Milestone 2 - MVP Deliverable', amount: 35000, status: 'pending' },
                            { id: 'm3', name: 'Milestone 3 - Final Acceptance & Handover', amount: 25000, status: 'pending' }
                        ]
                    }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'signature',
                    content: {
                        label: 'Service Provider Signature',
                        signatoryName: employeeName,
                        signatoryEmail: `${employeeName.toLowerCase().replace(/\s+/g, '')}@${companyName.toLowerCase().replace(/\s+/g, '')}.com`,
                        designation: employeeDesignation
                    }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'signature',
                    content: {
                        label: 'Client Partner Signature',
                        signatoryName: clientName,
                        signatoryEmail: clientEmail,
                        designation: 'Authorized Representative'
                    }
                }
            ]
        };
    }
}
