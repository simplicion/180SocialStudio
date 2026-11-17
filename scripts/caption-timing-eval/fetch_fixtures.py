"""Downloads the fixture audio that is not committed (manifest entries with a `url`) and checks its SHA-256.

  python -I scripts/caption-timing-eval/fetch_fixtures.py
"""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

FIX = Path(__file__).resolve().parent / "fixtures"


def main() -> int:
    manifest = json.loads((FIX / "manifest.json").read_text(encoding="utf-8"))
    bad = 0
    for c in manifest["clips"]:
        dest = FIX / c["audio"]
        if not dest.exists():
            if not c.get("url"):
                print(f"missing committed file {dest}", file=sys.stderr)
                bad += 1
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(urllib.request.urlopen(c["url"], timeout=60).read())  # noqa: S310 (manifest URL)
        digest = hashlib.sha256(dest.read_bytes()).hexdigest()
        if digest != c["sha256"]:
            print(f"checksum mismatch for {dest}: {digest}", file=sys.stderr)
            dest.unlink()
            bad += 1
        else:
            print(f"ok {c['id']}")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
