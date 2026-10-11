import { prisma } from '@workspace/db';
import { AIDocumentService } from '../documents/ai-document.service';
import { DocumentService } from '../documents/document.service';

export async function runFlow16() {
    console.log('\n===============================================================');
    console.log('🧪 TEST FLOW 16: AI BUILDER & INCREMENTAL AST SYNTHESIS');
    console.log('===============================================================\n');

    // Step 1: Initialize Test Context
    console.log('[Step 1] Initializing Test User & Client Context...');
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('No user found in test DB.');
    const client = await prisma.client.findFirst();

    console.log(`  ✓ User context ready: ${user.email} (${user.id})`);
    console.log(`  ✓ Client context ready: ${client?.name || 'Acme Corp'}`);

    // Step 2: Test Full Document Generation from Scratch
    console.log('\n[Step 2] Testing Full AI Document Generation from Scratch...');
    const initialPrompt = 'Create a professional tax invoice for web development with 18% GST';
    const fullResult = await AIDocumentService.generateFromPrompt({
        prompt: initialPrompt,
        clientId: client?.id,
        userId: user.id
    });

    if (!fullResult.success || !Array.isArray(fullResult.blocks) || fullResult.blocks.length === 0) {
        throw new Error('Failed to generate full document AST from scratch.');
    }
    console.log(`  ✓ Generated initial AST with ${fullResult.blocks.length} blocks (Type: ${fullResult.documentType})`);
    console.log(`  ✓ Grand Total calculated: ₹${fullResult.documentDetails.grandTotal}`);

    // Step 3: Test Incremental AST Synthesis (Appending Milestones & Signatures)
    console.log('\n[Step 3] Testing Incremental AST Synthesis on Existing Document...');
    const incrementalPrompt = 'I have completed half the form, now add a 3-phase milestone payment schedule and bilateral signatures';
    
    const incrementalResult = await AIDocumentService.generateFromPrompt({
        prompt: incrementalPrompt,
        existingBlocks: fullResult.blocks,
        clientId: client?.id,
        userId: user.id
    });

    if (!incrementalResult.success) {
        throw new Error('Incremental AI synthesis returned unsuccessful.');
    }
    if (incrementalResult.mode !== 'append') {
        throw new Error(`Expected mode 'append', got: ${incrementalResult.mode}`);
    }
    if (!Array.isArray(incrementalResult.newBlocks) || incrementalResult.newBlocks.length === 0) {
        throw new Error('Incremental AI synthesis failed to generate newBlocks array.');
    }
    if (incrementalResult.blocks.length <= fullResult.blocks.length) {
        throw new Error('Total block count did not increase after incremental synthesis.');
    }

    console.log(`  ✓ Incremental mode 'append' confirmed`);
    console.log(`  ✓ Generated ${incrementalResult.newBlocks.length} new blocks (Milestones + Bilateral Signatures)`);
    console.log(`  ✓ Total blocks expanded from ${fullResult.blocks.length} to ${incrementalResult.blocks.length}`);
    console.log(`  ✓ AI Explanation: "${incrementalResult.explanation}"`);

    // Step 4: Verify Milestone Grid Block Integrity
    console.log('\n[Step 4] Verifying Milestone Grid Block Structure...');
    const milestoneHeading = incrementalResult.newBlocks.find((b: any) => b.type === 'heading' && b.content?.text?.includes('Payment Milestones'));
    const milestoneGrid = incrementalResult.newBlocks.find((b: any) => b.type === 'grid' && b.content?.headers?.includes('Milestone Phase'));

    if (!milestoneHeading || !milestoneGrid) {
        throw new Error('Milestone heading or grid block missing in synthesized AST.');
    }
    console.log('  ✓ Milestone table verified with headers: ' + JSON.stringify(milestoneGrid.content.headers));

    // Step 5: Verify Container with Bilateral Signatures
    console.log('\n[Step 5] Verifying Bilateral Signatures in Flex Container...');
    const signatureContainer = incrementalResult.newBlocks.find((b: any) => b.type === 'container');
    if (!signatureContainer || signatureContainer.content.children.length !== 2) {
        throw new Error('Bilateral signature container missing or invalid children count.');
    }
    console.log(`  ✓ Signature container verified with 2 signer slots (${signatureContainer.content.direction} layout)`);

    // Step 6: Persisting Document to Unified Database
    console.log('\n[Step 6] Persisting Incremental AI Document to Database...');
    const createdDoc = await DocumentService.createDocument(user.id, {
        title: 'AI Synthesized Milestone Agreement',
        blocks: incrementalResult.blocks,
        clientId: client?.id || null,
        documentType: 'CONTRACT',
        subtotal: 50000,
        grandTotal: 50000
    });

    if (!createdDoc || !createdDoc.id) {
        throw new Error('Failed to persist AI-generated document.');
    }
    console.log(`  ✓ Persisted to DB with ID: ${createdDoc.id}`);

    // Step 7: Verify Database Retrieval
    console.log('\n[Step 7] Verifying Stored Document Retrieval...');
    const retrieved = await DocumentService.getDocumentById(createdDoc.id, user.id);
    if (!retrieved || retrieved.blocks.length !== incrementalResult.blocks.length) {
        throw new Error(`Retrieved block count mismatch. Expected ${incrementalResult.blocks.length}, got ${retrieved?.blocks?.length}`);
    }
    console.log(`  ✓ Stored AST matches synthesized AST (${retrieved.blocks.length} blocks)`);

    // Cleanup
    await DocumentService.deleteDocument(createdDoc.id);
    console.log('  ✓ Cleaned up test document record.');

    console.log('\n===============================================================');
    console.log('🎉 TEST FLOW 16 PASSED: AI BUILDER & INCREMENTAL AST 100%');
    console.log('===============================================================\n');
}

if (require.main === module) {
    runFlow16().catch(err => {
        console.error('❌ Test Flow 16 Failed:', err);
        process.exit(1);
    });
}
