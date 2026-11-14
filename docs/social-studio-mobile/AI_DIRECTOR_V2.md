# AI Director v2

How the AI Director edits a video after the quality-fix plan (`AI_DIRECTOR_QUALITY_FIX_PLAN.md`, phases 0-7,
November 2026). The request/response contract is in `AI_DIRECTOR_CONTRACT.md` (addenda 2026-11-13 to 2026-11-15).

## The pipeline of one turn

```
Phone: on-device analysis (transcript + speakers, pauses, faces, scene cuts, OCR, labels, loudness)
       + with consent: ~60 stills per clip → POST /media-editor/vision/shot-log → ShotLog (cached by file hash)
   │   POST /media-editor/ai-direct  (media, mediaList, currentEditIR, history, prompt)
   ▼
Server (VideoAIDirectorService.directMobile)
 1. Scope          offline classifier first, an LLM intent call only when unsure; whole edit / modify / add / question
 2. Style          one playbook for a whole edit (fast_hype | calm_educational | cinematic_vlog | podcast_clip)
 3. Story pass     whole edits: hook, keeper lines, retakes / false starts / repeats cut at word boundaries
 4. Enhance        agent loop on the cut timeline: stages cleanup → captions → framing → overlays → audio → finish,
                   per-call tool results (applied / rejected + reason), read tools (words, shots, timeline,
                   B-roll search with thumbnails, music search), ≤ 8 turns / 90 s
                   (one-shot planner when the provider has no multi-turn support)
 5. Guards         renderer gate, destructive guard, scope, item locks, locked ranges, validator, compiler
 6. Critic         structural checks + the playbook's targets; bounded deterministic / LLM repairs
 7. Projection     stock B-roll and music resolved, credits kept, untouched items preserved exactly
   │   response: editIR, reply, appliedOperations, warnings, plannerFallback?, turnLog, style, checkpoints
   ▼
Phone: applies (auto or "Apply"), then with consent: 360p preview render → stills at the checkpoints
       → POST /media-editor/vision/critique → score + issues → repair turn (visualCritique), at most 2 rounds
```

## Models and providers

- All model IDs live in `packages/domains/ai/src/kernel/model-config.ts`. Director defaults: `claude-opus-5-5`,
  `gpt-6-astra`, `gemini-3.8-flash`; overrides `AI_DIRECTOR_MODEL_<PROVIDER>`, then the Super Admin vault (retired
  IDs ignored). Other features: `claude-sonnet-5-5`, `gpt-4o` (until 2027-01-14), `gemini-3.8-flash`.
- Director provider: `AI_DIRECTOR_PROVIDER` → `AI_PROVIDER` → Claude, OpenAI, Gemini, Groq, custom.
- Planning depth `AI_DIRECTOR_EFFORT` (default `medium`); Claude refusal fallback on (`AI_CLAUDE_FALLBACKS=0` off).
- Every provider error is a `ProviderError` (provider, model, code, status, message). A turn the offline rules make
  because the model could not be used carries `plannerFallback` and the phone shows a banner.

## Observability

- One `[AI Director][turn] {json}` log line per turn (`turnLog`: provider, model, planner source and reason, fallback,
  LLM calls, ops planned / applied / dropped by filter, story, agent loop, style, vision, latency), also stored on the
  run's final `TimelineChanged` event.
- `GET /media-editor/director-report?days=7` (workspace admins): fallback %, reasons, provider/model mix, drops.

## Consent and retention (media)

The video file never leaves the phone. Two kinds of data can, only with the creator's consent (one-time card in the
Director panel, changeable with the eye button; stored on the device):

| What | Sent | Server keeps | Phone keeps |
|---|---|---|---|
| Audio for transcription | the clip's audio (existing, consented upload) | nothing after the request | the transcript |
| Stills for the vision pass | ≤ 60 JPEG stills per clip, ≤ 512 px, q70 | **no stills** (memory only, released at the end of the request); the text ShotLog, 7 days, per company + file hash | the ShotLog (deleted when consent is withdrawn) |
| Stills for the visual check | ≤ 40 JPEG stills of a 360p preview render | **nothing** (memory only) | nothing (the preview and stills are deleted) |

All model-written text that came from user media (ShotLog descriptions, on-screen text, critique issues, transcript)
is fenced as untrusted data in prompts and never followed as instructions.

## Regression gate (Phase 7)

- `scripts/director-eval/` — 5 fixtures (talking head, interview, vlog, tutorial, multi-clip), each with a reference
  (must / must not), machine checks (cuts, keeps, captions, zooms on the subject, aspect, length, dropped takes,
  playbook and its targets) and a ShotLog.
- **Pull requests** (`.github/workflows/director-eval.yml`, job `replay`): the eval runs with recorded model answers
  (`recordings/<fixture>.json`) or, without a recording, a deterministic scripted editor (`replay.ts`), so the whole
  pipeline is tested without an API key. `gate.ts --mode replay` fails when a check that passed in
  `baselines/replay.json` fails now. A recording that no longer matches the Director's conversation fails with
  "re-record with --record".
- **Nightly** (job `nightly`, needs a provider secret): the eval against the real model plus a judge
  (`judge.ts`, a different model than the Director's by default: `DIRECTOR_JUDGE_MODEL`, else `gpt-6.1-sol` for
  OpenAI / `claude-sonnet-5-5` for Claude) scoring each edit 0-10
  against the reference and the visual rubric. Each run appends a line to `history/scores.jsonl` (kept in the Actions
  cache and uploaded as an artifact). `gate.ts --mode live` fails on any offline-rules turn, a median judge score more
  than 1 point below `baselines/live.json`, or a check pass rate 10+ points lower.
- Fixtures carry no real footage, so the judge reads the final timeline, not rendered stills; real clips with a
  `frames/` folder are the next step for a vision judge.

Commands:

```
npx tsx scripts/director-eval/run-director-eval.ts --provider replay --name replay            # PR check, no key
npx tsx scripts/director-eval/gate.ts --report scripts/director-eval/reports/replay.json --mode replay
npx tsx scripts/director-eval/run-director-eval.ts --provider openai --env apps/180-social-studio-backend/.env --record   # real answers → recordings/
npx tsx scripts/director-eval/run-director-eval.ts --provider openai --env apps/180-social-studio-backend/.env --judge --name nightly --history scripts/director-eval/history/scores.jsonl
npx tsx scripts/director-eval/gate.ts --report scripts/director-eval/reports/nightly.json --mode live --update          # first live baseline
```

## Known limits

- iOS: the still extraction (`generateThumbnails`) and the vision flows are written but not compiled (needs a Mac).
- The visual check's preview render and stills run only on a device; unit tests cover the server and the phone's
  request handling, not the render.
- Critic repairs after the agent loop still use the one-shot planner; the visual repair uses the agent loop.
- The live baseline, the real recordings and the planted-problem visual check need an API key and real footage.
