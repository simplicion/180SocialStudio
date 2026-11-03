const fs = require('fs');
const path = require('path');

/**
 * The backend reads its secrets from apps/180-social-studio-backend/.env itself (dotenv in server.ts). The trend
 * worker is a Python process, so pm2 hands it the few values it needs from that SAME file: one place to set them.
 */
function backendEnv() {
  const file = path.join(__dirname, 'apps/180-social-studio-backend/.env');
  try {
    return require('dotenv').parse(fs.readFileSync(file));
  } catch {
    return {};
  }
}
const be = backendEnv();
const pick = (...keys) => Object.fromEntries(keys.filter((k) => be[k]).map((k) => [k, be[k]]));

module.exports = {
  apps: [
    {
      name: '180socialstudio-backend',
      script: 'node_modules/.bin/tsx',
      args: 'apps/180-social-studio-backend/src/server.ts',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1500M',
      env: {
        NODE_ENV: 'production',
        PORT: 4005,
        TREND_WORKER_URL: 'http://127.0.0.1:4010',
      },
    },
    {
      // Trend research sidecar (last30days + free web search + Scrapling/Chromium fetch). One-time setup: services/trend-worker/setup.sh.
      // TREND_WORKER_SECRET (and the optional official-API credentials) come from the backend .env above.
      name: '180socialstudio-trend-worker',
      script: '.venv/bin/uvicorn', // relative to cwd
      args: 'app.main:app --host 127.0.0.1 --port 4010',
      cwd: `${__dirname}/services/trend-worker`,
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '600M',
      env: {
        LAST30DAYS_SCRIPT: `${__dirname}/services/trend-worker/vendor/last30days/skills/last30days/scripts/last30days.py`,
        LAST30DAYS_PYTHON: `${__dirname}/services/trend-worker/.venv/bin/python`,
        ...pick('TREND_WORKER_SECRET', 'TREND_WORKER_GITHUB_TOKEN', 'TREND_WORKER_X_BEARER_TOKEN', 'REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET',
          // Free search + Chromium render fallback (see services/trend-worker/README in setup.sh).
          'SEARXNG_URL', 'TREND_WORKER_SEARCH', 'TREND_WORKER_BROWSER', 'PLAYWRIGHT_BROWSERS_PATH'),
      },
    },
  ],
};
