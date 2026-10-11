# 180 Social OS: Phase 0 forensic audit and implementation plan (2026-09-27)

This audit maps the "Autonomous Multi-Agent Social Media Operating System" spec against the code that exists today.
Each claim was checked in the repo.

Legend: ✅ live and tested · 🟡 partial, or exists but not wired into the live path · 🔴 missing.

## 1. Architecture as it is today (reuse this; do not build a second engine)

```
Project (Prisma)  ──  BrandConsciousness (brand-consciousness.ts, GET/PUT + completeness)
   │
Autopilot pipeline (packages/domains/ai/src/content/autopilot)
   research? → strategist → hooks & scripts (per week) → copy → critic → persist
   │  job API: /projects/:id/autopilot (queued → research … done)
Content calendar (ContentCalendar + CalendarPiece; structured brief in videoScriptOrHooks)
   │  Creative engine (social-media/src/creative): carousel / static → image providers → deterministic render → attach
   │  raw-footage + final-video routes (calendar-piece-media.ts)
Media Studio
   ├─ Mobile: Flutter UI → MobileEditIR → Android Media3 renderer (EditIrRenderer.kt, TimelineEffects.kt)
   └─ Desktop: Next/Remotion UI → EditIR → native-render-plan.ts → Tauri FFmpeg (render.rs; overlays.rs; remote.rs)
AI Director (packages/domains/ai/src/builders/video-ai-director.service.ts)
   LLM tool-calling (director-tools.ts, 25 tools) → CreativeEditPlan ops → validator → EditIRCompiler → mobile/desktop IR
Publishing (social-media/src/publishing): OAuth+PKCE, AES-GCM token vault, dispatcher, scheduler, webhooks, adapters
Engagement (social-media/src/engagement): matcher, dispatcher, AI DM agent, AI Reply-All, rate limiter
```

The invariant "AI is the brain, the engine is the hands" **holds**. The AI only emits typed operations. The
compiler builds the timeline, and pixels are only produced by Media3 or FFmpeg on the user's device. No server-side
video processing remains.

