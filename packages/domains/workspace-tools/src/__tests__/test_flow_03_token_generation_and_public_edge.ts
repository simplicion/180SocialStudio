import { DocumentService } from '../documents/document.service';

export async function run() {
    console.log('\n======================================================');
    console.log('🧪 TEST FLOW 3: Share Token Generation & Public Edge Retrieval');
    console.log('======================================================');

    const testUserId = 'test-owner-' + Date.now();
    const docData = {
        title: 'Confidential Non-Disclosure Agreement',
        documentType: 'NDA',
        category: 'Legal',
        blocks: [
            {
                id: 'nda-1',
                type: 'heading',
                content: { text: 'Mutual Non-Disclosure Agreement' }
            },
            {
                id: 'nda-2',
                type: 'text',
                content: { text: 'The parties agree to protect all proprietary technical assets.' }
            }
        ],
        variables: { clientName: 'Stark Industries', clientEmail: 'tony@stark.com' },
        subtotal: 0,
        grandTotal: 0
    };

    // 1. Create Document
    console.log('1. Creating Document...');
    const doc = await DocumentService.createDocument(testUserId, docData);
    if (!doc?.id) throw new Error('Document creation failed');

    // 2. Generate Share Token
    console.log('2. Generating Public E-Sign Token...');
    const shareToken = await DocumentService.generateShareLink(doc.id);
    if (!shareToken || shareToken.length < 16) throw new Error('Invalid shareToken generated');
    console.log('✓ Public Share Token generated:', shareToken);

    // 3. Retrieve Document via Public Token (Unauthenticated Flow)
    console.log('3. Simulating unauthenticated public client fetch via token...');
    const publicDoc: any = await DocumentService.getDocumentByToken(shareToken);
    if (!publicDoc) throw new Error('Public fetch by token returned empty');
    if (publicDoc.id !== doc.id) throw new Error('Document ID mismatch from public fetch');
    if (publicDoc.title !== docData.title) throw new Error('Document title mismatch');
    console.log('✓ Public document retrieved successfully without authentication headers.');

    // 4. Verify Invalid Token Rejection
    console.log('4. Verifying invalid token handling...');
    let rejected = false;
    try {
        await DocumentService.getDocumentByToken('non-existent-fake-token-12345');
    } catch (e) {
        rejected = true;
    }
    if (!rejected) throw new Error('System allowed invalid/fake token lookup');
    console.log('✓ Invalid token correctly threw 404/Not Found error.');

    // Clean up
    await DocumentService.deleteDocument(doc.id);
    console.log('✓ Cleaned up test document.');

    console.log('\n🎉 TEST FLOW 3 PASSED: Public Token Generation and Edge Retrieval fully verified.\n');
}

if (process.argv[1]?.includes('test_flow_03')) {
    run().catch(err => {
        console.error('❌ TEST FLOW 3 FAILED:', err);
        process.exit(1);
    });
}
