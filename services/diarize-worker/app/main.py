"""diarize-worker HTTP API.

  GET  /health     liveness and whether the model is loaded (no auth, no secrets in the body)
  POST /diarize    multipart `audio` (+ optional num_speakers / min_speakers / max_speakers form fields)
                   -> {"speakers": 2, "segments": [{"speaker": "S1", "startMs": 0, "endMs": 4200}, ...], "model": ...}
                   X-Worker-Secret required.

Bind to 127.0.0.1 (pm2); the backend is the only client.
Run: uvicorn app.main:app --host 127.0.0.1 --port 4020
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Any, Callable

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from .diarize import DEFAULT_MODEL, SAMPLE_RATE, AudioDecodeError, decode_audio, load_pipeline, run_diarization

log = logging.getLogger("diarize-worker")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")

# Same secret as the trend worker unless a separate one is set: one value to configure in the backend .env.
SECRET = os.environ.get("DIARIZE_WORKER_SECRET") or os.environ.get("TREND_WORKER_SECRET", "")
ALLOW_NO_SECRET = os.environ.get("DIARIZE_WORKER_ALLOW_NO_SECRET", "").lower() in {"1", "true", "yes"}
MODEL = os.environ.get("DIARIZE_MODEL", DEFAULT_MODEL)
MAX_BYTES = int(os.environ.get("DIARIZE_MAX_BYTES", str(25 * 1024 * 1024)))
MAX_AUDIO_SEC = int(os.environ.get("DIARIZE_MAX_AUDIO_SEC", str(2 * 60 * 60)))
QUEUE_WAIT_S = float(os.environ.get("DIARIZE_QUEUE_WAIT_S", "60"))

if not SECRET and not ALLOW_NO_SECRET:
    raise RuntimeError("DIARIZE_WORKER_SECRET (or TREND_WORKER_SECRET) must be set (or DIARIZE_WORKER_ALLOW_NO_SECRET=1 for local tests).")

# One diarization at a time: it uses every CPU core, so parallel runs only make each one slower.
_slot = asyncio.Semaphore(1)


class _Model:
    """Loaded in the background at start-up so /health answers at once; requests get 503 until it is ready."""

    def __init__(self, loader: Callable[[], Any]):
        self._loader = loader
        self.pipeline: Any = None
        self.error: str | None = None
        self.loading = False
        self._lock = threading.Lock()

    def start(self) -> None:
        with self._lock:
            if self.pipeline is not None or self.loading:
                return
            self.loading = True
        threading.Thread(target=self._load, daemon=True).start()

    def _load(self) -> None:
        try:
            self.pipeline = self._loader()
            self.error = None
        except Exception as e:  # reported on /health; the worker keeps running so it can be fixed without a restart loop
            log.exception("model load failed")
            self.error = str(e)[:300]
        finally:
            self.loading = False


model = _Model(lambda: load_pipeline(MODEL, os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")))


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    if os.environ.get("DIARIZE_SKIP_MODEL_LOAD", "") != "1":
        model.start()
    yield


app = FastAPI(title="180 diarize-worker", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None, lifespan=_lifespan)


def _check_secret(given: str) -> None:
    if SECRET and not hmac.compare_digest(given.encode(), SECRET.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
async def health():
    return {
        "ok": True,
        "model": MODEL,
        "ready": model.pipeline is not None,
        "loading": model.loading,
        "error": model.error,
    }


def _speakers(v: int | None) -> int | None:
    if v is None:
        return None
    if not 1 <= v <= 20:
        raise HTTPException(status_code=422, detail="speaker counts must be 1..20")
    return v


@app.post("/diarize")
async def diarize(
    audio: UploadFile = File(...),
    num_speakers: int | None = Form(default=None),
    min_speakers: int | None = Form(default=None),
    max_speakers: int | None = Form(default=None),
    x_worker_secret: str = Header(default=""),
):
    _check_secret(x_worker_secret)
    if model.pipeline is None:
        if not model.loading and model.error is None:
            model.start()
        raise HTTPException(status_code=503, detail="model loading" if model.loading or model.error is None else "model unavailable")
    data = await audio.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")
    if not data:
        raise HTTPException(status_code=400, detail="empty audio")
    n, lo, hi = _speakers(num_speakers), _speakers(min_speakers), _speakers(max_speakers)

    try:
        await asyncio.wait_for(_slot.acquire(), timeout=QUEUE_WAIT_S)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=429, detail="worker busy, retry later")
    try:
        t0 = time.monotonic()
        try:
            samples = await run_in_threadpool(decode_audio, data)
        except AudioDecodeError as e:
            raise HTTPException(status_code=415, detail=str(e))
        seconds = len(samples) / SAMPLE_RATE
        if seconds > MAX_AUDIO_SEC:
            raise HTTPException(status_code=413, detail="audio too long")
        if seconds < 0.5:
            return {"speakers": 0, "segments": [], "model": MODEL, "audioSec": round(seconds, 2), "elapsedSec": 0}
        segs = await run_in_threadpool(run_diarization, model.pipeline, samples, n, lo, hi)
        elapsed = time.monotonic() - t0
        log.info("diarized %.1fs of audio in %.1fs: %d speakers, %d turns", seconds, elapsed, len({s.speaker for s in segs}), len(segs))
        return {
            "speakers": len({s.speaker for s in segs}),
            "segments": [{"speaker": s.speaker, "startMs": s.start_ms, "endMs": s.end_ms} for s in segs],
            "model": MODEL,
            "audioSec": round(seconds, 2),
            "elapsedSec": round(elapsed, 2),
        }
    finally:
        _slot.release()
