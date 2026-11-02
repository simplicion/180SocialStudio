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
      // Trend research sidecar (last30days + Scrapling). One-time setup: services/trend-worker/setup.sh.
      // TREND_WORKER_SECRET must be set in the server environment for BOTH apps (never commit it).
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
      },
    },
  ],
};