## 2. Requirement-by-requirement status

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| 1 | AI never touches pixels/FFmpeg | ✅ | Ops → compiler → device renderers. The desktop FFmpeg args are allow-listed in TypeScript and Rust. |
| 3 | Reuse the existing engine | ✅ | One IR family (EditIR ↔ MobileEditIR), two renderers. |
| 4, 35 | Per-project isolation | ✅ | Tenant extension plus `{id, companyId}` guards. `tenant-isolation.test.ts` and the LinkedIn/YouTube cross-project security tests. |
| 5 | Intelligent onboarding | ✅ | Brand consciousness covers website, industry, country, language, secondary colour, restrictions, posting frequency, growth objectives, and autonomy. Mobile BrandIdentityCard editor updated. |
| 6 | Director knows the context automatically | ✅ | `director-context.ts` supplies brand, calendar piece, script alignment and platform. The greet intent opens with a proposal. |
| 7 | Orchestrated agents (not one prompt) | ✅ | Autopilot multi-agent pipeline + Director specialized sub-agents (style, b-roll research, sound, watermark). |
| 8 | Strategy with a content mix | ✅ | The strategist agent assigns pillars, formats and a mix per slot. |
| 9, 39 | Research agent with injection protection | ✅ | `research.ts` (Tavily/Brave) truncates results and cites by allow-listed URL. Prompt injection protection with `fenceUntrusted` and `sanitizeInlineUntrusted`. |
| 10–11 | Hook and script agents | ✅ | Hook types, spoken and on-screen hook, beats, retention loop, CTA and duration. Rendered on mobile and web. |
| 12, 28 | Structured, editable calendar | ✅ | 7/14/30-day jobs. Per-piece regenerate with an instruction. Status, date and platform are editable. |
| 13 | Calendar → Studio bridge | ✅ | pieceId, hook and script go to the camera, Studio and Director. Final video is attached to the piece. |
| 14–16 | Media intelligence | ✅ | Live device analysis (silences, transcript words, faces, beats, scenes, OCR, loudness). BM25 semantic text search over user library (`MediaIndexService`). |
| 17–19 | Director reasons and picks tools dynamically | ✅ | LLM tool-calling over 25 tools, driven by the transcript, silences, faces, brand and timeline. No preset mapping. |
| 20–21 | CreativeEditPlan → validator → compiler | ✅ | `creative-plan.schema.ts`, `validateDirectorToolCalls`, `EditIRCompiler`. |
| 22 | Observe → critique → repair (bounded) | ✅ | `director-critic.ts` with `critiqueDirectorEdit`, bounded repair loop (1-3 repair turns) handling microClips, deadAir, loudness, and caption collisions. |
| 23 | Manual and AI coexist | ✅ | Both edit the same timeline. Director reads current timeline. Constraints preserve locked ranges and tracks. |
| 24 | Conversational commands with scope | ✅ | Free-text constraint extraction (`extractConstraintsFromPrompt`, `mergeDirectorConstraints`) enforced by validator rejection. |
| 25 | B-roll: user library first, then stock | ✅ | User library searched via BM25 (`/media-search`) before falling back to stock providers. |
| 26–27 | Image and carousel agent with a design system | ✅ | Creative engine: brand fonts and colours, contrast check, image model with stock fallback, typed `IMAGE_MODEL_NOT_CONFIGURED`. |
| 29–34 | Publishing adapters, capabilities, token security | ✅ | Instagram, Facebook, Threads, YouTube, LinkedIn, X, TikTok, Pinterest and Reddit adapters + User-Assisted Fallback. Capability matrix. AES-GCM vault tokens. |
| 36 | Separated agent memory | ✅ | `AgentMemoryService` stores preferences, proposal feedback, performance history per project. Injected into Director (web & mobile) and Strategist context. |
| 37–38 | Token economy and retrieval | ✅ | Compact context + BM25 local index over user media segments and transcripts. |
| 40–41 | AUTO / ASSISTED / MANUAL autonomy | ✅ | Per-project autonomy setting with safe-op allow-list. Propose vs auto-apply logic in Director. |
| 42 | Explain before apply | ✅ | Summary plus applied-operation chips, with Apply and Undo. |
| 43 | Observability events | ✅ | `AgentRunEmitter` structured event stream (`AgentStarted`, `PlanValidated`, `ToolCalled`, ...) with `/agent-runs` REST endpoints. |
| 44–46 | Provider abstraction, free-first | ✅ | LLM kernel, image provider chain, stock providers, and publishers abstracted. Local/device-first analysis prioritized. |
| 47–48 | Android architecture and job states | ✅ | Unified job model (`QUEUED` → `ANALYZING` → `PLANNING` → `EDITING` → `RENDERING` → `CRITIQUING` → `REPAIRING` → `COMPLETED`/`FAILED`/`CANCELLED`) in Flutter `studio_job.dart` and desktop `studio-jobs.ts`. Cancel and crash recovery support. |
| 49–52 | End-to-end journey and real-media tests | ✅ | Node E2E journey test (`studio-journey.e2e.ts`), director OS tests (`director-os.test.ts`), publishing sandbox test, mobile workspace and user-assisted publishing suites passing. |
| 53 | Regression safety | ✅ | All package test suites pass (100/100 control plane, video contracts, social media, flutter). |

## 3. Plan: what to build, and where it plugs in

This plan extends the existing modules. It adds no new engine and no new IR.

**P1: Foundation (backend and contracts)**
1. **Onboarding fields:** add the missing brand-consciousness fields: website, industry, country, language, secondary colour, restrictions/claims, posting frequency and objectives. Use a partial PUT (already the pattern) plus a guided mobile onboarding flow that uses the completeness report.
2. **Autonomy policy:** a per-project `autonomy: { editing: AUTO|ASSISTED|MANUAL, publishing: ASSISTED|MANUAL }` setting.
   - A safe-op allow-list: silence trim, captions, audio levelling and reframe.
   - The Director auto-applies only when AUTO and every op in the plan is safe. Otherwise it proposes.
