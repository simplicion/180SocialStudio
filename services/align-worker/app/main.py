"""align-worker HTTP API.

  GET  /health   liveness, supported languages and loaded models (no auth, no secrets in the body)
  POST /align    multipart `audio` + `words` (JSON: [{"text", "startMs", "endMs"}, ...]) + `language` (ISO-639-1)
                 -> {"words": [{"text", "startMs", "endMs", "aligned"}], "alignedRatio", "model", "language", ...}
                 X-Worker-Secret required. 422 for a language without a model (the caller keeps provider times).

Only the clip's extracted audio is sent (the same audio /transcribe received); the video never leaves the phone.
Bind to 127.0.0.1 (pm2); the backend is the only client.
Run: uvicorn app.main:app --host 127.0.0.1 --port 4030
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from .align import DEFAULT_MODELS, SAMPLE_RATE, Aligner, AudioDecodeError, decode_audio, model_for

log = logging.getLogger("align-worker")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")

# Same secret as the trend worker unless a separate one is set: one value to configure in the backend .env.
SECRET = os.environ.get("ALIGN_WORKER_SECRET") or os.environ.get("TREND_WORKER_SECRET", "")
ALLOW_NO_SECRET = os.environ.get("ALIGN_WORKER_ALLOW_NO_SECRET", "").lower() in {"1", "true", "yes"}
MAX_BYTES = int(os.environ.get("ALIGN_MAX_BYTES", str(25 * 1024 * 1024)))
MAX_AUDIO_SEC = int(os.environ.get("ALIGN_MAX_AUDIO_SEC", str(30 * 60)))
MAX_WORDS = 20_000
QUEUE_WAIT_S = float(os.environ.get("ALIGN_QUEUE_WAIT_S", "60"))
PRELOAD = [x.strip() for x in os.environ.get("ALIGN_PRELOAD", "en").split(",") if x.strip()]

if not SECRET and not ALLOW_NO_SECRET:
    raise RuntimeError("ALIGN_WORKER_SECRET (or TREND_WORKER_SECRET) must be set (or ALIGN_WORKER_ALLOW_NO_SECRET=1 for local tests).")

# One alignment at a time: the model uses every CPU core.
_slot = asyncio.Semaphore(1)
aligner = Aligner()
_loading: set[str] = set()
_errors: dict[str, str] = {}


def _load_in_background(lang: str) -> None:
    if lang in _loading:
        return
    _loading.add(lang)

    def run() -> None:
        try:
            aligner.model(lang)
            _errors.pop(lang, None)
        except Exception as e:  # reported on /health; requests keep provider times meanwhile
            log.exception("model load failed for %s", lang)
            _errors[lang] = str(e)[:300]
        finally:
            _loading.discard(lang)

    threading.Thread(target=run, daemon=True).start()


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    if os.environ.get("ALIGN_SKIP_MODEL_LOAD", "") != "1":
        for lang in PRELOAD:
            if model_for(lang):
                _load_in_background(lang)
    yield


app = FastAPI(title="180 align-worker", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None, lifespan=_lifespan)


def _check_secret(given: str) -> None:
    if SECRET and not hmac.compare_digest(given.encode(), SECRET.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
async def health():
    return {
        "ok": True,
        "languages": sorted(set(DEFAULT_MODELS) | {k[len("ALIGN_MODEL_"):].lower() for k in os.environ if k.startswith("ALIGN_MODEL_")}),
        "loaded": list(aligner._models.keys()),
        "loading": sorted(_loading),
        "errors": _errors,
    }


def _parse_words(raw: str) -> list[dict]:
    try:
        data = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="words must be JSON")
    if not isinstance(data, list) or len(data) > MAX_WORDS:
        raise HTTPException(status_code=422, detail=f"words must be a list of at most {MAX_WORDS}")
    out = []
    for w in data:
        if not isinstance(w, dict) or not isinstance(w.get("text"), str):
            raise HTTPException(status_code=422, detail="each word needs text, startMs, endMs")
        try:
            s, e = float(w.get("startMs", 0) or 0), float(w.get("endMs", 0) or 0)
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="startMs / endMs must be numbers")
        out.append({"text": w["text"][:100], "startMs": max(0.0, s), "endMs": max(0.0, e)})
    return out


@app.post("/align")
async def align(
    audio: UploadFile = File(...),
    words: str = Form(...),
    language: str = Form(...),
    x_worker_secret: str = Header(default=""),
):
    _check_secret(x_worker_secret)
    lang = language.strip().lower().split("-")[0]
    if not model_for(lang):
        raise HTTPException(status_code=422, detail="language not supported")
    parsed = _parse_words(words)
    data = await audio.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="audio too large")
    if not data:
        raise HTTPException(status_code=400, detail="empty audio")
    spec = model_for(lang)
    if spec and spec[0] not in aligner._models:
        if lang in _errors:
            raise HTTPException(status_code=503, detail="model unavailable")
        _load_in_background(lang)
        raise HTTPException(status_code=503, detail="model loading")

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
        result = await run_in_threadpool(aligner.align, samples, parsed, lang)
        elapsed = time.monotonic() - t0
        log.info("aligned %d words over %.1fs of %s audio in %.1fs (%d aligned, %d windows)",
                 len(parsed), seconds, lang, elapsed, result.aligned, result.windows)
        return {
            "words": result.words,
            "alignedRatio": round(result.aligned / len(parsed), 3) if parsed else 0,
            "model": spec[0] if spec else None,
            "language": lang,
            "audioSec": round(seconds, 2),
            "elapsedSec": round(elapsed, 2),
            "notes": result.notes[:20],
        }
    finally:
        _slot.release()
