#!/usr/bin/env bash
# One-time setup for running trend-worker under pm2 (non-Docker servers).
#   cd services/trend-worker && ./setup.sh
# Creates .venv, installs the worker, and checks out last30days at the pinned tag into vendor/.
set -euo pipefail
cd "$(dirname "$0")"
LAST30DAYS_REF="${LAST30DAYS_REF:-v3.31.0}"

python3 -m venv .venv
.venv/bin/pip install --upgrade pip >/dev/null
.venv/bin/pip install ".[dev]"

rm -rf vendor/last30days
git clone --depth 1 --branch "$LAST30DAYS_REF" https://github.com/mvanhorn/last30days-skill vendor/last30days
rm -rf vendor/last30days/.git

.venv/bin/python -m pytest
echo "trend-worker ready. Set TREND_WORKER_SECRET in the environment, then: pm2 start ecosystem.config.cjs --only 180socialstudio-trend-worker"
