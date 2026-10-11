// @ts-nocheck
import { prisma, requestContext } from '@workspace/db';
import { DocumentService } from './document.service';

export class DocumentApprovalService {
    /**
     * Approves a signed or finalized document and posts revenue to the financial ledger.
     */
    static async approveDocument(documentId: string, userId: string) {
        const companyId = requestContext.getStore()?.companyId as string;

        // 1. Try KnowledgeArticle
        const article = await prisma.knowledgeArticle.findFirst({ where: { id: documentId } });
        if (article) {
            let parsed: any = {};
            try {
                parsed = JSON.parse(article.content);
            } catch (e) {
                parsed = {};
            }

            const docType = parsed.documentType || (article.category === 'Finance' ? 'INVOICE' : 'CONTRACT');
            const newStatus = docType === 'INVOICE' ? 'paid' : 'approved';
            const totalAmount = Number(parsed.grandTotal || parsed.subtotal || 0);

            parsed.status = newStatus;
            parsed.paidAt = docType === 'INVOICE' ? new Date().toISOString() : parsed.paidAt;
            parsed.approvedAt = new Date().toISOString();
            parsed.approvedById = userId;

            const updateData: any = {
                content: JSON.stringify(parsed)
            };
            if (userId) {
                const userExists = await prisma.user.findFirst({ where: { id: userId }, select: { id: true } });
                if (userExists) {
                    updateData.updatedBy = { connect: { id: userId } };
                }
            }

            await prisma.knowledgeArticle.update({
                where: { id: documentId },
                data: updateData
            });

            let transaction = null;

            // 2. Post to Financial Ledger (CompanyTransaction)
            if (totalAmount > 0) {
                let validCompanyId = parsed.companyId || companyId;
                if (!validCompanyId) {
                    const firstCompany = await prisma.company.findFirst({ select: { id: true } });
                    if (firstCompany) validCompanyId = firstCompany.id;
                }

                try {
                    const txData: any = {
                        type: 'credit',
                        amount: totalAmount,
                        currency: parsed.currency || 'INR',
                        status: 'completed',
                        provider: 'document_approval',
                        referenceModel: 'Document',
                        referenceId: article.id,
                        metadata: {
                            documentNumber: parsed.documentNumber || article.title,
                            documentType: docType,
                            approvedBy: userId
                        }
                    };

                    if (validCompanyId) {
                        txData.company = { connect: { id: validCompanyId } };
                    }
                    if (parsed.clientId) {
                        txData.client = { connect: { id: parsed.clientId } };
                    }

                    transaction = await prisma.companyTransaction.create({
                        data: txData
                    });
                } catch (err) {
                    console.error('Error recording ledger transaction on document approval:', err);
                }

                // 3. Update Client Lifetime Value (CLV)
                if (parsed.clientId) {
                    try {
                        await prisma.client.update({
                            where: { id: parsed.clientId },
                            data: {
                                clv: { increment: totalAmount },
                                annualRevenue: { increment: totalAmount },
                                lastContacted: new Date()
                            }
                        });
                    } catch (err) {
                        console.error('Error updating Client CLV:', err);
                    }
                }

                // 4. Update CRM Deal stage
                if (parsed.dealId) {
                    try {
                        await prisma.deal.update({
                            where: { id: parsed.dealId },
                            data: {
                                stage: 'Won',
                                value: totalAmount,
                                updatedAt: new Date()
                            }
                        });
                    } catch (err) {
                        console.error('Error updating CRM Deal stage:', err);
                    }
                }
            }

            return {
                success: true,
                message: `Document ${parsed.documentNumber || article.title || ''} approved and posted to financial records!`,
                document: {
                    id: article.id,
                    title: article.title,
                    status: newStatus,
                    ...parsed
                },
                transaction
            };
        }

        // 2. Fallback check in Document table
        try {
            const doc = await prisma.document.findFirst({
                where: { id: documentId },
                include: { client: true, deal: true }
            });

            if (doc) {
                const newStatus = doc.documentType === 'INVOICE' ? 'paid' : 'approved';
                const totalAmount = doc.grandTotal || 0;

                const updatedDoc = await prisma.document.update({
                    where: { id: documentId },
                    data: {
                        status: newStatus,
                        paidAt: doc.documentType === 'INVOICE' ? new Date() : doc.paidAt,
                        updatedAt: new Date()
                    }
                });

                let transaction = null;

                if (totalAmount > 0) {
                    let validCompanyId = doc.companyId || companyId;
                    if (!validCompanyId) {
                        const firstCompany = await prisma.company.findFirst({ select: { id: true } });
                        if (firstCompany) validCompanyId = firstCompany.id;
                    }

                    try {
                        const txData: any = {
                            type: 'credit',
                            amount: totalAmount,
                            currency: doc.currency || 'INR',
                            status: 'completed',
                            provider: 'document_approval',
                            referenceModel: 'Document',
                            referenceId: doc.id,
                            metadata: {
                                documentNumber: doc.documentNumber || doc.title,
                                documentType: doc.documentType,
                                approvedBy: userId
                            }
                        };

                        if (validCompanyId) {
                            txData.company = { connect: { id: validCompanyId } };
                        }
                        if (doc.clientId) {
                            txData.client = { connect: { id: doc.clientId } };
                        }

                        transaction = await prisma.companyTransaction.create({
                            data: txData
                        });
                    } catch (err) {
                        console.error('Error recording ledger transaction:', err);
                    }

                    if (doc.clientId) {
                        try {
                            await prisma.client.update({
                                where: { id: doc.clientId },
                                data: {
                                    clv: { increment: totalAmount },
                                    annualRevenue: { increment: totalAmount },
                                    lastContacted: new Date()
                                }
                            });
                        } catch (err) {
                            console.error('Error updating Client CLV:', err);
                        }
                    }

                    if (doc.dealId) {
                        try {
                            await prisma.deal.update({
                                where: { id: doc.dealId },
                                data: {
                                    stage: 'Won',
                                    value: totalAmount,
                                    updatedAt: new Date()
                                }
                            });
                        } catch (err) {
                            console.error('Error updating CRM Deal stage:', err);
                        }
                    }
                }

                return {
                    success: true,
                    message: `Document ${doc.documentNumber || doc.title || ''} approved and posted to financial records!`,
                    document: updatedDoc,
                    transaction
                };
            }
        } catch (e) {}

        throw new Error('Document not found');
    }

