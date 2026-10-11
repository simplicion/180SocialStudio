import { DocumentService } from '../documents/document.service';
import { generateHtmlFromBlocks } from '../../../../../apps/frontend/app/(platform)/(workspace-tools-app)/document-editor/_components/utils/generateHtml';

export async function run() {
    console.log('\n======================================================');
    console.log('🧪 TEST FLOW 18: Signature Element Display, Resizing & Universal Signing AST');
    console.log('======================================================');

    const testUserId = 'test-sig-user-' + Date.now();

    // Step 1: Create Document with Compact Signature Block
    console.log('1. Creating document with compact signature block...');
    const docData = {
        title: 'Executive Master Service Agreement',
        documentType: 'CONTRACT',
        category: 'Contract',
        blocks: [
            {
                id: 'head-1',
                type: 'heading',
                content: { text: 'Executive Agreement & Signatures', level: 'h1' }
            },
            {
                id: 'sig-1',
                type: 'signature',
                content: {
                    label: 'Chief Executive Officer',
                    requireName: true,
                    signatoryName: '',
                    width: '280px',
                    alignment: 'left'
                },
                styles: { width: '280px' }
            },
            {
                id: 'sig-2',
                type: 'signature',
                content: {
                    label: 'Authorized Client Signatory',
                    requireName: true,
                    signatoryName: '',
                    width: '50%',
                    alignment: 'right'
                },
                styles: { width: '50%' }
            }
        ],
        variables: { clientName: 'Global Enterprises Inc' }
    };

    const doc = await DocumentService.createDocument(testUserId, docData);
    console.log('✓ Document created with ID:', doc.id);
    if (!doc.blocks || doc.blocks.length !== 3) {
        throw new Error(`Expected 3 blocks, found: ${doc.blocks?.length}`);
    }

    // Step 2: Test In-Editor Pre-Signing with Universal Signature Capture
    console.log('2. Simulating in-editor signature adoption (Universal Modal save)...');
    const mockSigDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAABkCAYAAACwJzU6AAAA...';
    const nowIso = new Date().toISOString();

    const updatedBlocks = doc.blocks.map((b: any) => {
        if (b.id === 'sig-1') {
            return {
                ...b,
                content: {
                    ...b.content,
                    signatureImage: mockSigDataUrl,
                    signatoryName: 'Jane Smith, CEO',
                    signedAt: nowIso
                }
            };
        }
        return b;
    });

    const updatedDoc = await DocumentService.updateDocument(testUserId, doc.id, {
        blocks: updatedBlocks
    });

    const savedSigBlock = updatedDoc.blocks.find((b: any) => b.id === 'sig-1');
    if (!savedSigBlock?.content?.signatureImage) {
        throw new Error('Pre-signature image was not saved into signature block content');
    }
    if (savedSigBlock.content.signatoryName !== 'Jane Smith, CEO') {
        throw new Error('Signer name was not saved correctly');
    }
    console.log('✓ Signature image and metadata successfully saved on block:', savedSigBlock.content.signatoryName);

    // Step 3: Test Resizing & Alignment Properties Modification
    console.log('3. Testing signature slot width and alignment resizing...');
    const resizedBlocks = updatedDoc.blocks.map((b: any) => {
        if (b.id === 'sig-1') {
            return {
                ...b,
                content: {
                    ...b.content,
                    width: '360px',
                    alignment: 'center',
                    label: 'Managing Director & CEO'
                }
            };
        }
        return b;
    });

    const docWithResizedSig = await DocumentService.updateDocument(testUserId, doc.id, {
        blocks: resizedBlocks
    });
    const resizedBlock = docWithResizedSig.blocks.find((b: any) => b.id === 'sig-1');
    if (resizedBlock.content.width !== '360px' || resizedBlock.content.alignment !== 'center') {
        throw new Error('Failed to update signature width/alignment properties');
    }
    console.log('✓ Signature width updated to 360px and alignment set to center');

    // Step 4: Validate HTML & PDF Export Engine
    console.log('4. Verifying HTML/PDF rendering for signature block...');
    const exportedHtml = generateHtmlFromBlocks(docWithResizedSig.blocks, {
        primaryColor: '#4f46e5',
        fontFamily: 'Inter, sans-serif'
    });


    if (!exportedHtml.includes('Managing Director & CEO')) {
        throw new Error('Exported HTML does not contain updated signature label');
    }
    if (!exportedHtml.includes(mockSigDataUrl)) {
        throw new Error('Exported HTML does not contain signature image');
    }
    if (!exportedHtml.includes('Jane Smith, CEO')) {
        throw new Error('Exported HTML does not contain printed signer name');
    }
    console.log('✓ HTML/PDF export engine correctly renders signature image, label, and legal name line');

    // Step 5: Clean Up
    console.log('5. Cleaning up test document...');
    await DocumentService.deleteDocument(testUserId, doc.id);
    console.log('✓ Test document cleaned up.');

    console.log('\n🎉 TEST FLOW 18 PASSED: Signature block display, modal integration, and AST export fully verified.\n');
}

if (process.argv[1]?.includes('test_flow_18')) {
    run().catch(err => {
        console.error('❌ TEST FLOW 18 FAILED:', err);
        process.exit(1);
    });
}
