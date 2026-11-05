"""Speaker diarization: decode audio, run the pipeline, return who speaks when.

Model: pyannote/speaker-diarization-community-1 (pyannote.audio 4, weights CC-BY-4.0, code MIT). It is the most
accurate open diarization model that runs on a CPU, and its "exclusive" output (one speaker at a time) lines up with
word timestamps. The weights are gated on Hugging Face: accept the terms once and set HF_TOKEN; after the first
download they are cached and it runs offline.
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from typing import Any, Iterable, Protocol

import numpy as np

log = logging.getLogger("diarize-worker")

SAMPLE_RATE = 16_000
DEFAULT_MODEL = "pyannote/speaker-diarization-community-1"


@dataclass(frozen=True)
class Segment:
    speaker: str
    start_ms: int
    end_ms: int


class Pipeline(Protocol):
    def __call__(self, file: dict, **kwargs: Any) -> Any: ...


class AudioDecodeError(Exception):
    pass


def decode_audio(data: bytes, ffmpeg: str | None = None, timeout_s: float = 120) -> np.ndarray:
    """Any container / codec the phone sends (m4a, aac, wav, mp3, ogg, webm) -> mono float32 at 16 kHz."""
    exe = ffmpeg or shutil.which("ffmpeg")
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


def _tracks(output: Any) -> Iterable[tuple[float, float, str]]:
    """(start s, end s, label) from a pyannote 4 DiarizeOutput (exclusive view preferred) or a bare Annotation."""
    ann = output
    for attr in ("exclusive_speaker_diarization", "speaker_diarization"):
        # Checked against None: an empty Annotation is falsy but still the right answer (no speech).
        if getattr(output, attr, None) is not None:
            ann = getattr(output, attr)
            break
    for turn, _, label in ann.itertracks(yield_label=True):
        yield float(turn.start), float(turn.end), str(label)


def normalize_segments(raw: Iterable[tuple[float, float, str]], merge_gap_ms: int = 250, min_ms: int = 120) -> list[Segment]:
    """Sorted, with labels renamed S1, S2... in order of first appearance; same-speaker turns closer than
    merge_gap_ms are joined and slivers shorter than min_ms are dropped."""
    names: dict[str, str] = {}
    segs: list[Segment] = []
    for start, end, label in sorted(raw, key=lambda t: (t[0], t[1])):
        s, e = max(0, round(start * 1000)), max(0, round(end * 1000))
        if e - s < min_ms:
            continue
        name = names.setdefault(label, f"S{len(names) + 1}")
        if segs and segs[-1].speaker == name and s - segs[-1].end_ms <= merge_gap_ms:
            segs[-1] = Segment(name, segs[-1].start_ms, max(segs[-1].end_ms, e))
        else:
            segs.append(Segment(name, s, e))
    return segs


def run_diarization(pipeline: Pipeline, samples: np.ndarray, num_speakers: int | None = None,
                    min_speakers: int | None = None, max_speakers: int | None = None) -> list[Segment]:
    import torch  # only needed with the real model

    kwargs: dict[str, int] = {}
    if num_speakers:
        kwargs["num_speakers"] = num_speakers
    else:
        if min_speakers:
            kwargs["min_speakers"] = min_speakers
        if max_speakers:
            kwargs["max_speakers"] = max_speakers
    waveform = torch.from_numpy(samples).unsqueeze(0)
    output = pipeline({"waveform": waveform, "sample_rate": SAMPLE_RATE}, **kwargs)
    return normalize_segments(_tracks(output))


def load_pipeline(model: str = DEFAULT_MODEL, token: str | None = None) -> Pipeline:
    """Loads the model once. Uses the GPU when there is one, otherwise all CPU threads (capped by DIARIZE_THREADS)."""
    import torch
    from pyannote.audio import Pipeline as PyannotePipeline

    threads = int(os.environ.get("DIARIZE_THREADS", "0") or 0)
    if threads > 0:
        torch.set_num_threads(threads)
    pipe = PyannotePipeline.from_pretrained(model, token=token or None)
    if pipe is None:
        raise RuntimeError(f"could not load {model}: accept its terms on huggingface.co and set HF_TOKEN")
    if torch.cuda.is_available():
        pipe.to(torch.device("cuda"))
    log.info("loaded %s on %s", model, "cuda" if torch.cuda.is_available() else f"cpu x{torch.get_num_threads()}")
    return pipe