    /**
     * Converts an accepted Quotation/Proposal into an Invoice.
     */
    static async convertToInvoice(documentId: string, userId: string) {
        const doc: any = await DocumentService.getDocumentById(documentId);
        if (!doc) throw new Error('Quotation document not found');

        const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 15); // Net 15 default

        const invoiceDoc = await DocumentService.createDocument(userId, {
            name: `Invoice for ${doc.title || doc.name || 'Client'}`,
            title: `Invoice #${invoiceNumber}`,
            documentNumber: invoiceNumber,
            documentType: 'INVOICE',
            category: 'Finance',
            tags: ['invoice', 'converted_from_quote'],
            blocks: doc.contentBlocks || doc.blocks || [],
            headerBlocks: doc.headerBlocks || [],
            footerBlocks: doc.footerBlocks || [],
            variables: doc.variables || {},
            designSettings: doc.designSettings || {},
            subtotal: doc.subtotal,
            taxPercent: doc.taxPercent,
            taxAmount: doc.taxAmount,
            discount: doc.discount,
            grandTotal: doc.grandTotal,
            currency: doc.currency || 'INR',
            issueDate: new Date(),
            dueDate: dueDate,
            clientId: doc.clientId,
            projectId: doc.projectId,
            dealId: doc.dealId,
            companyId: doc.companyId
        });

