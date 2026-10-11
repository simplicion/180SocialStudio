import { prisma } from '@workspace/db';
import { DocumentService } from '../documents/document.service';
import { DocumentApprovalService } from '../documents/document-approval.service';

export async function run() {
    console.log('\n======================================================');
    console.log('🧪 TEST FLOW 5: The Golden Financial Approval & Ledger Posting');
    console.log('======================================================');

    const testUserId = 'test-owner-' + Date.now();
    const testAmount = 75000;

    // 1. Create a Test Client in Database
    console.log('1. Setting up Test Client and Deal...');
    const client = await prisma.client.create({
        data: {
            name: 'Acme MegaCorp',
            companyName: 'Acme MegaCorp Inc.',
            email: `billing-${Date.now()}@acmemegacorp.com`,
            clv: 10000,
            annualRevenue: 10000
        }
    });

    // 2. Create a Test Deal
    const deal = await prisma.deal.create({
        data: {
            title: 'Acme Cloud Migration Deal',
            clientId: client.id,
            stage: 'Proposal',
            value: testAmount
        }
    });

    console.log(`✓ Created Client (ID: ${client.id}, Initial CLV: ₹${client.clv})`);
    console.log(`✓ Created Deal (ID: ${deal.id}, Initial Stage: ${deal.stage})`);

    // 3. Create an Invoice Document linked to Client and Deal
    console.log('2. Creating Invoice Document for ₹' + testAmount + '...');
    const doc = await DocumentService.createDocument(testUserId, {
        title: 'Tax Invoice - Acme Cloud Migration',
        documentNumber: `INV-${Date.now().toString().slice(-6)}`,
        documentType: 'INVOICE',
        category: 'Finance',
        clientId: client.id,
        dealId: deal.id,
        subtotal: testAmount,
        grandTotal: testAmount,
        currency: 'INR'
    });

    // 4. Simulate Client Signing
    const token = await DocumentService.generateShareLink(doc.id);
    await DocumentService.signDocumentByToken(token, {
        clientName: 'Wile E. Coyote (CEO)',
        signatureData: 'data:image/png;base64,...'
    });
    console.log('✓ Invoice marked as "signed" by Client.');

    // 5. Execute Owner Approval (The Golden Rule)
    console.log('3. Executing One-Click Owner Approval...');
    const approvalResult = await DocumentApprovalService.approveDocument(doc.id, testUserId);
    if (!approvalResult.success) throw new Error('Document approval failed');
    console.log('✓ Approval executed. Message:', approvalResult.message);

    // 6. Verify Document Status Transition
    const updatedDoc: any = await DocumentService.getDocumentById(doc.id);
    if (updatedDoc.status !== 'paid' && updatedDoc.status !== 'approved') {
        throw new Error(`Expected document status to be 'paid' or 'approved', but got: ${updatedDoc.status}`);
    }
    console.log('✓ Document status successfully transitioned to:', updatedDoc.status);

    // 7. Verify Financial Ledger Posting in CompanyTransaction
    console.log('4. Verifying Financial Ledger (CompanyTransaction) credit posting...');
    const ledgerTx = await prisma.companyTransaction.findFirst({
        where: {
            referenceModel: 'Document',
            referenceId: doc.id
        }
    });

    if (!ledgerTx) {
        throw new Error('Ledger transaction was NOT created in CompanyTransaction!');
    }
    if (ledgerTx.type !== 'credit') {
        throw new Error(`Expected transaction type 'credit', but got: ${ledgerTx.type}`);
    }
    if (Number(ledgerTx.amount) !== testAmount) {
        throw new Error(`Expected ledger amount ${testAmount}, but got: ${ledgerTx.amount}`);
    }
    console.log(`✓ Ledger Transaction verified: +₹${ledgerTx.amount} (Type: ${ledgerTx.type}, Status: ${ledgerTx.status})`);

    // 8. Verify Client CLV Increment
    console.log('5. Verifying Client CLV & Annual Revenue increment...');
    const updatedClient = await prisma.client.findFirst({ where: { id: client.id } });
    const expectedClv = 10000 + testAmount;
    if (updatedClient?.clv !== expectedClv) {
        throw new Error(`Expected Client CLV to be ${expectedClv}, but got: ${updatedClient?.clv}`);
    }
    console.log(`✓ Client CLV successfully incremented from ₹10,000 -> ₹${updatedClient.clv}`);

    // 9. Verify CRM Deal Status Transition
    console.log('6. Verifying CRM Deal Stage update...');
    const updatedDeal = await prisma.deal.findFirst({ where: { id: deal.id } });
    if (updatedDeal?.stage !== 'Won') {
        throw new Error(`Expected Deal stage to be 'Won', but got: ${updatedDeal?.stage}`);
    }
    console.log(`✓ Deal stage updated to: "${updatedDeal.stage}"`);

    // Clean up
    console.log('7. Cleaning up test data...');
    if (ledgerTx) await prisma.companyTransaction.delete({ where: { id: ledgerTx.id } });
    await DocumentService.deleteDocument(doc.id);
    await prisma.deal.delete({ where: { id: deal.id } });
    await prisma.client.delete({ where: { id: client.id } });
    console.log('✓ Test records cleaned up.');

    console.log('\n🎉 TEST FLOW 5 PASSED: Golden Financial Approval, Ledger Posting, and CLV Sync fully verified.\n');
}

if (process.argv[1]?.includes('test_flow_05')) {
    run().catch(err => {
        console.error('❌ TEST FLOW 5 FAILED:', err);
        process.exit(1);
    });
}
