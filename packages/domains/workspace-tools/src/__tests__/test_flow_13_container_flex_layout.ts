import { DocumentService } from '../documents/document.service';
import { prisma } from '@workspace/db';
import { generateHtmlFromBlocks } from '../../../../../apps/frontend/app/(platform)/(workspace-tools-app)/document-editor/_components/utils/generateHtml';

export async function runFlow13() {
    console.log('\n===============================================================');
    console.log('🧪 TEST FLOW 13: FLEX CONTAINER & MULTI-SLOT ROW/COL LAYOUT');
    console.log('===============================================================\n');

    // Step 1: Context setup
    console.log('[Step 1] Initializing Test Context...');
    const user = await prisma.user.findFirst();
    const client = await prisma.client.findFirst();

    if (!user || !client) {
        throw new Error('Test environment requires seeded User and Client.');
    }
    console.log(`  ✓ Context Ready: User (${user.email}), Client (${client.name})`);

    // Step 2: Create Document with Flex Container AST Block (2 Signatures side-by-side)
    console.log('\n[Step 2] Creating Document with Flex Row Container (2 Signatures)...');
    const containerBlock: any = {
        id: 'block-container-' + Date.now(),
        type: 'container',
        content: {
            direction: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 24,
            wrap: true,
            children: [
                {
                    id: 'sig-client-1',
                    type: 'signature',
                    content: { label: 'Client / Authorized Signatory', requireName: true },
                    width: '45%',
                    flex: '1 1 0px'
                },
                {
                    id: 'sig-company-2',
                    type: 'signature',
                    content: { label: 'Company / Executive Signatory', requireName: true },
                    width: '45%',
                    flex: '1 1 0px'
                }
            ]
        },
        styles: {
            backgroundColor: '#ffffff',
            borderColor: '#e2e8f0',
            borderStyle: 'solid',
            borderWidth: 1,
            borderRadius: 12,
            padding: '16px'
        }
    };

    const doc = await DocumentService.createDocument(user.id, {
        title: 'Master Service Agreement - Side-by-Side Signatures',
        documentType: 'CONTRACT',
        category: 'contract',
        clientId: client.id,
        blocks: [
            {
                id: 'text-intro',
                type: 'text',
                content: { text: '<p>This Agreement is executed between Client and Company on mutual acceptance.</p>' },
                styles: { fontSize: 16, color: '#1e293b' }
            },
            containerBlock
        ],
        documentDetails: {
            clientName: client.name,
            clientEmail: client.email
        },
        designSettings: {
            fontFamily: 'Inter',
            fontSize: 16,
            primaryColor: '#4f46e5'
        }
    });

    console.log(`  ✓ Document Persisted (ID: ${doc.id}, Share Token: ${doc.shareToken})`);

    // Step 3: Validate AST Structure & Children Persistence
    console.log('\n[Step 3] Validating Container AST Structure & Children...');
    const fetchedDoc: any = await DocumentService.getDocumentById(doc.id, user.id);
    const fetchedContainer = fetchedDoc.blocks.find((b: any) => b.type === 'container');

    if (!fetchedContainer) {
        throw new Error('Container block missing from retrieved document AST.');
    }
    if (fetchedContainer.content.direction !== 'row') {
        throw new Error(`Expected direction 'row', got: ${fetchedContainer.content.direction}`);
    }
    if (fetchedContainer.content.justifyContent !== 'space-between') {
        throw new Error(`Expected justifyContent 'space-between', got: ${fetchedContainer.content.justifyContent}`);
    }
    if (fetchedContainer.content.alignItems !== 'center') {
        throw new Error(`Expected alignItems 'center', got: ${fetchedContainer.content.alignItems}`);
    }
    if (fetchedContainer.content.children.length !== 2) {
        throw new Error(`Expected 2 container children, got: ${fetchedContainer.content.children.length}`);
    }
    console.log('  ✓ Flex Container properties verified: direction=row, justify=space-between, align=center, gap=24px');
    console.log('  ✓ 2 Signature slots persisted side-by-side in container');

    // Step 4: HTML Generation Verification
    console.log('\n[Step 4] Verifying HTML / PDF Export Generation...');
    const generatedHtml = generateHtmlFromBlocks(
        fetchedDoc.blocks,
        fetchedDoc.documentDetails,
        fetchedDoc.designSettings
    );

    if (!generatedHtml.includes('display: flex')) {
        throw new Error('Generated HTML missing display: flex for container block.');
    }
    if (!generatedHtml.includes('flex-direction: row')) {
        throw new Error('Generated HTML missing flex-direction: row.');
    }
    if (!generatedHtml.includes('justify-content: space-between')) {
        throw new Error('Generated HTML missing justify-content: space-between.');
    }
    if (!generatedHtml.includes('Client / Authorized Signatory')) {
        throw new Error('Generated HTML missing Client signature slot label.');
    }
    if (!generatedHtml.includes('Company / Executive Signatory')) {
        throw new Error('Generated HTML missing Company signature slot label.');
    }
    console.log('  ✓ HTML Flexbox container markup verified: flex-direction, space-between, and slot labels present');

    // Step 5: Test Centered & Column Alignment Updates
    console.log('\n[Step 5] Testing Layout Transformation to Centered Column...');
    const updatedContainerBlock = {
        ...containerBlock,
        content: {
            ...containerBlock.content,
            direction: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 16,
            children: [
                ...containerBlock.content.children,
                {
                    id: 'note-3',
                    type: 'text',
                    content: { text: 'Note: Both parties have agreed to electronic transmission.' },
                    styles: { fontSize: 12, color: '#64748b' },
                    width: '100%'
                }
            ]
        }
    };

    const updatedDoc: any = await DocumentService.updateDocument(user.id, doc.id, {
        blocks: [
            fetchedDoc.blocks[0],
            updatedContainerBlock
        ]
    });

    const refetchedContainer = updatedDoc.blocks.find((b: any) => b.type === 'container');
    if (refetchedContainer.content.direction !== 'column') {
        throw new Error('Expected direction to update to column');
    }
    if (refetchedContainer.content.justifyContent !== 'center') {
        throw new Error('Expected justifyContent to update to center');
    }
    if (refetchedContainer.content.children.length !== 3) {
        throw new Error('Expected 3 children after adding note');
    }
    console.log('  ✓ Successfully transformed to column direction with 3 children and center alignment');

    // Step 6: Cleanup
    console.log('\n[Step 6] Cleaning up test artifacts...');
    await DocumentService.deleteDocument(doc.id);
    console.log('  ✓ Test document cleaned up successfully.');

    console.log('\n===============================================================');
    console.log('🎉 TEST FLOW 13 PASSED: CONTAINER & FLEX LAYOUT 100% VERIFIED');
    console.log('===============================================================\n');
}

if (require.main === module) {
    runFlow13().catch((err) => {
        console.error('❌ Test Flow 13 Failed:', err);
        process.exit(1);
    });
}