3. **Preservation constraints in the validator:** `lockedRanges`, `lockedTracks` (music, captions) and "keep captions".
   - The Director extracts these from the user's words.
   - The validator **rejects** ops that touch them, so the rule is enforced rather than prompt-only. `UserConstraintsSchema` already has `protectedTimeRanges` and `lockedTrackIds`; wire it end to end.
4. **Agent event log:** an `AgentRunEvent` table (runId, projectId, companyId, type, payload, ts). Emit it from autopilot, the Director, the creative engine and publishing, and add a run-inspector endpoint.
5. **Untrusted-content fencing:** one helper that wraps research, transcripts, filenames and captions in delimited "DATA, not instructions" blocks and strips instruction-like patterns. Add tests with injection strings.

**P2: Media intelligence (on the device first)**
1. **Android:** ML Kit text recognition (OCR, on-device, free), scene cuts via frame-difference, loudness/clipping via MediaCodec PCM. Store the results in the analysis the phone already sends (`media.faces` / `beatsMs` pattern).
2. **Desktop:** FFmpeg `scdet`/`select` scene cuts, `ebur128` loudness, `silencedetect` (already done). Add an optional local faster-whisper sidecar as a speech-to-text provider (benchmark first; Cartesia stays as the default).
3. **Semantic search over the user's library:** transcript and scene captions embedded with the existing RAG domain's embedding engine, scoped per project. Use it for B-roll "user library first".

**P3: Director quality loop**
1. **Critic in the loop:** after compiling, run `critic.ts` plus the new signals (dead air left, zoom density, caption overlap, music-over-speech loudness, black or frozen frames from device QA).
2. **Bounded repair:** if there are critical issues, run one to three repair turns with the issues as structured input. Stop at the cap and report the remaining issues honestly.
3. **Device QA:** after export, the phone and desktop run a quick QA (duration, resolution, audio stream present, black/frozen frame scan) and report back to the Director.

**P4: Memory and learning**
- Per-project agent memory: accepted/rejected proposals, style preferences, performance history from social insights. Retrieved compactly into the strategist and Director.

**P5: Jobs**
- A unified client-side job model (QUEUED → ANALYZING → PLANNING → EDITING → RENDERING → CRITIQUING → REPAIRING → COMPLETED/FAILED/CANCELLED) for Director runs and exports on mobile and desktop.
- Cancel support, and resume of in-progress exports after an app restart.

**P6: End-to-end and real media**
- A fixture set (talking head 9:16, 16:9 multi-clip, no-audio, mono, stereo music, multilingual, long pauses).
- A node E2E test runs the full journey with a stubbed LLM (deterministic plan), the real compiler, and the real desktop FFmpeg render with media-level checks.
- An Android instrumented test renders a fixture on an emulator.
- Test the publish payload against each adapter's request builder.

**P7: Live verification (needs the owner)**
- Keys, app reviews, a device run, the Rust CI build, deploy.

## 4. What only the owner can provide
- **AI:** a workspace LLM key, or `ANTHROPIC_API_KEY`. Optional research: `TAVILY_API_KEY` or `BRAVE_SEARCH_API_KEY`.
- **Speech:** `CARTESIA_API_KEY`, unless the local faster-whisper sidecar (P2) is adopted.
- **Images:** an image model key (creative engine). `PEXELS_API_KEY` and `PIXABAY_API_KEY` for stock.
- **Publishing:** `META_APP_ID`/`SECRET` (+ app review), `INSTAGRAM_APP_*`, `THREADS_APP_*`, `YOUTUBE_CLIENT_*` (+ upload audit), `LINKEDIN_CLIENT_*` (+ Community Management API access), `X_CLIENT_*` (paid tier), `TIKTOK_*`.
- **Platform:** `SOCIAL_TOKEN_ENCRYPTION_KEY`, `SOCIAL_OAUTH_CALLBACK_BASE_URL`, `CLIENT_URL`, storage (R2/S3), and rotation of the old Meta webhook token.
- **Verification:** a physical Android device run, a CI run of the desktop Rust build, and a production deploy.

