"""Keyless web & news search: the free replacement for Tavily / Brave.

Engines, in order:
  1. SearXNG (open-source metasearch, self-hosted) when SEARXNG_URL is set: JSON API, no key, no third-party quota.
  2. ddgs (open-source metasearch library: DuckDuckGo / Bing / Yahoo news and web) when SEARXNG is unset or failed.

Each query runs as a news search (dated articles) and a web search (forums, blogs, explainers), restricted to the
requested window. Results are plain data: titles/snippets are untrusted and the TypeScript side fences them before any
model reads them; URLs are only ever cited and fetched through the SSRF-guarded /fetch.
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

import httpx

from .config import Settings
from .models import SearchRequest, SearchResponse, SearchResult

log = logging.getLogger("trend-worker.search")

DdgsFactory = Callable[[], Any]
HttpGet = Callable[..., Any]

# The free engines rate-limit bursts; one query at a time, spaced, keeps the worker under their limits.
_ddgs_lock = threading.Lock()
_last_ddgs_call = [0.0]
_DDGS_SPACING_S = 1.0


def _timelimit(days: int) -> str:
    return "d" if days <= 1 else "w" if days <= 7 else "m" if days <= 31 else "y"


def _iso_date(value: Any) -> Optional[str]:
    if not value:
        return None
    s = str(value).strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            dt = datetime.strptime(s.replace("Z", "+00:00"), fmt)
            return dt.date().isoformat()
        except ValueError:
            continue
    return s[:10] if len(s) >= 10 and s[4] == "-" and s[7] == "-" else None


def _within_window(published: Optional[str], days: int, now: datetime) -> bool:
    if not published:
        return True  # undated web results stay; the window was already applied by the engine
    try:
        d = datetime.strptime(published, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return (now - d).days <= days + 1


def _clean_url(url: Any) -> Optional[str]:
    if not isinstance(url, str):
        return None
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return url.strip()


def _result(raw: dict, engine: str, kind: str) -> Optional[SearchResult]:
    url = _clean_url(raw.get("url") or raw.get("href"))
    title = " ".join(str(raw.get("title") or "").split())
    if not url or not title:
        return None
    return SearchResult(
        title=title[:300],
        url=url,
        snippet=" ".join(str(raw.get("body") or raw.get("content") or raw.get("snippet") or "").split())[:600],
        publishedAt=_iso_date(raw.get("date") or raw.get("publishedDate") or raw.get("published_date")),
        source=str(raw.get("source") or urlsplit(url).hostname or "")[:80],
        engine=engine,
        kind=kind,
    )


def _default_ddgs() -> Any:
    from ddgs import DDGS  # imported lazily: tests inject a fake

    return DDGS(timeout=10)


def search_ddgs(query: str, days: int, max_results: int, factory: Optional[DdgsFactory] = None) -> list[SearchResult]:
    factory = factory or _default_ddgs
    out: list[SearchResult] = []
    with _ddgs_lock:
        for kind in ("news", "text"):
            wait = _DDGS_SPACING_S - (time.monotonic() - _last_ddgs_call[0])
            if wait > 0 and factory is _default_ddgs:
                time.sleep(wait)
            try:
                client = factory()
                call = client.news if kind == "news" else client.text
                rows = call(query, timelimit=_timelimit(days), max_results=max_results, safesearch="moderate") or []
            except Exception as exc:  # no results / rate limit / engine change: the other kind may still work
                log.info("ddgs %s failed: %s", kind, str(exc)[:160])
                rows = []
            finally:
                _last_ddgs_call[0] = time.monotonic()
            out.extend(r for r in (_result(x, "ddgs", "news" if kind == "news" else "web") for x in rows if isinstance(x, dict)) if r)
    return out


def search_searxng(query: str, days: int, max_results: int, settings: Settings, http_get: Optional[HttpGet] = None) -> list[SearchResult]:
    http_get = http_get or httpx.get
    time_range = "day" if days <= 1 else "week" if days <= 7 else "month" if days <= 31 else "year"
    out: list[SearchResult] = []
    for category, kind in (("news", "news"), ("general", "web")):
        resp = http_get(
            f"{settings.searxng_url.rstrip('/')}/search",
            params={"q": query, "format": "json", "categories": category, "time_range": time_range, "safesearch": 1},
            headers={"User-Agent": settings.user_agent, "Accept": "application/json"},
            timeout=settings.fetch_timeout_s + 5,
        )
        if getattr(resp, "status_code", 0) != 200:
            raise RuntimeError(f"SearXNG HTTP {getattr(resp, 'status_code', '?')}")
        rows = (resp.json() or {}).get("results") or []
        out.extend(r for r in (_result(x, "searxng", kind) for x in rows[:max_results] if isinstance(x, dict)) if r)
    return out


def run_search(req: SearchRequest, settings: Settings, ddgs_factory: Optional[DdgsFactory] = None, http_get: Optional[HttpGet] = None,
               now: Optional[datetime] = None) -> SearchResponse:
    now = now or datetime.now(timezone.utc)
    warnings: list[str] = []
    engines: list[str] = []
    collected: list[SearchResult] = []
    for q in req.queries:
        rows: list[SearchResult] = []
        if settings.searxng_url:
            try:
                rows = search_searxng(q, req.days, req.maxResults, settings, http_get)
                if "searxng" not in engines:
                    engines.append("searxng")
            except Exception as exc:
                warnings.append(f"searxng unavailable: {str(exc)[:120]}")
        if not rows:
            rows = search_ddgs(q, req.days, req.maxResults, ddgs_factory)
            if rows and "ddgs" not in engines:
                engines.append("ddgs")
        collected.extend(rows)

    seen: set[str] = set()
    results: list[SearchResult] = []
    for r in collected:
        key = r.url.split("#")[0].rstrip("/").lower()
        if key in seen or not _within_window(r.publishedAt, req.days, now):
            continue
        seen.add(key)
        results.append(r)
    # Dated news first (newest first), then web results in engine order.
    news = sorted((r for r in results if r.kind == "news"), key=lambda r: r.publishedAt or "", reverse=True)
    results = news + [r for r in results if r.kind != "news"]
    if not results:
        warnings.append("no results from the free search engines")
    return SearchResponse(results=results[: req.maxResults * 2 * len(req.queries)], engines=engines, warnings=warnings)
