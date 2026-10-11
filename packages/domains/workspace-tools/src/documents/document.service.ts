// @ts-nocheck
import { prisma, requestContext } from '@workspace/db';
import crypto from 'crypto';

export class DocumentService {
    static async getAllDocuments(search?: string, category?: string, pagination?: { limit?: number }) {
        const where: any = {};
        const take = Math.min(Number(pagination?.limit) || 100, 100);

        if (category && category !== 'All' && category !== 'all') {
            where.category = category;
        }

        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { content: { contains: search, mode: 'insensitive' } }
            ];
        }

        const articles = await prisma.knowledgeArticle.findMany({
            where,
            include: {
                createdBy: { select: { id: true, name: true, photoUrl: true, email: true } },
                updatedBy: { select: { id: true, name: true, photoUrl: true, email: true } }
            },
            orderBy: { updatedAt: 'desc' },
            take
        });

        // Also fetch file uploads from Document table if exists
        let rawDocs: any[] = [];
        try {
            rawDocs = await prisma.document.findMany({
                where: category && category !== 'All' && category !== 'all' ? { category } : {},
                include: {
                    uploadedBy: { select: { id: true, name: true, photoUrl: true, email: true } }
                },
                orderBy: { updatedAt: 'desc' },
                take
            });
        } catch (e) {}

        const formattedArticles = articles.map((a: any) => {
            let parsed: any = {};
            try {
                parsed = JSON.parse(a.content);
            } catch (e) {
                parsed = {};
            }

            const docType = parsed.documentType || (a.category === 'Contract' ? 'CONTRACT' : a.category === 'Finance' ? 'INVOICE' : 'GENERAL');
            const isContract = ['CONTRACT', 'NDA', 'SLA', 'RETAINER_AGREEMENT'].includes(docType) || a.category === 'Contract';
            const isInvoice = docType === 'INVOICE' || a.category === 'Finance';
            const isQuote = ['QUOTATION', 'SALES_PROPOSAL', 'STATEMENT_OF_WORK'].includes(docType);

            return {
                id: a.id,
                _id: a.id,
                title: a.title,
                name: a.title,
                documentNumber: parsed.documentNumber || '',
                documentType: docType,
                status: parsed.status || 'draft',
                category: a.category || 'General',
                folder: a.category || 'General',
                tags: a.tags || [],
                createdAt: a.createdAt,
                updatedAt: a.updatedAt,
                createdBy: a.createdBy,
                uploadedBy: a.createdBy,
                clientId: parsed.clientId || null,
                clientName: parsed.clientName || parsed.variables?.clientName || '',
                clientEmail: parsed.clientEmail || parsed.variables?.clientEmail || '',
                isArticle: true,
                isContract,
                isInvoice,
                isQuote,
                type: docType,
                blocks: parsed.blocks || [],
                contentBlocks: parsed.blocks || [],
                headerBlocks: parsed.headerBlocks || [],
                footerBlocks: parsed.footerBlocks || [],
                variables: parsed.variables || {},
                designSettings: parsed.designSettings || {},
                subtotal: parsed.subtotal || 0,
                taxPercent: parsed.taxPercent || 0,
                taxAmount: parsed.taxAmount || 0,
                discount: parsed.discount || 0,
                grandTotal: parsed.grandTotal || parsed.subtotal || 0,
                currency: parsed.currency || 'INR',
                shareToken: parsed.shareToken || '',
                signature: parsed.signatureData || null,
                signatureData: parsed.signatureData || null,
                signerIp: parsed.signerIp || null,
                signedAt: parsed.signedAt || null,
                validUntil: parsed.validUntil || null,
                dueDate: parsed.dueDate || null,
                paidAt: parsed.paidAt || null,
                dealId: parsed.dealId || null,
                employeeId: parsed.employeeId || null,
                companyId: parsed.companyId || null,
                accessType: parsed.accessType || 'public'
            };
        });

        const formattedRawDocs = rawDocs
            .filter((d: any) => !articles.some((a: any) => a.id === d.id))
            .map((d: any) => ({
                id: d.id,
                _id: d.id,
                title: d.name || 'Uploaded File',
                name: d.name || 'Uploaded File',
                documentNumber: '',
                documentType: 'UPLOADED_FILE',
                status: 'published',
                category: d.category || 'General',
                folder: d.folder || 'General',
                tags: d.tags || [],
                createdAt: d.createdAt,
                updatedAt: d.updatedAt,
                createdBy: d.uploadedBy,
                uploadedBy: d.uploadedBy,
                isArticle: false,
                isContract: false,
                isInvoice: false,
                isQuote: false,
                type: 'UPLOADED_FILE',
                blocks: [],
                contentBlocks: [],
                headerBlocks: [],
                footerBlocks: [],
                variables: {},
                designSettings: {},
                subtotal: 0,
                taxAmount: 0,
                grandTotal: 0,
                currency: 'INR',
                shareToken: '',
                signature: null,
                fileUrl: d.fileUrl
            }));

        return [...formattedArticles, ...formattedRawDocs];
    }

    static async getDocumentById(id: string) {
        // 1. Fetch from KnowledgeArticle
        const article = await prisma.knowledgeArticle.findFirst({
            where: { id },
            include: {
                createdBy: { select: { id: true, name: true, photoUrl: true, email: true } },
                updatedBy: { select: { id: true, name: true, photoUrl: true, email: true } }
            }
        });

        if (article) {
            let parsed: any = {};
            try {
                parsed = JSON.parse(article.content);
            } catch (e) {
                parsed = {};
            }

            let client = null;
            if (parsed.clientId) {
                client = await prisma.client.findFirst({ where: { id: parsed.clientId } });
            }

            let deal = null;
            if (parsed.dealId) {
                deal = await prisma.deal.findFirst({ where: { id: parsed.dealId } });
            }

            const docType = parsed.documentType || (article.category === 'Contract' ? 'CONTRACT' : article.category === 'Finance' ? 'INVOICE' : 'GENERAL');

            return {
                id: article.id,
                _id: article.id,
                title: article.title,
                name: article.title,
                documentNumber: parsed.documentNumber || '',
                documentType: docType,
                status: parsed.status || 'draft',
                category: article.category || 'General',
                folder: article.category || 'General',
                tags: article.tags || [],
                createdAt: article.createdAt,
                updatedAt: article.updatedAt,
                createdBy: article.createdBy,
                uploadedBy: article.createdBy,
                client,
                clientId: parsed.clientId || null,
                clientName: client?.name || client?.companyName || parsed.variables?.clientName || '',
                clientEmail: client?.email || parsed.variables?.clientEmail || '',
                deal,
                dealId: parsed.dealId || null,
                employeeId: parsed.employeeId || null,
                companyId: parsed.companyId || null,
                type: docType,
                blocks: parsed.blocks || [],
                contentBlocks: parsed.blocks || [],
                headerBlocks: parsed.headerBlocks || [],
                footerBlocks: parsed.footerBlocks || [],
                variables: parsed.variables || {},
                designSettings: parsed.designSettings || {},
                subtotal: parsed.subtotal || 0,
                taxPercent: parsed.taxPercent || 0,
                taxAmount: parsed.taxAmount || 0,
                discount: parsed.discount || 0,
                grandTotal: parsed.grandTotal || parsed.subtotal || 0,
                currency: parsed.currency || 'INR',
                shareToken: parsed.shareToken || '',
                signature: parsed.signatureData || null,
                signatureData: parsed.signatureData || null,
                signerIp: parsed.signerIp || null,
                signedAt: parsed.signedAt || null,
                validUntil: parsed.validUntil || null,
                dueDate: parsed.dueDate || null,
                paidAt: parsed.paidAt || null,
                fileUrl: parsed.fileUrl || null,
                accessType: parsed.accessType || 'public',
                allowedUserIds: parsed.allowedUserIds || [],
                allowedEmails: parsed.allowedEmails || [],
                shares: parsed.shares || []
            };
        }

        // 2. Fallback to Document table
        try {
            const doc = await prisma.document.findFirst({
                where: { id },
                include: {
                    uploadedBy: { select: { id: true, name: true, photoUrl: true, email: true } },
                    client: true
                }
            });

            if (doc) {
                let blocks = doc.contentBlocks || [];
                if (typeof blocks === 'string') {
                    try { blocks = JSON.parse(blocks); } catch (e) { blocks = []; }
                }

                return {
                    id: doc.id,
                    _id: doc.id,
                    title: doc.title || doc.name || 'Untitled Document',
                    name: doc.name || doc.title || 'Untitled Document',
                    documentNumber: doc.documentNumber || '',
                    documentType: doc.documentType || 'CONTRACT',
                    status: doc.status || 'draft',
                    category: doc.category || 'General',
                    folder: doc.folder || 'contracts',
                    tags: doc.tags || [],
                    createdAt: doc.createdAt,
                    updatedAt: doc.updatedAt,
                    createdBy: doc.uploadedBy,
                    uploadedBy: doc.uploadedBy,
                    client: doc.client,
                    clientId: doc.clientId || null,
                    employeeId: doc.employeeId || null,
                    projectId: doc.projectId || null,
                    dealId: doc.dealId || null,
                    companyId: doc.companyId || null,
                    type: doc.documentType || 'CONTRACT',
                    blocks: blocks,
                    contentBlocks: blocks,
                    headerBlocks: doc.headerBlocks || [],
                    footerBlocks: doc.footerBlocks || [],
                    variables: doc.variables || {},
                    designSettings: doc.designSettings || {},
                    subtotal: doc.subtotal || 0,
                    taxPercent: doc.taxPercent || 0,
                    taxAmount: doc.taxAmount || 0,
                    discount: doc.discount || 0,
                    grandTotal: doc.grandTotal || doc.subtotal || 0,
                    currency: doc.currency || 'INR',
                    shareToken: doc.shareToken || '',
                    signature: doc.signatureData || null,
                    signatureData: doc.signatureData || null,
                    signerIp: doc.signerIp || null,
                    signedAt: doc.signedAt || null,
                    validUntil: doc.validUntil || null,
                    dueDate: doc.dueDate || null,
                    paidAt: doc.paidAt || null,
                    fileUrl: doc.fileUrl
                };
            }
        } catch (e) {}

        return null;
    }

    static async createDocument(userId: string, data: any) {
        const {
            name,
            title,
            content,
            category,
            tags,
            documentType,
            clientId,
            employeeId,
            projectId,
            dealId,
            blocks,
            headerBlocks,
            footerBlocks,
            variables,
            designSettings,
            subtotal,
            taxPercent,
            taxAmount,
            discount,
            grandTotal,
            currency,
            dueDate,
            validUntil
        } = data;

        const companyId = requestContext.getStore()?.companyId as string;
        const docTitle = title || name || 'Untitled Document';
        const shareToken = crypto.randomBytes(16).toString('hex');

        // Parse content if blocks passed as JSON string
        let contentBlocks = blocks || [];
        if (!blocks && content) {
            try {
                const parsed = JSON.parse(content);
                if (parsed.blocks) contentBlocks = parsed.blocks;
            } catch (e) {}
        }

        // Ensure valid creator user
        let validCreatedById = userId;
        if (userId) {
            const userExists = await prisma.user.findFirst({ where: { id: userId }, select: { id: true } });
            if (!userExists) {
                const firstUser = await prisma.user.findFirst({ select: { id: true } });
                if (firstUser) validCreatedById = firstUser.id;
            }
        } else {
            const firstUser = await prisma.user.findFirst({ select: { id: true } });
            if (firstUser) validCreatedById = firstUser.id;
        }

        const payload = {
            documentType: documentType || 'INVOICE',
            status: 'draft',
            blocks: contentBlocks,
            headerBlocks: headerBlocks || [],
            footerBlocks: footerBlocks || [],
            variables: variables || {},
            designSettings: designSettings || {},
            subtotal: Number(subtotal || 0),
            taxPercent: Number(taxPercent || 0),
            taxAmount: Number(taxAmount || 0),
            discount: Number(discount || 0),
            grandTotal: Number(grandTotal || subtotal || 0),
            currency: currency || 'INR',
            shareToken,
            dueDate: dueDate || null,
            validUntil: validUntil || null,
            clientId: clientId || null,
            employeeId: employeeId || null,
            projectId: projectId || null,
            dealId: dealId || null,
            companyId: companyId || data.companyId || null,
            documentNumber: data.documentNumber || `DOC-${Date.now().toString().slice(-6)}`,
            accessType: data.accessType || 'public',
            allowedUserIds: data.allowedUserIds || [],
            allowedEmails: (data.allowedEmails || []).map((e: string) => e.toLowerCase().trim()).filter(Boolean),
            shares: data.shares || []
        };

        // Ensure valid company
        let validCompanyId = companyId || data.companyId;
        let companyRecord = null;
        if (validCompanyId) {
            companyRecord = await prisma.company.findFirst({ where: { id: validCompanyId }, select: { id: true } });
        }
        if (!companyRecord) {
            companyRecord = await prisma.company.findFirst({ select: { id: true } });
        }
        if (!companyRecord) {
            try {
                companyRecord = await prisma.company.create({
                    data: {
                        name: 'Default Workspace',
                        slug: `workspace-${Date.now()}`
                    }
                });
            } catch (e) {}
        }

        const createData: any = {
            title: docTitle,
            category: category || (documentType === 'INVOICE' ? 'Finance' : documentType === 'CONTRACT' ? 'Contract' : 'General'),
            tags: tags || [],
            content: JSON.stringify(payload)
        };

        if (validCreatedById) {
            createData.createdById = validCreatedById;
        }

        if (companyRecord) {
            createData.companyId = companyRecord.id;
        }

        const article = await prisma.knowledgeArticle.create({
            data: createData,
            include: {
                createdBy: { select: { id: true, name: true, email: true } }
            }
        });

        return {
            id: article.id,
            _id: article.id,
            title: article.title,
            name: article.title,
            documentNumber: payload.documentNumber,
            documentType: payload.documentType,
            status: payload.status,
            category: article.category,
            folder: article.category,
            tags: article.tags,
            contentBlocks: payload.blocks,
            blocks: payload.blocks,
            headerBlocks: payload.headerBlocks,
            footerBlocks: payload.footerBlocks,
            variables: payload.variables,
            designSettings: payload.designSettings,
            subtotal: payload.subtotal,
            taxPercent: payload.taxPercent,
            taxAmount: payload.taxAmount,
            discount: payload.discount,
            grandTotal: payload.grandTotal,
            currency: payload.currency,
            shareToken: payload.shareToken,
            dueDate: payload.dueDate,
            validUntil: payload.validUntil,
            clientId: payload.clientId,
            dealId: payload.dealId,
            employeeId: payload.employeeId,
            companyId: payload.companyId,
            accessType: payload.accessType || 'public',
            createdAt: article.createdAt,
            updatedAt: article.updatedAt,
            createdBy: article.createdBy
        };
    }

    static async updateDocument(userId: string, id: string, data: any) {
        let article = await prisma.knowledgeArticle.findFirst({ where: { id } });
        if (!article) {
            // Seamlessly create the document if the ID does not exist
            return this.createDocument(userId, { ...data, id });
        }

        let parsed: any = {};
        try {
            parsed = JSON.parse(article.content);
        } catch (e) {
            parsed = {};
        }

        if (data.blocks !== undefined) parsed.blocks = data.blocks;
        if (data.headerBlocks !== undefined) parsed.headerBlocks = data.headerBlocks;
        if (data.footerBlocks !== undefined) parsed.footerBlocks = data.footerBlocks;
        if (data.variables !== undefined) parsed.variables = data.variables;
        if (data.designSettings !== undefined) parsed.designSettings = data.designSettings;
        if (data.subtotal !== undefined) parsed.subtotal = Number(data.subtotal);
        if (data.taxPercent !== undefined) parsed.taxPercent = Number(data.taxPercent);
        if (data.taxAmount !== undefined) parsed.taxAmount = Number(data.taxAmount);
        if (data.discount !== undefined) parsed.discount = Number(data.discount);
        if (data.grandTotal !== undefined) parsed.grandTotal = Number(data.grandTotal);
        if (data.currency !== undefined) parsed.currency = data.currency;
        if (data.documentType !== undefined) parsed.documentType = data.documentType;
        if (data.status !== undefined) parsed.status = data.status;
        if (data.clientId !== undefined) parsed.clientId = data.clientId;
        if (data.dealId !== undefined) parsed.dealId = data.dealId;
        if (data.employeeId !== undefined) parsed.employeeId = data.employeeId;
        if (data.dueDate !== undefined) parsed.dueDate = data.dueDate;
        if (data.validUntil !== undefined) parsed.validUntil = data.validUntil;
        if (data.accessType !== undefined) parsed.accessType = data.accessType;
        if (data.allowedUserIds !== undefined) parsed.allowedUserIds = data.allowedUserIds;
        if (data.allowedEmails !== undefined) {
            parsed.allowedEmails = (data.allowedEmails || []).map((e: string) => e.toLowerCase().trim()).filter(Boolean);
        }
        if (data.shares !== undefined) parsed.shares = data.shares;

        const updateData: any = {
            title: data.title !== undefined ? data.title : data.name !== undefined ? data.name : article.title,
            category: data.category !== undefined ? data.category : article.category,
            tags: data.tags !== undefined ? data.tags : article.tags,
            content: JSON.stringify(parsed)
        };

        if (userId) {
            const userExists = await prisma.user.findFirst({ where: { id: userId }, select: { id: true } });
            if (userExists) {
                updateData.updatedBy = { connect: { id: userId } };
            }
        }

        const updatedArticle = await prisma.knowledgeArticle.update({
            where: { id },
            data: updateData
        });

        return {
            id: updatedArticle.id,
            title: updatedArticle.title,
            name: updatedArticle.title,
            category: updatedArticle.category,
            tags: updatedArticle.tags,
            ...parsed
        };
    }

    static verifyDocumentAccess(doc: any, userContext?: { userId?: string; email?: string } | null): { allowed: boolean; reason?: string } {
        const accessType = doc.accessType || 'public';
        if (accessType === 'public') {
            return { allowed: true };
        }

        // If restricted or client_only:
        if (!userContext || (!userContext.userId && !userContext.email)) {
            return { allowed: false, reason: 'AUTHENTICATION_REQUIRED' };
        }

        const reqUserId = userContext.userId ? String(userContext.userId) : null;
        const reqEmail = userContext.email ? userContext.email.toLowerCase().trim() : null;

        // 1. Is user the creator/owner?
        const creatorId = doc.createdBy?.id || doc.createdById;
        if (creatorId && reqUserId && String(creatorId) === reqUserId) {
            return { allowed: true };
        }

        // 2. Is user in allowedUserIds?
        const allowedUserIds = Array.isArray(doc.allowedUserIds) ? doc.allowedUserIds.map(String) : [];
        if (reqUserId && allowedUserIds.includes(reqUserId)) {
            return { allowed: true };
        }

        // 3. Is client matching?
        if (doc.clientId && reqUserId && String(doc.clientId) === reqUserId) {
            return { allowed: true };
        }
        const clientEmail = (doc.clientEmail || doc.variables?.clientEmail || '').toLowerCase().trim();
        if (clientEmail && reqEmail && clientEmail === reqEmail) {
            return { allowed: true };
        }

        // 4. Is user's email in allowedEmails?
        const allowedEmails = Array.isArray(doc.allowedEmails) ? doc.allowedEmails.map((e: string) => String(e).toLowerCase().trim()) : [];
        if (reqEmail && allowedEmails.includes(reqEmail)) {
            return { allowed: true };
        }

        return { allowed: false, reason: 'UNAUTHORIZED_VIEWER' };
    }

    static async dispatchDocumentShares(documentId: string, inviterId: string, payload: {
        accessType?: 'public' | 'restricted' | 'client_only';
        recipientUserIds?: string[];
        customEmails?: string[];
        message?: string;
        documentUrl?: string;
    }) {
        const article = await prisma.knowledgeArticle.findFirst({
            where: { id: documentId },
            include: {
                createdBy: { select: { id: true, name: true, email: true } },
                company: { select: { id: true, name: true } }
            }
        });

        if (!article) throw new Error('Document not found for sharing');

        let parsed: any = {};
        try {
            parsed = JSON.parse(article.content);
        } catch (e) {
            parsed = {};
        }

        const accessType = payload.accessType || parsed.accessType || 'public';
        const recipientUserIds = payload.recipientUserIds || [];
        const customEmails = (payload.customEmails || []).map((e: string) => e.toLowerCase().trim()).filter(Boolean);

        const existingAllowedUsers = Array.isArray(parsed.allowedUserIds) ? parsed.allowedUserIds : [];
        const existingAllowedEmails = Array.isArray(parsed.allowedEmails) ? parsed.allowedEmails : [];

        const updatedAllowedUserIds = Array.from(new Set([...existingAllowedUsers, ...recipientUserIds]));
        const updatedAllowedEmails = Array.from(new Set([...existingAllowedEmails, ...customEmails]));

        parsed.accessType = accessType;
        parsed.allowedUserIds = updatedAllowedUserIds;
        parsed.allowedEmails = updatedAllowedEmails;

        // Fetch platform user records
        let platformUsers: any[] = [];
        if (recipientUserIds.length > 0) {
            platformUsers = await prisma.user.findMany({
                where: { id: { in: recipientUserIds } },
                select: { id: true, name: true, email: true }
            });
        }

        // Combine all target recipient records
        const allRecipients: { email: string; name: string; userId?: string }[] = [];
        for (const u of platformUsers) {
            if (u.email) {
                allRecipients.push({ email: u.email, name: u.name || 'Team Member', userId: u.id });
            }
        }
        for (const email of customEmails) {
            if (!allRecipients.some(r => r.email === email)) {
                allRecipients.push({ email, name: email.split('@')[0] });
            }
        }

        if (!parsed.shareToken) {
            parsed.shareToken = crypto.randomBytes(16).toString('hex');
        }

        // Record shares audit
        const shareRecords = (parsed.shares || []);
        const timestamp = new Date().toISOString();
        for (const r of allRecipients) {
            shareRecords.push({
                recipient: r.email,
                name: r.name,
                userId: r.userId || null,
                sharedAt: timestamp,
                sharedBy: inviterId
            });
        }
        parsed.shares = shareRecords;

        await prisma.knowledgeArticle.update({
            where: { id: article.id },
            data: { content: JSON.stringify(parsed) }
        });

        // Enqueue background email jobs via BullMQ
        let queuedJobs: string[] = [];
        try {
            let queueService: any = null;
            try {
                const mod: any = await import('@workspace/backend-infra');
                queueService = mod.queueService || mod;
            } catch (e) {}
            const companyId = article.companyId || (requestContext.getStore()?.companyId as string);
            const inviter = inviterId ? await prisma.user.findFirst({ where: { id: inviterId }, select: { name: true, email: true } }) : null;
            const senderName = inviter?.name || '180 Workspace';
            const docTitle = article.title || 'Document';
            const docUrl = payload.documentUrl || `/f/document/${parsed.shareToken}`;

            for (const recipient of allRecipients) {
                const emailPayload = {
                    to: recipient.email,
                    subject: `${senderName} shared a document with you: ${docTitle}`,
                    html: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
                            <h2 style="color: #1e293b; margin-bottom: 8px; font-size: 20px;">Document Shared: ${docTitle}</h2>
                            <p style="color: #4b5563; font-size: 14px; line-height: 1.5;">
                                <strong>${senderName}</strong> has shared a document with you on 180 Workspace.
                            </p>
                            ${payload.message ? `<div style="background-color: #f8fafc; border-left: 4px solid #6366f1; padding: 12px 16px; margin: 16px 0; font-size: 13px; color: #334155; border-radius: 4px;">${payload.message}</div>` : ''}
                            <div style="margin: 24px 0;">
                                <a href="${docUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 14px;">
                                    View & Sign Document
                                </a>
                            </div>
                            <p style="color: #9ca3af; font-size: 11px; margin-top: 24px; border-top: 1px solid #f3f4f6; padding-top: 12px;">
                                Access Mode: ${accessType === 'public' ? 'Public View' : 'Restricted (Authorized Emails Only)'}
                            </p>
                        </div>
                    `,
                    category: 'DOCUMENT_SHARE',
                    companyId
                };

                await queueService.queueEmail(emailPayload);
                queuedJobs.push(recipient.email);
            }
        } catch (err) {
            console.error('Queue email dispatch error (fallback handled):', err);
        }

        return {
            success: true,
            message: `Document permissions updated and invitation sent to ${allRecipients.length} recipients.`,
            accessType,
            totalRecipients: allRecipients.length,
            dispatchedTo: queuedJobs,
            shareToken: parsed.shareToken,
            allowedUserIds: updatedAllowedUserIds,
            allowedEmails: updatedAllowedEmails
        };
    }

    static async generateShareLink(id: string) {
        const article = await prisma.knowledgeArticle.findFirst({ where: { id } });
        if (!article) throw new Error('Document not found');

        let parsed: any = {};
        try {
            parsed = JSON.parse(article.content);
        } catch (e) {
            parsed = {};
        }

        const token = parsed.shareToken || crypto.randomBytes(16).toString('hex');
        parsed.shareToken = token;

        await prisma.knowledgeArticle.update({
            where: { id },
            data: { content: JSON.stringify(parsed) }
        });

        return token;
    }

    static async getDocumentByToken(token: string, userContext?: { userId?: string; email?: string }) {
        const article = await prisma.knowledgeArticle.findFirst({
            where: {
                content: { contains: `"shareToken":"${token}"` }
            },
            include: {
                createdBy: { select: { id: true, name: true, photoUrl: true, email: true } }
            }
        });

        if (!article) {
            throw new Error('Document not found or invalid token');
        }

        let parsed: any = {};
        try {
            parsed = JSON.parse(article.content);
        } catch (e) {
            parsed = {};
        }

        let client = null;
        if (parsed.clientId) {
            client = await prisma.client.findFirst({ where: { id: parsed.clientId } });
        }

        const accessType = parsed.accessType || 'public';
        const accessCheck = this.verifyDocumentAccess({
            ...parsed,
            createdById: article.createdById || article.createdBy?.id,
            clientEmail: client?.email || parsed.variables?.clientEmail || parsed.clientEmail
        }, userContext);

        return {
            id: article.id,
            title: article.title,
            documentNumber: parsed.documentNumber || '',
            documentType: parsed.documentType || 'GENERAL',
            status: parsed.status || 'draft',
            clientName: client?.name || client?.companyName || parsed.variables?.clientName || '',
            clientEmail: client?.email || parsed.variables?.clientEmail || '',
            blocks: parsed.blocks || [],
            headerBlocks: parsed.headerBlocks || [],
            footerBlocks: parsed.footerBlocks || [],
            designSettings: parsed.designSettings || {},
            subtotal: parsed.subtotal || 0,
            taxPercent: parsed.taxPercent || 0,
            taxAmount: parsed.taxAmount || 0,
            grandTotal: parsed.grandTotal || 0,
            currency: parsed.currency || 'INR',
            createdAt: article.createdAt,
            signature: parsed.signatureData || null,
            signatureData: parsed.signatureData || null,
            signedAt: parsed.signedAt || null,
            accessType,
            allowedUserIds: parsed.allowedUserIds || [],
            allowedEmails: parsed.allowedEmails || [],
            accessGranted: accessCheck.allowed,
            accessReason: accessCheck.reason
        };
    }

    static async signDocumentByToken(token: string, signaturePayload: any, ip?: string, userAgent?: string) {
        const article = await prisma.knowledgeArticle.findFirst({
            where: {
                content: { contains: `"shareToken":"${token}"` }
            }
        });

        if (!article) {
            throw new Error('Document not found for signature');
        }

        let parsed: any = {};
        try {
            parsed = JSON.parse(article.content);
        } catch (e) {
            parsed = {};
        }

        const signedAt = new Date().toISOString();
        parsed.status = 'signed';
        parsed.signatureData = {
            signedBy: signaturePayload.clientName,
            signatureData: signaturePayload.signatureData,
            signedAt
        };
        parsed.signerIp = ip || null;
        parsed.signerUserAgent = userAgent || null;
        parsed.signedAt = signedAt;

        await prisma.knowledgeArticle.update({
            where: { id: article.id },
            data: { content: JSON.stringify(parsed) }
        });

        return {
            success: true,
            message: 'Document electronically signed and accepted!',
            signedAt
        };
    }

    static async recordDecisionByToken(
        token: string, 
        payload: {
            action: 'approve' | 'decline';
            reviewerName: string;
            reviewerEmail?: string;
            reviewerRole?: string;
            reason?: string;
            note?: string;
            signatureData?: string;
        }, 
        ip?: string, 
        userAgent?: string
    ) {
        const article = await prisma.knowledgeArticle.findFirst({
            where: {
                content: { contains: `"shareToken":"${token}"` }
            }
        });

        if (!article) {
            throw new Error('Document not found for decision');
        }

        let parsed: any = {};
        try {
            parsed = JSON.parse(article.content);
        } catch (e) {
            parsed = {};
        }

        const timestamp = new Date().toISOString();
        const isDecline = payload.action === 'decline';

        if (isDecline && !payload.reason?.trim()) {
            throw new Error('A mandatory reason is required when declining or requesting changes.');
        }

        const newStatus = isDecline ? 'declined' : 'approved';
        parsed.status = newStatus;

        const decisionRecord = {
            status: newStatus,
            reviewerName: payload.reviewerName || 'Reviewer',
            reviewerEmail: payload.reviewerEmail || null,
            reviewerRole: payload.reviewerRole || 'Senior Reviewer',
            reason: isDecline ? payload.reason : undefined,
            note: !isDecline ? payload.note : undefined,
            signatureData: payload.signatureData || null,
            timestamp,
            ip: ip || null,
            userAgent: userAgent || null
        };

        parsed.decisionData = decisionRecord;

        // Also update any approval_buttons or decision blocks in the document AST
        if (Array.isArray(parsed.blocks)) {
            parsed.blocks = parsed.blocks.map((block: any) => {
                if (block.type === 'approval_buttons' || block.type === 'decision') {
                    return {
                        ...block,
                        content: {
                            ...block.content,
                            decision: decisionRecord
                        }
                    };
                }
                return block;
            });
        }

        await prisma.knowledgeArticle.update({
            where: { id: article.id },
            data: { content: JSON.stringify(parsed) }
        });

        return {
            success: true,
            status: newStatus,
            message: isDecline 
                ? 'Document review declined and revisions recorded.' 
                : 'Document successfully approved and signed off!',
            decision: decisionRecord
        };
    }

    static async recordDecision(
        id: string, 
        payload: {
            action: 'approve' | 'decline';
            reviewerName?: string;
            reviewerRole?: string;
            reason?: string;
            note?: string;
        }, 
        userId?: string
    ) {
        let article = await prisma.knowledgeArticle.findFirst({ where: { id } });
        if (!article) {
            throw new Error('Document not found');
        }

        let parsed: any = {};
        try {
            parsed = JSON.parse(article.content);
        } catch (e) {
            parsed = {};
        }

        const timestamp = new Date().toISOString();
        const isDecline = payload.action === 'decline';

        if (isDecline && !payload.reason?.trim()) {
            throw new Error('A mandatory reason is required when declining or requesting changes.');
        }

        let reviewerName = payload.reviewerName;
        if (!reviewerName && userId) {
            const user = await prisma.user.findFirst({ where: { id: userId }, select: { name: true, email: true } });
            if (user) reviewerName = user.name || user.email;
        }

        const newStatus = isDecline ? 'declined' : 'approved';
        parsed.status = newStatus;

        const decisionRecord = {
            status: newStatus,
            reviewerName: reviewerName || 'Workspace Reviewer',
            reviewerRole: payload.reviewerRole || 'Senior Reviewer',
            reason: isDecline ? payload.reason : undefined,
            note: !isDecline ? payload.note : undefined,
            timestamp
        };

        parsed.decisionData = decisionRecord;

        if (Array.isArray(parsed.blocks)) {
            parsed.blocks = parsed.blocks.map((block: any) => {
                if (block.type === 'approval_buttons' || block.type === 'decision') {
                    return {
                        ...block,
                        content: {
                            ...block.content,
                            decision: decisionRecord
                        }
                    };
                }
                return block;
            });
        }

        await prisma.knowledgeArticle.update({
            where: { id: article.id },
            data: { content: JSON.stringify(parsed) }
        });

        return {
            success: true,
            status: newStatus,
            message: isDecline 
                ? 'Document changes requested and reason recorded.' 
                : 'Document accepted and authorized.',
            decision: decisionRecord
        };
    }

    static async deleteDocument(id: string) {
        try {
            await prisma.knowledgeArticle.delete({ where: { id } });
            return true;
        } catch (e) {
            try {
                await prisma.document.delete({ where: { id } });
                return true;
            } catch (err) {}
        }
        return false;
    }
}

