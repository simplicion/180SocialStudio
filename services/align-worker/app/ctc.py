"""CTC forced alignment (Viterbi), numpy only.

Given per-frame log-probabilities from a CTC acoustic model and the token ids of a known transcript, finds the most
likely frame-by-frame path that spells exactly that transcript (blanks allowed between tokens, repeats need a blank
between them). This is the algorithm torchaudio.functional.forced_align implements (deprecated there since 2.8);
implemented here so the worker does not depend on it. O(T * S) time, S = 2 * len(tokens) + 1, with an int8 backpointer
table (T * S bytes: 30 s of audio and 500 characters is about 1.5 MB).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


class AlignmentError(Exception):
    pass


@dataclass(frozen=True)
class TokenSpan:
    token: int
    start: int  # first frame
    end: int  # one past the last frame
    score: float  # mean frame probability


def min_frames(tokens: list[int]) -> int:
    """Frames needed to emit tokens: one each, plus a blank between equal neighbours."""
    return len(tokens) + sum(1 for a, b in zip(tokens, tokens[1:]) if a == b)


def forced_align(log_probs: np.ndarray, tokens: list[int], blank: int = 0) -> list[TokenSpan]:
    """One span per token, in order. Raises AlignmentError when the audio is too short for the transcript."""
    lp = np.asarray(log_probs, dtype=np.float32)
    if lp.ndim != 2:
        raise ValueError("log_probs must be [frames, vocab]")
    T = lp.shape[0]
    if not tokens:
        return []
    if any(t == blank for t in tokens):
        raise ValueError("the transcript must not contain the blank token")
    if T < min_frames(tokens):
        raise AlignmentError(f"{T} frames cannot hold {len(tokens)} tokens")

    ext = np.full(2 * len(tokens) + 1, blank, dtype=np.int64)
    ext[1::2] = tokens
    S = len(ext)
    # s may come from s-2 when it is a token different from the token two states back (skipping the blank between).
    skip = np.zeros(S, dtype=bool)
    skip[3::2] = ext[3::2] != ext[1:-2:2]

    neg = np.float32(-np.inf)
    alpha = np.full(S, neg, dtype=np.float32)
    alpha[0] = lp[0, blank]
    alpha[1] = lp[0, ext[1]]
    back = np.zeros((T, S), dtype=np.int8)  # 0 = stayed, 1 = came from s-1, 2 = from s-2
    for t in range(1, T):
        stay = alpha
        step = np.concatenate(([neg], alpha[:-1]))
        jump = np.concatenate(([neg, neg], alpha[:-2]))
        jump = np.where(skip, jump, neg)
        cand = np.stack((stay, step, jump))
        best = np.argmax(cand, axis=0)
        alpha = cand[best, np.arange(S)] + lp[t, ext]
        back[t] = best

    end_state = S - 1 if alpha[S - 1] >= alpha[S - 2] else S - 2
    if not np.isfinite(alpha[end_state]):
        raise AlignmentError("no alignment path")
    states = np.empty(T, dtype=np.int64)
    s = end_state
    for t in range(T - 1, -1, -1):
        states[t] = s
        s -= int(back[t, s])
    if states[0] > 1:
        raise AlignmentError("alignment path does not start at the transcript start")

    probs = np.exp(lp[np.arange(T), ext[states]])
    spans: list[TokenSpan] = []
    tok_idx = np.where(states % 2 == 1, (states - 1) // 2, -1)
    t = 0
    while t < T:
        k = tok_idx[t]
        if k < 0:
            t += 1
            continue
        u = t
        while u < T and tok_idx[u] == k:
            u += 1
        spans.append(TokenSpan(int(tokens[k]), t, u, float(probs[t:u].mean())))
        t = u
    if len(spans) != len(tokens):
        raise AlignmentError("alignment lost a token")
    return spans
