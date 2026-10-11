// @ts-nocheck
import { prisma } from '@workspace/db';
import crypto from 'crypto';
import { aiProviderService, AISettings } from '../kernel/ai-provider.service';
import { AICompanyConfigService } from '../kernel/ai-company-config.service';
import { Mem0MemoryService } from '../memory/mem0-memory.service';

export interface AIDocumentGenerationParams {
    prompt: string;
    documentType?: string;
    clientId?: string;
    employeeId?: string;
    companyId?: string;
    userId?: string;
    existingBlocks?: any[];
    mode?: string;
    sessionId?: string;
}

export class AIDocumentArchitectService {
    /**
     * Synthesizes or refines document AST blocks with multi-turn consciousness
     * and automatically saves the document to the database.
     */
    static async generate(params: AIDocumentGenerationParams) {
        const { prompt, documentType: requestedType, clientId, employeeId, existingBlocks = [], sessionId } = params;
        let companyId = params.companyId;
        let userId = params.userId;
        const textPrompt = (prompt || '').trim();

        if (!textPrompt) {
            return {
                success: false,
                message: 'Please provide a prompt or instruction.'
            };
        }

        // 1. Resolve Company & Credentials
        if (!companyId) {
            const firstCompany = await prisma.company.findFirst().catch(() => null);
            companyId = firstCompany?.id;
        }
        if (!userId && companyId) {
            const firstUser = await prisma.user.findFirst({ where: { companyId } }).catch(() => null);
            userId = firstUser?.id;
        }

        const { settings, companyName } = await AICompanyConfigService.getCompanyAISettings(companyId);
        const provider = settings.aiProvider;
        const isConfigured = Boolean(
            (provider === 'gemini' && !!settings.geminiKey) ||
            (provider === 'openai' && !!settings.openaiKey) ||
            (provider === 'claude' && !!settings.claudeKey) ||
            (provider === 'custom' && !!settings.customAiKey && !!settings.customAiUrl)
        );

        // 2. Resolve Client & Employee Metadata
        let client = null;
        if (clientId) {
            client = await prisma.client.findFirst({ where: { id: clientId } }).catch(() => null);
        } else if (companyId) {
            client = await prisma.client.findFirst({ where: { companyId } }).catch(() => null);
        }

        let employee = null;
        if (employeeId) {
            employee = await prisma.user.findFirst({ 
                where: { id: employeeId },
                include: { designation: true }
            }).catch(() => null);
        }

        const clientName = client?.name || client?.companyName || 'Client';
        const clientEmail = client?.email || 'client@example.com';
        const employeeName = employee?.name || 'Authorized Officer';
        const employeeDesignation = employee?.designation?.name || 'Managing Director';
        const todayDate = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });

        const lower = textPrompt.toLowerCase().replace(/\s+/g, ' ');
        const hasExisting = Array.isArray(existingBlocks) && existingBlocks.length > 0;

        // Record turn in session memory
        if (sessionId) {
            Mem0MemoryService.recordTurn(sessionId, 'user', textPrompt);
        }

        // 3. Fast Intent Detection Pre-checks

        // A. Negation / Rollback Intent
        const isDeleteOrCancel = (
            lower.includes('no delete') ||
            lower.includes('delete that') ||
            lower.includes('undo that') ||
            lower.includes('cancel that') ||
            lower.includes('clear canvas')
        );

        if (isDeleteOrCancel) {
            if (sessionId) Mem0MemoryService.clearSession(sessionId);
            return {
                success: true,
                intent: 'delete',
                mode: 'clear',
                reply: `🗑️ I have cleared the generated draft from your canvas. How would you like to proceed?`,
                explanation: `🗑️ I have cleared the generated draft from your canvas. How would you like to proceed?`,
                blocks: [],
                newBlocks: []
            };
        }

        // B. Pure Greeting
        const isPureGreeting = /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|sup)\b/i.test(textPrompt) && textPrompt.split(' ').length <= 3;
        if (isPureGreeting) {
            return {
                success: true,
                intent: 'chat',
                mode: 'chat',
                reply: `👋 Hello! I am your **180 Workspace AI Document Architect**.\n\nTell me what document you'd like to build (e.g. *"Create a 4-month client service contract for ₹80,000 with milestone payments"*), and I'll generate the complete AST document and save it in your workspace!`,
                explanation: `👋 Hello! I am your **180 Workspace AI Document Architect**.\n\nTell me what document you'd like to build (e.g. *"Create a 4-month client service contract for ₹80,000 with milestone payments"*), and I'll generate the complete AST document and save it in your workspace!`,
                blocks: existingBlocks,
                newBlocks: []
            };
        }

        // C. Incremental AST Block Addition (Preserves existing canvas blocks)
        const isIncrementalAddition = hasExisting && (
            lower.startsWith('add ') ||
            lower.startsWith('insert ') ||
            lower.startsWith('append ') ||
            lower.includes('add a ') ||
            lower.includes('add another ') ||
            lower.includes('add the ') ||
            lower.includes('insert a ') ||
            lower.includes('insert the ')
        );

        if (isIncrementalAddition) {
            const addedBlocks: any[] = [];
            let addedDesc = '';

            if (lower.includes('milestone') || lower.includes('payment schedule') || lower.includes('tranche')) {
                addedBlocks.push({
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
                addedDesc = 'interactive 3-stage milestone payment schedule';
            } else if (lower.includes('signature') || lower.includes('signatory') || lower.includes('sign block')) {
                addedBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'container',
                    content: {
                        direction: 'row',
                        justifyContent: 'space-between',
                        gap: 24,
                        children: [
                            {
                                id: crypto.randomUUID(),
                                type: 'signature',
                                content: { label: 'Client Authorized Signatory', signatoryName: clientName, signatoryEmail: clientEmail, requireName: true },
                                styles: { flex: 1, border: '1px dashed #cbd5e1', padding: 16, borderRadius: 8 }
                            },
                            {
                                id: crypto.randomUUID(),
                                type: 'signature',
                                content: { label: 'Company Signatory', signatoryName: employeeName, signatoryEmail: 'authorized@company.com', requireName: true },
                                styles: { flex: 1, border: '1px dashed #cbd5e1', padding: 16, borderRadius: 8 }
                            }
                        ]
                    },
                    styles: { marginTop: 24 }
                });
                addedDesc = 'bilateral signature blocks for both parties';
            } else if (lower.includes('pricing') || lower.includes('line item') || lower.includes('table') || lower.includes('tax') || lower.includes('gst')) {
                addedBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'pricing_table',
                    content: {
                        currency: 'INR',
                        items: [
                            { id: '1', description: 'Sprint 1: Architecture & UI/UX Design', quantity: 1, rate: 25000, taxRate: 18, amount: 29500 },
                            { id: '2', description: 'Sprint 2: Backend APIs & Cloud Deployment', quantity: 1, rate: 35000, taxRate: 18, amount: 41300 },
                            { id: '3', description: 'Sprint 3: Security Audits & SLA Support', quantity: 1, rate: 15000, taxRate: 18, amount: 17700 }
                        ],
                        subtotal: 75000,
                        taxAmount: 13500,
                        grandTotal: 88500
                    }
                });
                addedDesc = 'itemized pricing table with 18% GST';
            } else if (lower.includes('nda') || lower.includes('confidential') || lower.includes('terms') || lower.includes('net 15')) {
                addedBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'box',
                    content: {
                        text: '🔒 <strong>Payment Terms (Net 15) & Mutual Confidentiality:</strong><br>Invoices are payable within 15 days of presentation. Both parties agree to protect all proprietary and confidential information. Deliverables vest with the Client upon receipt of final settlement.'
                    },
                    styles: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', padding: 16, borderRadius: 8 }
                });
                addedDesc = 'payment terms (Net 15) and mutual confidentiality clause';
            } else {
                addedBlocks.push({
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: { text: textPrompt },
                    styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
                });
                addedDesc = `clause: "${textPrompt.slice(0, 40)}..."`;
            }

            const combinedBlocks = [...existingBlocks, ...addedBlocks];
            const incrementalReply = `✨ **Document Updated**: Appended ${addedDesc}! Your existing ${existingBlocks.length} canvas blocks have been preserved intact.`;

            return {
                success: true,
                intent: 'append',
                mode: 'append',
                reply: incrementalReply,
                explanation: incrementalReply,
                blocks: combinedBlocks,
                newBlocks: addedBlocks
            };
        }

        // 4. Try Real LLM Execution if Configured
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

                    const rawResponse = await clientAI.generate(systemPrompt, { max_tokens: 3000 });
                    if (rawResponse) {
                        const cleanJson = rawResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                        try {
                            const parsed = JSON.parse(cleanJson);
                            if (parsed && Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
                                docResult = {
                                    title: parsed.title || `Service Contract - ${clientName}`,
                                    documentType: parsed.documentType || requestedType || 'CONTRACT',
                                    blocks: parsed.blocks.map((b: any) => ({ ...b, id: b.id || crypto.randomUUID() })),
                                    explanation: parsed.explanation || `I've created and structured the document "${parsed.title || 'Contract'}" for you.`,
                                    grandTotal: parsed.grandTotal || 80000
                                };
                            }
                        } catch (e) {
                            console.warn('[AIDocumentArchitectService] JSON parse error, falling back to deterministic template');
                        }
                    }
                }
            } catch (err: any) {
                console.warn('[AIDocumentArchitectService] LLM execution fallback:', err.message);
            }
        }

        // 5. Deterministic Generator if LLM didn't return blocks
        if (!docResult) {
            docResult = this.generateDeterministicAST({
                prompt: textPrompt,
                requestedType,
                clientName,
                clientEmail,
                employeeName,
                employeeDesignation,
                companyName,
                todayDate,
                hasExisting,
                existingBlocks
            });
        }

        // 6. Auto-Save Document to Database so user gets instant URL & can view in 180 Documents
        let createdDocument: any = null;
        if (companyId && userId && docResult.blocks && docResult.blocks.length > 0) {
            try {
                createdDocument = await prisma.document.create({
                    data: {
                        name: docResult.title,
                        title: docResult.title,
                        documentType: docResult.documentType || 'CONTRACT',
                        status: 'draft',
                        uploadedById: userId,
                        companyId: companyId,
                        contentBlocks: docResult.blocks,
                        grandTotal: docResult.grandTotal || 80000,
                        currency: 'INR',
                        folder: 'contracts',
                        category: 'Contracts & Agreements'
                    }
                });
            } catch (dbErr: any) {
                console.error('[AIDocumentArchitectService] Database auto-save failed:', dbErr.message);
            }
        }

        const docId = createdDocument?.id;
        const editorUrl = docId ? `/document-editor?id=${docId}` : '/document-editor';

        const replyMessage = `📄 I've drafted and created **"${docResult.title}"** in your 180 Documents!\n\n` +
            `- **Document Type**: ${docResult.documentType || 'CONTRACT'}\n` +
            `- **Structure**: ${docResult.blocks.length} AST Elements (Scope, Payment Milestones, Terms, E-Signatures)\n` +
            (docResult.grandTotal ? `- **Total Value**: ₹${Number(docResult.grandTotal).toLocaleString('en-IN')}\n` : '') +
            (docId ? `- **Document ID**: \`${docId}\`\n\n` : '\n') +
            `👉 [**Open & Edit "${docResult.title}" in 180 Documents**](${editorUrl})`;

        return {
            success: true,
            intent: 'create',
            mode: 'replace',
            documentId: docId || null,
            documentUrl: editorUrl,
            title: docResult.title,
            documentType: docResult.documentType || 'CONTRACT',
            reply: replyMessage,
            explanation: replyMessage,
            blocks: docResult.blocks,
            newBlocks: docResult.blocks,
            draft: {
                id: docId || 'draft-preview',
                title: docResult.title,
                type: docResult.documentType || 'CONTRACT',
                blocksCount: docResult.blocks.length,
                blocks: docResult.blocks,
                documentUrl: editorUrl,
                clientName
            }
        };
    }

    private static generateDeterministicAST(ctx: any) {
        const { prompt, requestedType, clientName, clientEmail, employeeName, employeeDesignation, companyName, todayDate } = ctx;
        const lower = prompt.toLowerCase();

        // 1. Specialized Rent / Commercial Lease Agreement
        const isRentOrLease = lower.includes('rent') || lower.includes('lease') || lower.includes('tenant') || lower.includes('landlord') || lower.includes('tenancy') || requestedType === 'RENT_AGREEMENT';

        if (isRentOrLease) {
            let landlord = 'Rahul';
            const landlordMatch = prompt.match(/(?:landlord(?:\s+name)?(?:\s+is|\s*:)?)\s*([a-zA-Z\s]+?)(?=\s+the|\s+tenant|\s+address|,|\.|\n|$)/i);
            if (landlordMatch) landlord = landlordMatch[1].trim();

            let tenant = 'Prince';
            const tenantMatch = prompt.match(/(?:tenant(?:\s+name)?(?:\s+will\s+be|\s+is|\s*:)?)\s*([a-zA-Z\s]+?)(?=\s+the|\s+address|\s+duration|,|\.|\n|$)/i);
            if (tenantMatch) tenant = tenantMatch[1].trim();

            let address = 'Hyderabad, Malakpet';
            const addressMatch = prompt.match(/(?:address(?:\s+is|\s+of\s+the\s+office\s+is|\s*:)?)\s*([a-zA-Z0-9,\s-]+?)(?=\s+the|\s+duration|\s+security|,|\.|\n|$)/i);
            if (addressMatch) address = addressMatch[1].trim();

            let leaseDuration = '2 Years';
            const leaseMatch = prompt.match(/(?:duration(?:\s+of\s+lease)?(?:\s+is|\s*:)?)\s*(\d+\s*(?:years?|months?|yrs?|mos?))/i);
            if (leaseMatch) leaseDuration = leaseMatch[1].trim();

            let rentAmount = 10000;
            const rentMatch = prompt.match(/(?:rent(?:\s+of)?(?:\s+is|\s*:)?\s*(?:₹|rs\.?|inr)?\s*)([\d,]+)/i);
            if (rentMatch) rentAmount = parseInt(rentMatch[1].replace(/,/g, ''));

            let depositAmount = 100000;
            const depositMatch = prompt.match(/(?:security\s+deposit(?:\s+is|\s*:)?\s*(?:₹|rs\.?|inr)?\s*)([\d,]+)/i);
            if (depositMatch) depositAmount = parseInt(depositMatch[1].replace(/,/g, ''));

            const title = `Office Rent Agreement - ${address}`;

            const blocks = [
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: 'COMMERCIAL OFFICE RENT & LEASE AGREEMENT', level: 1 },
                    styles: { textAlign: 'center', fontSize: 24, fontWeight: '800', color: '#0f172a' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'box',
                    content: {
                        text: `This Commercial Lease Agreement is made and executed on <strong>${todayDate}</strong> at ${address}.<br><br>` +
                              `<strong>LESSOR / LANDLORD:</strong> ${landlord}<br>` +
                              `<strong>LESSEE / TENANT:</strong> ${tenant}<br>` +
                              `<strong>DEMISED PREMISES:</strong> Commercial Office situated at ${address}<br>` +
                              `<strong>LEASE TERM:</strong> ${leaseDuration}<br>` +
                              `<strong>MONTHLY RENT:</strong> ₹${rentAmount.toLocaleString('en-IN')} INR per month<br>` +
                              `<strong>SECURITY DEPOSIT:</strong> ₹${depositAmount.toLocaleString('en-IN')} INR (Interest-Free Refundable)`
                    },
                    styles: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', padding: 18, borderRadius: 10, marginTop: 14 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: '1. Monthly Rent & Payment Terms', level: 2 },
                    styles: { fontSize: 16, fontWeight: '700', marginTop: 22, color: '#1e293b' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `The Tenant agrees to pay a monthly rent of <strong>₹${rentAmount.toLocaleString('en-IN')}</strong> to the Landlord on or before the 5th day of each calendar month. The rent shall remain fixed for the agreed lease duration of <strong>${leaseDuration}</strong>.`
                    },
                    styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: '2. Interest-Free Refundable Security Deposit', level: 2 },
                    styles: { fontSize: 16, fontWeight: '700', marginTop: 22, color: '#1e293b' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `The Tenant has deposited with the Landlord an amount of <strong>₹${depositAmount.toLocaleString('en-IN')}</strong> as security deposit. This deposit is non-interest bearing and shall be refunded in full upon termination and peaceful vacant possession of the premises.`
                    },
                    styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: '3. Use of Premises & Utilities', level: 2 },
                    styles: { fontSize: 16, fontWeight: '700', marginTop: 22, color: '#1e293b' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `The premises shall be used exclusively for commercial/office purposes in compliance with local municipal bylaws. The Tenant shall bear all electricity, water, and internet utility expenses during the lease period.`
                    },
                    styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: '4. Termination & Notice Period', level: 2 },
                    styles: { fontSize: 16, fontWeight: '700', marginTop: 22, color: '#1e293b' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `Either party may terminate this agreement by providing one (1) month prior written notice or rent in lieu thereof. The agreement may be renewed upon mutual consent of both parties.`
                    },
                    styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'container',
                    content: {
                        direction: 'row',
                        justifyContent: 'space-between',
                        gap: 24,
                        children: [
                            {
                                id: crypto.randomUUID(),
                                type: 'signature',
                                content: { label: 'Landlord / Lessor', signatoryName: landlord, signatoryEmail: 'landlord@example.com', requireName: true },
                                styles: { flex: 1, border: '1px dashed #cbd5e1', padding: 16, borderRadius: 8 }
                            },
                            {
                                id: crypto.randomUUID(),
                                type: 'signature',
                                content: { label: 'Tenant / Lessee', signatoryName: tenant, signatoryEmail: 'tenant@example.com', requireName: true },
                                styles: { flex: 1, border: '1px dashed #cbd5e1', padding: 16, borderRadius: 8 }
                            }
                        ]
                    },
                    styles: { marginTop: 28 }
                }
            ];

            return {
                title,
                documentType: 'RENT_AGREEMENT',
                blocks,
                grandTotal: rentAmount,
                explanation: `I've prepared and saved the Rent Agreement for ${address} between ${landlord} and ${tenant}.`
            };
        }

        // 2. Specialized Employee Offer Letter & Employment Agreement
        const isOfferLetter = lower.includes('offer letter') || lower.includes('employment agreement') || lower.includes('appointment letter') || lower.includes('hiring agreement') || requestedType === 'OFFER_LETTER';
        if (isOfferLetter) {
            let candidate = employeeName || 'Priya Patel';
            const candMatch = prompt.match(/(?:candidate(?:\s+name)?(?:\s+is|\s*:)?|hire\s+|offering\s+to\s+)\s*([a-zA-Z\s]+?)(?=\s+as|\s+in|\s+with|,|\.|\n|$)/i);
            if (candMatch) candidate = candMatch[1].trim();

            let role = employeeDesignation || 'Growth Marketing Lead';
            const roleMatch = prompt.match(/(?:as\s+(?:a\s+|an\s+)?|position(?:\s+of)?(?:\s+is|\s*:)?)\s*([a-zA-Z\s]+?)(?=\s+in|\s+with|\s+salary|,|\.|\n|$)/i);
            if (roleMatch) role = roleMatch[1].trim();

            let dept = 'Marketing & Growth';
            const deptMatch = prompt.match(/(?:in\s+(?:the\s+)?department(?:\s+of)?|in\s+)\s*([a-zA-Z\s]+?)(?=\s+with|\s+salary|,|\.|\n|$)/i);
            if (deptMatch && !deptMatch[1].toLowerCase().includes('salary')) dept = deptMatch[1].trim();

            let salaryVal = 120000;
            const salMatch = prompt.match(/(?:salary(?:\s+of)?(?:\s+is|\s*:)?\s*(?:₹|rs\.?|inr)?\s*)([\d,]+)/i);
            if (salMatch) salaryVal = parseInt(salMatch[1].replace(/,/g, ''));

            const title = `Employment Offer Letter - ${candidate} (${role})`;

            const blocks = [
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: 'OFFICIAL EMPLOYMENT OFFER & APPOINTMENT LETTER', level: 1 },
                    styles: { textAlign: 'center', fontSize: 24, fontWeight: '800', color: '#0f172a' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'box',
                    content: {
                        text: `Date of Issue: <strong>${todayDate}</strong><br><br>` +
                              `<strong>CANDIDATE NAME:</strong> ${candidate}<br>` +
                              `<strong>POSITION OFFERED:</strong> ${role}<br>` +
                              `<strong>DEPARTMENT:</strong> ${dept}<br>` +
                              `<strong>COMPANY:</strong> ${companyName}<br>` +
                              `<strong>GROSS MONTHLY SALARY:</strong> ₹${salaryVal.toLocaleString('en-IN')} INR<br>` +
                              `<strong>ANNUAL CTC:</strong> ₹${(salaryVal * 12).toLocaleString('en-IN')} INR`
                    },
                    styles: { backgroundColor: '#f0fdf4', borderColor: '#86efac', padding: 18, borderRadius: 10, marginTop: 14 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: '1. Role Overview & Core Deliverables', level: 2 },
                    styles: { fontSize: 16, fontWeight: '700', marginTop: 22, color: '#1e293b' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `We are delighted to offer you the position of <strong>${role}</strong> at <strong>${companyName}</strong>. In this capacity, you will lead key strategic initiatives, drive team excellence, and collaborate cross-functionally to achieve company milestones.`
                    },
                    styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: '2. Compensation & Benefits Structure', level: 2 },
                    styles: { fontSize: 16, fontWeight: '700', marginTop: 22, color: '#1e293b' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `Your total fixed compensation will be <strong>₹${salaryVal.toLocaleString('en-IN')}</strong> per month, subject to statutory deductions. You will also be eligible for comprehensive health insurance, paid annual leave, and performance-linked incentives as per company policy.`
                    },
                    styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: '3. Probation, Code of Conduct & Confidentiality', level: 2 },
                    styles: { fontSize: 16, fontWeight: '700', marginTop: 22, color: '#1e293b' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `This employment is subject to a standard three (3) month probation period. You will be required to execute the company's Non-Disclosure Agreement (NDA) and adhere to all intellectual property assignment policies.`
                    },
                    styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'container',
                    content: {
                        direction: 'row',
                        justifyContent: 'space-between',
                        gap: 24,
                        children: [
                            {
                                id: crypto.randomUUID(),
                                type: 'signature',
                                content: { label: 'For ' + companyName + ' (Authorized Signatory)', signatoryName: 'Managing Director / HR Head', signatoryEmail: 'hr@' + (companyName.toLowerCase().replace(/\s+/g, '')) + '.com', requireName: true },
                                styles: { flex: 1, border: '1px dashed #cbd5e1', padding: 16, borderRadius: 8 }
                            },
                            {
                                id: crypto.randomUUID(),
                                type: 'signature',
                                content: { label: 'Candidate Acceptance & Signature', signatoryName: candidate, signatoryEmail: 'candidate@example.com', requireName: true },
                                styles: { flex: 1, border: '1px dashed #cbd5e1', padding: 16, borderRadius: 8 }
                            }
                        ]
                    },
                    styles: { marginTop: 28 }
                }
            ];

            return {
                title,
                documentType: 'OFFER_LETTER',
                blocks,
                grandTotal: salaryVal * 12,
                explanation: `I've prepared and saved the Official Employment Offer Letter for ${candidate} (${role}).`
            };
        }

        // 3. Specialized Employee Termination & Relieving / Experience Letter
        const isTermination = lower.includes('terminate') || lower.includes('termination letter') || lower.includes('relieving letter') || lower.includes('experience letter') || requestedType === 'TERMINATION_LETTER';
        if (isTermination) {
            let employee = employeeName || 'Rahul Sharma';
            const empMatch = prompt.match(/(?:terminate|relieve|employee(?:\s+name)?(?:\s+is|\s*:)?)\s*([a-zA-Z\s]+?)(?=\s+from|\s+as|\s+with|,|\.|\n|$)/i);
            if (empMatch && !['the', 'an', 'a'].includes(empMatch[1].trim().toLowerCase())) employee = empMatch[1].trim();

            let role = employeeDesignation || 'Senior Team Member';
            const roleMatch = prompt.match(/(?:as\s+(?:a\s+|an\s+)?|position(?:\s+of)?(?:\s+is|\s*:)?)\s*([a-zA-Z\s]+?)(?=\s+in|\s+with|,|\.|\n|$)/i);
            if (roleMatch) role = roleMatch[1].trim();

            const title = `Relieving & Service Experience Certificate - ${employee}`;

            const blocks = [
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: 'FORMAL LETTER OF RELIEVING & WORK EXPERIENCE', level: 1 },
                    styles: { textAlign: 'center', fontSize: 24, fontWeight: '800', color: '#0f172a' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'box',
                    content: {
                        text: `Issue Date: <strong>${todayDate}</strong><br><br>` +
                              `<strong>EMPLOYEE NAME:</strong> ${employee}<br>` +
                              `<strong>DESIGNATION:</strong> ${role}<br>` +
                              `<strong>ORGANIZATION:</strong> ${companyName}<br>` +
                              `<strong>STATUS:</strong> Relieved in Good Standing<br>` +
                              `<strong>FULL & FINAL SETTLEMENT:</strong> Completed & Disbursed`
                    },
                    styles: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', padding: 18, borderRadius: 10, marginTop: 14 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: '1. Service & Tenure Certification', level: 2 },
                    styles: { fontSize: 16, fontWeight: '700', marginTop: 22, color: '#1e293b' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `This is to certify that <strong>${employee}</strong> was employed with <strong>${companyName}</strong> as <strong>${role}</strong>. During their tenure, they demonstrated professionalism, diligence, and contributed significantly to company initiatives.`
                    },
                    styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: '2. Relieving & Dues Settlement', level: 2 },
                    styles: { fontSize: 16, fontWeight: '700', marginTop: 22, color: '#1e293b' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `With effect from <strong>${todayDate}</strong>, ${employee} stands relieved from all official duties. All company assets have been successfully returned, and all final dues have been fully settled.`
                    },
                    styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'heading',
                    content: { text: '3. Continuing Non-Disclosure Obligations', level: 2 },
                    styles: { fontSize: 16, fontWeight: '700', marginTop: 22, color: '#1e293b' }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'text',
                    content: {
                        text: `The employee remains bound by the confidentiality obligations outlined in their original employment agreement regarding proprietary software, client records, and commercial secrets.`
                    },
                    styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
                },
                {
                    id: crypto.randomUUID(),
                    type: 'signature',
                    content: { label: 'Authorized Signatory (Human Resources)', signatoryName: 'Director of People & Culture', signatoryEmail: 'hr@' + (companyName.toLowerCase().replace(/\s+/g, '')) + '.com', requireName: true },
                    styles: { marginTop: 28, border: '1px dashed #cbd5e1', padding: 16, borderRadius: 8 }
                }
            ];

            return {
                title,
                documentType: 'TERMINATION_LETTER',
                blocks,
                grandTotal: 0,
                explanation: `I've prepared and generated the official Relieving & Experience Certificate for ${employee}.`
            };
        }

        // 4. Standard Service Contract
        let duration = '4 Months';
        const durationMatch = lower.match(/(\d+)\s*(month|months|mo|year|years|week|weeks)/);
        if (durationMatch) {
            duration = `${durationMatch[1]} ${durationMatch[2]}`;
        }

        let totalAmount = 80000;
        const amountMatch = lower.match(/(\d+)\s*(k|lakh|inr|rs|usd|\$)/i);
        if (amountMatch) {
            const num = parseInt(amountMatch[1]);
            const unit = amountMatch[2].toLowerCase();
            if (unit === 'k') totalAmount = num * 1000;
            else if (unit === 'lakh') totalAmount = num * 100000;
            else totalAmount = num;
        }

        let docType = requestedType || 'CONTRACT';
        if (lower.includes('invoice') || lower.includes('bill')) docType = 'INVOICE';
        else if (lower.includes('proposal') || lower.includes('quote')) docType = 'QUOTATION';
        else if (lower.includes('nda') || lower.includes('confidential')) docType = 'NDA';

        const title = `${duration} Service Contract - ${clientName}`;

        const m1Amount = Math.round(totalAmount * 0.4);
        const m2Amount = Math.round(totalAmount * 0.4);
        const m3Amount = totalAmount - m1Amount - m2Amount;

        const blocks = [
            {
                id: crypto.randomUUID(),
                type: 'heading',
                content: { text: 'SERVICE CONTRACT & COMMERCIAL AGREEMENT', level: 1 },
                styles: { textAlign: 'center', fontSize: 24, fontWeight: '800', color: '#1e293b' }
            },
            {
                id: crypto.randomUUID(),
                type: 'box',
                content: {
                    text: `This Service Contract is entered into on <strong>${todayDate}</strong> by and between <strong>${companyName}</strong> ("Service Provider") and <strong>${clientName}</strong> ("Client").<br><br>` +
                          `<strong>Contract Term:</strong> ${duration}<br>` +
                          `<strong>Total Contract Fee:</strong> ₹${totalAmount.toLocaleString('en-IN')} INR`
                },
                styles: { backgroundColor: '#f8fafc', borderColor: '#cbd5e1', padding: 16, borderRadius: 8, marginTop: 12 }
            },
            {
                id: crypto.randomUUID(),
                type: 'heading',
                content: { text: '1. Scope of Work & Deliverables', level: 2 },
                styles: { fontSize: 16, fontWeight: '700', marginTop: 20, color: '#334155' }
            },
            {
                id: crypto.randomUUID(),
                type: 'text',
                content: {
                    text: `The Service Provider agrees to deliver technical engineering, software deployment, and ongoing support services over the agreed duration of <strong>${duration}</strong> as outlined in the project specifications.`
                },
                styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
            },
            {
                id: crypto.randomUUID(),
                type: 'heading',
                content: { text: '2. Payment Installment Schedule', level: 2 },
                styles: { fontSize: 16, fontWeight: '700', marginTop: 20, color: '#334155' }
            },
            {
                id: crypto.randomUUID(),
                type: 'payment_checkout',
                content: {
                    mode: 'milestones',
                    milestoneTitle: `Milestone Payment Breakdown (Total: ₹${totalAmount.toLocaleString('en-IN')})`,
                    milestoneCurrency: 'INR',
                    milestones: [
                        { id: 'm1', title: 'Phase 1: Project Kickoff & Architecture (40%)', percentage: 40, amount: m1Amount, dueDate: 'Upon Signing', status: 'pending' },
                        { id: 'm2', title: 'Phase 2: Core Development & Review (40%)', percentage: 40, amount: m2Amount, dueDate: 'Month 2', status: 'pending' },
                        { id: 'm3', title: 'Phase 3: Final Testing & Handover (20%)', percentage: 20, amount: m3Amount, dueDate: `End of ${duration}`, status: 'pending' }
                    ]
                },
                styles: { padding: 16, marginTop: 12, backgroundColor: '#f1f5f9', borderRadius: 8 }
            },
            {
                id: crypto.randomUUID(),
                type: 'heading',
                content: { text: '3. Terms, Termination & Confidentiality', level: 2 },
                styles: { fontSize: 16, fontWeight: '700', marginTop: 20, color: '#334155' }
            },
            {
                id: crypto.randomUUID(),
                type: 'text',
                content: {
                    text: `Either party may terminate this agreement with 15 days written notice. All proprietary materials, source code, and trade secrets shall remain strictly confidential between both organizations.`
                },
                styles: { fontSize: 14, lineHeight: '1.6', marginTop: 8 }
            },
            {
                id: crypto.randomUUID(),
                type: 'container',
                content: {
                    direction: 'row',
                    justifyContent: 'space-between',
                    gap: 24,
                    children: [
                        {
                            id: crypto.randomUUID(),
                            type: 'signature',
                            content: { label: 'Client Authorized Signatory', signatoryName: clientName, signatoryEmail: clientEmail, requireName: true },
                            styles: { flex: 1, border: '1px dashed #cbd5e1', padding: 16, borderRadius: 8 }
                        },
                        {
                            id: crypto.randomUUID(),
                            type: 'signature',
                            content: { label: 'Company Signatory', signatoryName: employeeName, signatoryEmail: 'authorized@company.com', requireName: true },
                            styles: { flex: 1, border: '1px dashed #cbd5e1', padding: 16, borderRadius: 8 }
                        }
                    ]
                },
                styles: { marginTop: 24 }
            }
        ];

        return {
            title,
            documentType: docType,
            blocks,
            grandTotal: totalAmount,
            explanation: `I've prepared the ${duration} contract for ${clientName} worth ₹${totalAmount.toLocaleString('en-IN')}.`
        };
    }
}
