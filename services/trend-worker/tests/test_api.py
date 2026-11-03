from fastapi.testclient import TestClient

import app.main as main
from app.models import FetchedPage, PulseResponse

client = TestClient(main.app)
AUTH = {"X-Worker-Secret": "test-secret"}


def test_health_is_open_and_leaks_nothing():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and "test-secret" not in r.text
    assert "reddit" not in body["sources"]


def test_endpoints_require_secret():
    assert client.post("/pulse", json={"topic": "creatine"}).status_code == 401
    assert client.post("/pulse", json={"topic": "creatine"}, headers={"X-Worker-Secret": "wrong"}).status_code == 401
    assert client.post("/fetch", json={"urls": ["https://example.com"]}).status_code == 401


def test_pulse_validates_input(monkeypatch):
    assert client.post("/pulse", json={"topic": "x"}, headers=AUTH).status_code == 422
    assert client.post("/pulse", json={"topic": "creatine", "days": 400}, headers=AUTH).status_code == 422

    async def fake_run(req, s):
        return PulseResponse(topic=req.topic, windowDays=req.days, engine="native")
    monkeypatch.setattr(main, "run_pulse", fake_run)
    r = client.post("/pulse", json={"topic": "  creatine   for women "}, headers=AUTH)
    assert r.status_code == 200 and r.json()["topic"] == "creatine for women"


def test_fetch_limits_and_dedupes(monkeypatch):
    assert client.post("/fetch", json={"urls": [f"https://e.com/{i}" for i in range(7)]}, headers=AUTH).status_code == 422
    seen = []
    monkeypatch.setattr(main, "fetch_page", lambda u, s: seen.append(u) or FetchedPage(url=u, ok=False, error="x"))
    r = client.post("/fetch", json={"urls": ["https://e.com/a", "https://e.com/a", "https://e.com/b"]}, headers=AUTH)
    assert r.status_code == 200 and seen == ["https://e.com/a", "https://e.com/b"]


def test_search_requires_secret_and_validates(monkeypatch):
    assert client.post("/search", json={"queries": ["creatine"]}).status_code == 401
    assert client.post("/search", json={"queries": []}, headers=AUTH).status_code == 422
    from app.models import SearchResponse
    monkeypatch.setattr(main, "run_search", lambda req, s: SearchResponse(results=[], engines=["ddgs"]))
    r = client.post("/search", json={"queries": ["creatine"], "days": 30}, headers=AUTH)
    assert r.status_code == 200 and r.json()["engines"] == ["ddgs"]


def test_health_reports_search_and_browser():
    body = client.get("/health").json()
    assert body["search"] in ("ddgs", "searxng+ddgs") and body["browser"] in (True, False)
