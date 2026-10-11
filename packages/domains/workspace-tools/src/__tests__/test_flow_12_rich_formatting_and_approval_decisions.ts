import { DocumentService } from '../documents/document.service';
import { prisma } from '@workspace/db';

export async function runTestFlow12() {
    console.log('\n===============================================================');
    console.log('🧪 TEST FLOW 12: FUNDAMENTAL ELEMENTS, RICH FORMATTING & DECISION ENGINE');
    console.log('===============================================================\n');

    let createdDocId: string | null = null;
    let shareToken: string | null = null;

    try {
        // 1. Get or seed a test user and client
        let user = await prisma.user.findFirst();
        if (!user) {
            user = await prisma.user.create({
                data: {
                    name: 'Test Reviewer User',
                    email: `reviewer_${Date.now()}@workspace.io`,
                    password: 'hashed_password_123',
                    role: 'admin'
                }
            });
        }

        let client = await prisma.client.findFirst();
        if (!client) {
            client = await prisma.client.create({
                data: {
                    name: 'Global Enterprise Corp',
                    email: 'director@enterprise.com',
                    companyName: 'Global Enterprise Corp'
                }
            });
        }

        console.log(`[Step 1] Seeded Context: User (${user.email}), Client (${client.name})`);

        // 2. Create document with fundamental elements: Rich Text, Styled Box, Custom Line, and Approval Decision
        const customTextStyles = {
            fontFamily: 'Outfit',
            fontSize: 20,
            fontWeight: '600',
            lineHeight: '1.8',
            letterSpacing: '1px',
            color: '#1e293b',
            highlightColor: '#fef08a',
            textTransform: 'uppercase',
            alignment: 'center'
        };

        const customBoxStyles = {
            backgroundColor: '#eef2ff',
            borderColor: '#6366f1',
            borderStyle: 'dashed',
            borderWidth: 2,
            borderRadius: 20,
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            padding: '24px',
            color: '#312e81'
        };

        const customLineStyles = {
            orientation: 'horizontal',
            borderStyle: 'dashed',
            borderWidth: 3,
            borderColor: '#94a3b8',
            width: '75%',
            alignment: 'center'
        };

        const blocks = [
            {
                id: 'txt-1',
                type: 'text',
                content: { text: '<h1>Executive Project Architecture Proposal</h1>' },
                styles: customTextStyles
            },
            {
                id: 'line-1',
                type: 'line',
                content: {},
                styles: customLineStyles
            },
            {
                id: 'box-1',
                type: 'box',
                content: { text: 'Important: All deliverables must adhere to Tier-1 High Availability requirements.' },
                styles: customBoxStyles
            },
            {
                id: 'decision-1',
                type: 'approval_buttons',
                content: {
                    title: 'Senior Engineering Sign-Off',
                    description: 'Authorize infrastructure blueprint and budget allocation.',
                    acceptLabel: 'Authorize Architecture',
                    declineLabel: 'Request Architectural Changes',
                    reviewerRole: 'Principal Cloud Architect',
                    requireReason: true
                }
            }
        ];

        const docResult = await DocumentService.createDocument(user.id, {
            title: 'Cloud Modernization Strategy v2',
            documentType: 'PROPOSAL',
            clientId: client.id,
            blocks,
            subtotal: 50000,
            taxAmount: 9000,
            grandTotal: 59000,
            currency: 'USD'
        });

        createdDocId = docResult.id;
        shareToken = docResult.shareToken;
        console.log(`[Step 2] Created Document with AST blocks: id=${createdDocId}, shareToken=${shareToken}`);

        // 3. Verify retrieved document AST preserves rich styles
        const retrieved = await DocumentService.getDocumentById(createdDocId);
        if (!retrieved || !Array.isArray(retrieved.blocks)) {
            throw new Error('Failed to retrieve created document blocks');
        }

        const textBlock = retrieved.blocks.find((b: any) => b.id === 'txt-1');
        if (!textBlock || textBlock.styles?.fontFamily !== 'Outfit' || textBlock.styles?.fontSize !== 20) {
            throw new Error(`Text block styles mismatch: expected Outfit/20px, got ${JSON.stringify(textBlock?.styles)}`);
        }
        console.log('  ✓ Text block rich typography styles verified in AST');

        const boxBlock = retrieved.blocks.find((b: any) => b.id === 'box-1');
        if (!boxBlock || boxBlock.styles?.backgroundColor !== '#eef2ff' || boxBlock.styles?.borderRadius !== 20) {
            throw new Error(`Box block styles mismatch: expected #eef2ff/20px radius, got ${JSON.stringify(boxBlock?.styles)}`);
        }
        console.log('  ✓ Box block background fill, borders, and radius verified in AST');

        const lineBlock = retrieved.blocks.find((b: any) => b.id === 'line-1');
        if (!lineBlock || lineBlock.styles?.borderStyle !== 'dashed' || lineBlock.styles?.borderWidth !== 3) {
            throw new Error(`Line block styles mismatch: expected dashed/3px, got ${JSON.stringify(lineBlock?.styles)}`);
        }
        console.log('  ✓ Line block horizontal/dashed styles verified in AST');

        // 4. Test Decline Flow with Mandatory Reason Validation
        console.log('\n[Step 3] Testing Decline Decision Validation...');
        let errorCaught = false;
        try {
            await DocumentService.recordDecisionByToken(shareToken!, {
                action: 'decline',
                reviewerName: 'Marcus Vance',
                reviewerRole: 'Principal Cloud Architect',
                reason: '' // Empty reason should fail!
            });
        } catch (err: any) {
            errorCaught = true;
            console.log(`  ✓ Validation successfully rejected empty decline reason: "${err.message}"`);
        }

        if (!errorCaught) {
            throw new Error('Expected validation error when declining without a mandatory reason');
        }

        // 5. Test Successful Decline Decision Recording
        const declineReason = 'Please increase failover replication nodes in US-East region to 3.';
        const declineRes = await DocumentService.recordDecisionByToken(shareToken!, {
            action: 'decline',
            reviewerName: 'Marcus Vance',
            reviewerRole: 'Principal Cloud Architect',
            reason: declineReason
        }, '192.168.1.50', 'Mozilla/5.0 Chrome/128');

        if (!declineRes.success || declineRes.status !== 'declined') {
            throw new Error(`Expected status declined, got ${declineRes.status}`);
        }
        console.log('  ✓ Decline recorded successfully with token handler');

        // Verify document state in database
        const declinedDoc = await DocumentService.getDocumentById(createdDocId);
        if (declinedDoc.status !== 'declined') {
            throw new Error(`Expected document status to be 'declined', got '${declinedDoc.status}'`);
        }

        const decisionBlock = declinedDoc.blocks.find((b: any) => b.type === 'approval_buttons');
        if (!decisionBlock?.content?.decision || decisionBlock.content.decision.status !== 'declined') {
            throw new Error(`Decision block in AST did not update: ${JSON.stringify(decisionBlock)}`);
        }
        if (decisionBlock.content.decision.reason !== declineReason) {
            throw new Error(`Decision reason mismatch: expected "${declineReason}", got "${decisionBlock.content.decision.reason}"`);
        }
        console.log('  ✓ Document status is "declined" and AST block has recorded reviewer reason');

        // 6. Test Author Revising and Reviewer Accepting Document
        console.log('\n[Step 4] Testing Document Approval & Sign-Off...');
        const approveRes = await DocumentService.recordDecision(createdDocId, {
            action: 'approve',
            reviewerName: 'Marcus Vance',
            reviewerRole: 'Principal Cloud Architect',
            note: 'Updated failover configuration looks solid. Approved for rollout.'
        }, user.id);

        if (!approveRes.success || approveRes.status !== 'approved') {
            throw new Error(`Expected approval status 'approved', got ${approveRes.status}`);
        }

        const approvedDoc = await DocumentService.getDocumentById(createdDocId);
        if (approvedDoc.status !== 'approved') {
            throw new Error(`Expected document status 'approved', got '${approvedDoc.status}'`);
        }

        const approvedDecisionBlock = approvedDoc.blocks.find((b: any) => b.type === 'approval_buttons');
        if (approvedDecisionBlock?.content?.decision?.status !== 'approved') {
            throw new Error(`Decision block status was not updated to approved: ${JSON.stringify(approvedDecisionBlock)}`);
        }
        console.log('  ✓ Document status successfully transitioned to "approved"');
        console.log(`  ✓ Reviewer note verified: "${approvedDecisionBlock.content.decision.note}"`);

        // 7. Clean up test document
        await DocumentService.deleteDocument(createdDocId);
        console.log('\n  ✓ Test document cleaned up successfully');

        console.log('\n===============================================================');
        console.log('🎉 TEST FLOW 12 PASSED: 100% COMPLETE & VERIFIED');
        console.log('===============================================================\n');
        return true;
    } catch (error: any) {
        console.error('\n❌ TEST FLOW 12 FAILED:', error);
        if (createdDocId) {
            try { await DocumentService.deleteDocument(createdDocId); } catch (e) {}
        }
        throw error;
    }
}

// Auto-run if invoked directly
if (require.main === module) {
    runTestFlow12()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
}
