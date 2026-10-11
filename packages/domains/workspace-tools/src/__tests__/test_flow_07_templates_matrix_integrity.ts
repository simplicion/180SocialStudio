import { DOCUMENT_TEMPLATES } from 'c:/Users/saavi/OneDrive/Desktop/180workspace/apps/frontend/app/(platform)/(workspace-tools-app)/_components/templatesData';

export async function run() {
    console.log('\n======================================================');
    console.log('🧪 TEST FLOW 7: 20 Production Templates Matrix Integrity');
    console.log('======================================================');

    console.log(`1. Total Templates in Registry: ${DOCUMENT_TEMPLATES.length}`);
    if (DOCUMENT_TEMPLATES.length < 20) {
        throw new Error(`Expected at least 20 templates, found ${DOCUMENT_TEMPLATES.length}`);
    }

    const categoriesFound = new Set<string>();
    const idsFound = new Set<string>();

    for (const [index, t] of DOCUMENT_TEMPLATES.entries()) {
        // ID check
        if (!t.id) throw new Error(`Template at index ${index} is missing an id`);
        if (idsFound.has(t.id)) throw new Error(`Duplicate template id: ${t.id}`);
        idsFound.add(t.id);

        // Title and description
        if (!t.title || t.title.trim() === '') throw new Error(`Template ${t.id} is missing a title`);
        if (!t.description || t.description.trim() === '') throw new Error(`Template ${t.id} is missing a description`);

        // Category check
        if (!t.category) throw new Error(`Template ${t.id} is missing a category`);
        categoriesFound.add(t.category);

        // Block Structure Check
        if (t.id !== 't-blank') {
            if (!Array.isArray(t.blocks) || t.blocks.length === 0) {
                throw new Error(`Template ${t.id} has empty blocks array`);
            }
            for (const b of t.blocks) {
                if (!b.id || !b.type) {
                    throw new Error(`Template ${t.id} contains malformed block (missing id or type)`);
                }
            }
        }
    }

    console.log('✓ All', DOCUMENT_TEMPLATES.length, 'templates passed unique ID & AST structural checks.');
    console.log('✓ Categories represented:', Array.from(categoriesFound).join(', '));

    console.log('\n🎉 TEST FLOW 7 PASSED: 20 Production Templates Matrix Integrity fully verified.\n');
}

if (process.argv[1]?.includes('test_flow_07')) {
    run().catch(err => {
        console.error('❌ TEST FLOW 7 FAILED:', err);
        process.exit(1);
    });
}
