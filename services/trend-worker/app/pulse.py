"""Engagement-ranked research for a topic over the last N days.

Lanes:
  * last30days (pinned checkout, run as a subprocess with a clean environment): Hacker News, Polymarket, GitHub,
    and X when an official X bearer token is configured.
  * Reddit through the official API (app-only OAuth) when REDDIT_CLIENT_ID/SECRET are set.
  * Native Hacker News (Algolia API) as a fallback when last30days is unavailable or fails.
Hacker News items are enriched with a few top comments so the analyst can read audience sentiment.

Everything returned is untrusted third-party text; the TypeScript side fences it before any model sees it.
"""
from __future__ import annotations

import asyncio
import html
import json
import os
import re
import tempfile
import time
from typing import Any, Awaitable, Callable, Optional

import httpx

from .config import Settings
from .models import Engagement, PulseCluster, PulseItem, PulseRequest, PulseResponse, QueryPlan, Subquery

Runner = Callable[[str, int, QueryPlan, Settings], Awaitable[dict[str, Any]]]

# Engagement keys seen across last30days sources, mapped to our fields (first match wins).
_KEYMAP = {
    "upvotes": ("score", "points", "ups", "upvotes", "stars", "reactions", "reposts"),
    "comments": ("comments", "num_comments", "comment_count", "replies"),
    "views": ("views", "view_count", "plays", "impressions"),
    "likes": ("likes", "like_count", "favorites"),
    "volume": ("volume", "volume_usd", "liquidity"),
}
_EXCLUDE_SUFFIXES = ("_rank", "_score", "_ratio", "_rate", "_followers")
_TAG_RE = re.compile(r"<[^>]+>")


def _num(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f >= 0 else None  # drop NaN / negatives


def map_engagement(raw: dict[str, Any] | None) -> Engagement:
    counters = {k: n for k, v in (raw or {}).items() if not str(k).endswith(_EXCLUDE_SUFFIXES) and (n := _num(v)) is not None}
    out: dict[str, Optional[float]] = {}
    for field, keys in _KEYMAP.items():
        out[field] = next((counters[k] for k in keys if k in counters), None)
    primary = next((out[f] for f in ("views", "upvotes", "likes", "volume", "comments") if out[f] is not None), None)
    return Engagement(primary=primary, raw=counters, **out)


def _http_url(u: Any) -> bool:
    return isinstance(u, str) and u.startswith(("http://", "https://")) and len(u) <= 2048


def normalize_agent_export(data: dict[str, Any]) -> tuple[list[PulseItem], list[PulseCluster], dict[str, str]]:
    """Maps last30days `--emit=json --json-profile=agent` (schema 1.x) to our items."""
    items: list[PulseItem] = []
    seen: set[str] = set()
    for r in data.get("results") or []:
        if not isinstance(r, dict):
            continue
        url, title = r.get("url"), str(r.get("title") or "").strip()
        if not _http_url(url) or not title or url in seen:
            continue
        seen.add(url)
        rel = _num(r.get("relevance_score"))
        items.append(PulseItem(
            source=str(r.get("source") or "unknown"), url=url, title=title[:300], text=str(r.get("summary") or "")[:1200],
            publishedAt=r.get("published_at") if isinstance(r.get("published_at"), str) else None,
            engagement=map_engagement(r.get("engagement") if isinstance(r.get("engagement"), dict) else {}),
            relevance=min(1.0, rel) if rel is not None else None,
            cluster=r.get("cluster") if isinstance(r.get("cluster"), str) else None,
        ))
    clusters = [
        PulseCluster(title=str(c.get("title") or "")[:300], summary=str(c.get("summary") or "")[:800],
                     sources=[str(s) for s in c.get("sources") or []], engagementTotal=_num(c.get("engagement_total")))
        for c in data.get("clusters") or [] if isinstance(c, dict) and c.get("title")
    ]
    status = {str(k): str(v) for k, v in (data.get("source_status") or {}).items()}
    return items, clusters, status


def default_plan(topic: str, sources: tuple[str, ...]) -> QueryPlan:
    return QueryPlan(subqueries=[Subquery(label="primary", search_query=topic[:120], ranking_query=f"What are people discussing about {topic[:200]}?", sources=list(sources), weight=1.0)])


def restrict_plan(plan: QueryPlan, allowed: tuple[str, ...]) -> QueryPlan:
    """Keeps only sources this worker may query; subqueries left with no source are dropped."""
    subs = []
    for sq in plan.subqueries:
        srcs = [s for s in sq.sources if s in allowed] or ([*allowed] if sq.label == "primary" else [])
        if srcs:
            subs.append(sq.model_copy(update={"sources": srcs}))
    if not subs:
        subs = [Subquery(label="primary", search_query=plan.subqueries[0].search_query, ranking_query=plan.subqueries[0].ranking_query, sources=list(allowed))]
    return plan.model_copy(update={"subqueries": subs})


def _clean_env(settings: Settings, home: str) -> dict[str, str]:
    """Only what the engine needs. No LLM keys, so research topics are never sent to a third-party model."""
    keep = ("PATH", "SYSTEMROOT", "COMSPEC", "PATHEXT", "LANG", "LC_ALL", "TZ")
    env = {k: os.environ[k] for k in keep if k in os.environ}
    env.update({"HOME": home, "USERPROFILE": home, "TEMP": home, "TMP": home, "TMPDIR": home, "LAST30DAYS_ALLOW_ENGINE_PLAN": "1", "PYTHONIOENCODING": "utf-8"})
    if settings.github_token:
        env["GITHUB_TOKEN"] = settings.github_token
    if settings.x_bearer_token:
        env["X_BEARER_TOKEN"] = settings.x_bearer_token
    return env


def _extract_json(stdout: str) -> dict[str, Any]:
    start = stdout.find("{")
    if start < 0:
        raise ValueError("last30days printed no JSON")
    return json.loads(stdout[start:])


async def run_last30days(topic: str, days: int, plan: QueryPlan, settings: Settings) -> dict[str, Any]:
    script = settings.last30days_script
    if not script or not os.path.isfile(script):
        raise FileNotFoundError("LAST30DAYS_SCRIPT is not configured")
    with tempfile.TemporaryDirectory(prefix="l30-") as home:
        plan_path = os.path.join(home, "plan.json")
        with open(plan_path, "w", encoding="utf-8") as fh:
            fh.write(plan.model_dump_json())
        args = [settings.python_bin, script, topic, "--emit=json", "--json-profile=agent", f"--days={days}", "--plan", plan_path,
                "--no-browser-cookies", "--web-backend", "none", "--quick"]
        proc = await asyncio.create_subprocess_exec(*args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=_clean_env(settings, home), cwd=home)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=settings.pulse_timeout_s)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise TimeoutError(f"last30days exceeded {settings.pulse_timeout_s:.0f}s")
        if proc.returncode != 0:
            tail = err.decode("utf-8", "replace").strip().splitlines()[-3:]
            raise RuntimeError(f"last30days exited {proc.returncode}: {' | '.join(tail)[:300]}")
        return _extract_json(out.decode("utf-8", "replace"))


