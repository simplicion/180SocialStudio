# Verification report

Prompt A (end-to-end verification of the AI Director and the manual editor), started 2026-11-15 on branch
`production` at `3eb894f`. Every PASS cites its evidence; anything not run says why.

**Environment.** Windows 11, Node 20, Flutter (project SDK), JDK, Python 3.13. Android emulator image
`Pixel_7_API_34` available; no macOS (no iOS build or tests); ffmpeg/ffprobe not installed at the start.
OpenAI is the platform's provider and its account has **no credits** ("429: You have no credits remaining"), so
every check that needs a working model is blocked. No Anthropic / Gemini key is configured.

**Safety during the run.** The local `.env` files point at the production database and at an AWS ElastiCache
Redis. Every suite was run with `DATABASE_URL=postgresql://qa:qa@127.0.0.1:1/qa_unreachable` and `REDIS_URL=""` so
no test could read or write production data. The ElastiCache host is not reachable from this machine (TCP
timeout), so no earlier run reached it either.

---

## Section 0: build and static checks

| Check | Result | Evidence |
|---|---|---|
| `pnpm install` | PASS | workspace already installed; lockfile unchanged |
| `pnpm build` (turbo, all packages) | PASS | exit 0, 2 min 14 s; 2 turbo warnings: no `outputs` declared for backend / runtime builds (config only) |
| `pnpm -r lint` | NOT CONFIGURED | no package defines a `lint` script; there is nothing to run |
| `tsc --noEmit` per package (10 packages) | 8 PASS, 2 FAIL | backend, backend-common, db, db-social-studio, video-contracts, video-engine-runtime, ai, rag: 0 errors. **social-media: 5, workspace-tools: 14 errors**, all TS2742 ("inferred type cannot be named without a reference to … generated/client/runtime/library"): declaration portability of functions returning Prisma-inferred types. No runtime effect, the build passes. Pre-existing; open issue O-3. |
| Strict mode | info | strict: db, db-social-studio, video-contracts, video-engine-runtime. Not strict: backend, backend-common, ai, rag, social-media, workspace-tools. The AI package is also compiled under the runtime's strict config (that is where the Director's strict errors are caught). |
| `flutter analyze` | PASS | 0 errors, 0 warnings, 10 infos (unnecessary imports and similar) |
| `dart format --set-exit-if-changed` | NOT ENFORCED | the codebase is not dart-formatted at any width (42–44 untouched files change at 80/120/160), so formatting only the changed files would be noise |
| Android `:app:assembleDebug` | PASS | `BUILD SUCCESSFUL`, `build/app/outputs/flutter-apk/app-debug.apk` (301 MB). 19 warnings, all "Deprecated 'org.jetbrains.kotlin.android' plugin usage" (Flutter plugin migration notice) |
| Kotlin unit tests `:app:testDebugUnitTest` | PASS | 4 classes, 30 tests, 0 failures (`build/app/test-results/testDebugUnitTest/*.xml`). The first attempt ran every plugin's tests and hit the time limit; re-run app-only |
| iOS `xcodebuild` build + tests | NOT RUN | no macOS machine |
| `services/diarize-worker` pytest | PASS | 6 passed (fresh venv, `pip install -e .[dev]`) |
| `services/trend-worker` pytest | PASS | 60 passed (fresh venv) |

Warnings that point at real defects: none from the compilers. Two found by the tests (Section 1).

---

## Section 1: existing test suites

| Suite | Result | Evidence |
|---|---|---|
| `pnpm test` (scripts/test-all.mjs) | PASS | 3/3 suites |
| `packages/video-contracts/tests` | PASS | 111/111 |
| `packages/domains/ai/tests` (all 26 files) | PASS after fixes | 276 → all pass except one database integration test (below). Fixed F-1, F-2 |
| backend `src/**/*.test.ts` (18 files) | PASS after fixes | 131 tests: 130 pass, 1 skipped, 0 fail (was 3 fail). Fixed F-3, F-4, F-5 |
| `video-engine-runtime` edge suite (28 tests) | 27 PASS, 1 FLAKY | Test 28 (Pixabay sourcing) failed with HTTP 429 from Pixabay. This suite calls real external APIs with the configured keys (Cartesia, OpenAI Whisper, Pixabay); open issue O-4 |
| `flutter test` | PASS | 348/348 |
| Kotlin unit tests | PASS | 30/30 |
| `scripts/director-eval` gate + replay tests, replay eval + gate | PASS | 6/6 tests; replay eval 33/38 checks = baseline, `gate passed (replay)` |
| *(extra, not in Prompt A)* `packages/domains/social-media/test` | 204 PASS, 37 FAIL | not fixed here; see open issue O-1 |

