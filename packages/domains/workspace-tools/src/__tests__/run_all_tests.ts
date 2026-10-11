import { run as runFlow1 } from './test_flow_01_document_crud_ast';
import { run as runFlow2 } from './test_flow_02_ai_generation_engine';
import { run as runFlow3 } from './test_flow_03_token_generation_and_public_edge';
import { run as runFlow4 } from './test_flow_04_client_esign_signature_verification';
import { run as runFlow5 } from './test_flow_05_golden_financial_approval_and_ledger';
import { run as runFlow6 } from './test_flow_06_quote_to_invoice_conversion';
import { run as runFlow7 } from './test_flow_07_templates_matrix_integrity';
import { run as runFlow8 } from './test_flow_08_multi_tenant_company_scoping';
import { run as runFlow9 } from './test_flow_09_backward_compatibility_fallback';
import { run as runFlow10 } from './test_flow_10_end_to_end_complete_lifecycle';
import { run as runFlow11 } from './test_flow_11_pricing_table_and_payment_recording';
import { runTestFlow12 as runFlow12 } from './test_flow_12_rich_formatting_and_approval_decisions';
import { runFlow13 } from './test_flow_13_container_flex_layout';
import { runTestFlow14 as runFlow14 } from './test_flow_14_universal_viewer_and_access_control';
import { runTestFlow15 as runFlow15 } from './test_flow_15_google_drive_share_and_access_control';
import { runFlow16 } from './test_flow_16_ai_builder_incremental_ast';
import { runFlow17 } from './test_flow_17_payment_checkout_hybrid_block';
import { run as runFlow18 } from './test_flow_18_signature_block_and_universal_modal_ast';

const testSuites = [
    { name: 'Flow 1: Unified Document CRUD & AST Serialization', fn: runFlow1 },
    { name: 'Flow 2: Natural Language AI Generation Engine', fn: runFlow2 },
    { name: 'Flow 3: Share Token Generation & Public Edge Retrieval', fn: runFlow3 },
    { name: 'Flow 4: Digital Signature Submission & Verification', fn: runFlow4 },
    { name: 'Flow 5: The Golden Financial Approval & Ledger Posting', fn: runFlow5 },
    { name: 'Flow 6: Quotation to Official Invoice Conversion', fn: runFlow6 },
    { name: 'Flow 7: 20 Production Templates Matrix Integrity', fn: runFlow7 },
    { name: 'Flow 8: Multi-Tenant Company Scoping & User Indexing', fn: runFlow8 },
    { name: 'Flow 9: Backward Compatibility & Legacy Fallbacks', fn: runFlow9 },
    { name: 'Flow 10: Complete End-to-End Document Lifecycle Simulation', fn: runFlow10 },
    { name: 'Flow 11: Pricing Table & Two-Step Payment Recording', fn: runFlow11 },
    { name: 'Flow 12: Fundamental Elements, Rich Formatting & Decision Engine', fn: runFlow12 },
    { name: 'Flow 13: Flex Container & Multi-Slot Row/Col Layout Engine', fn: runFlow13 },
    { name: 'Flow 14: Universal Document Viewer & Access Control Engine', fn: runFlow14 },
    { name: 'Flow 15: Google Drive Style Multi-User Sharing & Access Enforcement', fn: runFlow15 },
    { name: 'Flow 16: AI Document Builder Live Streaming & Incremental AST Synthesis', fn: runFlow16 },
    { name: 'Flow 17: Payment & Checkout Hybrid Block (Button, Milestones, Bank Wire)', fn: runFlow17 },
    { name: 'Flow 18: Signature Element Display, Resizing & Universal Signing AST', fn: runFlow18 }
];

async function runAll() {
    console.log('================================================================');
    console.log('🚀 RUNNING ALL 18 CENTRALIZED DOCUMENT ENGINE TEST SUITES (IN-PROCESS)');
    console.log('================================================================\n');

    let passedCount = 0;
    const startTime = Date.now();

    for (const [index, suite] of testSuites.entries()) {
        console.log(`\n▶️  [${index + 1}/${testSuites.length}] Executing ${suite.name}...`);
        try {
            await suite.fn();
            passedCount++;
        } catch (err: any) {
            console.error(`\n❌ FAILED [${index + 1}/${testSuites.length}]: ${suite.name}`);
            console.error(err);
            process.exit(1);
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n================================================================');
    console.log(`🏆 ALL ${passedCount}/${testSuites.length} TEST SUITES PASSED IN ${duration}s!`);
    console.log('================================================================\n');
}

runAll().catch(err => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
});
