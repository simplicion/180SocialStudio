import { AICreditMeterService, AICreditOperationRates } from '../src/kernel/ai-credit-meter.service';

async function runTests() {
  console.log('--- STARTING AI CREDIT METER & REVISION ARCHITECTURE VERIFICATION ---');

  // Verify rates definition
  console.log('[Test 1] Verify AICreditOperationRates structure');
  if (AICreditOperationRates.DOCUMENT_FULL !== 10) throw new Error('DOCUMENT_FULL must be 10 credits');
  if (AICreditOperationRates.DOCUMENT_REVISION !== 1) throw new Error('DOCUMENT_REVISION must be 1 credit');
  if (AICreditOperationRates.DOCUMENT_APPEND !== 1) throw new Error('DOCUMENT_APPEND must be 1 credit');
  if (AICreditOperationRates.WEBSITE_FULL !== 20) throw new Error('WEBSITE_FULL must be 20 credits');
  if (AICreditOperationRates.WEBSITE_PATCH !== 2) throw new Error('WEBSITE_PATCH must be 2 credits');
  if (AICreditOperationRates.VIDEO_DIRECTOR !== 25) throw new Error('VIDEO_DIRECTOR must be 25 credits');
  console.log('✓ Rates verified successfully!');

  // Test 2: Calculate $5.00 top-up
  console.log('[Test 2] Test $5.00 wallet recharge (+5,000 credits)');
  const testCompanyId = `test_comp_${Date.now()}`;
  const recharge5Res = await AICreditMeterService.rechargeCredits(testCompanyId, 5, 'sim_stripe_5');
  console.log('Recharge $5 result:', recharge5Res);
  if (recharge5Res.creditsAdded !== 5000) {
    throw new Error(`Expected 5,000 credits for $5, got ${recharge5Res.creditsAdded}`);
  }
  console.log('✓ $5.00 recharge granted exactly +5,000 credits!');

  // Test 3: Test $25 (+10% bonus = 27,500) and $50 (+20% bonus = 60,000)
  console.log('[Test 3] Test tier volume bonuses ($25 and $50)');
  const recharge25Res = await AICreditMeterService.rechargeCredits(testCompanyId, 25, 'sim_stripe_25');
  if (recharge25Res.creditsAdded !== 27500) {
    throw new Error(`Expected 27,500 credits for $25 (+10% bonus), got ${recharge25Res.creditsAdded}`);
  }
  console.log(`✓ $25 recharge correctly granted ${recharge25Res.creditsAdded} credits (10% bonus)!`);

  const recharge50Res = await AICreditMeterService.rechargeCredits(testCompanyId, 50, 'sim_stripe_50');
  if (recharge50Res.creditsAdded !== 60000) {
    throw new Error(`Expected 60,000 credits for $50 (+20% bonus), got ${recharge50Res.creditsAdded}`);
  }
  console.log(`✓ $50 recharge correctly granted ${recharge50Res.creditsAdded} credits (20% bonus)!`);

  // Test 4: Document creation (10 credits)
  console.log('[Test 4] Document initial creation deduction (10 credits)');
  const docCreateRes = await AICreditMeterService.settleCredits({
    companyId: testCompanyId,
    actualCredits: AICreditOperationRates.DOCUMENT_FULL,
    appId: 'documents',
    featureKey: 'DOCUMENT_FULL',
    metadata: { title: 'Service Agreement' }
  });
  console.log('Doc create deduction result:', docCreateRes);
  if (!docCreateRes.success) throw new Error('Document creation deduction failed');
  console.log('✓ 10 credits deducted for full document architecture!');

  // Test 5: 10 Iterative Revisions (1 credit each = 10 credits total)
  console.log('[Test 5] Simulating 10 iterative document revisions (1 credit each)');
  for (let i = 1; i <= 10; i++) {
    const revRes = await AICreditMeterService.settleCredits({
      companyId: testCompanyId,
      actualCredits: AICreditOperationRates.DOCUMENT_REVISION,
      appId: 'documents',
      featureKey: 'DOCUMENT_REVISION',
      metadata: { turn: i, prompt: `Revision ${i}: tweak terms` }
    });
    if (!revRes.success) throw new Error(`Revision ${i} deduction failed`);
  }
  console.log('✓ 10 revisions successfully executed, costing exactly 1 credit each (10 credits total)!');

  console.log('\n========================================');
  console.log('ALL AI CREDIT & REVISION TESTS PASSED!');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