**Not run (needs a database):** `packages/domains/ai/tests/credit-meter-and-revision.test.ts` credits $5 to a
company and reads it back. It is a database integration test that WRITES; run against the local `.env` it would
write to the production database. It needs a disposable test database (open issue O-2).

### Fixes

| # | Fix | File | Test |
|---|---|---|---|
| F-1 | **Production bug.** `basePrisma` is imported by the website builder (business context, domain registry) and a website provider, but `@workspace/db` never exported it: every such call threw `Cannot read properties of undefined (reading 'company')`. Exported `basePrisma` (the unscoped client; `prisma` is already unscoped). Models and fields verified in the schema. | `packages/db-social-studio/src/index.ts` | `website-ai-sanitizer.test.ts` "compileAST: provider failure …" crashed before, 11/11 now |
| F-2 | Test bug: `OrbitEventBus` used without being imported (Test #090). | `packages/domains/ai/tests/orbit-control-plane.test.ts` | 100/100 |
| F-3 | **Production bug.** The device registry falls back from Redis to process memory per operation. With a lazily connecting client (or a Redis blip), a device saved during the fallback was invisible to later Redis reads: its token was refused until the phone registered again. Reads now merge the memory fallback (newest copy wins), a successful Redis write clears the fallback copy, and revoking deletes from both. Reproduced here because a local Redis runs on 127.0.0.1:6379. | `apps/180-social-studio-backend/src/api/v1/desktop/desktop-device.ts` | new test "a device registered while Redis was unavailable is still found once Redis is back"; fails on the old code (verified), 20/20 now, 3 consecutive runs |
| F-4 | **Security bug.** `sendRouteError` (73 social-media routes) returned `error.message` on unexpected errors, so Prisma messages (query + database host, e.g. `10.0.0.5:5432`) reached clients, contrary to its own contract and test. Introduced in `f4d9bb1`. Now a generic 500, full error logged server-side. | `apps/180-social-studio-backend/src/api/v1/social-media/route-errors.ts` | `tenant-routes.test.ts` "content-calendar: an unexpected error is a generic 500 without internals" |
| F-5 | Test out of date: analytics gained `milestones` (an array the app reads, added 2026-11-03); the "flat fields only" assertion now allows exactly that field and checks it is a list. | `apps/180-social-studio-backend/src/api/v1/social-media/projects/social-insights.test.ts` | passes |

Flaky: `video-engine-runtime` Test 28 (Pixabay 429: external rate limit).

---

## Section 2: provider and planner health

| Check | Result | Evidence |
|---|---|---|
| Live Director turn with the configured OpenAI key | BLOCKED (account) | OpenAI answers `429 You have no credits remaining`. The turn is still answered, labelled `plannerSource: deterministic`, `fallbackReason: llm_error`, and the app shows the fallback banner. No silent fallback. |
| Invalid key | PASS | probe with a bad key: the log shows the readable `auth 401: Incorrect API key provided`; the turn is labelled fallback `llm_error` |
| 401 / timeout / hung call / invalid tool args | PASS (existing tests) | ai tests "LLM error (e.g. 401/timeout) …", "LLM timeout: a hung planner call becomes a labelled deterministic fallback", "repair retry: invalid tool args …" |
| The app tells the user | PASS | Flutter widget test for `FallbackBanner` |
| No retired model id is a default | PASS | model-config test "no default is retired" (Director `gpt-6-astra`, judge `gpt-6.1-sol`) |

What the planner does with a *working* model (quality, latency, cost per turn) cannot be measured until the OpenAI
account has credits: open issue O-5.

---

## Section 3: Director behaviour

Run with scripted models through the real pipeline (scope, playbook, story pass, agent loop, guards, compiler,
critic, projection). The models' *judgement* needs the live key (O-5); everything the code enforces is checked.

| Case | Result | Evidence |
|---|---|---|
| a. "edit this video" asks / recommends first | PASS | "conversation: 'edit this video' without an LLM recommends …" |
| b. "yes" executes the agreed plan | PASS | "conversation: 'yes' to the plan in history executes it …", "with an LLM, 'yes' sends the agreed plan …" |
| c. "make it punchy for TikTok" full edit | PASS after fix F-6 | **new** `director-qa-full-edit.test.ts`: pauses and false start cut (story pass), no word half-cut, a caption over every kept word, first word ≤ 0.5 s and it is the clean take, zooms centred on the face track (not the model's 0.5/0.5), music ducked, nothing past the end, ≤ 4 floating layers, IR valid under the renderer's schema, playbook `fast_hype` |
| d. narrow edits touch only their scope | PASS | 49-case scope eval with `forbiddenChanges` ("make the music quieter", "add a zoom on the punchline", "cut the first 2 seconds", "add captions but don't touch the music", "make the captions yellow", **new** "remove the title") |
| e. locked tracks / items survive | PASS | "F-21: a locked title survives …", "request lockedTracks: music ops are rejected …" |
| f. F-10 guards | PASS | F-10 tests |
| g. prompt injection in the transcript | PASS | "fencing: an injection spoken in the video is fenced …" |
| h. no transcript | PASS | "captions without a transcript are skipped with a warning" |
| i. undo / redo of a Director edit | PASS | Flutter `studio_controller_test.dart` "an applied director edit replaces the timeline; undo/redo walk it back and forth" |
| j. critic catches defects | PASS | "critic: dead air, zoom overlap/density, caption overlap/bounds, unducked music, micro clip", "critic + repair …", "a repair that would remove the captions … is discarded", **new** "QA 3j: a caption on screen for under 250 ms is reported" |

### Fix

| # | Fix | File | Test |
|---|---|---|---|
| F-6 | **Production bug.** A filler cut started exactly on the filler's first sample; the compiler snaps cut starts *up* to the next frame (so kept speech is never clipped), so up to one frame of the "um" stayed on the timeline (13 ms of "um" at 18.22 s in the talking-head fixture: an audible click). Filler cuts now start up to 50 ms into the preceding gap (never before the previous word's end), mirroring the existing 150 ms extension at the end. | `packages/video-contracts/src/plan-expander.ts` | 3c test failed with `"um" at 18220 is half-cut (13 ms kept)`, passes now; contracts 112/112, ai 279 pass + 1 skipped, replay gate passed (33/38 = baseline) |

---

## Section 4: manual editor

Preview/timeline side: Flutter unit and widget tests (348/348, Section 1) drive the same pure `TimelineOps` the Studio
buttons call. Export side: on-device integration tests on the `Pixel_7_API_34` emulator (Android 14, x86_64), Media3
1.11.1 export, files pulled to `docs/qa/evidence/` and probed with ffmpeg/ffprobe 8.0. Runner: fixtures pushed after the
fresh install, evidence mirrored before `flutter test` uninstalls the app.

| Operation | Timeline / preview test | Export evidence | Result |
|---|---|---|---|
| import + 9:16 reframe | "one clip over the whole source, centre-cropped to 9:16 …", "initial and setAspect centre the crop on the face …" | manual demo (no crossfade), core render | PASS |
| trim | "selected item shows trim handles; dragging the end handle trims it", "trim and reorder" | manual demo cuts | PASS |
| split | "split creates two contiguous clips …", "split at a clip edge is refused" | covered via cuts | PASS |
| delete with ripple | "ripple delete shifts captions, zooms, b-roll, speech and music together", "removeRange drops content …" | manual demo: 6 cuts, 28 066 ms timeline → 28 075 ms file | PASS |
| reorder | "trim and reorder", "captions after cuts + a re-order follow the timeline" | manual demo reorder [12400, 16950, 800, 5950, 36700] | PASS |
| duplicate | "duplicate inserts a copy after the clip and ripples later items" | (timeline only) | PASS (preview) |
| speed | "speed change rescales duration …", "speed ramp splits the clip …" | core render (1.25x clip), "frame rate: 15 fps … speed changes" | PASS |
| volume / fades | "fades are stored, capped …", "a hard cut gets a 10 ms fade …" | "clip audio fades …" | PASS |
| rotate / flip | "rotate 90 re-centres the crop …"; flipH carried through every rebuild (`timeline_ops.dart`) | not exported in a test | PASS (preview) / flip export NOT RUN |
| crop / reframe | "crop outside the frame is rejected", "cropAt interpolates the moving crop …" | 9:16 / 1:1 / 16:9 exports | PASS |
| filters / colour grade | "neutral grade is the identity", "exposure doubles per stop …" | "colour grade: export matches the preview matrix" | PASS |
| transitions | "crossfadeAt mirrors the renderer …", "mobile transition types round-trip" | "crossfade: the incoming clip really overlaps …" passes alone; **manual demo with crossfade + B-roll + sticker fails on the emulator** (O-6) | PARTIAL |
| text add / edit / style / move | "Text tool adds a title, then edits …", "long-press drag moves a text item …", "text template: …" | "text motion (in / out / loop / typewriter) renders on device" | PASS |
| auto-captions + manual fix | "auto captions group words …", "an edited speech caption with a different word count is re-timed …" | core render (kinetic captions), manual demo (38 captions) | PASS |
| sticker / overlay position, scale, keyframes | "a sticker is a contained image layer …", "two keyframes animate the layer between them …" | "stickers: a transparent PNG layer …", "layers: PiP … keyframed fade-in" | PASS |
| B-roll insert | "effects, B-roll and sound effects merge by id …", "photo overlays keep mediaType …" | core render, manual demo | PASS |
| music add / replace / duck | "music beds: …", "music needs a device file or web URL and ducks only with speech" | "ducking: music drops by ~duckDb inside speech ranges" | PASS |
| SFX | "sound effects: add at playhead, volume, move, trim, delete; JSON round-trip" | (timeline only) | PASS (preview) |
| voiceover | "voiceover: placed at the playhead …" | "voiceover: placed at its slot over muted footage …" | PASS |
| freeze frame | "insertStill splits at the playhead, holds the still …" | "freeze frame: a still on the main track holds …" | PASS |
| undo / redo | per-op "one undo step" tests; "an applied director edit replaces the timeline; undo/redo walk it back and forth" | n/a | PASS |
| save / reopen draft | "current drafts are not migrated and round-trip with the units version", "legacy drafts scale old …", "itemMeta round-trips" | n/a | PASS |
| export 9:16 / 1:1 / 16:9 | "aspect change recomputes crops; fit mode clears them" | **new** "each export format (9:16, 1:1, 16:9) …": 1080x1920, 1080x1080, 1280x720, 3.03–3.07 s, audio | PASS |
| Director → manual → Director | "F-01 a manual edit made while the Director is thinking is merged …", "F-02 …", "Director removes an item the creator changed: kept, with a note", "both cut: structural conflict …" | n/a | PASS |

**O-6 (emulator, needs a phone).** `real_edit_demo_test.dart` (the full manual edit) fails to export on the emulator, deterministically, with
SwiftShader and with the host GPU: `C2GoldfishAvcDec: fetchGraphicBlock for Output failed with status 22` → `ERROR_CODE_DECODING_FAILED` /
`MUXING_TIMEOUT`. Removing only the crossfade line, the same edit exports correctly (5 clips, 38 captions, 2 zooms, B-roll, sticker, ducked
music; 28 075 ms vs 28 066 ms timeline; 1080x1920). The engine's own crossfade + B-roll test passes, so it is this combination (crossfade on the
graded main track + a 25 fps portrait B-roll + sticker) exhausting the emulator decoder's output buffers. The engine has typed retries for HDR
and storage but none for a decoder dying mid-export. Whether real phones hit it is unknown until a device run; a fix (decoder budget per device
via `MediaCodecInfo.getMaxSupportedInstances`, or a software-decoder retry) is not small.

