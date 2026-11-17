"""Timing sources: where the hypothesis word timings of a clip come from.

  provider-json  a JSON file of transcripts made earlier (e.g. by provider-transcribe.ts against the real STT provider):
                 {"<clip id>": {"words": [{"text", "startMs", "endMs"}, ...]}, ...} (the backend's /transcribe `data`)
  aligner        services/align-worker in this process (needs its model deps: torch + transformers)
  aligner-http   a running align-worker: POST {url}/align
  uniform        baseline: the reference words spread evenly over the clip (shows what "no timing" scores)

The aligner sources get the reference TEXT only (no reference times), plus anchors the backend would also have:
for "aligner" the provider words when --anchors points at a provider-json file, else none.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
import uuid
from pathlib import Path
from typing import Callable, Protocol

from .metrics import Word

ROOT = Path(__file__).resolve().parents[3]
WORKER_DIR = ROOT / "services" / "align-worker"


class Clip(Protocol):
    id: str
    language: str
    audio_path: Path
    duration_ms: float
    reference: list[Word]


Source = Callable[[Clip], list[Word]]


def _words(raw: list[dict]) -> list[Word]:
    return [Word(str(w["text"]), float(w["startMs"]), float(w["endMs"])) for w in raw if str(w.get("text", "")).strip()]


def provider_json(path: str) -> Source:
    data = json.loads(Path(path).read_text(encoding="utf-8"))

    def run(clip: Clip) -> list[Word]:
        entry = data.get(clip.id)
        if entry is None:
            raise KeyError(f"{path} has no transcript for clip {clip.id}")
        entry = entry.get("data", entry)
        return _words(entry.get("words", []))

    return run


def uniform() -> Source:
    def run(clip: Clip) -> list[Word]:
        n = len(clip.reference)
        step = clip.duration_ms / max(1, n)
        return [Word(w.text, i * step, (i + 1) * step) for i, w in enumerate(clip.reference)]

    return run


def _anchor_words(clip: Clip, anchors: Source | None) -> list[dict]:
    """The words sent to the aligner: reference text, times from the anchor source when there is one (else 0)."""
    if anchors is not None:
        return [{"text": w.text, "startMs": w.start_ms, "endMs": w.end_ms} for w in anchors(clip)]
    return [{"text": w.text, "startMs": 0, "endMs": 0} for w in clip.reference]


def aligner(anchors: Source | None = None) -> Source:
    sys.path.insert(0, str(WORKER_DIR))
    from app.align import Aligner, decode_audio  # noqa: E402  (the worker's own code, unchanged)

    engine = Aligner()

    def run(clip: Clip) -> list[Word]:
        samples = decode_audio(clip.audio_path.read_bytes())
        out = engine.align(samples, _anchor_words(clip, anchors), clip.language)
        return _words(out.words)

    return run


def aligner_http(url: str, secret: str | None = None, anchors: Source | None = None) -> Source:
    secret = secret if secret is not None else os.environ.get("ALIGN_WORKER_SECRET", "")

    def run(clip: Clip) -> list[Word]:
        boundary = uuid.uuid4().hex
        parts = []
        for name, value in (("words", json.dumps(_anchor_words(clip, anchors))), ("language", clip.language)):
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="audio"; filename="{clip.audio_path.name}"\r\n'
                     f"Content-Type: application/octet-stream\r\n\r\n".encode() + clip.audio_path.read_bytes() + b"\r\n")
        parts.append(f"--{boundary}--\r\n".encode())
        req = urllib.request.Request(url.rstrip("/") + "/align", data=b"".join(parts), method="POST",
                                     headers={"Content-Type": f"multipart/form-data; boundary={boundary}", "X-Worker-Secret": secret})
        with urllib.request.urlopen(req, timeout=300) as res:  # noqa: S310 (operator-given URL)
            return _words(json.loads(res.read())["words"])

    return run
