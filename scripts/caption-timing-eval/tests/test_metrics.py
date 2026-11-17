"""python -m pytest scripts/caption-timing-eval/tests (stdlib + pytest only)."""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from timing_eval.metrics import Word, align_pairs, normalize, percentile, score_clip, summarize  # noqa: E402


def words(spec):
    return [Word(t, s, e) for t, s, e in spec]


def test_normalize_drops_punctuation_and_case_and_keeps_marks():
    assert normalize("Hello,") == "hello"
    assert normalize("don’t") == "don't"
    assert normalize("“Quote”") == "quote"
    assert normalize("नमस्ते।") == "नमस्ते"  # virama + vowel sign kept, danda dropped
    assert normalize("'tis'") == "tis"


def test_percentile_matches_numpy_linear():
    assert percentile([1, 2, 3, 4], 50) == 2.5
    assert percentile([10], 95) == 10
    assert math.isclose(percentile(list(range(1, 101)), 95), 95.05)
    assert math.isnan(percentile([], 50))


def test_identical_words_all_match_with_zero_error():
    ref = words([("a", 0, 100), ("b", 100, 200), ("c", 250, 400)])
    r = score_clip("x", "en", ref, ref)
    assert r.matched == 3 and r.coverage == 1
    assert r.start_errors_ms == [0, 0, 0]


def test_insertion_and_deletion_do_not_shift_later_pairs():
    ref = words([("the", 0, 100), ("cat", 100, 300), ("sat", 300, 500), ("down", 500, 700)])
    # hypothesis: an extra "uh", "sat" missing, "cat" misrecognised as "hat"
    hyp = words([("The", 10, 110), ("uh", 110, 150), ("hat", 150, 300), ("down.", 540, 690)])
    pairs = align_pairs(ref, hyp)
    assert pairs == [(0, 0), (3, 3)]
    r = score_clip("x", "en", ref, hyp)
    assert r.matched == 2 and r.coverage == 0.5
    assert r.start_errors_ms == [10, 40]
    assert r.end_errors_ms == [10, 10]


def test_repeated_words_pair_in_order():
    ref = words([("no", 0, 100), ("no", 200, 300), ("no", 400, 500)])
    hyp = words([("no", 205, 300), ("no", 405, 500)])
    pairs = align_pairs(ref, hyp)
    # two of three matched; the edit path never crosses (i and j both increase)
    assert len(pairs) == 2 and pairs[0][0] < pairs[1][0] and pairs[0][1] < pairs[1][1]


def test_empty_hypothesis_scores_zero_coverage_and_fails():
    ref = words([("a", 0, 100)])
    s = summarize([score_clip("x", "en", ref, [])])
    assert s.coverage == 0 and not s.passed and math.isnan(s.start_median_ms)


def test_summary_pools_words_and_applies_targets():
    ref = words([(f"w{i}", i * 300, i * 300 + 200) for i in range(100)])
    good = [Word(w.text, w.start_ms + 20, w.end_ms - 30) for w in ref]
    s = summarize([score_clip("a", "en", ref, good)])
    assert s.start_median_ms == 20 and s.end_median_ms == 30 and s.passed
    # 10% of words 200 ms late: median still fine, p95 over target -> fail
    late = [Word(w.text, w.start_ms + (200 if i % 10 == 0 else 20), w.end_ms) for i, w in enumerate(ref)]
    s2 = summarize([score_clip("b", "en", ref, late)])
    assert s2.start_median_ms == 20 and s2.start_p95_ms == 200 and not s2.passed
    both = summarize([score_clip("a", "en", ref, good), score_clip("b", "en", ref, late)])
    assert both.words == 200 and both.matched == 200