# ------------------------------------------------------------------ native lanes (official, keyless or OAuth)

def _strip_html(s: str) -> str:
    return " ".join(html.unescape(_TAG_RE.sub(" ", s or "")).split())


async def native_hn(client: httpx.AsyncClient, query: str, days: int, limit: int = 20) -> list[PulseItem]:
    since = int(time.time()) - days * 86400
    r = await client.get("https://hn.algolia.com/api/v1/search", params={"query": query, "tags": "story", "numericFilters": f"created_at_i>{since}", "hitsPerPage": limit})
    r.raise_for_status()
    items = []
    for h in r.json().get("hits", []):
        url = h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID')}"
        if not h.get("title") or not _http_url(url):
            continue
        items.append(PulseItem(source="hackernews", url=url, title=h["title"][:300], publishedAt=(h.get("created_at") or "")[:10] or None,
                               engagement=map_engagement({"points": h.get("points"), "num_comments": h.get("num_comments")}),
                               text=f"hn:{h.get('objectID')}"))
    return items


async def hn_top_comments(client: httpx.AsyncClient, item: PulseItem, n: int = 3) -> list[str]:
    story_id = item.text[3:] if item.text.startswith("hn:") else None
    if not story_id:
        r = await client.get("https://hn.algolia.com/api/v1/search", params={"query": item.url, "restrictSearchableAttributes": "url", "tags": "story", "hitsPerPage": 1})
        r.raise_for_status()
        hits = r.json().get("hits", [])
        story_id = hits[0].get("objectID") if hits else None
    if not story_id:
        return []
    r = await client.get(f"https://hn.algolia.com/api/v1/items/{story_id}")
    r.raise_for_status()
    texts = [_strip_html(c.get("text") or "") for c in r.json().get("children") or []]
    return [t[:400] for t in texts if len(t) > 20][:n]


async def reddit_token(client: httpx.AsyncClient, settings: Settings) -> str:
    r = await client.post("https://www.reddit.com/api/v1/access_token", data={"grant_type": "client_credentials"},
                          auth=(settings.reddit_client_id, settings.reddit_client_secret))
    r.raise_for_status()
    return r.json()["access_token"]


