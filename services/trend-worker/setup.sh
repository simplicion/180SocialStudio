#!/usr/bin/env bash
# One-time setup for running trend-worker under pm2 (non-Docker servers).
#   cd services/trend-worker && ./setup.sh
# Creates .venv, installs the worker, and checks out last30days at the pinned tag into vendor/.
set -euo pipefail
cd "$(dirname "$0")"
LAST30DAYS_REF="${LAST30DAYS_REF:-v3.31.0}"
PYTHON="${PYTHON:-python3}"

# last30days needs Python 3.12+. Fail early with a clear message instead of half-installing.
if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 12) else 1)'; then
  echo "trend-worker needs Python 3.12 or newer (found: $("$PYTHON" --version 2>&1))." >&2
  echo "Install it (e.g. 'sudo apt install python3.12 python3.12-venv') and run: PYTHON=python3.12 ./setup.sh" >&2
  exit 1
fi
command -v git >/dev/null || { echo "git is required to fetch last30days." >&2; exit 1; }

"$PYTHON" -m venv .venv
.venv/bin/pip install --upgrade pip >/dev/null
.venv/bin/pip install ".[dev]"

rm -rf vendor/last30days
git clone --depth 1 --branch "$LAST30DAYS_REF" https://github.com/mvanhorn/last30days-skill vendor/last30days
rm -rf vendor/last30days/.git

# Chromium for the render fallback (TREND_WORKER_BROWSER=1). Its system libraries need root once:
#   sudo .venv/bin/python -m playwright install-deps chromium
# Skip the download with: WITH_BROWSER=0 ./setup.sh
if [ "${WITH_BROWSER:-1}" = "1" ]; then
  .venv/bin/python -m playwright install chromium
fi

.venv/bin/python -m pytest
echo "trend-worker ready. In apps/180-social-studio-backend/.env set TREND_WORKER_SECRET and TREND_WORKER_BROWSER=1"
echo "(if Chromium fails to start, run once: sudo .venv/bin/python -m playwright install-deps chromium), then:"
echo "  pm2 start ecosystem.config.cjs --only 180socialstudio-trend-worker"
