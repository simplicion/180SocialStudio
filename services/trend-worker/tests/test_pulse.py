import asyncio
import json
import os

import httpx

from app.config import Settings
from app.models import PulseRequest, QueryPlan, Subquery
from app.pulse import _clean_env, default_plan, map_engagement, normalize_agent_export, restrict_plan, run_pulse

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "l30_agent_export.json")


def load_fixture():
    with open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)


def test_normalizes_real_last30days_output():
    items, clusters, status = normalize_agent_export(load_fixture())
    assert len(items) == 2
    first = items[0]
    assert first.source == "hackernews"
    assert first.url.startswith("https://")
    assert first.engagement.upvotes == 4 and first.engagement.comments == 1
    assert first.engagement.primary == 4
    assert 0 <= (first.relevance or 0) <= 1
    assert clusters and clusters[0].title
    assert status["hackernews"] == "ok"


def test_normalizer_drops_bad_rows_and_duplicates():
    data = {"results": [
        {"title": "ok", "url": "https://a.example/1", "source": "github", "engagement": {"stars": 10, "author_followers": 99999}},
        {"title": "dup", "url": "https://a.example/1", "source": "github"},
        {"title": "", "url": "https://a.example/2"},
        {"title": "js", "url": "javascript:alert(1)"},
        "garbage",
    ]}
    items, _, _ = normalize_agent_export(data)
    assert [i.title for i in items] == ["ok"]
    assert items[0].engagement.upvotes == 10
    assert "author_followers" not in items[0].engagement.raw


def test_engagement_mapping_prefers_views():
    e = map_engagement({"views": 1000, "likes": 50, "comments": 3, "engagement_rate": 0.2})
    assert e.primary == 1000 and e.likes == 50 and "engagement_rate" not in e.raw
    assert map_engagement({"volume": 2500.5}).primary == 2500.5
    assert map_engagement({"points": "NaN"}).primary is None


def test_plan_restricted_to_allowed_sources():
    plan = QueryPlan(subqueries=[
        Subquery(label="primary", search_query="creatine", ranking_query="what?", sources=["reddit", "tiktok", "hackernews"]),
        Subquery(label="tt", search_query="creatine tiktok", ranking_query="what?", sources=["tiktok", "instagram"]),
    ])
    out = restrict_plan(plan, ("hackernews", "polymarket", "github"))
    assert len(out.subqueries) == 1
    assert out.subqueries[0].sources == ["hackernews"]
    assert default_plan("x topic", ("hackernews",)).subqueries[0].sources == ["hackernews"]


def test_engine_env_has_no_llm_keys(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-should-not-leak")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "should-not-leak")
    env = _clean_env(Settings(secret="s"), "/tmp/h")
    assert "OPENAI_API_KEY" not in env and "ANTHROPIC_API_KEY" not in env
    assert env["LAST30DAYS_ALLOW_ENGINE_PLAN"] == "1" and env["HOME"] == "/tmp/h"


def _mock_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_run_pulse_uses_engine_and_enriches_hn_comments():
    async def runner(topic, days, plan, settings):
        assert plan.subqueries[0].sources == ["hackernews", "polymarket", "github"]
        return load_fixture()

    def handler(request: httpx.Request):
        if request.url.path == "/api/v1/search":
            return httpx.Response(200, json={"hits": [{"objectID": "123"}]})
        if request.url.path == "/api/v1/items/123":
            return httpx.Response(200, json={"children": [{"text": "<p>I take 5g daily and it really helped my recovery.</p>"}, {"text": "short"}]})
        return httpx.Response(404)

    async def go():
        async with _mock_client(handler) as client:
            return await run_pulse(PulseRequest(topic="creatine for women"), Settings(secret="s"), runner=runner, client=client)

    res = asyncio.run(go())
    assert res.engine == "last30days"
    assert res.sourceStatus["reddit"] == "disabled"
    assert any(i.topComments for i in res.items)
    assert all(len(c) > 20 for i in res.items for c in i.topComments)


def test_run_pulse_falls_back_to_native_hn_when_engine_fails():
    async def runner(*_):
        raise FileNotFoundError("LAST30DAYS_SCRIPT is not configured")

    def handler(request: httpx.Request):
        if request.url.path == "/api/v1/search":
            return httpx.Response(200, json={"hits": [
                {"objectID": "9", "title": "Show HN: creatine tracker", "url": "https://x.example/c", "points": 42, "num_comments": 7, "created_at": "2026-10-20T00:00:00Z"},
                {"objectID": "10", "title": "", "url": "https://x.example/d"},
            ]})
        if request.url.path == "/api/v1/items/9":
            return httpx.Response(200, json={"children": []})
        return httpx.Response(404)

    async def go():
        async with _mock_client(handler) as client:
            return await run_pulse(PulseRequest(topic="creatine"), Settings(secret="s"), runner=runner, client=client)

    res = asyncio.run(go())
    assert res.engine == "native"
    assert [i.title for i in res.items] == ["Show HN: creatine tracker"]
    assert res.items[0].engagement.upvotes == 42 and res.items[0].text == ""
    assert any("last30days unavailable" in w for w in res.warnings)


def test_reddit_lane_uses_official_oauth_when_configured():
    calls = []

    def handler(request: httpx.Request):
        calls.append(str(request.url))
        if request.url.host == "www.reddit.com":
            assert request.headers["authorization"].startswith("Basic ")
            return httpx.Response(200, json={"access_token": "tok"})
        if request.url.path == "/search":
            assert request.headers["authorization"] == "bearer tok"
            return httpx.Response(200, json={"data": {"children": [
                {"data": {"title": "Creatine made me bloated?", "permalink": "/r/xxfitness/comments/abc/creatine/", "score": 812, "num_comments": 240, "created_utc": 1761000000, "subreddit": "xxfitness"}},
                {"data": {"title": "nsfw", "permalink": "/r/x/comments/zzz/", "over_18": True}},
            ]}})
        if request.url.path.startswith("/comments/abc"):
            return httpx.Response(200, json=[{}, {"data": {"children": [{"kind": "t1", "data": {"body": "Bloating went away after two weeks for me."}}]}}])
        return httpx.Response(200, json={"hits": []})

    async def runner(*_):
        return {"results": [], "clusters": [], "source_status": {}}

    async def go():
        async with _mock_client(handler) as client:
            return await run_pulse(PulseRequest(topic="creatine"), Settings(secret="s", reddit_client_id="id", reddit_client_secret="sec"), runner=runner, client=client)

    res = asyncio.run(go())
    assert res.sourceStatus["reddit"] == "ok"
    assert len(res.items) == 1 and res.items[0].source == "reddit"
    assert res.items[0].url == "https://www.reddit.com/r/xxfitness/comments/abc/creatine/"
    assert res.items[0].topComments == ["Bloating went away after two weeks for me."]
    assert any("oauth.reddit.com/search" in c for c in calls)
