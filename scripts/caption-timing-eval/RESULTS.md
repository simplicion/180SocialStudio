# Caption word-timing evaluation: results

Run on 2026-11-18 (Windows, CPU, torch 2.15 CPU, transformers 4.57). Target: **median < 60 ms and p95 < 150 ms**
absolute error, for word starts and ends alike, pooled over all matched words.

## What was measured, and what was not

| Timing source | Measured? |
|---|---|
| **Production STT provider** (OpenAI / Groq Whisper `verbose_json` word timestamps) | **No.** The OpenAI account has no credits, and no paid API was called. Command to run it later is below. |
| **align-worker** (wav2vec2 CTC forced alignment, given the correct transcript and no times) | Yes, real models, numbers below. |
| Uniform baseline (words spread evenly over the clip) | Yes: shows the metric separates good and bad timing. |

The aligner was given the reference **text** with no anchor times, i.e. "a perfect transcript, timings unknown". In
production it gets the provider's words; transcript errors there are outside this measurement (the worker keeps the
provider's time for a word it would move by more than 1 s). See `fixtures/ATTRIBUTION` for the references and their
limits: **no timing here was checked by hand by us**.

## Results: align-worker, calibrated (as shipped)

| clip | lang | reference | words | coverage | start median | start p95 | end median | end p95 |
|---|---|---|---:|---:|---:|---:|---:|---:|
| en-1089-134686-0000 | en | MFA | 28 | 100% | 20 | 103 | 30 | 70 |
| en-1188-133604-0000 | en | MFA | 19 | 100% | 20 | 51 | 30 | 151 |
| en-121-123852-0000 | en | MFA | 29 | 100% | 40 | 108 | 20 | 160 |
| en-1221-135766-0000 | en | MFA | 37 | 100% | 20 | 50 | 20 | 70 |
| en-1284-1180-0008 | en | MFA | 37 | 100% | 20 | 84 | 20 | 60 |
| de_-E31VeOj-iE-01042-00345798-00346244 | de | MMS-CTC | 12 | 100% | 12 | 18 | 15 | 38 |
| es_-Gf9FocdIc4-00005-00003352-00003853 | es | MMS-CTC | 15 | 100% | 6 | 17 | 7 | 21 |
| fr_-F1WW3J6oQQ-00033-00011486-00011922 | fr | MMS-CTC | 11 | 100% | 11 | 14 | 27 | 46 |
| it_-CXLW8sQqDY-00009-00005586-00006204 | it | MMS-CTC | 14 | 100% | 16 | 37 | 18 | 36 |
| pt_-1XqvK0h5Yo-00013-00006570-00007264 | pt | MMS-CTC | 18 | 100% | 10 | 20 | 26 | 47 |

All values in ms. Per-clip p95 over 11–37 words is noisy; the pooled rows are what the target is judged on.

| Pooled | words | start median | start p95 | end median | end p95 | target |
|---|---:|---:|---:|---:|---:|---|
| **All 10 clips** | 220 | **14** | **80** | **20** | **90** | met |
| English, MFA reference (independent of CTC) | 150 | 20 | 86 | 20 | 110 | met |
| de/es/fr/it/pt, MMS-CTC reference (optimistic, see below) | 70 | 11 | 30 | 20 | 40 | met |

## Other runs, for comparison

| Run | words | start median | start p95 | end median | end p95 | target |
|---|---:|---:|---:|---:|---:|---|
| align-worker, **uncalibrated** (raw CTC frames), all clips | 220 | 40 | 130 | 30 | 120 | met |
| align-worker, uncalibrated, English / MFA only | 150 | 55 | 136 | 40 | 140 | met, barely |
| uniform baseline, all clips | 220 | 291 | 869 | 272 | 828 | missed |

**Calibration.** The English model's raw word starts are late and its ends early (CTC models emit a word's first
letter after it begins). The offset was measured on **20 held-out LibriSpeech test-clean utterances (502 words,
speakers disjoint from the 5 eval speakers)** against the MFA reference: median signed error start **+50 ms**, end
**−30 ms**. `CALIBRATION_MS` in `services/align-worker/app/align.py` subtracts / adds those for
`facebook/wav2vec2-base-960h` only. The other languages' models are **not** calibrated: their only reference is
itself CTC (MMS), which shares this bias, so it cannot be measured there. Their real-world error is likely closer to
the uncalibrated English numbers than to the 11–20 ms shown.

## How to read these numbers (limitations)

- English (150 words) is the trustworthy part: MFA is an HMM-GMM aligner, independent of the CTC model under test.
  MFA itself is a few tens of ms from hand labels on typical benchmarks, so the error vs. the true boundary
  can be somewhat larger or smaller than shown. LibriSpeech is clean read speech; social videos (music, noise,
  fast speech) will do worse.
- The 5 non-English clips (70 words) are scored against MMS-CTC alignments: same model family, so shared errors
  are invisible. Those rows show agreement between two CTC aligners, not accuracy.
- Not measured at all: Hindi and other Indic languages, Arabic, CJK, Thai (no openly licensed word-timing reference
  was found; the worker has no model for them yet either, so the provider's times are used unchanged).
- 10 clips, 220 words: enough to say the target is met by a margin on English, not to compare two systems that are
  within ~10 ms of each other.

## Reproduce

```bash
# venv with: torch (CPU), "transformers>=4.40,<5", numpy, soundfile, static-ffmpeg (or ffmpeg on PATH), pytest
python -I scripts/caption-timing-eval/fetch_fixtures.py          # YODAS clips, SHA-256 checked
python -m pytest scripts/caption-timing-eval/tests               # metric unit tests
python -I scripts/caption-timing-eval/run_eval.py --source aligner --json aligner.json   # downloads ~6.7 GB of models once
python -I scripts/caption-timing-eval/run_eval.py --source uniform
```

**The production provider, once the account has credits** (paid; ~2 minutes of audio per provider):

```bash
OPENAI_API_KEY=... npx tsx scripts/caption-timing-eval/provider-transcribe.ts openai scripts/caption-timing-eval/results/provider-openai.json
python -I scripts/caption-timing-eval/run_eval.py --source provider-json --hyp scripts/caption-timing-eval/results/provider-openai.json
# provider words refined by the aligner, i.e. what /transcribe returns with ALIGN_WORKER_URL set:
python -I scripts/caption-timing-eval/run_eval.py --source aligner --anchors scripts/caption-timing-eval/results/provider-openai.json
```

The same with `groq` / `GROQ_API_KEY`. Coverage below ~95% there means the provider misheard words; their timing
is not scored (only exact word matches are).

## Tests

- Metric unit tests: `scripts/caption-timing-eval/tests/test_metrics.py`: 7 passed.
- align-worker: 13 passed, including the real-model test (`ALIGN_RUN_MODEL_TESTS=1`, English model, 125 s with the
  model download already cached). The 10-clip evaluation above is the real-model run for all six models.
