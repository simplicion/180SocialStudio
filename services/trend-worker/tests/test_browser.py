from types import SimpleNamespace

import pytest

from app.browser import MAX_REQUESTS_PER_PAGE, Blocked, _resolve_entry, pinned_fetch
from app.config import Settings
from app.fetch import fetch_page

PUBLIC = lambda host: ["93.184.216.34"]  # noqa: E731
S = Settings(secret="s")


def requester_spy():
    calls = []

    def req(method, url, **kw):
        calls.append((method, url, kw))
        return SimpleNamespace(status_code=200, headers={"Content-Type": "text/javascript", "Content-Encoding": "gzip"}, content=b"ok();")
    req.calls = calls
    return req


def test_subrequest_is_pinned_to_the_checked_address_with_honest_agent():
    spy = requester_spy()
    budget = {"requests": 0, "bytes": 0}
    status, headers, body = pinned_fetch("GET", "https://cdn.example.com/app.js", {"Host": "evil", "Accept": "*/*"}, None, S, budget, PUBLIC, spy)
    assert status == 200 and body == b"ok();" and "content-encoding" not in headers
    _, url, kw = spy.calls[0]
    assert kw["pinned"] == ["cdn.example.com:443:93.184.216.34"]
    assert kw["allow_redirects"] is False and "Host" not in kw["headers"] and "180StudioResearchBot" in kw["headers"]["User-Agent"]
    assert budget == {"requests": 1, "bytes": 5}


@pytest.mark.parametrize("url", ["http://127.0.0.1/admin", "http://169.254.169.254/latest/", "https://example.com:8443/x", "file:///etc/passwd", "http://metadata.internal/x"])
def test_private_and_odd_targets_are_never_requested(url):
    spy = requester_spy()
    with pytest.raises(Blocked):
        pinned_fetch("GET", url, {}, None, S, {"requests": 0, "bytes": 0}, PUBLIC, spy)
    assert spy.calls == []


def test_rebinding_host_is_blocked_at_check_time():
    spy = requester_spy()
    with pytest.raises(Blocked):
        pinned_fetch("GET", "https://rebind.example.com/", {}, None, S, {"requests": 0, "bytes": 0}, lambda h: ["93.184.216.34", "10.0.0.5"], spy)
    assert spy.calls == []


def test_budgets_and_methods():
    spy = requester_spy()
    with pytest.raises(Blocked):
        pinned_fetch("GET", "https://a.example.com/", {}, None, S, {"requests": MAX_REQUESTS_PER_PAGE, "bytes": 0}, PUBLIC, spy)
    with pytest.raises(Blocked):
        pinned_fetch("PUT", "https://a.example.com/", {}, None, S, {"requests": 0, "bytes": 0}, PUBLIC, spy)
    assert spy.calls == []


def test_ipv6_pin_format():
    assert _resolve_entry("http://v6.example.com/x", ["2606:2800::1"]) == ["v6.example.com:80:[2606:2800::1]"]


SHELL = "<html><head><title>App</title></head><body><div id=root></div><script src='/app.js'></script></body></html>"
RENDERED = "<html><head><title>Rendered</title></head><body><article>" + "<p>Text that only exists after JavaScript ran. </p>" * 10 + "</article></body></html>"


def _getter(url, **kw):
    if url.endswith("robots.txt"):
        return SimpleNamespace(status=404, body=b"", url=url, headers={})
    return SimpleNamespace(status=200, body=SHELL.encode(), url=url, headers={"content-type": "text/html"}, encoding="utf-8")


def test_js_only_page_falls_back_to_renderer():
    seen = []
    res = fetch_page("https://spa.example.com/post", S, getter=_getter, resolver=PUBLIC, renderer=lambda u, s: seen.append(u) or RENDERED)
    assert res.ok and res.rendered and res.title == "Rendered" and "after JavaScript ran" in res.markdown
    assert seen == ["https://spa.example.com/post"]


def test_renderer_never_used_for_blocked_or_robots_or_when_disabled():
    called = []
    r = lambda u, s: called.append(u) or RENDERED  # noqa: E731
    assert not fetch_page("http://10.0.0.1/x", S, getter=_getter, resolver=PUBLIC, renderer=r).ok
    disallow = lambda url, **kw: (SimpleNamespace(status=200, body=b"User-agent: *\nDisallow: /", url=url, headers={}) if url.endswith("robots.txt") else _getter(url))  # noqa: E731
    assert not fetch_page("https://spa.example.com/post", S, getter=disallow, resolver=PUBLIC, renderer=r).ok
    assert called == []
    # Default (no renderer injected) with TREND_WORKER_BROWSER unset: static result returned unchanged.
    res = fetch_page("https://spa.example.com/post", S, getter=_getter, resolver=PUBLIC)
    assert not res.ok and res.error == "no readable article text" and not res.rendered


def test_renderer_failure_returns_static_result():
    def boom(u, s):
        raise RuntimeError("chromium missing")
    res = fetch_page("https://spa.example.com/post", S, getter=_getter, resolver=PUBLIC, renderer=boom)
    assert not res.ok and res.error == "no readable article text"
