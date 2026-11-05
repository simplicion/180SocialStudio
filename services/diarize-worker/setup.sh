#!/usr/bin/env bash
# One-time setup for running diarize-worker under pm2.
#   cd services/diarize-worker && ./setup.sh
# Needs: Python 3.10+, ffmpeg, and HF_TOKEN (a Hugging Face read token whose account has accepted the terms of
# https://huggingface.co/pyannote/speaker-diarization-community-1) to download the model once.
set -euo pipefail
cd "$(dirname "$0")"
PYTHON="${PYTHON:-python3}"

if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
  echo "diarize-worker needs Python 3.10 or newer (found: $("$PYTHON" --version 2>&1)). Run: PYTHON=python3.12 ./setup.sh" >&2
  exit 1
fi
command -v ffmpeg >/dev/null || { echo "ffmpeg is required (sudo apt install ffmpeg)." >&2; exit 1; }

"$PYTHON" -m venv .venv
.venv/bin/pip install --upgrade pip >/dev/null
# CPU-only PyTorch (about 200 MB instead of several GB of CUDA). On a GPU server: TORCH_INDEX=default ./setup.sh
if [ "${TORCH_INDEX:-cpu}" = "cpu" ]; then
  .venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
fi
.venv/bin/pip install ".[model,dev]"
.venv/bin/python -m pytest

# Download the model now (cached in ~/.cache/huggingface), so the first request is not slow.
BACKEND_ENV="../../apps/180-social-studio-backend/.env"
if [ -z "${HF_TOKEN:-}" ] && [ -f "$BACKEND_ENV" ]; then
  HF_TOKEN="$(grep -E '^HF_TOKEN=' "$BACKEND_ENV" | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [ -n "${HF_TOKEN:-}" ]; then
  HF_TOKEN="$HF_TOKEN" .venv/bin/python -c "from app.diarize import load_pipeline; import os; load_pipeline(token=os.environ['HF_TOKEN'])" \
    && echo "model downloaded."
else
  echo "HF_TOKEN is not set: the model downloads on first start instead (set HF_TOKEN in the backend .env)."
fi
echo "diarize-worker ready. In apps/180-social-studio-backend/.env set HF_TOKEN and DIARIZE_WORKER_URL=http://127.0.0.1:4020, then:"
echo "  pm2 start ecosystem.config.cjs --only 180socialstudio-diarize-worker"
