#!/usr/bin/env bash
# One-time setup for running align-worker under pm2.
#   cd services/align-worker && ./setup.sh
# Needs: Python 3.10+ and ffmpeg. Models are public (no token): the English one (~360 MB) is downloaded now, the
# others (~1.2 GB each) on first use of their language (cached in ~/.cache/huggingface).
set -euo pipefail
cd "$(dirname "$0")"
PYTHON="${PYTHON:-python3}"

if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "align-worker needs Python 3.10 or newer (found: $("$PYTHON" --version 2>&1)). Run: PYTHON=python3.12 ./setup.sh" >&2
  exit 1
fi
command -v ffmpeg >/dev/null || { echo "ffmpeg is required (sudo apt install ffmpeg)." >&2; exit 1; }

"$PYTHON" -m venv .venv
.venv/bin/pip install --upgrade pip >/dev/null
# CPU-only PyTorch (about 200 MB instead of several GB of CUDA). On a GPU server: TORCH_INDEX=default ./setup.sh
if [ "${TORCH_INDEX:-cpu}" = "cpu" ]; then
  .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
fi
.venv/bin/pip install ".[model,dev]"
.venv/bin/python -m pytest

# Download the English model now so the first request is not slow.
.venv/bin/python -c "from app.align import Aligner; Aligner().model('en')" && echo "English model downloaded."
echo "align-worker ready. In apps/180-social-studio-backend/.env set ALIGN_WORKER_URL=http://127.0.0.1:4030, then:"
echo "  pm2 start ecosystem.config.cjs --only 180socialstudio-align-worker"
