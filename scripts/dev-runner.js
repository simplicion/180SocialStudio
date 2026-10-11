#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

console.log('\x1b[1m\x1b[35m==================================================\x1b[0m');
console.log('\x1b[1m\x1b[35m 🎬 180 SOCIAL STUDIO DEV RUNNER\x1b[0m');
console.log('\x1b[1m\x1b[35m==================================================\x1b[0m');
console.log('  [backend] -> http://localhost:4005 (Social & Video API)');
console.log('  [mobile]  -> apps/social-studio-mobile (Flutter Run)\n');

const backend = spawn('pnpm', ['--filter', '@workspace/social-studio-backend', 'dev'], {
  cwd: rootDir,
  shell: true,
  stdio: 'inherit'
});

backend.on('close', (code) => {
  console.log(`Backend exited with code ${code}`);
  process.exit(code);
});