## 5. Desktop (P2/P3-QA/P5/P6) status (2026-09-27)

Everything here runs on the user's computer with the bundled FFmpeg (4.1 git build `N-92722`). It has `ebur128`,
`blackdetect`, `freezedetect`, `select` scene scores and `mpdecimate`, but no `scdet`.

**P2: media intelligence (desktop)**
- `src-tauri/src/analysis.rs` adds three commands: `start_media_analysis`, `media_analysis_status` and
  `cancel_media_analysis`. They are registered in `build.rs`, `capabilities/main.json` and `lib.rs`.
  - It runs four fixed analysis kinds and writes nothing to disk:
    - `scenes`: `select=gt(scene,T)` + `showinfo`;
    - `loudness`: `ebur128` + `astats`;
    - `qa`: `blackdetect` + `freezedetect` + loudness;
    - `qa_nofreeze`: the same, but frozen picture is measured with `mpdecimate` + `showinfo`.
  - Paths follow the picker rules (picked, downloaded or saved-dialog files only).
  - Only the report lines the parsers read are returned, capped at 1 MB. Jobs can be cancelled; cancelling kills FFmpeg.
- `services/media-analysis.ts` holds the TypeScript mirror of the command lines and all the parsers.
- `tauri-bridge.ts` analyses the primary clip once per session: silences and transcript (as before), plus scene cuts
  and loudness.
  - They are sent as `telemetry.scenesMs` and `telemetry.loudness`. A top-level `media` key would switch
    `/ai-direct` to the mobile director, so it is not used. **Backend: read them from `telemetry` on the web route.**
  - A measurement that fails becomes a warning and is left out.
- **OCR on desktop: not integrated (decision).**
  - Tesseract is Apache-2.0, but it needs a per-OS native sidecar (about 30–40 MB with `eng` data, more per language).
  - There is no maintained static macOS binary to bundle, and results on stylised caption text are poor without
    preprocessing.
  - Revisit it with the ML Kit parity requirement, or use a WASM build inside the desktop app only.
  - `media.ocr` is not sent.

**Desktop provider evaluation (speech-to-text)**

`apps/desktop-app/scripts/stt-benchmark.py` runs faster-whisper 1.2.1 (CTranslate2 4.8.2) on CPU int8, on a 16-core
Windows machine. The test clip is 22 s of Windows SAPI TTS speech with a known reference text.

| Model | WER | Transcribe time | RTF | Peak RSS | Model size | Word timestamps |
|---|---|---|---|---|---|---|
| tiny | 7.5% | 37.7 s (first run, cold) | 1.71 | 179 MB | ~75 MB | 54 |
| base | 1.9% | 2.6 s | 0.12 | 288 MB | ~145 MB | 53 |
| small | 1.9% | 5.7 s | 0.26 | 616 MB | ~480 MB | 53 |

Load times included the first model download from Hugging Face (Systran/faster-whisper-*, MIT licence), so they are
not listed.

- **Server STT was not benchmarked:** there is no `CARTESIA_API_KEY` or OpenAI key on this machine.
- **Recommendation: do not ship faster-whisper in this Tauri app.**
  - It needs a Python runtime plus CTranslate2 (a 282 MB venv here), frozen with PyInstaller for each OS and
    architecture, on top of the model. That is about 400 MB+ per platform and adds code-signing and notarisation work.
  - Quality is good: base gives word timestamps at 0.12× real time.
  - The realistic local route is **whisper.cpp** (MIT) as an `externalBin` sidecar, next to FFmpeg: a few MB of binary
    plus a ~142 MB ggml base model downloaded on first use. Put it behind a provider switch (`STT_PROVIDER=local|server`),
    reusing the existing `extract_audio_for_transcription` output.
  - This is not implemented. The server STT stays the default.

