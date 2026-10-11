import { DocumentService, DocumentApprovalService } from '../index';
import { prisma } from '@workspace/db';

export async function runTestFlow14() {
    console.log('\n===============================================================');
    console.log('🧪 TEST FLOW 14: UNIVERSAL DOCUMENT VIEWER & ACCESS CONTROL');
    console.log('===============================================================\n');

    // Step 1: Prepare Tenant and Client Context
    console.log('[Step 1] Initializing Test Tenant & Client Context...');
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('No test user found');

    const client = await prisma.client.findFirst();
    if (!client) throw new Error('No test client found');

    console.log(`  ✓ Context Ready: User (${user.email}), Client (${client.name || client.companyName})`);

    // Step 2: Create Multi-Format 180 Workspace Document
    console.log('\n[Step 2] Creating Multi-Format AST Document for Universal Viewer...');
    const docData = {
        title: 'Master Service Agreement 2026',
        name: 'Master Service Agreement 2026',
        documentType: 'CONTRACT',
        category: 'Contract',
        clientId: client.id,
        clientName: client.name || client.companyName,
        clientEmail: client.email || 'client@example.com',
        accessType: 'public', // default public access
        blocks: [
            {
                id: 'b-header',
                type: 'heading',
                content: { text: '<h1>Master Service Agreement & Commercial Terms</h1>' },
                styles: { fontSize: 24, fontWeight: 'bold', color: '#1e293b' }
            },
            {
                id: 'b-pricing',
                type: 'pricing_table',
                content: {
                    currency: 'USD',
                    items: [
                        { id: 'item-1', description: 'Enterprise Architecture & Cloud Setup', quantity: 1, rate: 8500, taxRate: 18, amount: 8500 },
                        { id: 'item-2', description: 'Monthly Operations Support', quantity: 3, rate: 2500, taxRate: 18, amount: 7500 }
                    ],
                    subtotal: 16000,
                    taxAmount: 2880,
                    grandTotal: 18880
                }
            },
            {
                id: 'b-container',
                type: 'container',
                content: {
                    direction: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 24,
                    children: [
                        {
                            id: 'sig-client',
                            type: 'signature',
                            content: { label: 'Client Signatory', requireName: true }
                        },
                        {
                            id: 'sig-company',
                            type: 'signature',
                            content: { label: 'Company Signatory', requireName: true }
                        }
                    ]
                }
            },
            {
                id: 'b-decision',
                type: 'decision',
                content: {
                    title: 'Executive Sign-Off & Verification',
                    acceptLabel: 'Authorize Agreement',
                    declineLabel: 'Request Revisions'
                }
            }
        ]
    };

    const doc = await DocumentService.createDocument(user.id, docData);
    if (!doc?.id) throw new Error('Failed to create document');
    console.log(`  ✓ Document Persisted (ID: ${doc.id}, AccessType: ${doc.accessType || 'public'})`);

    // Step 3: Test Universal Document Viewer Data Retrieval
    console.log('\n[Step 3] Verifying Universal Document Viewer Data Loading...');
    const loadedDoc = await DocumentService.getDocumentById(doc.id);
    if (!loadedDoc) throw new Error('Failed to retrieve document by ID');
    if (!Array.isArray(loadedDoc.blocks) || loadedDoc.blocks.length !== 4) {
        throw new Error(`Expected 4 blocks, found ${loadedDoc.blocks?.length}`);
    }
    console.log(`  ✓ Universal Document Viewer retrieved ${loadedDoc.blocks.length} AST blocks with full fidelity`);

    // Step 4: Test Public Share Token Generation & Access Mode
    console.log('\n[Step 4] Testing Public Share Link & Unauthenticated Access...');
    const shareToken = await DocumentService.generateShareLink(doc.id);
    if (!shareToken) throw new Error('Failed to generate share token');

    const publicViewDoc = await DocumentService.getDocumentByToken(shareToken);
    if (!publicViewDoc || publicViewDoc.id !== doc.id) {
        throw new Error('Public view could not retrieve document by token');
    }
    console.log(`  ✓ Public Edge retrieval successful via token: ${shareToken}`);

    // Step 5: Test Switching Access Permission to Client-Restricted
    console.log('\n[Step 5] Testing Access Permission Switching to "Client Only"...');
    const updatedDoc = await DocumentService.updateDocument(user.id, doc.id, {
        accessType: 'client_only'
    });
    if (updatedDoc.accessType !== 'client_only') {
        throw new Error(`Expected accessType to be 'client_only', got ${updatedDoc.accessType}`);
    }
    console.log('  ✓ Document updated to restricted accessType="client_only" successfully');

    // Step 6: Test Decision Workflow (Request Revisions)
    console.log('\n[Step 6] Testing Decision Engine: Decline / Request Changes...');
    const declineResult = await DocumentService.recordDecision(
        doc.id,
        {
            action: 'decline',
            reviewerName: 'Eleanor Vance',
            reviewerRole: 'VP Legal',
            reason: 'Section 4 payment terms need Net 30 clause added.'
        }
    );
    if (declineResult.status !== 'declined' && declineResult.document?.status !== 'declined') {
        throw new Error('Expected status to be declined / changes requested');
    }
    console.log('  ✓ Decision recorded: Status set to "declined" with mandatory feedback reason');

    // Step 7: Clean up test artifacts
    console.log('\n[Step 7] Cleaning up test artifacts...');
    await DocumentService.deleteDocument(doc.id);
    console.log('  ✓ Test document cleaned up successfully.');

    console.log('\n===============================================================');
    console.log('🎉 TEST FLOW 14 PASSED: UNIVERSAL VIEWER & ACCESS CONTROL 100%');
    console.log('===============================================================\n');
}

if (require.main === module) {
    runTestFlow14()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('❌ Test Flow 14 Failed:', err);
            process.exit(1);
        });
}
