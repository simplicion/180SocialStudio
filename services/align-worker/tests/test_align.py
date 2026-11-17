import json
import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import align as A
from app import main
from app.ctc import AlignmentError, forced_align, min_frames

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ'"
VOCAB = {"<pad>": 0, "|": 1, **{c: i + 2 for i, c in enumerate(LETTERS)}}


def emissions(T, active, vocab_size=len(VOCAB), p=0.9):
    """[T, V] log-probs: frame t emits active[t] (a token id) with probability p, else blank with p."""
    lp = np.full((T, vocab_size), np.log((1 - p) / (vocab_size - 1)), dtype=np.float32)
    for t in range(T):
        lp[t, active.get(t, 0)] = np.log(p)
    return lp


class FakeModel:
    """Speaks `script` = [(word, start s, end s)]: each word's letters spread evenly over its time, blanks elsewhere."""

    frame_sec = 0.02
    blank = 0
    vocab = VOCAB

    def __init__(self, script):
        self.script = script
        self.calls = []

    def log_probs(self, samples):
        T = int(round(len(samples) / A.SAMPLE_RATE / self.frame_sec))
        offset = self._offset
        active = {}
        for word, s, e in self.script:
            letters = [VOCAB[c] for c in word.upper()]
            f0, f1 = int(round((s - offset) / self.frame_sec)), int(round((e - offset) / self.frame_sec))
            n = max(1, f1 - f0)
            for k in range(n):
                t = f0 + k
                if 0 <= t < T:
                    active[t] = letters[min(len(letters) - 1, k * len(letters) // n)]
        self.calls.append((offset, T))
        return emissions(T, active)


def run_align(script, words, duration, language="en"):
    model = FakeModel(script)
    aligner = A.Aligner(loader=lambda mid, rev: model)
    samples = np.zeros(int(duration * A.SAMPLE_RATE), dtype=np.float32)
    return aligner_align_with_offsets(aligner, model, samples, words, language), model


def aligner_align_with_offsets(aligner, model, samples, words, language):
    """Aligner.align, with the fake model told which window it is decoding (the real model just sees audio)."""
    orig = model.log_probs
    starts = iter([w0 for w0, _, _ in A._windows(
        [{"text": w["text"], "startMs": w.get("startMs", 0), "endMs": w.get("endMs", 0)} for w in words],
        len(samples) / A.SAMPLE_RATE, any(w.get("endMs", 0) > 0 for w in words))])

    def lp(seg):
        model._offset = next(starts)
        return orig(seg)

    model.log_probs = lp
    return aligner.align(samples, words, language)


# ── CTC core ──

def test_forced_align_places_tokens_where_they_are_emitted():
    active = {**{t: 2 for t in range(10, 14)}, **{t: 3 for t in range(20, 22)}, **{t: 3 for t in range(25, 27)}}
    spans = forced_align(emissions(40, active), [2, 3, 3])
    assert [(s.start, s.end) for s in spans] == [(10, 14), (20, 22), (25, 27)]
    assert all(s.score > 0.8 for s in spans)


def test_repeated_tokens_need_a_blank_and_short_audio_is_rejected():
    assert min_frames([2, 2, 3]) == 4
    with pytest.raises(AlignmentError):
        forced_align(emissions(3, {}), [2, 2, 3])
    spans = forced_align(emissions(4, {}), [2, 2, 3])  # exactly enough frames
    assert len(spans) == 3 and spans[0].end <= spans[1].start


def test_word_tokens_follow_the_model_case_and_drop_unknown_characters():
    assert A.word_tokens("Don't!", VOCAB) == [VOCAB["D"], VOCAB["O"], VOCAB["N"], VOCAB["'"], VOCAB["T"]]
    assert A.word_tokens("café", VOCAB) == [VOCAB[c] for c in "CAFE"]
    assert A.word_tokens("42", VOCAB) == []


# ── alignment of word lists ──

SCRIPT = [("hello", 0.50, 0.90), ("big", 1.10, 1.30), ("world", 1.60, 2.10)]


def test_transcript_only_alignment_recovers_word_times():
    words = [{"text": t, "startMs": 0, "endMs": 0} for t, _, _ in SCRIPT]
    res, _ = run_align(SCRIPT, words, 3.0)
    for w, (_, s, e) in zip(res.words, SCRIPT):
        assert w["aligned"]
        assert abs(w["startMs"] - s * 1000) <= 20 and abs(w["endMs"] - e * 1000) <= 20, w


def test_provider_times_are_refined_and_a_far_move_is_refused():
    # provider times 120 ms late on every word; "world" wrong by 1.5 s (would be a transcript error)
    words = [{"text": "hello", "startMs": 620, "endMs": 1020}, {"text": "big", "startMs": 1220, "endMs": 1420},
             {"text": "world", "startMs": 3100, "endMs": 3600}]
    res, _ = run_align(SCRIPT, words, 4.0)
    assert abs(res.words[0]["startMs"] - 500) <= 20 and abs(res.words[1]["startMs"] - 1100) <= 20
    assert res.words[2]["aligned"] is False and res.words[2]["startMs"] == 3100


def test_unalignable_words_keep_order_and_fill_gaps():
    script = [("one", 0.5, 0.8), ("two", 1.4, 1.7)]
    words = [{"text": "one", "startMs": 0, "endMs": 0}, {"text": "42", "startMs": 0, "endMs": 0}, {"text": "two", "startMs": 0, "endMs": 0}]
    res, _ = run_align(script, words, 2.5)
    mid = res.words[1]
    assert not mid["aligned"]
    assert res.words[0]["endMs"] <= mid["startMs"] <= mid["endMs"] <= res.words[2]["startMs"]


def test_long_audio_is_aligned_in_windows_under_the_limit():
    # 76 s of speech; no doubled letters (the fake emitter cannot put a blank inside a word)
    script = [(f"Z{'ABCDEFGHIJKLMNOP'[i % 16]}Y", 1.0 + i * 1.5, 1.4 + i * 1.5) for i in range(50)]
    words = [{"text": w, "startMs": s * 1000 + 50, "endMs": e * 1000 + 50} for w, s, e in script]
    res, model = run_align(script, words, 80.0)
    assert res.windows >= 3
    assert all(T * model.frame_sec <= A.WINDOW_SEC + 0.05 for _, T in model.calls)
    assert all(w["aligned"] for w in res.words)
    assert max(abs(w["startMs"] - s * 1000) for w, (_, s, _) in zip(res.words, script)) <= 20


def test_calibration_offsets_apply_and_touching_words_meet_in_the_middle():
    script = [("one", 0.50, 0.80), ("two", 0.84, 1.20)]  # 40 ms gap
    model = FakeModel(script)
    model.calibration_ms = (-50.0, 30.0)
    aligner = A.Aligner(loader=lambda mid, rev: model)
    samples = np.zeros(int(2.0 * A.SAMPLE_RATE), dtype=np.float32)
    words = [{"text": t, "startMs": 0, "endMs": 0} for t, _, _ in script]
    res = aligner_align_with_offsets(aligner, model, samples, words, "en")
    a, b = res.words
    assert abs(a["startMs"] - 450) <= 20 and abs(b["endMs"] - 1230) <= 20
    # end of "one" (+30) and start of "two" (-50) would overlap: they meet between the two
    assert a["endMs"] == b["startMs"] and 800 <= a["endMs"] <= 840


# ── HTTP ──

@pytest.fixture
def client(monkeypatch):
    model = FakeModel(SCRIPT)
    model._offset = 0.0
    fake = A.Aligner(loader=lambda mid, rev: model)
    fake.model("en")
    monkeypatch.setattr(main, "aligner", fake)
    monkeypatch.setattr(main, "decode_audio", lambda data: np.zeros(A.SAMPLE_RATE * 3, dtype=np.float32))
    return TestClient(main.app)


def post(client, words, language="en", secret="test-secret"):
    return client.post("/align", files={"audio": ("a.m4a", b"xx", "audio/mp4")},
                       data={"words": json.dumps(words), "language": language}, headers={"X-Worker-Secret": secret})


def test_align_endpoint_returns_refined_words(client):
    r = post(client, [{"text": t, "startMs": int(s * 1000) + 80, "endMs": int(e * 1000) + 80} for t, s, e in SCRIPT])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["alignedRatio"] == 1 and body["model"] == "facebook/wav2vec2-base-960h"
    assert abs(body["words"][0]["startMs"] - 500) <= 20


def test_secret_language_and_input_are_checked(client):
    assert post(client, [], secret="nope").status_code == 401
    assert post(client, [{"text": "hola", "startMs": 0, "endMs": 1}], language="sw").status_code == 422
    r = client.post("/align", files={"audio": ("a.m4a", b"xx", "audio/mp4")}, data={"words": "{not json", "language": "en"},
                    headers={"X-Worker-Secret": "test-secret"})
    assert r.status_code == 422


def test_a_language_whose_model_is_not_loaded_answers_503(client, monkeypatch):
    started = []
    monkeypatch.setattr(main, "_load_in_background", lambda lang: started.append(lang))
    r = post(client, [{"text": "hallo", "startMs": 0, "endMs": 100}], language="de")
    assert r.status_code == 503 and started == ["de"]


def test_health_lists_languages(client):
    body = client.get("/health").json()
    assert {"en", "de", "es", "fr", "it", "pt", "ru"} <= set(body["languages"])


# ── the real model (run once by hand: ALIGN_RUN_MODEL_TESTS=1; downloads ~360 MB) ──

@pytest.mark.model
@pytest.mark.skipif(os.environ.get("ALIGN_RUN_MODEL_TESTS") != "1", reason="set ALIGN_RUN_MODEL_TESTS=1 to run the real model")
def test_real_english_model_loads_and_aligns_silence_without_crashing():
    aligner = A.Aligner()
    samples = (np.random.default_rng(0).standard_normal(A.SAMPLE_RATE * 2) * 0.01).astype(np.float32)
    res = aligner.align(samples, [{"text": "hello", "startMs": 0, "endMs": 0}], "en")
    assert len(res.words) == 1 and res.words[0]["endMs"] >= res.words[0]["startMs"]
