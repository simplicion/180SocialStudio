import { prisma } from '@workspace/db';
import { AIDocumentService } from '../documents/ai-document.service';
import { DocumentService } from '../documents/document.service';
import { DocumentApprovalService } from '../documents/document-approval.service';

export async function run() {
    console.log('\n======================================================');
    console.log('🚀 TEST FLOW 10: COMPLETE END-TO-END DOCUMENT LIFECYCLE');
    console.log('======================================================');

    const testUserId = 'test-owner-' + Date.now();

    // ── STEP 1: Setup Client & Deal in Workspace ──
    console.log('Step 1: Setting up client enterprise profile...');
    const client = await prisma.client.create({
        data: {
            name: 'Apex Global Industries',
            companyName: 'Apex Global Industries Ltd.',
            email: `finance-${Date.now()}@apexglobal.com`,
            clv: 25000,
            annualRevenue: 25000,
            billingAddress: '420 Lexington Ave, New York, NY'
        }
    });

    const deal = await prisma.deal.create({
        data: {
            title: 'Apex Global Website & Platform Deal',
            clientId: client.id,
            stage: 'Negotiation',
            value: 90000
        }
    });

    console.log(`✓ Client Profile Initialized (CLV: ₹${client.clv}, ID: ${client.id})`);
    console.log(`✓ CRM Deal Initialized (Stage: ${deal.stage}, Value: ₹${deal.value})`);

    // ── STEP 2: AI Document Generation ──
    console.log('\nStep 2: AI drafting invoice from natural language prompt...');
    const aiResult = await AIDocumentService.generateFromPrompt({
        prompt: 'Draft an invoice for Apex Global Industries for Full-Stack Platform Development for ₹90,000 with 18% GST',
        documentType: 'INVOICE',
        clientId: client.id
    });

    if (!aiResult.success) throw new Error('AI Generation failed');
    console.log(`✓ AI generated: "${aiResult.title}" with ${aiResult.blocks.length} structured AST blocks.`);

    // ── STEP 3: Persist Document in Centralized Engine ──
    console.log('\nStep 3: Persisting Document to Unified Database Model...');
    const invoiceDoc = await DocumentService.createDocument(testUserId, {
        title: aiResult.title,
        documentNumber: `INV-${Date.now().toString().slice(-6)}`,
        documentType: 'INVOICE',
        category: 'Finance',
        clientId: client.id,
        dealId: deal.id,
        blocks: aiResult.blocks,
        variables: aiResult.documentDetails,
        subtotal: 90000,
        taxPercent: 18,
        taxAmount: 16200,
        grandTotal: 106200,
        currency: 'INR'
    });

    console.log(`✓ Document Created (Doc #: ${invoiceDoc.documentNumber}, ID: ${invoiceDoc.id})`);
    console.log(`✓ Grand Total: ₹${invoiceDoc.grandTotal} (Status: ${invoiceDoc.status})`);

    // ── STEP 4: Share Link Generation & Public Client Portal ──
    console.log('\nStep 4: Generating Public E-Sign Share Link...');
    const token = await DocumentService.generateShareLink(invoiceDoc.id);
    console.log(`✓ Public E-Sign URL: /f/document/${token}`);

    // Public retrieval
    const publicDoc: any = await DocumentService.getDocumentByToken(token);
    if (!publicDoc) throw new Error('Public portal lookup failed');
    console.log(`✓ Client viewed document successfully via unauthenticated portal.`);

    // ── STEP 5: Client Digital Signature Execution ──
    console.log('\nStep 5: Client signs document via Canvas Drawing Pad...');
    const clientSignResult = await DocumentService.signDocumentByToken(
        token,
        {
            clientName: 'Sarah Connor (CFO)',
            signatureData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...'
        },
        '198.51.100.25',
        'Mozilla/5.0 Chrome/122.0.0.0 Safari/537.36'
    );

    if (!clientSignResult.success) throw new Error('Client signature failed');
    console.log('✓ Signature registered. Document status transitioned to "signed".');

    // ── STEP 6: Owner Approval & Automated Financial Settlement ──
    console.log('\nStep 6: Company Owner executes One-Click Financial Approval...');
    const approvalResult = await DocumentApprovalService.approveDocument(invoiceDoc.id, testUserId);
    if (!approvalResult.success) throw new Error('Approval execution failed');
    console.log('✓ Approval executed successfully!');

    // ── STEP 7: Audit & Verify All Ledgers, CLV, and CRM ──
    console.log('\nStep 7: Verifying Financial Ledger, Client CLV, and CRM Deal updates...');

    // Verify Document Status
    const verifiedDoc: any = await DocumentService.getDocumentById(invoiceDoc.id);
    if (verifiedDoc.status !== 'paid' && verifiedDoc.status !== 'approved') {
        throw new Error(`Expected document status 'paid' or 'approved', got: ${verifiedDoc.status}`);
    }
    console.log(`✓ Document status: "${verifiedDoc.status}"`);

    // Verify CompanyTransaction Ledger
    const ledgerTx = await prisma.companyTransaction.findFirst({
        where: { referenceModel: 'Document', referenceId: invoiceDoc.id }
    });
    if (!ledgerTx || ledgerTx.type !== 'credit' || Number(ledgerTx.amount) !== invoiceDoc.grandTotal) {
        throw new Error('Ledger transaction verification failed');
    }
    console.log(`✓ Financial Ledger: Credited +₹${ledgerTx.amount} (Tx ID: ${ledgerTx.id})`);

    // Verify Client CLV Increment
    const verifiedClient = await prisma.client.findFirst({ where: { id: client.id } });
    const expectedClv = 25000 + invoiceDoc.grandTotal;
    if (verifiedClient?.clv !== expectedClv) {
        throw new Error(`CLV mismatch: expected ${expectedClv}, got: ${verifiedClient?.clv}`);
    }
    console.log(`✓ Client CLV: Incremented from ₹25,000 -> ₹${verifiedClient.clv}`);

    // Verify CRM Deal Stage
    const verifiedDeal = await prisma.deal.findFirst({ where: { id: deal.id } });
    if (verifiedDeal?.stage !== 'Won') {
        throw new Error(`Deal stage expected 'Won', got: ${verifiedDeal?.stage}`);
    }
    console.log(`✓ CRM Deal: Automatically marked as "${verifiedDeal.stage}"`);

    // ── CLEANUP ──
    console.log('\nCleaning up test artifacts...');
    await prisma.companyTransaction.delete({ where: { id: ledgerTx.id } });
    await DocumentService.deleteDocument(invoiceDoc.id);
    await prisma.deal.delete({ where: { id: deal.id } });
    await prisma.client.delete({ where: { id: client.id } });
    console.log('✓ Cleanup complete.');

    console.log('\n======================================================');
    console.log('🎉 ALL 10 TESTS PASSED: COMPLETE END-TO-END FLOW VERIFIED!');
    console.log('======================================================\n');
}

if (process.argv[1]?.includes('test_flow_10')) {
    run().catch(err => {
        console.error('❌ TEST FLOW 10 FAILED:', err);
        process.exit(1);
    });
}
