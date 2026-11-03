from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.models import SearchRequest
from app.search import run_search

NOW = datetime(2026, 11, 3, tzinfo=timezone.utc)


class FakeDDGS:
    def __init__(self, news=None, text=None, fail=()):
        self._news, self._text, self._fail, self.calls = news or [], text or [], set(fail), []

    def __call__(self):
        return self

    def news(self, q, **kw):
        self.calls.append(("news", q, kw))
        if "news" in self._fail:
            raise RuntimeError("ratelimit")
        return self._news

    def text(self, q, **kw):
        self.calls.append(("text", q, kw))
        if "text" in self._fail:
            raise RuntimeError("no results")
        return self._text


NEWS = [
    {"date": "2026-10-22T15:02:00+00:00", "title": "Right and wrong way to take creatine", "body": "Experts explain.", "url": "https://www.msn.com/a", "source": "MSN"},
    {"date": "2026-10-30T18:22:00+00:00", "title": "AG1 expands into creatine gummies", "body": "New formats.", "url": "https://www.forbes.com/b", "source": "Forbes"},
    {"date": "2025-01-01T00:00:00+00:00", "title": "Old story", "body": "stale", "url": "https://old.example.com/c", "source": "Old"},
    {"date": "2026-10-29", "title": "javascript link", "url": "javascript:alert(1)"},
]
TEXT = [
    {"title": "Creatine gummy lawsuits", "href": "https://legalhelp.us/x", "body": "Oct 8, 2026 · class action"},
    {"title": "Duplicate of forbes", "href": "https://www.forbes.com/b/", "body": "dup"},
]


def test_ddgs_news_and_web_normalised_filtered_and_sorted():
    fake = FakeDDGS(NEWS, TEXT)
    res = run_search(SearchRequest(queries=["creatine gummies"], days=30), Settings(secret="s"), ddgs_factory=fake, now=NOW)
    urls = [r.url for r in res.results]
    assert urls == ["https://www.forbes.com/b", "https://www.msn.com/a", "https://legalhelp.us/x"]  # newest news first, then web
    assert res.engines == ["ddgs"]
    first = res.results[0]
    assert first.publishedAt == "2026-10-30" and first.kind == "news" and first.source == "Forbes" and first.engine == "ddgs"
    assert res.results[2].kind == "web" and res.results[2].publishedAt is None
    assert {c[2]["timelimit"] for c in fake.calls} == {"m"}


def test_one_failing_kind_does_not_lose_the_other():
    res = run_search(SearchRequest(queries=["creatine"], days=7), Settings(secret="s"), ddgs_factory=FakeDDGS(NEWS, TEXT, fail={"news"}), now=NOW)
    assert [r.kind for r in res.results] == ["web", "web"][: len(res.results)] and res.results
    empty = run_search(SearchRequest(queries=["creatine"]), Settings(secret="s"), ddgs_factory=FakeDDGS(fail={"news", "text"}), now=NOW)
    assert empty.results == [] and empty.engines == [] and "no results" in empty.warnings[0]


def test_searxng_preferred_and_falls_back_to_ddgs():
    calls = []

    def http_get(url, params=None, **kw):
        calls.append((url, params))
        rows = [{"title": "SearX hit", "url": "https://news.site/1", "content": "c", "publishedDate": "2026-10-31T10:00:00"}] if params["categories"] == "news" else []
        return SimpleNamespace(status_code=200, json=lambda: {"results": rows})
    s = Settings(secret="s", searxng_url="http://127.0.0.1:8888/")
    res = run_search(SearchRequest(queries=["creatine"]), s, ddgs_factory=FakeDDGS(NEWS, TEXT), http_get=http_get, now=NOW)
    assert res.engines == ["searxng"] and [r.url for r in res.results] == ["https://news.site/1"]
    assert calls[0][0] == "http://127.0.0.1:8888/search" and calls[0][1]["format"] == "json" and calls[0][1]["time_range"] == "month"

    down = lambda url, **kw: SimpleNamespace(status_code=502, json=lambda: {})  # noqa: E731
    res2 = run_search(SearchRequest(queries=["creatine"]), s, ddgs_factory=FakeDDGS(NEWS, TEXT), http_get=down, now=NOW)
    assert res2.engines == ["ddgs"] and res2.results and any("searxng unavailable" in w for w in res2.warnings)


def test_request_validation():
    with pytest.raises(ValueError):
        SearchRequest(queries=[])
    with pytest.raises(ValueError):
        SearchRequest(queries=["a", "b", "c", "d"])
    assert SearchRequest(queries=["  creatine   gummies ", "creatine gummies"]).queries == ["creatine gummies"]
