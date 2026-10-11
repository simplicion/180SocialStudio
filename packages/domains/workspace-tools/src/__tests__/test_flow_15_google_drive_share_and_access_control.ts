import { DocumentService } from '../index';
import { prisma } from '@workspace/db';

export async function runTestFlow15() {
    console.log('\n===============================================================');
    console.log('🧪 TEST FLOW 15: GOOGLE DRIVE STYLE SHARING & ACCESS CONTROL');
    console.log('===============================================================\n');

    // Step 1: Prepare Tenant and User Context
    console.log('[Step 1] Initializing Test Platform Users and Clients...');
    const users = await prisma.user.findMany({ take: 3 });
    if (users.length === 0) throw new Error('No test users found');

    const primaryUser = users[0];
    const teamMember1 = users[1] || users[0];
    const teamMember2 = users[2] || users[0];

    const client = await prisma.client.findFirst();
    const clientEmail = client?.email || 'client@enterprise.com';

    console.log(`  ✓ Ready: Primary (${primaryUser.email}), Team (${teamMember1.email}, ${teamMember2.email}), Client (${clientEmail})`);

    // Step 2: Create Initial Document in Public Mode
    console.log('\n[Step 2] Creating Multi-Block AST Document in Public View Mode...');
    const doc = await DocumentService.createDocument(primaryUser.id, {
        title: 'Global Master Services Agreement (GMSA-2026)',
        name: 'Global Master Services Agreement (GMSA-2026)',
        documentType: 'CONTRACT',
        category: 'Contract',
        accessType: 'public',
        blocks: [
            {
                id: 'b-title',
                type: 'heading',
                content: { text: '<h1>Enterprise Platform Agreement</h1>' }
            },
            {
                id: 'b-pricing',
                type: 'pricing_table',
                content: {
                    currency: 'USD',
                    items: [
                        { id: '1', description: 'Platform License Tier 1', quantity: 1, rate: 50000, taxRate: 18, amount: 50000 }
                    ],
                    subtotal: 50000,
                    grandTotal: 59000
                }
            },
            {
                id: 'b-sig',
                type: 'signature',
                content: { label: 'Authorized Signatory', requireName: true }
            }
        ]
    });

    if (!doc?.id) throw new Error('Document creation failed');
    console.log(`  ✓ Document Created (ID: ${doc.id}, AccessType: ${doc.accessType})`);

    // Step 3: Test Unauthenticated Access in Public Mode
    console.log('\n[Step 3] Verifying Unauthenticated Access in Public Mode...');
    const publicToken = await DocumentService.generateShareLink(doc.id);
    const publicView = await DocumentService.getDocumentByToken(publicToken, undefined);
    if (!publicView || !publicView.accessGranted) {
        throw new Error('Public view should allow unauthenticated access');
    }
    console.log(`  ✓ Public Mode: Unauthenticated viewer granted access (accessGranted=true)`);

    // Step 4: Dispatch Google Drive Style Batch Share (BullMQ + Multi-Recipients)
    console.log('\n[Step 4] Executing Google Drive Style Multi-User & Email Batch Dispatch (BullMQ)...');
    const customEmail1 = 'external.partner@acmepartners.com';
    const customEmail2 = 'lead.counsel@legaladvisors.io';

    const dispatchResult = await DocumentService.dispatchDocumentShares(doc.id, primaryUser.id, {
        accessType: 'restricted',
        recipientUserIds: [teamMember1.id, teamMember2.id],
        customEmails: [customEmail1, customEmail2],
        message: 'Please review and execute the commercial agreement before Friday.'
    });

    if (!dispatchResult.success) {
        throw new Error('Dispatch document shares failed');
    }
    if (dispatchResult.accessType !== 'restricted') {
        throw new Error(`Expected accessType 'restricted', received ${dispatchResult.accessType}`);
    }
    console.log(`  ✓ Document switched to Restricted Access Mode`);
    console.log(`  ✓ Enqueued invitations for ${dispatchResult.totalRecipients} recipients via BullMQ`);
    console.log(`  ✓ Allowed User IDs: [${dispatchResult.allowedUserIds.join(', ')}]`);
    console.log(`  ✓ Allowed Emails: [${dispatchResult.allowedEmails.join(', ')}]`);

    // Step 5: Test Access Control Enforcement (Restricted Mode)
    console.log('\n[Step 5] Testing Access Control Enforcement in Restricted Mode...');

    // Scenario A: Unauthenticated request (Public viewer / Anonymous)
    const anonymousAttempt = await DocumentService.getDocumentByToken(publicToken, undefined);
    if (anonymousAttempt.accessGranted !== false) {
        throw new Error('Anonymous viewer should be blocked under Restricted mode');
    }
    console.log(`  ✓ Scenario A: Anonymous viewer blocked (accessGranted=false, reason="${anonymousAttempt.accessReason}")`);

    // Scenario B: Unauthorized user
    const unauthorizedAttempt = await DocumentService.getDocumentByToken(publicToken, {
        userId: 'random-unauthorized-id',
        email: 'intruder@unknown.com'
    });
    if (unauthorizedAttempt.accessGranted !== false) {
        throw new Error('Unauthorized user should be blocked');
    }
    console.log(`  ✓ Scenario B: Unauthorized user blocked (accessGranted=false, reason="${unauthorizedAttempt.accessReason}")`);

    // Scenario C: Authorized Platform Team Member
    const authorizedTeamMemberAttempt = await DocumentService.getDocumentByToken(publicToken, {
        userId: teamMember1.id,
        email: teamMember1.email
    });
    if (!authorizedTeamMemberAttempt.accessGranted) {
        throw new Error('Authorized team member should be granted access');
    }
    console.log(`  ✓ Scenario C: Authorized platform team member granted access (userId=${teamMember1.id})`);

    // Scenario D: Authorized Custom Email Recipient
    const authorizedCustomEmailAttempt = await DocumentService.getDocumentByToken(publicToken, {
        email: customEmail1
    });
    if (!authorizedCustomEmailAttempt.accessGranted) {
        throw new Error('Authorized custom email should be granted access');
    }
    console.log(`  ✓ Scenario D: Authorized custom email recipient granted access (email=${customEmail1})`);

    // Step 6: Test Dynamic Permission Toggle & Instant Revocation
    console.log('\n[Step 6] Testing Instant Permission Revocation (Restricted -> Public -> Restricted)...');
    
    // Toggle back to Public
    await DocumentService.updateDocument(primaryUser.id, doc.id, { accessType: 'public' });
    const toggledPublicAttempt = await DocumentService.getDocumentByToken(publicToken, undefined);
    if (!toggledPublicAttempt.accessGranted) {
        throw new Error('Should allow anonymous access after switching back to public');
    }
    console.log(`  ✓ Switched to Public: Anonymous access immediately restored`);

    // Toggle back to Restricted
    await DocumentService.updateDocument(primaryUser.id, doc.id, { accessType: 'restricted' });
    const toggledRestrictedAttempt = await DocumentService.getDocumentByToken(publicToken, undefined);
    if (toggledRestrictedAttempt.accessGranted !== false) {
        throw new Error('Should immediately block anonymous access after switching to restricted');
    }
    console.log(`  ✓ Switched to Restricted: Anonymous access immediately revoked & blocked`);

    // Step 7: Test E-Signature & Approval by Authorized Stakeholder
    console.log('\n[Step 7] Testing Electronic Signature & Decision Recording...');
    const signResult = await DocumentService.signDocumentByToken(publicToken, {
        clientName: 'Alex Mercer (Lead Counsel)',
        signatureData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    });
    if (!signResult.success) throw new Error('E-signature failed');
    console.log(`  ✓ E-Signature verified & recorded electronically`);

    const decisionResult = await DocumentService.recordDecisionByToken(publicToken, {
        action: 'approve',
        reviewerName: 'Alex Mercer',
        reviewerRole: 'Lead Counsel',
        note: 'Approved on behalf of external stakeholders.'
    });
    if (!decisionResult.success) throw new Error('Decision recording failed');
    console.log(`  ✓ Approval decision recorded with full audit trail`);

    // Step 8: Clean up test artifacts
    console.log('\n[Step 8] Cleaning up test artifacts...');
    await prisma.knowledgeArticle.delete({ where: { id: doc.id } });
    console.log('  ✓ Test document cleaned up successfully.');

    console.log('\n===============================================================');
    console.log('🎉 TEST FLOW 15 PASSED: GOOGLE DRIVE SHARING & ACCESS CONTROL 100%');
    console.log('===============================================================\n');
}

// Execute if run directly
if (require.main === module) {
    runTestFlow15()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('❌ Test Flow 15 Failed:', err);
            process.exit(1);
        });
}