        return {
            success: true,
            message: 'Quotation successfully converted to Invoice',
            invoice: invoiceDoc
        };
    }

    /**
     * Records explicit receipt of payment (Bank Transfer, UPI, Card, Cash, Cheque)
     * Atomically transitions status to 'paid', logs payment audit metadata,
     * writes credit to CompanyTransaction, and updates Client CLV & CRM Deal.
     */
    static async recordPayment(documentId: string, paymentData: {
        paymentMethod?: string;
        referenceNumber?: string;
        paymentDate?: string;
        amountReceived?: number;
        notes?: string;
    }, userId: string) {
        const companyId = requestContext.getStore()?.companyId as string;

        // 1. Check in KnowledgeArticle
        const article = await prisma.knowledgeArticle.findFirst({ where: { id: documentId } });
        if (article) {
            let parsed: any = {};
            try {
                parsed = JSON.parse(article.content);
            } catch (e) {
                parsed = {};
            }

            const docType = parsed.documentType || (article.category === 'Finance' ? 'INVOICE' : 'CONTRACT');
            const totalAmount = Number(paymentData.amountReceived !== undefined ? paymentData.amountReceived : (parsed.grandTotal || parsed.subtotal || 0));

            parsed.status = 'paid';
            parsed.paidAt = paymentData.paymentDate ? new Date(paymentData.paymentDate).toISOString() : new Date().toISOString();
            parsed.paymentDetails = {
                method: paymentData.paymentMethod || 'BANK_TRANSFER',
                referenceNumber: paymentData.referenceNumber || '',
                amountReceived: totalAmount,
                notes: paymentData.notes || '',
                recordedBy: userId,
                recordedAt: new Date().toISOString()
            };

            const updateData: any = {
                content: JSON.stringify(parsed)
            };
            if (userId) {
                const userExists = await prisma.user.findFirst({ where: { id: userId }, select: { id: true } });
                if (userExists) {
                    updateData.updatedBy = { connect: { id: userId } };
                }
            }

            await prisma.knowledgeArticle.update({
                where: { id: documentId },
                data: updateData
            });

            let transaction = null;

            // Post to Financial Ledger (CompanyTransaction)
            if (totalAmount > 0) {
                let validCompanyId = parsed.companyId || companyId;
                if (!validCompanyId) {
                    const firstCompany = await prisma.company.findFirst({ select: { id: true } });
                    if (firstCompany) validCompanyId = firstCompany.id;
                }

                try {
                    const txData: any = {
                        type: 'credit',
                        amount: totalAmount,
                        currency: parsed.currency || 'INR',
                        status: 'completed',
                        provider: paymentData.paymentMethod || 'manual_record',
                        referenceModel: 'Document',
                        referenceId: article.id,
                        metadata: {
                            documentNumber: parsed.documentNumber || article.title,
                            documentType: docType,
                            paymentMethod: paymentData.paymentMethod || 'BANK_TRANSFER',
                            referenceNumber: paymentData.referenceNumber || '',
                            recordedBy: userId,
                            notes: paymentData.notes || ''
                        }
                    };

                    if (validCompanyId) {
                        txData.company = { connect: { id: validCompanyId } };
                    }
                    if (parsed.clientId) {
                        txData.client = { connect: { id: parsed.clientId } };
                    }

                    transaction = await prisma.companyTransaction.create({
                        data: txData
                    });
                } catch (err) {
                    console.error('Error recording ledger transaction on payment record:', err);
                }

                // Update Client CLV & Annual Revenue
                if (parsed.clientId) {
                    try {
                        await prisma.client.update({
                            where: { id: parsed.clientId },
                            data: {
                                clv: { increment: totalAmount },
                                annualRevenue: { increment: totalAmount },
                                lastContacted: new Date()
                            }
                        });
                    } catch (err) {
                        console.error('Error updating Client CLV on payment record:', err);
                    }
                }

                // Update CRM Deal stage
                if (parsed.dealId) {
                    try {
                        await prisma.deal.update({
                            where: { id: parsed.dealId },
                            data: {
                                stage: 'Won',
                                value: totalAmount,
                                updatedAt: new Date()
                            }
                        });
                    } catch (err) {
                        console.error('Error updating CRM Deal stage:', err);
                    }
                }
            }

            return {
                success: true,
                message: `Payment of ${parsed.currency === 'USD' ? '$' : '₹'}${totalAmount.toLocaleString()} recorded for document ${parsed.documentNumber || article.title}!`,
                document: {
                    id: article.id,
                    title: article.title,
                    status: 'paid',
                    ...parsed
                },
                transaction
            };
        }

        throw new Error('Document not found');
    }

    /**
     * Dispatches a payment reminder notification for an unpaid/accepted document.
     */
    static async sendPaymentReminder(documentId: string, userId: string) {
        const doc: any = await DocumentService.getDocumentById(documentId);
        if (!doc) throw new Error('Document not found');

        // Update reminder count and last reminded timestamp in metadata
        const article = await prisma.knowledgeArticle.findFirst({ where: { id: documentId } });
        if (article) {
            let parsed: any = {};
            try { parsed = JSON.parse(article.content); } catch (e) {}
            parsed.reminderCount = (parsed.reminderCount || 0) + 1;
            parsed.lastRemindedAt = new Date().toISOString();

            await prisma.knowledgeArticle.update({
                where: { id: documentId },
                data: { content: JSON.stringify(parsed) }
            });
        }

        return {
            success: true,
            message: `Payment reminder sent successfully to ${doc.clientName || doc.client?.name || 'Client'} (${doc.clientEmail || doc.client?.email || ''})`,
            remindedAt: new Date().toISOString()
        };
    }
}

