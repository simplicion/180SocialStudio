import { prisma } from '@workspace/db';
import { DocumentService } from '../documents/document.service';
import { AIDocumentService } from '../documents/ai-document.service';

export async function runFlow17() {
    console.log('\n===============================================================');
    console.log('🧪 TEST FLOW 17: PAYMENT & CHECKOUT HYBRID BLOCK (OPTION C)');
    console.log('===============================================================\n');

    // Step 1: Prepare Context
    console.log('[Step 1] Initializing Test User and Client Context...');
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('No test user found in database');
    const client = await prisma.client.findFirst();

    console.log(`  ✓ Ready: User (${user.email}), Client (${client?.name || 'Acme Corp'})`);

    // Step 2: Test Mode 1 - Payment Button / Checkout Link
    console.log('\n[Step 2] Testing Mode 1: Online Checkout Button (Razorpay/Stripe)...');
    const docWithButton = await DocumentService.createDocument(user.id, {
        title: 'Tax Invoice with Razorpay Button',
        documentType: 'INVOICE',
        clientId: client?.id || null,
        subtotal: 25000,
        grandTotal: 29500,
        blocks: [
            {
                id: 'head-1',
                type: 'heading',
                content: { text: 'TAX INVOICE - PAYMENT DUE', level: 1 }
            },
            {
                id: 'pay-btn-1',
                type: 'payment_checkout',
                content: {
                    mode: 'button',
                    gateway: 'razorpay',
                    buttonText: 'Pay Invoice via Razorpay',
                    paymentUrl: 'https://rzp.io/l/demo123',
                    amountText: '₹29,500.00',
                    buttonStyle: 'gradient',
                    buttonColor: '#4f46e5',
                    buttonAlignment: 'center'
                }
            }
        ]
    });

    if (!docWithButton || !docWithButton.id) throw new Error('Failed to create document with payment button');
    const payBlock1 = docWithButton.blocks.find((b: any) => b.type === 'payment_checkout');
    if (!payBlock1 || payBlock1.content.mode !== 'button' || payBlock1.content.gateway !== 'razorpay') {
        throw new Error('Payment button block content mismatch in created document');
    }
    console.log(`  ✓ Created Document with Mode 1 Payment Button (Doc ID: ${docWithButton.id})`);
    console.log(`  ✓ Verified Gateway: ${payBlock1.content.gateway}, URL: ${payBlock1.content.paymentUrl}, Amount: ${payBlock1.content.amountText}`);

    // Step 3: Test Mode 2 - Milestone Schedule Breakdown
    console.log('\n[Step 3] Testing Mode 2: Milestone Schedule & Percentage Installments...');
    const updatedWithMilestones = await DocumentService.updateDocument(docWithButton.id, user.id, {
        blocks: [
            {
                id: 'head-1',
                type: 'heading',
                content: { text: 'TAX INVOICE - MILESTONES', level: 1 }
            },
            {
                id: 'pay-btn-1',
                type: 'payment_checkout',
                content: {
                    mode: 'milestones',
                    milestoneTitle: 'Engineering Deliverable Milestones',
                    milestoneCurrency: 'INR',
                    milestones: [
                        { id: 'm1', title: 'Sprint 1: Schema & DB Migrations', percentage: 30, amount: 8850, dueDate: 'Day 7', status: 'paid' },
                        { id: 'm2', title: 'Sprint 2: Real-Time WebSockets & UI', percentage: 40, amount: 11800, dueDate: 'Day 14', status: 'pending' },
                        { id: 'm3', title: 'Sprint 3: Production Deployment & QA', percentage: 30, amount: 8850, dueDate: 'Day 21', status: 'pending' }
                    ]
                }
            }
        ]
    });

    const payBlock2 = updatedWithMilestones.blocks.find((b: any) => b.type === 'payment_checkout');
    if (!payBlock2 || payBlock2.content.mode !== 'milestones') {
        throw new Error('Failed to transition payment block to Mode 2 Milestones');
    }
    const totalPercentage = payBlock2.content.milestones.reduce((s: number, m: any) => s + m.percentage, 0);
    if (totalPercentage !== 100) {
        throw new Error(`Milestone percentage sum mismatch: Expected 100%, got ${totalPercentage}%`);
    }
    console.log(`  ✓ Updated to Mode 2 Milestones with ${payBlock2.content.milestones.length} staged deliverables`);
    console.log(`  ✓ Verified 100% allocation check across all phases`);

    // Step 4: Test Mode 3 - Bank & Wire Transfer Details
    console.log('\n[Step 4] Testing Mode 3: Corporate Bank & Wire Transfer Details (Light Theme)...');
    const updatedWithBank = await DocumentService.updateDocument(docWithButton.id, user.id, {
        blocks: [
            {
                id: 'head-1',
                type: 'heading',
                content: { text: 'TAX INVOICE - WIRE DETAILS', level: 1 }
            },
            {
                id: 'pay-btn-1',
                type: 'payment_checkout',
                content: {
                    mode: 'bank_transfer',
                    bankDetailsTitle: 'Official Corporate Bank Wire',
                    accountHolderName: 'Apex Enterprise Technologies Ltd',
                    bankName: 'HDFC Bank Corporate',
                    accountNumber: '50200088997766',
                    ifscOrSwiftCode: 'HDFC0001234',
                    iban: 'GB29HDFC00012345678901',
                    additionalInstructions: 'Include invoice reference INV-2026 in transaction remarks.'
                }
            }
        ]
    });

    const payBlock3 = updatedWithBank.blocks.find((b: any) => b.type === 'payment_checkout');
    if (!payBlock3 || payBlock3.content.mode !== 'bank_transfer' || payBlock3.content.accountNumber !== '50200088997766') {
        throw new Error('Failed to transition payment block to Mode 3 Bank Wire');
    }
    console.log(`  ✓ Updated to Mode 3 Bank Wire (Light Theme)`);
    console.log(`  ✓ Account: ${payBlock3.content.accountNumber}, IFSC: ${payBlock3.content.ifscOrSwiftCode}`);

    // Step 4B: Test Mode 4 - Instant UPI Transfer
    console.log('\n[Step 4B] Testing Mode 4: Instant UPI & QR Transfer (Light Theme)...');
    const updatedWithUpi = await DocumentService.updateDocument(docWithButton.id, user.id, {
        blocks: [
            {
                id: 'head-1',
                type: 'heading',
                content: { text: 'TAX INVOICE - UPI TRANSFER', level: 1 }
            },
            {
                id: 'pay-btn-1',
                type: 'payment_checkout',
                content: {
                    mode: 'upi_transfer',
                    upiDetailsTitle: 'Direct Instant UPI Transfer',
                    accountHolderName: 'Apex Enterprise Technologies Ltd',
                    upiId: 'apexenterprises@okhdfcbank',
                    bankName: 'HDFC Bank UPI',
                    amountText: '₹29,500.00',
                    additionalInstructions: 'Scan with any UPI app (GPay, PhonePe, Paytm).'
                }
            }
        ]
    });

    const payBlock4 = updatedWithUpi.blocks.find((b: any) => b.type === 'payment_checkout');
    if (!payBlock4 || payBlock4.content.mode !== 'upi_transfer' || payBlock4.content.upiId !== 'apexenterprises@okhdfcbank') {
        throw new Error('Failed to transition payment block to Mode 4 UPI Transfer');
    }
    console.log(`  ✓ Updated to Mode 4 Instant UPI Transfer`);
    console.log(`  ✓ UPI ID: ${payBlock4.content.upiId}, Beneficiary: ${payBlock4.content.accountHolderName}`);

    // Step 5: Test Natural Language AI Incremental Synthesis of Payment Blocks
    console.log('\n[Step 5] Testing AI Incremental Synthesis of Payment Block...');
    const aiResult = await AIDocumentService.generateFromPrompt({
        prompt: 'Add a Stripe checkout button and direct bank wire transfer details for international clients',
        existingBlocks: [
            { id: 'b1', type: 'heading', content: { text: 'Consulting Agreement', level: 1 } }
        ],
        clientId: client?.id,
        userId: user.id
    });

    if (!aiResult.success || !Array.isArray(aiResult.newBlocks)) {
        throw new Error('AI failed to incrementally synthesize payment blocks');
    }
    const aiPayBlocks = aiResult.newBlocks.filter((b: any) => b.type === 'payment_checkout');
    if (aiPayBlocks.length < 2) {
        throw new Error(`Expected AI to synthesize 2 payment blocks (Stripe button + Bank wire), got ${aiPayBlocks.length}`);
    }
    console.log(`  ✓ AI successfully synthesized ${aiPayBlocks.length} payment_checkout blocks (Button + Bank Wire)`);
    console.log(`  ✓ AI Explanation: "${aiResult.explanation}"`);

    // Cleanup
    await DocumentService.deleteDocument(docWithButton.id);
    console.log('  ✓ Cleaned up test document record.');

    console.log('\n===============================================================');
    console.log('🎉 TEST FLOW 17 PASSED: PAYMENT & CHECKOUT HYBRID BLOCK 100%');
    console.log('===============================================================\n');
}

if (require.main === module) {
    runFlow17().catch(err => {
        console.error('❌ Test Flow 17 Failed:', err);
        process.exit(1);
    });
}