async def native_reddit(client: httpx.AsyncClient, settings: Settings, query: str, with_comments: bool, limit: int = 25) -> list[PulseItem]:
    token = await reddit_token(client, settings)
    headers = {"Authorization": f"bearer {token}"}
    r = await client.get("https://oauth.reddit.com/search", params={"q": query, "sort": "top", "t": "month", "limit": limit, "type": "link"}, headers=headers)
    r.raise_for_status()
    items = []
    for child in r.json().get("data", {}).get("children", []):
        d = child.get("data") or {}
        if d.get("over_18") or not d.get("title") or not d.get("permalink"):
            continue
        created = d.get("created_utc")
        items.append(PulseItem(
            source="reddit", url=f"https://www.reddit.com{d['permalink']}", title=d["title"][:300], text=(d.get("selftext") or "")[:1200],
            publishedAt=time.strftime("%Y-%m-%d", time.gmtime(created)) if isinstance(created, (int, float)) else None,
            engagement=map_engagement({"score": d.get("score"), "num_comments": d.get("num_comments")}),
            cluster=f"r/{d.get('subreddit')}" if d.get("subreddit") else None,
        ))
    if with_comments:
        for it in sorted(items, key=lambda i: i.engagement.primary or 0, reverse=True)[:3]:
            post_id = it.url.rstrip("/").split("/comments/")[-1].split("/")[0]
            try:
                c = await client.get(f"https://oauth.reddit.com/comments/{post_id}", params={"limit": 5, "sort": "top", "depth": 1}, headers=headers)
                c.raise_for_status()
                listing = c.json()[1]["data"]["children"]
                it.topComments = [str(x["data"].get("body", ""))[:400] for x in listing if x.get("kind") == "t1" and x["data"].get("body")][:3]
            except Exception:  # comments are an enrichment; the post stays without them
                pass
    return items


# ------------------------------------------------------------------ orchestration

async def run_pulse(req: PulseRequest, settings: Settings, runner: Runner = run_last30days, client: Optional[httpx.AsyncClient] = None) -> PulseResponse:
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=15, headers={"User-Agent": settings.user_agent}, follow_redirects=False)
    status: dict[str, str] = {}
    warnings: list[str] = []
    items: list[PulseItem] = []
    clusters: list[PulseCluster] = []
    engine = "last30days"
    plan = restrict_plan(req.plan, settings.l30_sources) if req.plan else default_plan(req.topic, settings.l30_sources)
    primary_query = plan.subqueries[0].search_query

    async def l30_lane():
        nonlocal engine, items, clusters
        try:
            data = await runner(req.topic, req.days, plan, settings)
            got, clusters, st = normalize_agent_export(data)
            status.update(st)
            items.extend(got)
        except Exception as exc:  # degrade to the native HN lane instead of failing the request
            engine = "native"
            warnings.append(f"last30days unavailable: {str(exc)[:200]}")
            try:
                items.extend(await native_hn(client, primary_query, req.days))
                status["hackernews"] = "ok"
            except Exception as hn_exc:
                status["hackernews"] = "error"
                warnings.append(f"hackernews: {str(hn_exc)[:200]}")

    async def reddit_lane():
        if not settings.reddit_enabled:
            status["reddit"] = "disabled"
            return
        try:
            items.extend(await native_reddit(client, settings, primary_query, req.withComments))
            status["reddit"] = "ok"
        except Exception as exc:
            status["reddit"] = "error"
            warnings.append(f"reddit: {str(exc)[:200]}")

    try:
        await asyncio.gather(l30_lane(), reddit_lane())
        if req.withComments:
            hn = sorted([i for i in items if i.source == "hackernews"], key=lambda i: i.engagement.primary or 0, reverse=True)[:4]
            results = await asyncio.gather(*(hn_top_comments(client, i) for i in hn), return_exceptions=True)
            for it, res in zip(hn, results):
                if isinstance(res, list):
                    it.topComments = res
    finally:
        if own_client:
            await client.aclose()

    for it in items:  # internal marker used for HN comment lookup
        if it.text.startswith("hn:"):
            it.text = ""
    seen: set[str] = set()
    unique = [i for i in items if not (i.url in seen or seen.add(i.url))]
    unique.sort(key=lambda i: ((i.relevance or 0), (i.engagement.primary or 0)), reverse=True)
    return PulseResponse(topic=req.topic, windowDays=req.days, engine=engine, sourceStatus=status, items=unique[: req.maxItems], clusters=clusters[:20], warnings=warnings)