---

## Section 5: render truth

Every file below was exported on the emulator and probed on the host with ffprobe / ffmpeg 8.0 (`ebur128=peak=true`,
`blackdetect=d=0.5`, `freezedetect=d=1`). Files are in `docs/qa/evidence/`.

| Check | Result | Evidence |
|---|---|---|
| Engine suite `media_engine_render_test.dart` | 24/25, **25/25 after F-7** | 25 on-device tests (cuts, speed, crop, B-roll, captions, zoom, ducking, fades, grade, layers, stickers, freeze, chroma, masks, reverse, cut-out, crossfade, stabilise, 15 fps, export settings, voiceover, narration, cleanup, cancel, missing media) |
| Export formats suite | 4/5 | silent, mixed, HDR (typed `HDR_NOT_SUPPORTED` on the emulator's decoder, as designed), **new** 9:16 / 1:1 / 16:9 PASS; **new** Studio loudness FAIL (O-7) |
| Duration = timeline ± 250 ms | PASS (36 files) | worst +65 ms (`format_16x9`); Director render 11 156 / 11 150 ms; manual edit 28 075 / 28 066 ms |
| Resolution / aspect | PASS | 1080x1920, 1080x1080, 1280x720, 720x1280 (720p setting) as requested. 9:16 files are stored 1920x1080 with a -90° rotation tag (Media3 picks the encoder's landscape orientation); players display 1080x1920. Info, not a defect |
| fps | PASS | 29.7–30.0 for the 30 fps canvas, 24.1 for the 24 fps setting; the 15 fps test passes |
| Audio present | PASS | AAC in every file with sound; the video-only source correctly exports without a track |
| Loudness ≈ -14 LUFS, true peak < -1 dBTP with platform loudness on | **FAIL** (O-7) | Studio default export: **-20.0 LUFS**, true peak -2.5 dBFS (ffmpeg and the on-device meter agree). Exports without the setting sit at -30…-33 LUFS (source level, as designed) |
| No black > 500 ms | PASS | none in 36 files |
| No frozen > 1 s | PASS | only `freeze.mp4` 2.13–4.00 s (the freeze-frame feature) and the pre-fix `chroma_keyed.mp4` (the unkeyed green frame) |
| Frames at cuts, caption changes, zoom peak, B-roll midpoint | PASS, 1 cosmetic | `docs/qa/frames/director_sheet.jpg` (8 frames). Caption text matches the planned speech at each moment, no tofu, inside the frame, below the face; the 1.3x zoom keeps the whole head; B-roll shows at its midpoint. Cosmetic: the word-pop layout leaves uneven gaps between words ("FOR   BEING   HERE"), Prompt B scope |
| Preview vs export, same frame | NOT RUN | needs a preview frame capture on a device; golden tests are Prompt B work |
| iOS export | NOT RUN | no macOS |

### Fix

| # | Fix | File | Test |
|---|---|---|---|
| F-7 | **Production bug (regression).** Image layers are drawn by `ImageLayersOverlay` (a canvas overlay), which honoured `mask` but ignored `chromaKey`. A keyed photo / PNG layer ("Remove green" in the inspector, or the Director's `insertBroll.greenScreen` on an image) was exported as a solid green frame covering the video. It was verified at 0.2/255 on 2026-10-02 (`EDITOR_CAPCUT_PARITY_PLAN.md`) and broke when image layers moved to the overlay path. The layer bitmap is now keyed once on load with the shader's exact maths (`ChromaKeyCpu`). | `android/.../mediaengine/ChromaKey.kt`, `VideoEffects.kt` | on device: background difference 164 → **0.21/255**, subject 253 red; new Kotlin `ChromaKeyCpuTest` (2 tests); Kotlin 32/32 |

**O-7: Studio exports are about 6 dB under platform loudness.**
- **What happens:** the voice measures -25.5 LUFS with a -4.3 dBFS peak, a peak-to-loudness ratio of about 21 dB. The
  engine applies +11.5 dB of make-up gain. A no-lookahead peak limiter (instant attack, 120 ms release, -2 dBFS
  ceiling) then has to take about 9 dB off every syllable's peak. It stays engaged for most of the speech and costs
  about 6 dB. Nothing measures the result.
- **Consequence:** the engine's warning ("mix normalised … to -14 LUFS") is untrue.
- **Fix options:** a compressor stage before the limiter, or a gain search that simulates the limiter on the decoded
  voice; then correct the warning.
- **Why not fixed here:** it's an audio-quality design choice (how much squash is acceptable on speech).

---

## Section 6: languages

| Check | Result | Evidence |
|---|---|---|
| Transcribe 19 languages (language code, word timings) | BLOCKED | needs OpenAI transcription credits (O-5) |
| Caption text from word timings (`PlanExpander.captionOps`) | en, hi, ar, ur, ko PASS; **zh, ja, th FAIL** | output `这 是 我的 故事。`, `これは 私の 物語 です。`, `นี่ คือ เรื่อง ของฉัน`: spaces are inserted between words in scripts that don't use them (O-8, Prompt B) |
| Arabic / Urdu word order on screen | NOT RUN | needs a device render with an RTL transcript; the caption strings are in correct logical order |
| Devanagari font for Hindi corrections | PASS | Flutter "a correction with the same word count keeps every word timing; Hindi text gets a Devanagari font"; "auto captions break on the Hindi danda" |
| Caption translation (en↔hi, hi→Hinglish) | BLOCKED | needs a working model (O-5) |

---

## Section 7: performance and robustness

| Check | Result | Evidence |
|---|---|---|
| Director turn latency p50/p95 | NOT RUN | only meaningful with the live model (O-5); replay runs time a scripted model |
| Export time | emulator only | 11.2 s Director render took 84 s; 28 s manual edit took 182 s. Software H.264 encoder on an x86 emulator, so not representative of a phone; a mid-range device run is needed |
| Memory peak | NOT RUN | needs a device profile |
| Cancel mid-export | PASS | "cancel stops the export with CANCELLED and removes the partial file" |
| Missing media | PASS | "missing media is a typed error, never a placeholder file" |
| HDR source | PASS (typed) | emulator gives `HDR_NOT_SUPPORTED` with an actionable message; the tone-mapping path needs a device |
| Decoder failure mid-export | **FAIL on emulator** | O-6 |
| No network / slow network, app killed mid-export, 10-minute source, VFR phone video, rotation metadata | NOT RUN | need a physical phone and real footage |

---

## Summary

| Area | Checks run | Pass | Fail | Fixed | Not run (why) |
|---|---|---|---|---|---|
| 0 Build + static | 13 | 10 | 1 (TS2742, O-3) | 0 | lint (not configured), dart format (not enforced), iOS (no Mac) |
| 1 Existing suites | 10 | 9 | 1 (social-media extra suite, O-1) | 5 (F-1…F-5) | 1 DB-writing test (O-2) |
| 2 Provider health | 5 | 4 | 0 | 0 | live quality (no OpenAI credits, O-5) |
| 3 Director behaviour | 10 | 10 | 0 | 1 (F-6) | model judgement (O-5) |
| 4 Manual editor | 25 ops | 23 | 1 (O-6, emulator) | 0 | flip export; duplicate and SFX export (timeline only) |
| 5 Render truth | 12 | 10 | 1 (loudness, O-7) | 1 (F-7) | preview-vs-export golden, iOS |
| 6 Languages | 5 | 2 | 1 (CJK/Thai spacing, O-8) | 0 | transcription and translation (O-5), RTL on screen |
| 7 Performance | 9 | 4 | 1 (O-6) | 0 | latency, memory, network, app kill, long/VFR/rotated source (device) |

Not every row is PASS, so the product does **not** fully verify yet.

### Open issues, ranked by user impact

1. **O-5: the OpenAI account has no credits.** Every real Director turn falls back to the (labelled) deterministic
   planner. Transcription, translation and live quality can't be checked. Needs a user action.
2. **O-7: Studio exports are about 6 dB under platform loudness** (-20 vs -14 LUFS), and the warning claims -14. This
   affects every export.
3. **O-6: the full manual edit fails to export on the emulator** (decoder exhausted by crossfade + B-roll + sticker).
   Unknown on phones. Needs a device run, then a decoder budget or retry.
4. **O-8: Chinese, Japanese and Thai captions get spaces between words.** Prompt B.
5. **O-1: the social-media domain suite has 37 failures.**
   - About 25 test platforms that were removed.
   - About 7 may be real bugs: approval re-entry, engagement bulk switch, YouTube `url`, proactive token refresh,
     tenant isolation.
   - Needs triage.
6. **O-4: the runtime edge tests call paid external APIs** (Pixabay 429 flake). They should be mocked.
7. **O-2: a DB-writing test needs a disposable test database.** Never run it against `.env`, which is production.
8. **O-3: TS2742 declaration errors** in social-media (5) and workspace-tools (14). The build is unaffected.

### Fixes made (each with a test that failed before)

F-1 `basePrisma` export (website builder crash) · F-2 test import · F-3 device registry lost devices across a Redis
blip · F-4 Prisma internals leaked in 500s · F-5 analytics test · **F-6 filler cuts left a frame of the "um"** ·
**F-7 green screen ignored on photo layers in export**.
