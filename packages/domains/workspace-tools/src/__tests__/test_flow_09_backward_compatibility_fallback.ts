import { prisma } from '@workspace/db';
import { DocumentService } from '../documents/document.service';
import { DocumentApprovalService } from '../documents/document-approval.service';

export async function run() {
    console.log('\n======================================================');
    console.log('🧪 TEST FLOW 9: Backward Compatibility & Legacy Fallbacks');
    console.log('======================================================');

    let firstUser = await prisma.user.findFirst({ select: { id: true } });
    let firstCompany = await prisma.company.findFirst({ select: { id: true } });

    // 1. Create a Legacy Knowledge Article simulating an old contract document
    console.log('1. Creating legacy KnowledgeArticle record with serialized JSON blocks...');
    const legacyArticle = await prisma.knowledgeArticle.create({
        data: {
            title: 'Legacy Marketing Contract (2024)',
            category: 'Contract',
            tags: ['legacy', 'contract'],
            content: JSON.stringify({
                status: 'Draft',
                clientName: 'Acme Legacy Corp',
                blocks: [{ id: '1', type: 'heading', content: { text: 'Old Contract' } }]
            }),
            createdBy: { connect: { id: firstUser!.id } },
            company: { connect: { id: firstCompany!.id } }
        }
    });

    console.log('✓ Created Legacy Article ID:', legacyArticle.id);

    // 2. Fetch via getDocumentById (should transparently find it)
    console.log('2. Fetching via unified DocumentService.getDocumentById()...');
    const fetchedLegacy: any = await DocumentService.getDocumentById(legacyArticle.id);
    if (!fetchedLegacy || fetchedLegacy.title !== legacyArticle.title) {
        throw new Error('Fallback lookup for legacy article failed');
    }
    console.log('✓ Legacy document transparently resolved by DocumentService');

    // 3. Generate Share Link on Legacy Document
    console.log('3. Generating public share link for legacy document...');
    const shareToken = await DocumentService.generateShareLink(legacyArticle.id);
    if (!shareToken) throw new Error('Legacy share token generation failed');
    console.log('✓ Legacy share token generated:', shareToken);

    // 4. Approve Legacy Document
    console.log('4. Approving legacy document...');
    const approveRes = await DocumentApprovalService.approveDocument(legacyArticle.id, firstUser!.id);
    if (!approveRes.success) throw new Error('Legacy document approval failed');
    console.log('✓ Legacy document approved successfully');

    // Clean up
    await prisma.knowledgeArticle.delete({ where: { id: legacyArticle.id } });
    console.log('✓ Cleaned up legacy test record.');

    console.log('\n🎉 TEST FLOW 9 PASSED: Backward Compatibility & Legacy Fallbacks fully verified.\n');
}

if (process.argv[1]?.includes('test_flow_09')) {
    run().catch(err => {
        console.error('❌ TEST FLOW 9 FAILED:', err);
        process.exit(1);
    });
}