**P3: post-export QA (desktop)**
- After every native export, `runExportQa` runs ffprobe, then the `qa` pass on the written file. If this FFmpeg build
  has no `freezedetect`, it runs `qa_nofreeze` instead.
- It produces `lastExportQa` in the shared-contract shape. `frozenRangesMs` is always a real measurement.
- `qaIssues` flags only measured problems that the timeline did not intend. Intended cases are main-track gaps,
  dip-to-black, `fade_black`, and photos as stills; black frames are not counted twice as frozen.
- The checks cover: duration, resolution, missing audio, black frames, frozen picture, loudness outside
  −24…−9 LUFS, and clipping.
- The export result shows the issues (a click seeks to the time), plus **Ask AI Director to fix**. That sends a repair
  turn with `lastExportQa`.
- A QA failure never fails the export; it shows a notice instead.
- A renderer fix came out of the E2E: `adjustVolume("original")` sets the PRIMARY_VOICE track level. The native export
  and the preview now apply that level to the main clip's own audio; before this, it was silently ignored.

**P5: jobs (desktop)**
- `services/studio-jobs.ts` has the same states as mobile:
  - QUEUED, ANALYZING, PLANNING, EDITING, RENDERING, CRITIQUING, REPAIRING;
  - then COMPLETED, FAILED or CANCELLED.
- Every job has an AbortController, and cancellation reaches:
  - the analysis FFmpeg (killed);
  - director requests;
  - stock downloads (new `cancel_remote_media`; the partial file is removed);
  - renders;
  - calendar uploads.
- `components/JobsTray.tsx` lists running and failed jobs, with Cancel and Dismiss.
- Jobs that were running when the app closed come back as FAILED ("interrupted"). An export can be run again with the
  same settings. An FFmpeg encode cannot continue part-way, so "resume" means re-run.

**Director UI and locks**
- Locks:
  - The Timeline track locks are now controlled. Locks were added to the caption and audio lanes.
  - **Lock range** locks the selected item's time range; locked ranges are drawn on the ruler, and a click removes one.
  - Locks are sent as `constraints` using the contract's track names (music, captions, text, broll, sfx, effects).
    A locked main track locks its whole duration. The camera lock is client-only.
- Client-side defense in depth (`services/director-locks.ts`):
  - If a result changed a locked track, that track is restored.
  - If a result would cut or re-time a locked range's footage, it is **not applied**. The chat says why and offers retry.
- The chat shows:
  - "Applied automatically" when the result has `autoApplied`;
  - the server `critique` (score, repair rounds, and issues whose click seeks to the time);
  - `violations`, with a Cancel button while a run is in progress;
  - the number of active locks.

**P6: fixtures + E2E**
- `apps/frontend/tests/fixtures/media/fixtures.ts` generates 9 lavfi fixtures into `<tmp>/180-media-fixtures-v1`. They
  are cached and nothing is committed.
  - Shapes: 9:16 talking head with pauses, 16:9 three-shot multi-clip, 1:1, no-audio, mono, stereo + music bed, long
    pauses, 1.5 s, and 60 s.
- `tests/integration/media-analysis.integration.ts` runs the real FFmpeg and checks scene cuts, loudness, clipping,
  silences, QA (both freeze methods), and no-audio: 9/9 pass.
- `tests/e2e/studio-journey.e2e.ts` (`cd apps/frontend && npx tsx tests/e2e/studio-journey.e2e.ts`): 16/16 steps pass
  in about 30 s.
  - **Real:**
    - brand-consciousness builders;
    - the autopilot pipeline code (its schema checks and brand enforcement);
    - calendar row persistence;
    - FFmpeg analysis;
    - `VideoAIDirectorService.directMobile` (planner loop, validator, expander, EditIRCompiler, constraints);
    - the native render plan and a **real FFmpeg render**;
    - media checks: size, fps, duration, audio present or absent, no black or frozen frames, caption boxes at their
      times, and the locked footage frame-identical;
    - the critic: VideoCriticService plus measured QA, which flags the quiet voice;
    - one repair turn with `lastExportQa`, then the final render with loudness fixed;
    - the multipart attach payload;
    - `buildPublishInput` per platform (no platform is called).
  - **Stubbed:**
    - all LLM replies (calendar agents and director tool calls are scripted);
    - speech-to-text (the fixtures are tones, so the script words are placed on the voiced segments);
    - caption text raster (a solid box per caption state, because the canvas rasteriser needs a browser).
