"""Caption word-timing evaluation.

  python -I scripts/caption-timing-eval/run_eval.py --source aligner
  python -I scripts/caption-timing-eval/run_eval.py --source provider-json --hyp provider.json
  python -I scripts/caption-timing-eval/run_eval.py --source aligner --anchors provider.json   # provider -> aligner
  python -I scripts/caption-timing-eval/run_eval.py --source uniform                         # no-timing baseline

Clips: fixtures/manifest.json (fetch the downloadable ones first: fetch_fixtures.py). Per clip and overall: median and
p95 absolute start / end error (ms) over matched words, coverage (% reference words matched), pass / fail against the
target (median < 60 ms, p95 < 150 ms). --json writes the numbers for RESULTS.md.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from timing_eval import sources  # noqa: E402
from timing_eval.metrics import ClipResult, Word, percentile, score_clip, summarize  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@dataclass
class Clip:
    id: str
    language: str
    audio_path: Path
    duration_ms: float
    reference: list[Word]
    reference_method: str


def load_clips(manifest: Path = FIXTURES / "manifest.json", only: set[str] | None = None) -> list[Clip]:
    data = json.loads(manifest.read_text(encoding="utf-8"))
    clips = []
    for c in data["clips"]:
        if only and c["id"] not in only and c["language"] not in only:
            continue
        audio = manifest.parent / c["audio"]
        if not audio.exists():
            raise SystemExit(f"missing {audio}: run fetch_fixtures.py first")
        ref = [Word(w["text"], w["startMs"], w["endMs"]) for w in c["reference"]]
        clips.append(Clip(c["id"], c["language"], audio, float(c["durationMs"]), ref, c["referenceMethod"]))
    return clips


def make_source(args: argparse.Namespace):
    anchors = sources.provider_json(args.anchors) if args.anchors else None
    if args.source == "provider-json":
        if not args.hyp:
            raise SystemExit("--hyp is required for provider-json")
        return sources.provider_json(args.hyp)
    if args.source == "aligner":
        return sources.aligner(anchors)
    if args.source == "aligner-http":
        return sources.aligner_http(args.url, anchors=anchors)
    return sources.uniform()


def fmt(v: float) -> str:
    return "n/a" if math.isnan(v) else f"{v:.0f}"


def clip_row(r: ClipResult, method: str) -> dict:
    return {
        "clip": r.clip_id, "language": r.language, "reference": method, "words": r.ref_words, "matched": r.matched,
        "coverage": r.coverage,
        "startMedianMs": percentile(r.start_errors_ms, 50), "startP95Ms": percentile(r.start_errors_ms, 95),
        "endMedianMs": percentile(r.end_errors_ms, 50), "endP95Ms": percentile(r.end_errors_ms, 95),
    }


def table(rows: list[dict], overall: dict) -> str:
    head = "| clip | lang | reference | words | coverage | start median | start p95 | end median | end p95 |\n|---|---|---|---:|---:|---:|---:|---:|---:|"
    lines = [head]
    for r in rows + [overall]:
        lines.append(f"| {r['clip']} | {r['language']} | {r['reference']} | {r['words']} | {r['coverage'] * 100:.0f}% | "
                     f"{fmt(r['startMedianMs'])} | {fmt(r['startP95Ms'])} | {fmt(r['endMedianMs'])} | {fmt(r['endP95Ms'])} |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--source", choices=["provider-json", "aligner", "aligner-http", "uniform"], required=True)
    p.add_argument("--hyp", help="provider-json: transcripts file")
    p.add_argument("--anchors", help="aligner: provider transcripts whose words (text + times) are sent to the aligner")
    p.add_argument("--url", default="http://127.0.0.1:4030", help="aligner-http: worker URL")
    p.add_argument("--only", nargs="*", help="clip ids or language codes")
    p.add_argument("--json", help="write the results here")
    args = p.parse_args(argv)

    clips = load_clips(only=set(args.only) if args.only else None)
    source = make_source(args)
    results, rows = [], []
    for clip in clips:
        hyp = source(clip)
        r = score_clip(clip.id, clip.language, clip.reference, hyp)
        results.append(r)
        rows.append(clip_row(r, clip.reference_method))
        print(f"{clip.id}: {r.matched}/{r.ref_words} matched, start median {fmt(rows[-1]['startMedianMs'])} ms, "
              f"end median {fmt(rows[-1]['endMedianMs'])} ms", file=sys.stderr)

    groups = {"overall": results}
    for method in sorted({c.reference_method for c in clips}):
        groups[f"overall ({method} reference)"] = [r for r, c in zip(results, clips) if c.reference_method == method]
    summaries = {}
    for name, rs in groups.items():
        s = summarize(rs)
        summaries[name] = {"clip": f"**{name}**", "language": "", "reference": "", "words": s.words, "matched": s.matched,
                           "coverage": s.coverage, "startMedianMs": s.start_median_ms, "startP95Ms": s.start_p95_ms,
                           "endMedianMs": s.end_median_ms, "endP95Ms": s.end_p95_ms, "passed": s.passed}
    print(table(rows, summaries["overall"]))
    for name, s in summaries.items():
        print(f"{name}: {'PASS' if s['passed'] else 'FAIL'} (target median < 60 ms, p95 < 150 ms; start and end)")
    if args.json:
        Path(args.json).write_text(json.dumps({"source": args.source, "anchors": args.anchors, "clips": rows, "summaries": summaries}, indent=2), encoding="utf-8")
    return 0 if summaries["overall"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
