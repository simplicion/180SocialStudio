import { execSync } from 'child_process';
import path from 'path';

const rootDir = process.cwd();

console.log('================================================================');
console.log('🎬 180 SOCIAL STUDIO & AI DIRECTOR: AUTOMATED TEST RUNNER');
console.log('================================================================\n');

const suites = [
  { name: 'Video Contracts Compilation & Schemas', cmd: 'pnpm --filter @workspace/video-contracts typecheck' },
  { name: 'Video Engine Runtime Compilation', cmd: 'pnpm --filter @workspace/video-engine-runtime build' },
  { name: 'AI Director Architecture Contract & Schema Validation', cmd: 'npx tsx packages/domains/ai/tests/video-director.test.ts' }
];

let passed = 0;
let failed = 0;

for (const s of suites) {
  console.log(`▶ Running: ${s.name}...`);
  try {
    execSync(s.cmd, { cwd: rootDir, stdio: 'inherit' });
    console.log(`✅ [PASS] ${s.name}\n`);
    passed++;
  } catch (err) {
    console.error(`❌ [FAIL] ${s.name}\n`);
    failed++;
  }
}

console.log('================================================================');
console.log(`📊 SUMMARY: ${passed} passed, ${failed} failed (Total: ${suites.length})`);
console.log('================================================================\n');

if (failed > 0) process.exit(1);