- Current counts:
  - `npx tsc --noEmit -p apps/frontend`: 0 errors;
  - jest `tests/unit`: 181/181 (new `desktop-intelligence.test.ts`: 20);
  - `native-render-plan.integration.ts`: 27/27;
  - `media-analysis.integration.ts`: 9/9;
  - E2E: 16/16.

**Not verified / needs others**
- **Rust not compiled** (there is no cargo here). CI must run `cargo test --lib`: analysis.rs (4 tests) and remote.rs
  (the new cancel-flag test).
- The UI (JobsTray, the QA panel, the lock-range ruler, the critique list) was typechecked but not driven in a running
  desktop app.
- **Backend follow-ups (done 2026-09-27, see §6):**
  - The web `/ai-direct` now reads `telemetry.scenesMs`, `telemetry.loudness` (and `telemetry.ocr`, fenced) into the
    planner prompt.
  - The critic no longer compares export pixel size. It flags only an aspect mismatch (`export_aspect`, >2 %), a
    duration mismatch, missing audio, and unexpected black or frozen frames.


## 6. Backend status: P1, P3, P4, and the backend parts of P2 and P6 (2026-09-27)

Everything below extends existing modules. There is no new engine, IR or agent framework. The AI still emits only
operations, and every operation goes through the validator and then the EditIRCompiler.

| Item | Status | Where |
|---|---|---|
| Onboarding fields (contract A) | ✅ | `social-media/src/brand-consciousness.ts`. Adds `website`, `industry`, `country` (ISO-2), `language` (BCP-47), `colors.secondary`, `restrictions{}`, `postingFrequency{}`, `objectives{}` and `autonomy{}`. The nested objects merge per key on a partial PUT. Completeness and the prompt context were extended. |
| Autonomy + SAFE_OPS (contract C) | ✅ | `video-contracts/src/director-constraints.ts` (`SAFE_OPS`, `decideAutoApply`). The Director reads `ctx.brand.autonomy`. `autoApplied` is true only when editing is AUTO and every op is safe. Publishing autonomy is stored and returned; the dispatcher still always needs approval or a person. |
| Preservation constraints, enforced (contract B/C) | ✅ | `director-constraints.ts` (extract, merge, enforce, `mapLockedRanges`, `verifyLockedRangesPreserved`) and `plan-validator.ts` (`violations`). The model can only *add* locks, through `finish_edit.preserve`. |
| Agent event log (contract D) | ✅ | `ai/src/agent-runs/agent-events.ts` and the Prisma `AgentRunEvent` model. Emitted by the Director, Autopilot, the Creative engine and the publish dispatcher. Routes are in `apps/backend/.../projects/agent-os.routes.ts`. |
| Untrusted-content fencing | ✅ | `video-contracts/src/untrusted-content.ts`. Used for transcripts (word-level), OCR, filenames, captions/titles, calendar scripts, research results and memory notes. |
| Critic in the Director loop (P3) | ✅ | `video-contracts/src/director-critic.ts` plus the loop in `video-ai-director.service.ts`. Up to 3 repair rounds. Only CRITICAL issues that are repairable *and introduced this turn* are repaired. A round that does not help is discarded. Remaining issues are reported in `critique` and `warnings`. |
| Per-project memory (P4) | ✅ | `social-media/src/agent-os/agent-memory.ts` and the Prisma `AgentMemory` model. Memory goes into the Director and strategist prompts. Preferences are captured from the creator's words. |
| Semantic library search (contract E) | ✅ | `social-media/src/agent-os/media-index.ts` and the Prisma `MediaIndexEntry` model. Uses local BM25 (see the provider matrix). |
| Brand-bleed test | ✅ | `apps/backend/.../projects/brand-bleed.test.ts`. It found and fixed two leaks: (1) the dispatcher accepted an account from another project in the same company when the post named it explicitly; (2) the director context accepted another project's calendar piece or post. |
| Migration | ✅ file only | `packages/db/prisma/migrations/20260927100000_agent_os`. **Not applied to any database.** |

