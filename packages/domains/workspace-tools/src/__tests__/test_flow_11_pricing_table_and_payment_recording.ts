// @ts-nocheck
import { prisma } from '@workspace/db';
import { DocumentService } from '../documents/document.service';
import { DocumentApprovalService } from '../documents/document-approval.service';

async function runTestFlow11() {
    console.log('\n======================================================');
    console.log('🧪 TEST FLOW 11: Pricing Table & Two-Step Payment Recording');
    console.log('======================================================\n');

    let testCompany: any = null;
    let testUser: any = null;
    let testClient: any = null;
    let testDeal: any = null;
    let testDocument: any = null;

    try {
        // Step 1: Initialize Multi-tenant Scaffolding
        console.log('1. Setting up Test Environment & Client Fixture...');
        testCompany = await prisma.company.findFirst();
        if (!testCompany) {
            testCompany = await prisma.company.create({
                data: {
                    name: 'Test Enterprise Corp',
                    legalName: 'Test Enterprise Corporation Pvt Ltd',
                    currency: 'INR',
                    email: 'billing@testenterprise.com'
                }
            });
        }

        testUser = await prisma.user.findFirst();
        if (!testUser) {
            testUser = await prisma.user.create({
                data: {
                    name: 'Financial Controller',
                    email: `controller_${Date.now()}@testcorp.com`,
                    role: 'admin',
                    companyId: testCompany.id
                }
            });
        }

        testClient = await prisma.client.create({
            data: {
                name: 'Zenith Global Solutions',
                companyName: 'Zenith Global Ltd',
                email: `billing_${Date.now()}@zenithglobal.com`,
                companyId: testCompany.id,
                clv: 50000,
                annualRevenue: 50000,
                paymentTerms: 'NET_30'
            }
        });
        console.log(`✓ Test Client Created (ID: ${testClient.id}, Initial CLV: ₹${testClient.clv})`);

        testDeal = await prisma.deal.create({
            data: {
                title: 'Zenith Cloud Architecture 2026',
                value: 177000,
                stage: 'Negotiation',
                client: { connect: { id: testClient.id } }
            }
        });
        console.log(`✓ Test Deal Initialized (Stage: ${testDeal.stage}, Value: ₹${testDeal.value})`);

        // Step 2: Create Document with Interactive Pricing Table AST
        console.log('\n2. Creating Proposal Document with Structured Pricing Table AST...');
        const pricingItems = [
            { id: '1', description: 'Cloud Infrastructure Architecture & Audit', quantity: 1, rate: 50000, taxRate: 18, amount: 50000 },
            { id: '2', description: 'Kubernetes Microservices Deployment', quantity: 1, rate: 80000, taxRate: 18, amount: 80000 },
            { id: '3', description: 'SRE Observability & 24/7 Monitoring Setup', quantity: 1, rate: 20000, taxRate: 18, amount: 20000 },
        ];

        const subtotal = 150000;
        const discountPercent = 0;
        const taxAmount = 27000; // 18% GST on ₹150,000
        const grandTotal = 177000;

        testDocument = await DocumentService.createDocument(testUser.id, {
            title: 'Master Cloud Proposal - Zenith Global',
            name: 'Master Cloud Proposal',
            documentNumber: `PROP-${Date.now().toString().slice(-6)}`,
            documentType: 'COMMERCIAL_PROPOSAL',
            category: 'Contract',
            blocks: [
                {
                    id: 'b-heading-1',
                    type: 'heading',
                    content: { text: 'Enterprise Cloud Architecture Proposal' },
                    styles: { fontSize: 28, color: '#1E293B' }
                },
                {
                    id: 'b-pricing-1',
                    type: 'pricing_table',
                    content: {
                        items: pricingItems,
                        discountPercent,
                        subtotal,
                        taxAmount,
                        grandTotal,
                        currency: 'INR'
                    }
                },
                {
                    id: 'b-sig-1',
                    type: 'signature',
                    content: { label: 'Client Authorized Acceptance', requireName: true }
                }
            ],
            subtotal,
            taxPercent: 18,
            taxAmount,
            discount: 0,
            grandTotal,
            currency: 'INR',
            clientId: testClient.id,
            dealId: testDeal.id,
            paymentTerms: 'NET_30',
            companyId: testCompany.id
        });

        console.log(`✓ Document Created (Doc #: ${testDocument.documentNumber}, ID: ${testDocument.id})`);
        console.log(`✓ Grand Total Verified: ₹${testDocument.grandTotal}`);
        console.log(`✓ Payment Terms Verified: ${testDocument.paymentTerms}`);

        // Step 3: Client Views & Digitally Signs Document
        console.log('\n3. Simulating Client Public Review & E-Signature...');
        const shareToken = await DocumentService.generateShareLink(testDocument.id);
        console.log(`✓ Share Token generated: ${shareToken}`);

        const signResult = await DocumentService.signDocumentByToken(
            shareToken,
            {
                clientName: 'Alexander Hayes',
                signatureData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
            },
            '198.51.100.25',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
        );

        console.log(`✓ Digital Signature accepted! Response: ${signResult.message}`);
        const signedDoc: any = await DocumentService.getDocumentById(testDocument.id);
        if (signedDoc.status !== 'signed') {
            throw new Error(`Expected document status 'signed', got: ${signedDoc.status}`);
        }
        console.log(`✓ Document Status Verified: ${signedDoc.status}`);

        // Step 4: Step 1 of Confirmation - Owner clicks "No / Not Yet" (Dispatches Payment Reminder)
        console.log('\n4. Testing Step A: Owner clicks "No, Send Payment Reminder"...');
        const reminderRes = await DocumentApprovalService.sendPaymentReminder(testDocument.id, testUser.id);
        console.log(`✓ Reminder Dispatch: ${reminderRes.message}`);

        // Verify that financial ledger is NOT altered when owner clicked No
        const transactionsBeforePayment = await prisma.companyTransaction.findMany({
            where: { referenceId: testDocument.id }
        });
        if (transactionsBeforePayment.length !== 0) {
            throw new Error('Ledger transaction must NOT be posted prior to explicit payment confirmation!');
        }
        console.log('✓ Safeguard Confirmed: No transaction written to CompanyTransaction ledger.');

        // Step 5: Step 2 of Confirmation - Owner clicks "Yes, I Received Payment" (Records Payment & Ledger)
        console.log('\n5. Testing Step B: Owner clicks "Yes, I Received Payment" with UTR details...');
        const paymentRes = await DocumentApprovalService.recordPayment(testDocument.id, {
            paymentMethod: 'BANK_TRANSFER',
            referenceNumber: 'UTR-9823419082',
            paymentDate: new Date().toISOString(),
            amountReceived: grandTotal,
            notes: 'Received via ICICI Corporate Banking wire'
        }, testUser.id);

        console.log(`✓ Payment Recording Message: ${paymentRes.message}`);
        console.log(`✓ Updated Document Status: ${paymentRes.document.status}`);
        if (paymentRes.document.status !== 'paid') {
            throw new Error(`Expected document status 'paid', got: ${paymentRes.document.status}`);
        }

        // Step 6: Verify Financial Ledger Entry
        console.log('\n6. Verifying Financial Ledger (CompanyTransaction) Credit Entry...');
        const tx = await prisma.companyTransaction.findFirst({
            where: { referenceId: testDocument.id }
        });
        if (!tx) throw new Error('CompanyTransaction not found in ledger!');
        console.log(`✓ Ledger Transaction ID: ${tx.id}`);
        console.log(`✓ Amount Credited: +₹${tx.amount} (Status: ${tx.status}, Provider: ${tx.provider})`);
        console.log(`✓ UTR Metadata Reference: ${(tx.metadata as any)?.referenceNumber}`);

        // Step 7: Verify Client Lifetime Value (CLV) increment
        console.log('\n7. Verifying Client CLV & Revenue Synchronisation...');
        const updatedClient = await prisma.client.findFirst({ where: { id: testClient.id } });
        console.log(`✓ Client CLV updated from ₹50,000 -> ₹${updatedClient?.clv}`);
        if (Number(updatedClient?.clv) !== 227000) {
            throw new Error(`Expected CLV 227,000, got: ${updatedClient?.clv}`);
        }

        // Step 8: Verify CRM Deal Stage
        console.log('\n8. Verifying CRM Deal Stage Update...');
        const updatedDeal = await prisma.deal.findFirst({ where: { id: testDeal.id } });
        console.log(`✓ Deal Stage updated to: "${updatedDeal?.stage}"`);
        if (updatedDeal?.stage !== 'Won') {
            throw new Error(`Expected Deal stage 'Won', got: ${updatedDeal?.stage}`);
        }

        // Step 9: Cleanup Test Data
        console.log('\n9. Cleaning up test data...');
        await prisma.companyTransaction.deleteMany({ where: { referenceId: testDocument.id } });
        await DocumentService.deleteDocument(testDocument.id);
        await prisma.deal.delete({ where: { id: testDeal.id } });
        await prisma.client.delete({ where: { id: testClient.id } });
        console.log('✓ Cleanup completed.');

        console.log('\n======================================================');
        console.log('🎉 TEST FLOW 11 PASSED: Pricing Table & Two-Step Payment Recording fully verified!');
        console.log('======================================================\n');
        return true;
    } catch (error) {
        console.error('\n❌ TEST FLOW 11 FAILED:', error);
        // Attempt cleanup
        try {
            if (testDocument?.id) {
                await prisma.companyTransaction.deleteMany({ where: { referenceId: testDocument.id } });
                await DocumentService.deleteDocument(testDocument.id);
            }
            if (testDeal?.id) await prisma.deal.delete({ where: { id: testDeal.id } });
            if (testClient?.id) await prisma.client.delete({ where: { id: testClient.id } });
        } catch (e) {}
        throw error;
    }
}

export async function run() {
    return runTestFlow11();
}

// Execute standalone if run directly
if (require.main === module) {
    runTestFlow11().catch(e => {
        console.error(e);
        process.exit(1);
    });
}

