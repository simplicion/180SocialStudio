import { DocumentService } from '../documents/document.service';

export async function run() {
    console.log('\n======================================================');
    console.log('🧪 TEST FLOW 4: Digital Signature Submission & Verification');
    console.log('======================================================');

    const testUserId = 'test-creator-' + Date.now();
    const docData = {
        title: 'Software Development Retainer Agreement',
        documentType: 'CONTRACT',
        category: 'Contract',
        blocks: [
            { id: '1', type: 'heading', content: { text: 'Terms & Conditions' } },
            { id: '2', type: 'signature', content: { signerRole: 'Client Acceptance' } }
        ],
        variables: { clientName: 'Wayne Enterprises' },
        subtotal: 50000,
        grandTotal: 50000
    };

    // 1. Create Document & Generate Token
    console.log('1. Creating Document and generating token...');
    const doc = await DocumentService.createDocument(testUserId, docData);
    const token = await DocumentService.generateShareLink(doc.id);
    console.log('✓ Initial Status:', doc.status);

    // 2. Client Signs via Public Portal
    console.log('2. Simulating Client Digital Signature submission...');
    const mockSignatureData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAAAYCAYAAAA9y0daAAAA...';
    const mockIp = '203.0.113.42';
    const mockUserAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

    const signResult = await DocumentService.signDocumentByToken(
        token,
        {
            clientName: 'Bruce Wayne',
            signatureData: mockSignatureData
        },
        mockIp,
        mockUserAgent
    );

    if (!signResult.success) throw new Error('Signature submission failed');
    console.log('✓ Signature submission response:', signResult.message);

    // 3. Verify Document State Post-Signature
    console.log('3. Verifying updated document status & signature audit fields...');
    const updatedDoc: any = await DocumentService.getDocumentById(doc.id);
    if (updatedDoc.status !== 'signed') {
        throw new Error(`Expected status to be 'signed', but got: ${updatedDoc.status}`);
    }
    if (!updatedDoc.signatureData || updatedDoc.signatureData.signedBy !== 'Bruce Wayne') {
        throw new Error('Signature audit metadata mismatch');
    }
    if (updatedDoc.signerIp !== mockIp) {
        throw new Error('Signer IP address mismatch');
    }
    if (!updatedDoc.signedAt) {
        throw new Error('Signed timestamp missing');
    }

    console.log('✓ Status successfully transitioned to "signed"');
    console.log('✓ Captured Signer Name:', updatedDoc.signatureData.signedBy);
    console.log('✓ Captured Signer IP:', updatedDoc.signerIp);
    console.log('✓ Signed At Timestamp:', updatedDoc.signedAt);

    // Clean up
    await DocumentService.deleteDocument(doc.id);
    console.log('✓ Cleaned up test document.');

    console.log('\n🎉 TEST FLOW 4 PASSED: Client Digital Signature & Audit trail fully verified.\n');
}

if (process.argv[1]?.includes('test_flow_04')) {
    run().catch(err => {
        console.error('❌ TEST FLOW 4 FAILED:', err);
        process.exit(1);
    });
}
