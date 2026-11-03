"""Chromium render fallback (Playwright) for article pages that only show their text after JavaScript runs.

Used only when the plain HTTP fetch found no readable text, only when TREND_WORKER_BROWSER=1, and only after the
SSRF guard and robots.txt already passed for the page URL. The browser never touches the network itself:

  * Chromium starts with every host name mapped to NOTFOUND, so nothing it tries on its own can connect;
  * every request it makes is intercepted, re-validated by the SSRF guard (http(s), default ports, public addresses
    only) and performed by the worker with the connection PINNED to the addresses that passed the check (curl
    CURLOPT_RESOLVE), so a DNS answer that changes between check and connect (rebinding) is never used;
  * images, media, fonts and stylesheets are not loaded; service workers and WebSockets are blocked;
  * redirects are handed back to the browser and re-checked as new requests; per-page request and byte budgets apply.

Honest identity: the same bot User-Agent as the HTTP fetcher; no stealth or fingerprint evasion.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from .config import Settings
from .ssrf import UnsafeUrl, resolve_public_url

log = logging.getLogger("trend-worker.browser")

SKIPPED_RESOURCES = {"image", "media", "font", "stylesheet", "manifest", "texttrack", "eventsource", "websocket", "ping"}
MAX_REQUESTS_PER_PAGE = 80
MAX_SUBRESOURCE_BYTES = 3_000_000
_HOP_BY_HOP = {"connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "proxy-connection", "upgrade", "te", "trailer"}

_slots = threading.BoundedSemaphore(2)

Resolver = Callable[[str], list[str]]
Requester = Callable[..., Any]


class Blocked(Exception):
    pass


def browser_available(settings: Settings) -> bool:
    if not settings.browser_enabled:
        return False
    try:
        import playwright.sync_api  # noqa: F401
    except Exception:
        return False
    return True


def _resolve_entry(url: str, ips: list[str]) -> list[str]:
    parts = urlsplit(url)
    port = parts.port or (443 if parts.scheme == "https" else 80)
    host = (parts.hostname or "").lower()
    return [f"{host}:{port}:{','.join(f'[{ip}]' if ':' in ip else ip for ip in ips)}"]


def _default_requester(method: str, url: str, **kwargs: Any) -> Any:
    from curl_cffi import CurlOpt, requests as creq  # installed with scrapling[fetchers]

    pinned = kwargs.pop("pinned")
    return creq.request(method, url, curl_options={CurlOpt.RESOLVE: pinned}, **kwargs)


def pinned_fetch(method: str, url: str, headers: dict, body: Optional[bytes], settings: Settings, budget: dict,
                 resolver: Optional[Resolver] = None, requester: Optional[Requester] = None) -> tuple[int, dict, bytes]:
    """One browser sub-request done by the worker. Raises Blocked when it must not be made."""
    if budget["requests"] >= MAX_REQUESTS_PER_PAGE:
        raise Blocked("request budget exhausted")
    if method not in ("GET", "HEAD", "POST"):
        raise Blocked(f"method {method} not allowed")
    try:
        safe, ips = resolve_public_url(url, resolver) if resolver else resolve_public_url(url)
    except UnsafeUrl as exc:
        raise Blocked(str(exc)) from exc
    budget["requests"] += 1
    requester = requester or _default_requester
    fwd = {k: v for k, v in headers.items() if k.lower() not in _HOP_BY_HOP and k.lower() != "host"}
    fwd["User-Agent"] = settings.user_agent
    resp = requester(method, safe, headers=fwd, data=body, timeout=settings.fetch_timeout_s, allow_redirects=False,
                     pinned=_resolve_entry(safe, ips))
    content = bytes(getattr(resp, "content", b"") or b"")
    budget["bytes"] += len(content)
    if budget["bytes"] > MAX_SUBRESOURCE_BYTES:
        raise Blocked("byte budget exhausted")
    out_headers = {str(k).lower(): str(v) for k, v in dict(getattr(resp, "headers", {}) or {}).items() if str(k).lower() not in _HOP_BY_HOP}
    return int(getattr(resp, "status_code", 0) or 0), out_headers, content


def render_page_html(url: str, settings: Settings, resolver: Optional[Resolver] = None, requester: Optional[Requester] = None) -> str:
    """Rendered HTML of a page whose URL already passed the SSRF guard and robots.txt. Raises on failure."""
    from playwright.sync_api import sync_playwright

    budget = {"requests": 0, "bytes": 0}

    def handle(route: Any) -> None:
        req = route.request
        if req.resource_type in SKIPPED_RESOURCES:
            route.abort("blockedbyclient")
            return
        try:
            status, headers, body = pinned_fetch(req.method, req.url, req.headers, req.post_data_buffer, settings, budget, resolver, requester)
        except Blocked as exc:
            log.info("browser blocked %s: %s", urlsplit(req.url).hostname, exc)
            route.abort("blockedbyclient")
            return
        except Exception as exc:
            log.info("browser sub-request failed %s: %s", urlsplit(req.url).hostname, str(exc)[:120])
            route.abort("failed")
            return
        route.fulfill(status=status, headers=headers, body=body)

    if not _slots.acquire(timeout=30):
        raise RuntimeError("browser busy")
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, args=["--host-resolver-rules=MAP * ~NOTFOUND", "--disable-background-networking",
                                                              "--disable-component-update", "--no-first-run", "--disable-sync"])
            try:
                ctx = browser.new_context(user_agent=settings.user_agent, service_workers="block", java_script_enabled=True,
                                          accept_downloads=False, ignore_https_errors=False)
                ctx.route("**/*", handle)
                ctx.route_web_socket("**/*", lambda ws: ws.close())
                page = ctx.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=int(settings.browser_timeout_s * 1000))
                try:
                    page.wait_for_load_state("networkidle", timeout=4000)
                except Exception:
                    pass  # long-polling pages never go idle; the DOM so far is what we read
                html = page.content()
            finally:
                browser.close()
    finally:
        _slots.release()
    return html[: settings.fetch_max_bytes]
