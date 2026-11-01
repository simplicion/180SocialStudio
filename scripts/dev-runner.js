#!/usr/bin/env node
'use strict';

const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '..');

function loadRootEnv() {
  const envPath = path.join(rootDir, '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
    if (true) {
      process.env[key] = val;
    }
  }
  return env;
}

const rootEnv = loadRootEnv();
const PORT = process.env.PORT || 4007;

function freePort(port) {
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "$pids = (Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess | Where-Object { $_ -gt 0 } | Select-Object -Unique; foreach ($p in $pids) { try { Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $p -or $_.ParentProcessId -eq $p } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } } catch {} }"`,
        { stdio: 'ignore' }
      );
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
    }
  } catch (_) {}
}

function getFlutterBin() {
  if (process.platform === 'win32') {
    const flutterRoot = process.env.FLUTTER_ROOT || 'C:\\Users\\saavi\\flutter_sdk';
    const dart = path.join(flutterRoot, 'bin', 'cache', 'dart-sdk', 'bin', 'dart.exe');
    const pkg = path.join(flutterRoot, 'packages', 'flutter_tools', '.dart_tool', 'package_config.json');
    const snapshot = path.join(flutterRoot, 'bin', 'cache', 'flutter_tools.snapshot');
    if (fs.existsSync(dart) && fs.existsSync(snapshot)) {
      return `"${dart}" --packages="${pkg}" "${snapshot}"`;
    }
  }
  return 'flutter';
}

function getFlutterDevice() {
  if (process.env.FLUTTER_DEVICE) {
    return process.env.FLUTTER_DEVICE;
  }
  try {
    const flutterBin = getFlutterBin();
    const raw = execSync(`${flutterBin} devices --machine`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const devices = JSON.parse(raw.trim());
    // 1. If an android or iOS physical device/emulator is connected, use it
    const mobileDevice = devices.find(
      (d) => d.targetPlatform && (d.targetPlatform.startsWith('android') || d.targetPlatform.startsWith('ios'))
    );
    if (mobileDevice) return mobileDevice.id;

    // 2. Default to Chrome for fast desktop web preview without requiring Visual Studio C++ toolchain
    const chromeDevice = devices.find((d) => d.id === 'chrome');
    if (chromeDevice) return 'chrome';

    const edgeDevice = devices.find((d) => d.id === 'edge');
    if (edgeDevice) return 'edge';

    const winDevice = devices.find((d) => d.id === 'windows');
    if (winDevice) return 'windows';
  } catch (_) {}
  return 'chrome';
}

function waitForBackend(port, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (res.statusCode === 200 && data.service === '180-social-studio-backend') {
              return resolve(true);
            }
          } catch (_) {}
          retry();
        });
      });
      req.on('error', () => retry());
      req.setTimeout(1200, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
      } else {
        setTimeout(check, 800);
      }
    };
    check();
  });
}

async function start() {
  console.log('\x1b[1m\x1b[35m==================================================\x1b[0m');
  console.log('\x1b[1m\x1b[35m 🎬 180 SOCIAL STUDIO DUAL DEV RUNNER\x1b[0m');
  console.log('\x1b[1m\x1b[35m==================================================\x1b[0m');

  // Pre-flight: free ports 4005 (backend) and 3000 (flutter web)
  freePort(PORT);
  freePort(3000);

  const device = getFlutterDevice();
  console.log(`  [backend] -> http://localhost:${PORT} (Social & Video API)`);
  console.log(`  [client]  -> apps/social-studio-mobile (Target: [${device}])\n`);

  let cleaningUp = false;
  let backend = null;
  let backendRestartTimer = null;

  function launchBackend() {
    console.log('\x1b[36m[dev-runner] 🚀 Launching Backend API...\x1b[0m');
    backend = spawn('pnpm --filter @workspace/social-studio-backend dev', {
      cwd: rootDir,
      shell: true,
      stdio: 'inherit',
    });

    backend.on('close', (code) => {
      if (!cleaningUp) {
        console.log(`\x1b[33m[dev-runner] Backend exited (code ${code}), restarting in 2s...\x1b[0m`);
        clearTimeout(backendRestartTimer);
        backendRestartTimer = setTimeout(() => {
          freePort(PORT);
          launchBackend();
        }, 2000);
      }
    });
  }

  // 1. Launch Backend API
  launchBackend();

  // 2. Wait for Backend Health
  console.log(`\x1b[36m[dev-runner] ⏳ Waiting for Backend to be ready on port ${PORT}...\x1b[0m`);
  const ready = await waitForBackend(PORT);
  if (ready) {
    console.log(`\x1b[32m[dev-runner] ✅ Backend is online and healthy!\x1b[0m\n`);
  } else {
    console.log(`\x1b[33m[dev-runner] ⚠️ Backend taking a bit to start, launching client now...\x1b[0m\n`);
  }

  // 3. Launch Flutter App
  console.log(`\x1b[35m[dev-runner] 📱 Launching Flutter App on [${device}]...\x1b[0m`);
  const clientId = rootEnv['180_CLIENT_ID'] || process.env['180_CLIENT_ID'] || '180_client_a61725d6de73908b150480da80991fc4';
  const identityAuthUrl = rootEnv['IDENTITY_AUTH_URL'] || 'https://profile.180core.cloud';
  const identityServerUrl = rootEnv['IDENTITY_SERVER_URL'] || 'https://api.180core.cloud';
  const apiBaseUrl = `http://localhost:${PORT}`;

  const dartDefines = [
    `--dart-define=180_CLIENT_ID=${clientId}`,
    `--dart-define=IDENTITY_CLIENT_ID=${clientId}`,
    `--dart-define=IDENTITY_AUTH_URL=${identityAuthUrl}`,
    `--dart-define=IDENTITY_SERVER_URL=${identityServerUrl}`,
    `--dart-define=API_BASE_URL=${apiBaseUrl}`,
  ].join(' ');

  const flutterBin = getFlutterBin();
  const flutterCmd =
    device === 'chrome' || device === 'edge'
      ? `${flutterBin} run -d ${device} --web-port=3000 ${dartDefines}`
      : `${flutterBin} run -d ${device} ${dartDefines}`;

  const flutter = spawn(flutterCmd, {
    cwd: path.join(rootDir, 'apps', 'social-studio-mobile'),
    shell: true,
    stdio: 'inherit',
  });

  // Teardown / Graceful Exit
  function cleanup() {
    if (cleaningUp) return;
    cleaningUp = true;
    console.log('\n\x1b[33m[dev-runner] Stopping all services...\x1b[0m');
    clearTimeout(backendRestartTimer);
    try {
      if (backend) backend.kill('SIGINT');
    } catch (_) {}
    try {
      flutter.kill('SIGINT');
    } catch (_) {}
    freePort(PORT);
    freePort(3000);
    process.exit(0);
  }

  flutter.on('close', (code) => {
    console.log(`\x1b[33m[dev-runner] Flutter client closed.\x1b[0m`);
    cleanup();
  });

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

start();