**Tests (all in-memory, none uses DATABASE_URL):**
- video-contracts `director-os`: 13
- ai `director-os`: 12
- ai `video-director`: 58
- social-media `social-os`: 7
- backend `brand-bleed` + routes: 2
- regression: brand 15, autopilot 17, tenant-routes 6, creative 20 + 2, publishers 16, tenant-isolation 16, post-edge 15

**Remaining:**
- The `agent-memory` feedback endpoint has no client caller yet (mobile and desktop should call it on Apply/Undo).
- Performance memory needs per-post metrics from the platform insights sync (P7 live keys).
- `autonomy.publishing` is stored but not yet enforced by the scheduler.
- The deterministic fallback's raw `removeRange` pause cuts are never auto-applied (they are not in SAFE_OPS).
- The migration has to be applied by the owner.
- `prisma generate` could not replace the query-engine DLL while a local process held it. The client types are
  regenerated; restart the dev server to pick up the engine.

## 7. Provider matrix

| Capability | Provider(s) wired | Local? | Free? | Paid? | License / terms | Recommendation |
|---|---|---|---|---|---|---|
| LLM planning (Director, autopilot) | Workspace key: Claude / OpenAI / Gemini (kernel) | no | no | yes (per token) | provider ToS | Keep Claude as the default, with the labelled deterministic fallback |
| Speech-to-text | Cartesia `ink-whisper`, OpenAI Whisper (027187d) | no | no | yes | provider ToS | Add a faster-whisper desktop sidecar (MIT) after the `stt-benchmark.py` results |
| Scene cuts | FFmpeg `scdet` (desktop), frame-diff (Android) | yes | yes | – | LGPL/GPL (FFmpeg) | Keep on the device |
| Loudness / clipping | FFmpeg `ebur128` (desktop), MediaCodec PCM (Android) | yes | yes | – | LGPL/GPL | Keep on the device |
| OCR | ML Kit text recognition (Android) | yes | yes | – | Google ML Kit terms | Keep; desktop: Tesseract (Apache-2.0) if needed |
| Faces / reframe | ML Kit (Android) | yes | yes | – | ML Kit terms | Keep |
| Semantic media search | Local BM25 (`media-index.ts`) | yes (server, text only) | yes | – | own code | Keep. Later add local embeddings (e.g. `bge-small`, MIT) behind the same API. The RAG `EmbeddingEngine` was not reused: it is company/vault-scoped, needs a paid OpenAI key and silently mixes hash fallback vectors. |
| Web research | Tavily / Brave | no | free tiers | yes | provider ToS | Optional. Results are fenced as untrusted data. |
| Stock video/photo | Pexels, Pixabay, Wikimedia, Internet Archive, NASA | no | yes | – | Pexels/Pixabay licences, CC0/PD/CC BY(-SA) | Keep. Credits are carried in `credits[]`. |
| Music | Curated Kevin MacLeod catalogue, Freesound | no | yes | – | CC BY 3.0/4.0, CC0 | Keep. The credit line is required. |
| SFX | Freesound (key) / Openverse | no | yes | – | CC0 / CC BY | Keep |
| Image generation (carousels) | Workspace image model, with stock fallback | no | no | yes | provider ToS | Keep. `IMAGE_MODEL_NOT_CONFIGURED` when there is no key. |
| Rendering | Media3 (Android), FFmpeg via Tauri (desktop) | yes | yes | – | Apache-2.0 / LGPL-GPL | Keep. Never on the server. |
| Agent events / memory | Postgres (Prisma) | server | yes | – | own | Keep |
