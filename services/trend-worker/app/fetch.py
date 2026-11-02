"""Readable-text fetch of public article pages with Scrapling's plain HTTP fetcher (no browser, no stealth modes).

Rules: the SSRF guard runs first; robots.txt is honoured; redirects are followed only in Scrapling's "safe" mode
(private targets rejected on every hop); responses over the byte cap are cut before parsing. The result is converted
to Markdown and trimmed. It is untrusted text: the TypeScript side fences it before any model reads it.
"""
from __future__ import annotations

import re
import urllib.robotparser
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from markdownify import markdownify

from .config import Settings
from .models import FetchedPage
from .ssrf import UnsafeUrl, validate_public_url

# Blocks whose text is navigation, chrome or code, not the article.
_DROP_BLOCKS = re.compile(r"<(script|style|noscript|svg|nav|footer|header|aside|form|iframe|template|button)\b[^>]*>.*?</\1\s*>", re.I | re.S)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_MAIN = (re.compile(r"<article\b[^>]*>.*?</article\s*>", re.I | re.S), re.compile(r"<main\b[^>]*>.*?</main\s*>", re.I | re.S), re.compile(r"<body\b[^>]*>.*?</body\s*>", re.I | re.S))
_BLANK_LINES = re.compile(r"\n{3,}")

Getter = Callable[..., Any]


def _default_getter(url: str, **kwargs: Any) -> Any:
    from scrapling.fetchers import Fetcher  # imported lazily: heavy, and tests inject a fake

    return Fetcher.get(url, **kwargs)


def html_to_markdown(raw_html: str, max_chars: int) -> tuple[str, str, bool]:
    title_m = _TITLE.search(raw_html)
    title = " ".join(re.sub(r"<[^>]+>", " ", title_m.group(1)).split())[:300] if title_m else ""
    cleaned = _DROP_BLOCKS.sub(" ", raw_html)
    main = next((m.group(0) for rx in _MAIN if (m := rx.search(cleaned))), cleaned)
    md = markdownify(main, heading_style="ATX", strip=["img", "a"])
    md = _BLANK_LINES.sub("\n\n", "\n".join(line.rstrip() for line in md.splitlines())).strip()
    truncated = len(md) > max_chars
    return title, md[:max_chars], truncated


def robots_allows(url: str, settings: Settings, getter: Getter, resolver=None) -> bool:
    parts = urlsplit(url)
    robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
    try:
        validate_public_url(robots_url, resolver) if resolver else validate_public_url(robots_url)
    except UnsafeUrl:
        return False  # same host as the page, so this cannot happen for a URL that passed the guard
    try:
        resp = getter(robots_url, timeout=settings.fetch_timeout_s, retries=1, follow_redirects="safe", max_redirects=3,
                      stealthy_headers=False, headers={"User-Agent": settings.user_agent})
    except Exception:
        return True  # unreachable robots.txt: treated as no rules, as crawlers conventionally do
    if getattr(resp, "status", 0) != 200:
        return True
    body = getattr(resp, "body", b"") or b""
    text = body.decode("utf-8", "replace") if isinstance(body, (bytes, bytearray)) else str(body)
    rp = urllib.robotparser.RobotFileParser()
    rp.parse(text.splitlines())
    return rp.can_fetch(settings.user_agent, url)


def fetch_page(url: str, settings: Settings, getter: Optional[Getter] = None, resolver=None) -> FetchedPage:
    getter = getter or _default_getter
    try:
        safe = validate_public_url(url, resolver) if resolver else validate_public_url(url)
    except UnsafeUrl as exc:
        return FetchedPage(url=url, ok=False, error=f"blocked: {exc}")
    if not robots_allows(safe, settings, getter, resolver):
        return FetchedPage(url=url, ok=False, error="disallowed by robots.txt")
    try:
        resp = getter(safe, timeout=settings.fetch_timeout_s, retries=1, follow_redirects="safe", max_redirects=3,
                      stealthy_headers=False, headers={"User-Agent": settings.user_agent})
    except Exception as exc:
        return FetchedPage(url=url, ok=False, error=f"fetch failed: {str(exc)[:200]}")
    status = int(getattr(resp, "status", 0) or 0)
    final_url = str(getattr(resp, "url", safe) or safe)
    if status != 200:
        return FetchedPage(url=url, ok=False, status=status, finalUrl=final_url, error=f"HTTP {status}")
    ctype = ""
    headers = getattr(resp, "headers", None) or {}
    try:
        ctype = str(headers.get("content-type") or headers.get("Content-Type") or "").lower()
    except AttributeError:
        pass
    if ctype and "html" not in ctype and "text/plain" not in ctype:
        return FetchedPage(url=url, ok=False, status=status, finalUrl=final_url, error=f"unsupported content type {ctype[:60]}")
    body = getattr(resp, "body", b"") or b""
    if isinstance(body, (bytes, bytearray)):
        body = bytes(body[: settings.fetch_max_bytes]).decode(getattr(resp, "encoding", None) or "utf-8", "replace")
    else:
        body = str(body)[: settings.fetch_max_bytes]
    title, md, truncated = html_to_markdown(body, settings.markdown_max_chars)
    if len(md) < 200:
        return FetchedPage(url=url, ok=False, status=status, finalUrl=final_url, title=title, error="no readable article text")
    return FetchedPage(url=url, ok=True, status=status, finalUrl=final_url, title=title, markdown=md, truncated=truncated)
