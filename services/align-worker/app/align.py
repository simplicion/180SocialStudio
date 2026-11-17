"""Word-timing refinement: align a known transcript to the audio with a CTC acoustic model.

The STT provider gives words with times that can be 100+ ms off. Here the words (text + provider times) are aligned to
the audio again with a wav2vec2 CTC model, character by character, which puts each word's start and end on the audio.

Models (all Apache-2.0, see LICENSES.md; NOT Meta MMS, whose weights are CC-BY-NC-4.0):
  en  facebook/wav2vec2-base-960h
  de, es, fr, it, pt, ru  jonatasgrosman/wav2vec2-large-xlsr-53-<language>
Other languages: the provider times are returned unchanged (the backend then reports alignment "unsupported").
ALIGN_MODEL_<LANG> (e.g. ALIGN_MODEL_HI=<hf id>) adds or replaces one; check its licence first.

Long audio is aligned in windows of at most WINDOW_SEC, cut between words at the provider times with PAD_SEC of
audio either side, so each model call stays short (memory and accuracy both suffer on very long CTC windows).
A word the model cannot place (no letters in its vocabulary, e.g. "42" or an emoji) keeps its provider time, or sits in
the gap between its aligned neighbours when there are no provider times. A word the aligner moves by more than
MAX_SHIFT_SEC from its provider time keeps the provider time: that happens when the transcript is wrong there, and the
provider is then the better guess.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import threading
import unicodedata
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np

from .ctc import AlignmentError, forced_align, min_frames

log = logging.getLogger("align-worker")

SAMPLE_RATE = 16_000
WINDOW_SEC = float(os.environ.get("ALIGN_WINDOW_SEC", "30"))
PAD_SEC = 1.0
MAX_SHIFT_SEC = float(os.environ.get("ALIGN_MAX_SHIFT_SEC", "1.0"))

# (model id, pinned revision). Revisions pin the exact weights whose licence was checked (LICENSES.md).
DEFAULT_MODELS: dict[str, tuple[str, str | None]] = {
    "en": ("facebook/wav2vec2-base-960h", "22aad52d435eb6dbaf354bdad9b0da84ce7d6156"),
    "de": ("jonatasgrosman/wav2vec2-large-xlsr-53-german", "4b8a02957378d0f2da2ef74091156b032c485a89"),
    "es": ("jonatasgrosman/wav2vec2-large-xlsr-53-spanish", "96d7e9b4e4a78af515a3c6d3cee7c0826045d276"),
    "fr": ("jonatasgrosman/wav2vec2-large-xlsr-53-french", "7c79e105a6525d38e1e69f640b974b4a679723cc"),
    "it": ("jonatasgrosman/wav2vec2-large-xlsr-53-italian", "dab04a3e00d8326052f3fb22a6ff276b822f6131"),
    "pt": ("jonatasgrosman/wav2vec2-large-xlsr-53-portuguese", "634ac655299bcdc46c83bc01da9bab52d2987e4f"),
    "ru": ("jonatasgrosman/wav2vec2-large-xlsr-53-russian", "2329100508896c6d9b157019803ab5601e6f3406"),
}


def model_for(language: str) -> tuple[str, str | None] | None:
    lang = (language or "").lower().split("-")[0]
    override = os.environ.get(f"ALIGN_MODEL_{lang.upper()}")
    if override:
        return override, None
    return DEFAULT_MODELS.get(lang)


class AudioDecodeError(Exception):
    pass


def _ffmpeg() -> str | None:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:  # local runs on machines without ffmpeg on PATH (pip install static-ffmpeg)
        from static_ffmpeg import run  # type: ignore

        return run.get_or_fetch_platform_executables_else_raise()[0]
    except Exception:
        return None


def decode_audio(data: bytes, ffmpeg: str | None = None, timeout_s: float = 120) -> np.ndarray:
    """Any container / codec the phone sends -> mono float32 at 16 kHz."""
    exe = ffmpeg or _ffmpeg()
    if not exe:
        raise AudioDecodeError("ffmpeg is not installed on the server")
    try:
        out = subprocess.run(
            [exe, "-nostdin", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
             "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1"],
            input=data, capture_output=True, timeout=timeout_s, check=False,
        )
    except subprocess.TimeoutExpired as e:
        raise AudioDecodeError("audio decoding timed out") from e
    if out.returncode != 0 or not out.stdout:
        raise AudioDecodeError(f"could not decode audio: {out.stderr.decode(errors='ignore')[:200]}")
    return np.frombuffer(out.stdout, dtype=np.float32).copy()


class AcousticModel(Protocol):
    """What alignment needs from a model: per-frame log-probabilities and its character vocabulary."""

    vocab: dict[str, int]
    blank: int
    frame_sec: float

    def log_probs(self, samples: np.ndarray) -> np.ndarray: ...


class Wav2Vec2Model:
    def __init__(self, model_id: str, revision: str | None = None, threads: int | None = None):
        import torch  # heavy imports only when a real model is used
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

        if threads:
            torch.set_num_threads(threads)
        self._torch = torch
        self.processor = Wav2Vec2Processor.from_pretrained(model_id, revision=revision)
        self.model = Wav2Vec2ForCTC.from_pretrained(model_id, revision=revision).eval()
        self.vocab = {k: v for k, v in self.processor.tokenizer.get_vocab().items()}
        self.blank = self.processor.tokenizer.pad_token_id
        ratio = getattr(self.model.config, "inputs_to_logits_ratio", 320)
        self.frame_sec = ratio / SAMPLE_RATE
        self.model_id = model_id

    def log_probs(self, samples: np.ndarray) -> np.ndarray:
        torch = self._torch
        inputs = self.processor(samples, sampling_rate=SAMPLE_RATE, return_tensors="pt")
        with torch.inference_mode():
            logits = self.model(inputs.input_values).logits[0]
        return torch.log_softmax(logits.float(), dim=-1).numpy()


def _strip_accents(ch: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c))


def word_tokens(text: str, vocab: dict[str, int]) -> list[int]:
    """Vocabulary ids of a word's letters (the model's case; accents dropped when the model has no accented letter)."""
    upper = any(k.isalpha() and k.isupper() for k in vocab) and not any(k.isalpha() and k.islower() for k in vocab)
    out: list[int] = []
    for ch in unicodedata.normalize("NFC", text):
        ch = ch.upper() if upper else ch.lower()
        if ch in ("’", "ʼ"):
            ch = "'"
        if ch in vocab and ch not in ("|", " "):
            out.append(vocab[ch])
            continue
        base = _strip_accents(ch)
        if base and base in vocab and base != ch:
            out.append(vocab[base])
    return out


@dataclass
class AlignResult:
    words: list[dict[str, Any]]
    aligned: int = 0
    windows: int = 0
    notes: list[str] = field(default_factory=list)


def _windows(words: list[dict], duration: float, has_anchors: bool) -> list[tuple[float, float, list[int]]]:
    """(window start s, window end s, word indexes): every word in exactly one window of <= WINDOW_SEC."""
    n = len(words)
    if duration <= WINDOW_SEC or n == 0:
        return [(0.0, duration, list(range(n)))]
    if has_anchors:
        starts = [w["startMs"] / 1000 for w in words]
        ends = [max(w["endMs"], w["startMs"]) / 1000 for w in words]
    else:  # no times at all: spread the words over the audio by their length, then window around that guess
        weights = np.array([max(1, len(w["text"])) for w in words], dtype=float)
        edges = np.concatenate(([0.0], np.cumsum(weights) / weights.sum() * duration))
        starts, ends = list(edges[:-1]), list(edges[1:])
    out: list[tuple[float, float, list[int]]] = []
    i = 0
    budget = WINDOW_SEC - 2 * PAD_SEC
    while i < n:
        j = i
        while j + 1 < n and ends[j + 1] - starts[i] <= budget:
            j += 1
        idx = list(range(i, j + 1))
        out.append((max(0.0, starts[i] - PAD_SEC), min(duration, ends[j] + PAD_SEC), idx))
        i = j + 1
    return out


class Aligner:
    """Model cache (a few languages at a time) + alignment of word lists."""

    def __init__(self, loader=None, max_models: int = int(os.environ.get("ALIGN_MAX_MODELS", "2"))):
        self._loader = loader or (lambda mid, rev: Wav2Vec2Model(mid, rev, int(os.environ.get("ALIGN_THREADS", "0")) or None))
        self._models: OrderedDict[str, AcousticModel] = OrderedDict()
        self._max = max(1, max_models)
        self._lock = threading.Lock()

    def supports(self, language: str) -> bool:
        return model_for(language) is not None

    def model(self, language: str) -> AcousticModel:
        spec = model_for(language)
        if spec is None:
            raise KeyError(language)
        key = spec[0]
        with self._lock:
            if key in self._models:
                self._models.move_to_end(key)
                return self._models[key]
        m = self._loader(*spec)
        with self._lock:
            self._models[key] = m
            while len(self._models) > self._max:
                self._models.popitem(last=False)
        return m

    def align(self, samples: np.ndarray, words: list[dict], language: str) -> AlignResult:
        model = self.model(language)
        duration = len(samples) / SAMPLE_RATE
        words = [{"text": str(w.get("text", "")), "startMs": float(w.get("startMs", 0) or 0), "endMs": float(w.get("endMs", 0) or 0)} for w in words]
        has_anchors = any(w["endMs"] > 0 for w in words)
        out = [dict(w, aligned=False) for w in words]
        res = AlignResult(out)
        for w0, w1, idx in _windows(words, duration, has_anchors):
            res.windows += 1
            toks = [word_tokens(words[k]["text"], model.vocab) for k in idx]
            sep = model.vocab.get("|")
            flat: list[int] = []
            owner: list[int] = []  # word position of each token, -1 for a word separator
            for pos, t in enumerate(toks):
                if not t:
                    continue
                if flat and sep is not None:
                    flat.append(sep)
                    owner.append(-1)
                flat.extend(t)
                owner.extend([pos] * len(t))
            if not flat:
                continue
            seg = samples[int(w0 * SAMPLE_RATE): int(w1 * SAMPLE_RATE)]
            try:
                lp = model.log_probs(seg)
                if lp.shape[0] < min_frames(flat):
                    raise AlignmentError("window too short")
                spans = forced_align(lp, flat, blank=model.blank)
            except AlignmentError as e:
                res.notes.append(f"window {w0:.1f}-{w1:.1f}s kept provider times: {e}")
                continue
            per_word: dict[int, list[int]] = {}
            for o, sp in zip(owner, spans):
                if o >= 0:
                    per_word.setdefault(o, []).extend([sp.start, sp.end])
            for pos, frames in per_word.items():
                k = idx[pos]
                s = (w0 + min(frames) * model.frame_sec) * 1000
                e = (w0 + max(frames) * model.frame_sec) * 1000
                if has_anchors and (abs(s - words[k]["startMs"]) > MAX_SHIFT_SEC * 1000 or abs(e - words[k]["endMs"]) > MAX_SHIFT_SEC * 1000):
                    continue
                out[k].update(startMs=s, endMs=e, aligned=True)
                res.aligned += 1
        _fill_unaligned(out, has_anchors, duration * 1000)
        for w in out:
            w["startMs"] = int(round(w["startMs"]))
            w["endMs"] = int(round(max(w["endMs"], w["startMs"])))
        return res


def _fill_unaligned(words: list[dict], has_anchors: bool, duration_ms: float) -> None:
    """Without provider times an unplaced word fills the gap between its aligned neighbours; times stay in order."""
    if not has_anchors:
        for i, w in enumerate(words):
            if w["aligned"]:
                continue
            prev_end = next((words[j]["endMs"] for j in range(i - 1, -1, -1) if words[j]["aligned"]), 0.0)
            nxt = next((words[j]["startMs"] for j in range(i + 1, len(words)) if words[j]["aligned"]), duration_ms)
            w["startMs"], w["endMs"] = prev_end, max(prev_end, nxt)
    # Monotonic: a kept provider time never overlaps an aligned neighbour.
    for i in range(1, len(words)):
        if words[i]["startMs"] < words[i - 1]["endMs"]:
            if words[i]["aligned"] and not words[i - 1]["aligned"]:
                words[i - 1]["endMs"] = max(words[i - 1]["startMs"], words[i]["startMs"])
            else:
                words[i]["startMs"] = words[i - 1]["endMs"]
                words[i]["endMs"] = max(words[i]["endMs"], words[i]["startMs"])
