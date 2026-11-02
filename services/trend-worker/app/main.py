"""trend-worker HTTP API.

  GET  /health          liveness + which lanes are active (no auth, no secrets in the body)
  POST /pulse           engagement-ranked research for a topic (X-Worker-Secret required)
  POST /fetch           readable Markdown of up to 6 public pages (X-Worker-Secret required)

Bind to 127.0.0.1 (pm2) or an internal Docker network only; the backend is the only client.
Run: uvicorn app.main:app --host 127.0.0.1 --port 4010
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import os
import time

from fastapi import Depends, FastAPI, Header, HTTPException
from starlette.concurrency import run_in_threadpool

from .config import Settings, get_settings
from .fetch import fetch_page
from .models import FetchRequest, FetchResponse, PulseRequest, PulseResponse
from .pulse import run_pulse

log = logging.getLogger("trend-worker")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")

settings = get_settings()
if not settings.secret and not settings.allow_no_secret:
    raise RuntimeError("TREND_WORKER_SECRET must be set (or TREND_WORKER_ALLOW_NO_SECRET=1 for local tests).")

app = FastAPI(title="180 trend-worker", version="0.1.0", docs_url=None, redoc_url=None, openapi_url=None)
_slots = asyncio.Semaphore(max(1, settings.max_concurrency))


def current_settings() -> Settings:
    return settings


def require_secret(x_worker_secret: str = Header(default=""), s: Settings = Depends(current_settings)) -> None:
    if not s.secret:
        return
    if not hmac.compare_digest(x_worker_secret.encode(), s.secret.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


async def _acquire() -> None:
    try:
        await asyncio.wait_for(_slots.acquire(), timeout=30)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=429, detail="worker busy, retry later")


@app.get("/health")
async def health(s: Settings = Depends(current_settings)):
    return {
        "ok": True,
        "last30days": bool(s.last30days_script and os.path.isfile(s.last30days_script)),
        "sources": list(s.all_sources),
        "reddit": s.reddit_enabled,
    }


@app.post("/pulse", response_model=PulseResponse, dependencies=[Depends(require_secret)])
async def pulse(req: PulseRequest, s: Settings = Depends(current_settings)) -> PulseResponse:
    await _acquire()
    started = time.monotonic()
    try:
        res = await run_pulse(req, s)
    finally:
        _slots.release()
    log.info("pulse topic_len=%d engine=%s items=%d status=%s ms=%d", len(req.topic), res.engine, len(res.items), res.sourceStatus, (time.monotonic() - started) * 1000)
    return res


@app.post("/fetch", response_model=FetchResponse, dependencies=[Depends(require_secret)])
async def fetch(req: FetchRequest, s: Settings = Depends(current_settings)) -> FetchResponse:
    await _acquire()
    try:
        pages = await asyncio.gather(*(run_in_threadpool(fetch_page, u, s) for u in dict.fromkeys(req.urls)))
    finally:
        _slots.release()
    log.info("fetch urls=%d ok=%d", len(pages), sum(p.ok for p in pages))
    return FetchResponse(pages=list(pages))
