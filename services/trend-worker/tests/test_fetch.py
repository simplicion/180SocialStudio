from types import SimpleNamespace

from app.config import Settings
from app.fetch import fetch_page, html_to_markdown

PUBLIC = lambda host: ["93.184.216.34"]  # noqa: E731
ARTICLE = ("<html><head><title>Creatine and women</title><script>steal()</script></head><body><nav>Home | About</nav>"
           "<article><h1>Creatine and women</h1>" + "<p>New trials suggest creatine helps muscle in midlife women. </p>" * 10 + "</article>"
           "<footer>Cookie policy</footer></body></html>")


def fake_getter(responses):
    calls = []

    def get(url, **kwargs):
        calls.append((url, kwargs))
        r = responses.get(url)
        if isinstance(r, Exception):
            raise r
        return r or SimpleNamespace(status=404, body=b"", url=url, headers={})
    get.calls = calls
    return get


def page(body, status=200, ctype="text/html; charset=utf-8", url="https://news.example.com/a"):
    return SimpleNamespace(status=status, body=body.encode() if isinstance(body, str) else body, url=url, headers={"content-type": ctype}, encoding="utf-8")


def test_markdown_keeps_article_drops_chrome():
    title, md, truncated = html_to_markdown(ARTICLE, 8000)
    assert title == "Creatine and women"
    assert "# Creatine and women" in md and "midlife women" in md
    assert "steal()" not in md and "Cookie policy" not in md and "Home | About" not in md
    assert not truncated
    _, short, cut = html_to_markdown(ARTICLE, 50)
    assert len(short) == 50 and cut


def test_fetch_ok_uses_safe_redirects_and_honest_agent():
    g = fake_getter({"https://news.example.com/a": page(ARTICLE)})
    res = fetch_page("https://news.example.com/a", Settings(secret="s"), getter=g, resolver=PUBLIC)
    assert res.ok and res.title == "Creatine and women"
    url, kwargs = g.calls[-1]
    assert kwargs["follow_redirects"] == "safe" and kwargs["max_redirects"] == 3
    assert kwargs["stealthy_headers"] is False and "180StudioResearchBot" in kwargs["headers"]["User-Agent"]


def test_fetch_blocks_private_targets_without_requesting():
    g = fake_getter({})
    res = fetch_page("http://169.254.169.254/latest/meta-data/", Settings(secret="s"), getter=g, resolver=PUBLIC)
    assert not res.ok and res.error.startswith("blocked")
    assert g.calls == []


def test_fetch_honours_robots_txt():
    robots = page("User-agent: *\nDisallow: /private/\n", ctype="text/plain", url="https://news.example.com/robots.txt")
    g = fake_getter({"https://news.example.com/robots.txt": robots, "https://news.example.com/private/x": page(ARTICLE)})
    res = fetch_page("https://news.example.com/private/x", Settings(secret="s"), getter=g, resolver=PUBLIC)
    assert not res.ok and "robots" in res.error
    assert all(u != "https://news.example.com/private/x" for u, _ in g.calls)


def test_fetch_rejects_non_html_errors_and_thin_pages():
    s = Settings(secret="s")
    assert fetch_page("https://x.example.com/f.pdf", s, getter=fake_getter({"https://x.example.com/f.pdf": page(b"%PDF", ctype="application/pdf")}), resolver=PUBLIC).error.startswith("unsupported")
    assert fetch_page("https://x.example.com/404", s, getter=fake_getter({}), resolver=PUBLIC).error == "HTTP 404"
    assert fetch_page("https://x.example.com/t", s, getter=fake_getter({"https://x.example.com/t": page("<p>hi</p>")}), resolver=PUBLIC).error == "no readable article text"
    boom = fake_getter({"https://x.example.com/e": TimeoutError("slow")})
    assert fetch_page("https://x.example.com/e", s, getter=boom, resolver=PUBLIC).error.startswith("fetch failed")


def test_fetch_caps_body_bytes():
    s = Settings(secret="s", fetch_max_bytes=300)
    res = fetch_page("https://news.example.com/a", s, getter=fake_getter({"https://news.example.com/a": page(ARTICLE)}), resolver=PUBLIC)
    assert not res.ok  # cut before the article body, so nothing readable survives
