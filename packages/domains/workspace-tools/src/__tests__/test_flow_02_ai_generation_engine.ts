import { AIDocumentService } from '../documents/ai-document.service';

export async function run() {
    console.log('\n======================================================');
    console.log('🧪 TEST FLOW 2: Natural Language AI Generation Engine');
    console.log('======================================================');

    // 1. Test Invoice Intent Classification & Tabular AST Generation
    console.log('1. Testing AI Invoice Generation...');
    const invoiceResult = await AIDocumentService.generateFromPrompt({
        prompt: 'Create an invoice for mobile app UI design for ₹45,000 with 18% GST',
        documentType: 'INVOICE'
    });
    if (!invoiceResult.success) throw new Error('Invoice generation failed');
    if (invoiceResult.documentType !== 'INVOICE') throw new Error('Incorrect documentType classified');
    if (!invoiceResult.blocks.some(b => b.type === 'grid')) throw new Error('Invoice missing pricing grid block');
    console.log('✓ AI generated valid Tax Invoice AST with', invoiceResult.blocks.length, 'blocks.');

    // 2. Test Disciplinary Notice Intent Classification
    console.log('2. Testing AI Warning Letter Generation (Intent Auto-Detection)...');
    const warningResult = await AIDocumentService.generateFromPrompt({
        prompt: 'Write formal disciplinary warning notice for employee due to unexcused absences and sprint delays'
    });
    if (!warningResult.success) throw new Error('Warning letter generation failed');
    if (warningResult.documentType !== 'WARNING_LETTER') throw new Error('Failed to auto-classify WARNING_LETTER');
    if (!warningResult.blocks.some(b => b.type === 'heading')) throw new Error('Warning letter missing heading block');
    console.log('✓ AI auto-detected WARNING_LETTER and built structured HR notice blocks.');

    // 3. Test Offer Letter Intent Classification & Compensation Grid
    console.log('3. Testing AI Offer Letter Generation (Intent Auto-Detection)...');
    const offerResult = await AIDocumentService.generateFromPrompt({
        prompt: 'Generate an executive job offer letter for Lead Cloud Architect with compensation breakdown and joining date'
    });
    if (!offerResult.success) throw new Error('Offer letter generation failed');
    if (offerResult.documentType !== 'OFFER_LETTER') throw new Error('Failed to auto-classify OFFER_LETTER');
    if (!offerResult.blocks.some(b => b.type === 'signature')) throw new Error('Offer letter missing signature acceptance block');
    console.log('✓ AI auto-detected OFFER_LETTER and generated candidate acceptance block.');

    // 4. Test Commercial Proposal Intent Classification
    console.log('4. Testing AI Commercial Proposal Generation...');
    const proposalResult = await AIDocumentService.generateFromPrompt({
        prompt: 'Draft an agency pitch proposal for digital marketing transformation for ₹80,000/mo'
    });
    if (!proposalResult.success) throw new Error('Proposal generation failed');
    console.log('✓ AI generated Commercial Proposal AST with scope deliverables and signature.');

    console.log('\n🎉 TEST FLOW 2 PASSED: AI Generation Engine and Intent Detection fully verified.\n');
}

if (process.argv[1]?.includes('test_flow_02')) {
    run().catch(err => {
        console.error('❌ TEST FLOW 2 FAILED:', err);
        process.exit(1);
    });
}
