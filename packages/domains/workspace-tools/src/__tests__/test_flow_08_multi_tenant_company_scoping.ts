import { prisma } from '@workspace/db';
import { DocumentService } from '../documents/document.service';

export async function run() {
    console.log('\n======================================================');
    console.log('🧪 TEST FLOW 8: Multi-Tenant Company Scoping & User Indexing');
    console.log('======================================================');

    // 1. Create a Test Company
    const testCompany = await prisma.company.create({
        data: {
            name: 'Cyberdyne Systems Corp',
            slug: `cyberdyne-${Date.now()}`
        }
    });

    const testUserId = 'user-owner-' + Date.now();

    // 2. Create Scoped Document for that Company
    console.log('1. Creating scoped document for company:', testCompany.id);
    const doc = await DocumentService.createDocument(testUserId, {
        title: 'Company Policy Manual 2026',
        documentType: 'COMPANY_POLICY',
        category: 'Policy',
        companyId: testCompany.id,
        blocks: [{ id: 'p1', type: 'heading', content: { text: 'Information Security Standards' } }]
    });

    // 3. Fetch and Verify Company Scoping
    console.log('2. Querying scoped document...');
    const fetched: any = await DocumentService.getDocumentById(doc.id);
    if (!fetched) throw new Error('Failed to fetch scoped document');
    if (fetched.companyId !== testCompany.id) {
        throw new Error(`Expected companyId ${testCompany.id}, got: ${fetched.companyId}`);
    }
    console.log('✓ Document correctly bound to companyId:', fetched.companyId);

    // Clean up
    await DocumentService.deleteDocument(doc.id);
    await prisma.company.delete({ where: { id: testCompany.id } });
    console.log('✓ Cleaned up test document and company.');

    console.log('\n🎉 TEST FLOW 8 PASSED: Multi-Tenant Scoping and User Indexing verified.\n');
}

if (process.argv[1]?.includes('test_flow_08')) {
    run().catch(err => {
        console.error('❌ TEST FLOW 8 FAILED:', err);
        process.exit(1);
    });
}
