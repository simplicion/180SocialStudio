"""One-time builder of fixtures/manifest.json (kept so the clip choice is reproducible; not needed to run the eval).

  python -I make_fixtures.py --libri <test_clean parquet> --lemas <LEMAS-Dataset-eval eval/metadata.jsonl>

  --libri    https://huggingface.co/datasets/gilkeyio/librispeech-alignments  data/test_clean-00000-of-00001.parquet
             (LibriSpeech test-clean audio + Montreal Forced Aligner word alignments, both CC BY 4.0)
  --lemas    https://huggingface.co/datasets/LEMAS-Project/LEMAS-Dataset-eval  eval/metadata.jsonl (CC BY 4.0)

English: the first utterance (by id) of 5 different test-clean speakers lasting 10-25 s; its FLAC audio is written to
fixtures/audio/ (committed, CC BY 4.0). Other languages: the first utterance (by key) of each language in LANGS that
lasts 4-15 s; its MP3 is NOT committed (YODAS audio, CC BY 3.0, per-creator attribution only by video id): the
manifest stores its URL and SHA-256, and fetch_fixtures.py downloads it.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIX = HERE / "fixtures"
LANGS = ["de", "es", "fr", "it", "pt"]
LEMAS_URL = "https://huggingface.co/datasets/LEMAS-Project/LEMAS-Dataset-eval/resolve/main/eval/"


def libri(parquet: str, n: int = 5) -> list[dict]:
    import pyarrow.parquet as pq
    import soundfile as sf

    table = pq.read_table(parquet, columns=["id", "sex", "transcript", "words", "audio"]).to_pylist()
    table.sort(key=lambda r: r["id"])
    seen: set[str] = set()
    out = []
    for r in table:
        speaker = r["id"].split("-")[0]
        if speaker in seen:
            continue
        data, sr = sf.read(io.BytesIO(r["audio"]["bytes"]))
        dur = len(data) / sr
        if not 10 <= dur <= 25:
            continue
        seen.add(speaker)
        name = f"librispeech-{r['id']}.flac"
        (FIX / "audio").mkdir(parents=True, exist_ok=True)
        (FIX / "audio" / name).write_bytes(r["audio"]["bytes"])
        words = [w for w in r["words"] if w["word"].strip()]
        out.append({
            "id": f"en-{r['id']}",
            "language": "en",
            "audio": f"audio/{name}",
            "sha256": hashlib.sha256(r["audio"]["bytes"]).hexdigest(),
            "durationMs": round(dur * 1000),
            "transcript": r["transcript"],
            "source": f"LibriSpeech test-clean {r['id']} (speaker {speaker}, {r['sex']})",
            "licence": "audio CC BY 4.0 (LibriSpeech, Panayotov et al.); alignment CC BY 4.0 (Lugosch, MFA)",
            "referenceMethod": "MFA",
            "reference": [{"text": w["word"], "startMs": round(w["start"] * 1000), "endMs": round(w["end"] * 1000)} for w in words],
        })
        if len(out) == n:
            break
    return out


def lemas(metadata: str) -> list[dict]:
    rows = [json.loads(line) for line in Path(metadata).read_text(encoding="utf-8").splitlines() if line.strip()]
    rows.sort(key=lambda r: r["key"])
    out = []
    for lang in LANGS:
        r = next(r for r in rows if r["key"].startswith(lang + "_") and 4 <= r["dur"] <= 15)
        url = LEMAS_URL + r["file_name"]
        data = urllib.request.urlopen(url, timeout=60).read()  # noqa: S310 (fixed https URL)
        video = r["key"][3:].rsplit("-", 3)[0]
        out.append({
            "id": r["key"],
            "language": lang,
            "audio": f"audio/lemas/{Path(r['file_name']).name}",
            "url": url,
            "sha256": hashlib.sha256(data).hexdigest(),
            "durationMs": round(r["dur"] * 1000),
            "transcript": r["align"]["txt"],
            "source": f"LEMAS-Dataset-eval {r['key']} (YODAS, YouTube video {video})",
            "licence": "timings CC BY 4.0 (LEMAS-Project); audio CC BY 3.0 (YODAS / the YouTube creator)",
            "referenceMethod": "MMS-CTC",
            "reference": [{"text": w["word"], "startMs": round(w["start"] * 1000), "endMs": round(w["end"] * 1000)} for w in r["align"]["words"]],
        })
        dest = FIX / out[-1]["audio"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    return out


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--libri", required=True)
    p.add_argument("--lemas", required=True)
    a = p.parse_args()
    clips = libri(a.libri) + lemas(a.lemas)
    (FIX / "manifest.json").write_text(json.dumps({"version": 1, "clips": clips}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{len(clips)} clips")


if __name__ == "__main__":
    main()
