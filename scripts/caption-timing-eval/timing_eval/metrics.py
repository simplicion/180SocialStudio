"""Word-timing error metrics (standard library only).

Hypothesis words are matched to reference words by an edit-distance alignment over normalised text, so an inserted,
dropped or misrecognised word does not shift every later pair. Only exact matches (same normalised text) are scored;
coverage is the share of reference words that got one.
"""
from __future__ import annotations

import math
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Sequence

TARGET_MEDIAN_MS = 60.0
TARGET_P95_MS = 150.0



@dataclass(frozen=True)
class Word:
    text: str
    start_ms: float
    end_ms: float


def normalize(text: str) -> str:
    """NFKC, lower case, curly apostrophes folded, punctuation and symbols dropped ("Hello," == "hello")."""
    t = unicodedata.normalize("NFKC", text).lower().replace("’", "'").replace("‘", "'").replace("ʼ", "'")
    # Letters, combining marks (Indic vowel signs) and digits stay; everything else goes.
    t = "".join(c for c in t if c == "'" or unicodedata.category(c)[0] in "LMN")
    return t.strip("'")


def align_pairs(ref: Sequence[Word], hyp: Sequence[Word]) -> list[tuple[int, int]]:
    """(ref index, hyp index) of the exactly matching words on a minimum edit-distance path.

    Levenshtein with unit costs (substitution, insertion, deletion); ties prefer a match. O(len(ref) * len(hyp)).
    """
    r = [normalize(w.text) for w in ref]
    h = [normalize(w.text) for w in hyp]
    n, m = len(r), len(h)
    # cost[i][j]: edit distance between r[:i] and h[:j]
    cost = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        cost[i][0] = i
    for j in range(1, m + 1):
        cost[0][j] = j
    for i in range(1, n + 1):
        ri = r[i - 1]
        row, prev = cost[i], cost[i - 1]
        for j in range(1, m + 1):
            sub = prev[j - 1] + (0 if ri == h[j - 1] and ri else 1)
            row[j] = min(sub, prev[j] + 1, row[j - 1] + 1)
    pairs: list[tuple[int, int]] = []
    i, j = n, m
    while i > 0 and j > 0:
        same = r[i - 1] == h[j - 1] and r[i - 1] != ""
        if same and cost[i][j] == cost[i - 1][j - 1]:
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif cost[i][j] == cost[i - 1][j - 1] + 1:
            i, j = i - 1, j - 1
        elif cost[i][j] == cost[i - 1][j] + 1:
            i -= 1
        else:
            j -= 1
    pairs.reverse()
    return pairs


def percentile(values: Sequence[float], q: float) -> float:
    """Linear-interpolated percentile (numpy's default method), q in [0, 100]. NaN for no values."""
    if not values:
        return math.nan
    s = sorted(values)
    if len(s) == 1:
        return float(s[0])
    pos = (len(s) - 1) * q / 100.0
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(s) - 1)
    return float(s[lo] + (s[hi] - s[lo]) * (pos - lo))


@dataclass
class ClipResult:
    clip_id: str
    language: str
    ref_words: int
    matched: int
    start_errors_ms: list[float] = field(default_factory=list)
    end_errors_ms: list[float] = field(default_factory=list)

    @property
    def coverage(self) -> float:
        return self.matched / self.ref_words if self.ref_words else math.nan


def score_clip(clip_id: str, language: str, ref: Sequence[Word], hyp: Sequence[Word]) -> ClipResult:
    pairs = align_pairs(ref, hyp)
    res = ClipResult(clip_id, language, ref_words=len(ref), matched=len(pairs))
    for i, j in pairs:
        res.start_errors_ms.append(abs(hyp[j].start_ms - ref[i].start_ms))
        res.end_errors_ms.append(abs(hyp[j].end_ms - ref[i].end_ms))
    return res


@dataclass(frozen=True)
class Summary:
    words: int
    matched: int
    coverage: float
    start_median_ms: float
    start_p95_ms: float
    end_median_ms: float
    end_p95_ms: float

    @property
    def passed(self) -> bool:
        """Target: median < 60 ms and p95 < 150 ms, for starts and ends alike."""
        vals = (self.start_median_ms, self.start_p95_ms, self.end_median_ms, self.end_p95_ms)
        if any(math.isnan(v) for v in vals):
            return False
        return (self.start_median_ms < TARGET_MEDIAN_MS and self.end_median_ms < TARGET_MEDIAN_MS
                and self.start_p95_ms < TARGET_P95_MS and self.end_p95_ms < TARGET_P95_MS)


def summarize(results: Iterable[ClipResult]) -> Summary:
    """Pooled over every matched word of every clip (a long clip weighs more than a short one)."""
    rs = list(results)
    starts = [e for r in rs for e in r.start_errors_ms]
    ends = [e for r in rs for e in r.end_errors_ms]
    words = sum(r.ref_words for r in rs)
    matched = sum(r.matched for r in rs)
    return Summary(
        words=words,
        matched=matched,
        coverage=matched / words if words else math.nan,
        start_median_ms=percentile(starts, 50),
        start_p95_ms=percentile(starts, 95),
        end_median_ms=percentile(ends, 50),
        end_p95_ms=percentile(ends, 95),
    )
