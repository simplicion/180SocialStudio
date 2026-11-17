# align-worker: licences of models, code and evaluation data

Checked 2026-11-16 against each Hugging Face model card (`cardData.license` from the Hub API) at the pinned revision.
All models are **Apache-2.0** (commercial use allowed, attribution + licence notice required).

| Language | Model | Revision | Licence |
|---|---|---|---|
| en | [facebook/wav2vec2-base-960h](https://huggingface.co/facebook/wav2vec2-base-960h) | 22aad52d435eb6dbaf354bdad9b0da84ce7d6156 | Apache-2.0 |
| de | [jonatasgrosman/wav2vec2-large-xlsr-53-german](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-german) | 4b8a02957378d0f2da2ef74091156b032c485a89 | Apache-2.0 |
| es | [jonatasgrosman/wav2vec2-large-xlsr-53-spanish](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-spanish) | 96d7e9b4e4a78af515a3c6d3cee7c0826045d276 | Apache-2.0 |
| fr | [jonatasgrosman/wav2vec2-large-xlsr-53-french](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-french) | 7c79e105a6525d38e1e69f640b974b4a679723cc | Apache-2.0 |
| it | [jonatasgrosman/wav2vec2-large-xlsr-53-italian](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-italian) | dab04a3e00d8326052f3fb22a6ff276b822f6131 | Apache-2.0 |
| pt | [jonatasgrosman/wav2vec2-large-xlsr-53-portuguese](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-portuguese) | 634ac655299bcdc46c83bc01da9bab52d2987e4f | Apache-2.0 |
| ru | [jonatasgrosman/wav2vec2-large-xlsr-53-russian](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-russian) | 2329100508896c6d9b157019803ab5601e6f3406 | Apache-2.0 |

The jonatasgrosman models are fine-tunes of `facebook/wav2vec2-large-xlsr-53` (Apache-2.0) on Common Voice (CC0).

## Not used, on purpose

- **Meta MMS / torchaudio `MMS_FA` bundle**: weights are CC-BY-NC-4.0 (non-commercial). Not shipped, not downloaded by
  this worker. (The LEMAS evaluation references below were *made* with MMS by their authors; we only read the published
  CC-BY-4.0 timings for evaluation, we never run MMS.)
- `torchaudio.functional.forced_align` (BSD-2, deprecated in torchaudio 2.8): the same CTC Viterbi algorithm is
  implemented in `app/ctc.py` (numpy), so the worker does not depend on it.

## Adding a language

`ALIGN_MODEL_<LANG>=<hf id>` adds one. Before setting it in production, check the model card licence (and that of its
base model) allows commercial use, and add a row above. Candidates for Indic languages must be checked case by case
(many community fine-tunes have no licence, which means no permission).

## Code and runtime dependencies

PyTorch (BSD-3), transformers (Apache-2.0), numpy (BSD-3), FastAPI (MIT), uvicorn (BSD-3), python-multipart (Apache-2.0).
ffmpeg is called as an external program (LGPL/GPL build of the server's package manager; not linked).

## Evaluation data (scripts/caption-timing-eval)

See `scripts/caption-timing-eval/fixtures/ATTRIBUTION`: LibriSpeech (CC BY 4.0) with Montreal Forced Aligner word
alignments by Loren Lugosch (CC BY 4.0); LEMAS-Dataset-eval word timings (CC BY 4.0) over YODAS audio (CC BY 3.0).
