from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import main
from app.diarize import Segment, _tracks, normalize_segments


class FakeAnnotation:
    def __init__(self, tracks):
        self.tracks = tracks

    def __len__(self):
        return len(self.tracks)

    def itertracks(self, yield_label=False):
        for s, e, label in self.tracks:
            yield SimpleNamespace(start=s, end=e), None, label


def test_labels_are_renamed_in_order_of_first_appearance_and_turns_merged():
    segs = normalize_segments([
        (5.0, 7.0, "SPEAKER_03"),
        (0.0, 2.0, "SPEAKER_03"),
        (2.1, 4.0, "SPEAKER_03"),  # 100 ms gap: same turn
        (4.0, 5.0, "SPEAKER_00"),
        (7.0, 7.05, "SPEAKER_01"),  # 50 ms sliver: dropped
    ])
    assert segs == [Segment("S1", 0, 4000), Segment("S2", 4000, 5000), Segment("S1", 5000, 7000)]


def test_exclusive_view_is_preferred_and_an_empty_one_is_not_skipped():
    out = SimpleNamespace(
        exclusive_speaker_diarization=FakeAnnotation([(0, 1, "A")]),
        speaker_diarization=FakeAnnotation([(0, 1, "A"), (0.5, 1.5, "B")]),
    )
    assert list(_tracks(out)) == [(0.0, 1.0, "A")]
    empty = SimpleNamespace(exclusive_speaker_diarization=FakeAnnotation([]), speaker_diarization=FakeAnnotation([(0, 1, "A")]))
    assert list(_tracks(empty)) == []
    assert list(_tracks(FakeAnnotation([(1, 2, "X")]))) == [(1.0, 2.0, "X")]  # pyannote 3.x returns a bare Annotation


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main.model, "pipeline", object())
    monkeypatch.setattr(main, "decode_audio", lambda data: np.zeros(main.SAMPLE_RATE * 10, dtype=np.float32))
    calls = {}

    def fake_run(pipeline, samples, n, lo, hi):
        calls.update(n=n, lo=lo, hi=hi)
        return [Segment("S1", 0, 4000), Segment("S2", 4000, 9000)]

    monkeypatch.setattr(main, "run_diarization", fake_run)
    c = TestClient(main.app)
    c.calls = calls
    return c


def test_diarize_returns_segments(client):
    r = client.post("/diarize", files={"audio": ("a.m4a", b"xx", "audio/mp4")}, data={"max_speakers": "3"},
                    headers={"X-Worker-Secret": "test-secret"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["speakers"] == 2
    assert body["segments"][1] == {"speaker": "S2", "startMs": 4000, "endMs": 9000}
    assert client.calls == {"n": None, "lo": None, "hi": 3}


def test_secret_is_required(client):
    r = client.post("/diarize", files={"audio": ("a.m4a", b"xx", "audio/mp4")}, headers={"X-Worker-Secret": "wrong"})
    assert r.status_code == 401


def test_bad_speaker_count_is_rejected(client):
    r = client.post("/diarize", files={"audio": ("a.m4a", b"xx", "audio/mp4")}, data={"num_speakers": "99"},
                    headers={"X-Worker-Secret": "test-secret"})
    assert r.status_code == 422


def test_503_while_the_model_is_not_loaded(monkeypatch):
    monkeypatch.setattr(main.model, "pipeline", None)
    monkeypatch.setattr(main.model, "loading", True)
    r = TestClient(main.app).post("/diarize", files={"audio": ("a.m4a", b"xx", "audio/mp4")}, headers={"X-Worker-Secret": "test-secret"})
    assert r.status_code == 503
    h = TestClient(main.app).get("/health").json()
    assert h["ready"] is False and h["loading"] is True
