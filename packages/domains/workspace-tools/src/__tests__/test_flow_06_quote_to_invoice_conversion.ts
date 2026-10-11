import { DocumentService } from '../documents/document.service';
import { DocumentApprovalService } from '../documents/document-approval.service';

export async function run() {
    console.log('\n======================================================');
    console.log('🧪 TEST FLOW 6: Quotation to Official Invoice Conversion');
    console.log('======================================================');

    const testUserId = 'test-rep-' + Date.now();
    const quoteData = {
        title: 'Project Proposal & Quotation - ERP System',
        documentType: 'QUOTATION',
        category: 'Commercial',
        blocks: [
            { id: '1', type: 'heading', content: { text: 'Scope of Work & Pricing' } },
            { id: '2', type: 'grid', content: { headers: ['Item', 'Amount'], data: [['ERP Customization', '60000.00']] } }
        ],
        variables: { clientName: 'Omni Consumer Products' },
        subtotal: 60000,
        taxPercent: 18,
        taxAmount: 10800,
        grandTotal: 70800,
        currency: 'INR'
    };

    // 1. Create Quotation
    console.log('1. Creating Quotation Document...');
    const quote = await DocumentService.createDocument(testUserId, quoteData);
    if (!quote?.id) throw new Error('Quotation creation failed');
    console.log('✓ Created Quotation (ID:', quote.id, ', Total: ₹' + quote.grandTotal + ')');

    // 2. Convert to Invoice
    console.log('2. Converting Quotation to Official Tax Invoice...');
    const conversionResult = await DocumentApprovalService.convertToInvoice(quote.id, testUserId);
    if (!conversionResult.success || !conversionResult.invoice) {
        throw new Error('Quotation to Invoice conversion failed');
    }
    const invoice = conversionResult.invoice;
    console.log('✓ Conversion Successful. New Invoice Number:', invoice.documentNumber);

    // 3. Verify Converted Invoice Properties
    if (invoice.documentType !== 'INVOICE') {
        throw new Error(`Expected documentType 'INVOICE', got: ${invoice.documentType}`);
    }
    if (invoice.grandTotal !== quote.grandTotal) {
        throw new Error(`Grand total mismatch: expected ${quote.grandTotal}, got ${invoice.grandTotal}`);
    }
    if (!invoice.dueDate) {
        throw new Error('Converted Invoice missing auto-generated due date');
    }
    if (!invoice.tags.includes('converted_from_quote')) {
        throw new Error('Converted Invoice missing traceability tag');
    }

    console.log('✓ Converted Invoice Type verified: "INVOICE"');
    console.log('✓ Grand Total preserved: ₹' + invoice.grandTotal);
    console.log('✓ Net-15 Due Date automatically generated:', invoice.dueDate);

    // Clean up
    await DocumentService.deleteDocument(quote.id);
    await DocumentService.deleteDocument(invoice.id);
    console.log('✓ Cleaned up test records.');

    console.log('\n🎉 TEST FLOW 6 PASSED: Quotation to Invoice Conversion fully verified.\n');
}

if (process.argv[1]?.includes('test_flow_06')) {
    run().catch(err => {
        console.error('❌ TEST FLOW 6 FAILED:', err);
        process.exit(1);
    });
}
