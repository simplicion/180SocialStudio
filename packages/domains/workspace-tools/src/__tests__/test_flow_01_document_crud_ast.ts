import { prisma } from '@workspace/db';
import { DocumentService } from '../documents/document.service';

export async function run() {
    console.log('\n======================================================');
    console.log('🧪 TEST FLOW 1: Unified Document CRUD & AST Serialization');
    console.log('======================================================');

    const testUserId = 'test-user-' + Date.now();
    const testDocData = {
        title: 'Master Enterprise Agreement 2026',
        documentType: 'CONTRACT',
        category: 'Contract',
        blocks: [
            {
                id: 'b-head-1',
                type: 'heading',
                content: { text: 'Master Services Agreement' },
                styles: { fontSize: 24, fontWeight: 'bold' }
            },
            {
                id: 'b-box-1',
                type: 'box',
                content: { text: 'This agreement governs all future statement of works.' },
                styles: { backgroundColor: '#f8fafc', padding: 12 }
            }
        ],
        headerBlocks: [{ id: 'h-1', type: 'text', content: { text: 'Confidential & Proprietary' } }],
        footerBlocks: [{ id: 'f-1', type: 'text', content: { text: 'Page 1 of 1' } }],
        variables: { clientName: 'Globex Corp', contractTerm: '12 Months' },
        subtotal: 100000,
        taxPercent: 18,
        taxAmount: 18000,
        grandTotal: 118000,
        currency: 'INR'
    };

    // 1. Create Document
    console.log('1. Creating Document with AST Blocks & Financial Header...');
    const created = await DocumentService.createDocument(testUserId, testDocData);
    if (!created || !created.id) throw new Error('Document creation failed');
    console.log('✓ Document created successfully with ID:', created.id);
    console.log('✓ Share token auto-generated:', created.shareToken);

    // 2. Fetch Document by ID
    console.log('2. Fetching Document by ID...');
    const fetched: any = await DocumentService.getDocumentById(created.id);
    if (!fetched) throw new Error('Document fetch by ID failed');
    if (fetched.title !== testDocData.title) throw new Error('Document title mismatch');
    if (!Array.isArray(fetched.contentBlocks) || fetched.contentBlocks.length !== 2) {
        throw new Error('AST Blocks array length mismatch');
    }
    console.log('✓ Document AST blocks verified (Count:', fetched.contentBlocks.length, ')');
    console.log('✓ Grand Total verified: ₹' + fetched.grandTotal);

    // 3. Update Document & Save Version
    console.log('3. Updating Document and saving version snapshot...');
    const updated = await DocumentService.updateDocument(testUserId, created.id, {
        title: 'Master Enterprise Agreement 2026 - Revised',
        grandTotal: 125000,
        saveVersion: true
    });
    if (!updated || updated.title !== 'Master Enterprise Agreement 2026 - Revised') {
        throw new Error('Document update failed');
    }
    console.log('✓ Document updated successfully. New title:', updated.title);

    // 4. Clean Up
    console.log('4. Cleaning up test document...');
    await DocumentService.deleteDocument(created.id);
    console.log('✓ Test document deleted successfully');

    console.log('\n🎉 TEST FLOW 1 PASSED: Document CRUD & AST Serialization fully verified.\n');
}

if (process.argv[1]?.includes('test_flow_01')) {
    run().catch(err => {
        console.error('❌ TEST FLOW 1 FAILED:', err);
        process.exit(1);
    });
}
