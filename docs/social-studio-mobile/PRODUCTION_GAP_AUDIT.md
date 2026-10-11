# 180 Social Media Manager: Production Gap Audit and Completion Plan

Audited 2026-09-26 against commit `8852feb`, read-only. Three parallel audits covered the AI Director
(web and mobile), brand, calendar, creative and the video bridge, and publishing, app health and
security. The critical findings were re-verified on `8852feb`. The plan below does not rewrite
anything: it finishes, wires up and fixes what already exists.

## 1. Requirement vs codebase

Legend: ✅ done · 🟡 partial · ❌ missing · 🔴 broken

| # | Requirement | Backend | Web | Mobile |
|---|---|---|---|---|
| 1 | Brand consciousness at project creation (type, positioning, tagline, ideology, colours, logo, font, voice, platforms), editable, no invented data | ✅ | ✅ | 🟡 form still saves invented `#6366F1`/`#EC4899`/Inter; no type/positioning/tagline/ideology/bg/text fields; uses the legacy brand-voice endpoint |
| 2 | Autonomous multi-agent calendar (research → strategist → 5-hook scripts → copy → critic), 7/14/30 days, background job | ✅ (17/17 tests) | ❌ still calls the legacy one-shot generator | 🟡 only per-piece regenerate; the generator uses the legacy path |
| 3 | Full teleprompter scripts (spoken hook, on-screen hook, retention loop, CTA, shot notes) | ✅ | 🟡 shows only the legacy script fields | 🔴 the teleprompter shows raw JSON |
| 4 | Realistic image model and brand carousels | ✅ (`creative/*`, 22 tests) | ❌ no UI | ❌ no UI |
| 5 | Calendar day → upload raw video → Edit in Studio → final video attached to the post | 🟡 new piece endpoints ✅; the legacy sync route is cross-tenant 🔴 | 🔴 URL text box only; the export attaches a local file path; the publish button fakes success | 🟡 the export uploads to the post ✅; no raw upload, no piece context, piece endpoints unused |
| 6 | AI Director really edits (understands footage, LLM tool calls, deterministic compile, renders on the user's device, zero AI pixels) | ✅ LLM tool-calling planner, 53/53 tests | 🟡 native FFmpeg export in the desktop app ✅, but no transcript/silences are sent, so the server plans blind | ✅ transcript + silences → LLM → compile → on-device render |
| 7 | Director is brand-conscious (colours, font, caption style, logo watermark, platform aspect) | 🟡 loads brand; `resolveBrandRendering` is unused | 🔴 never sends projectId, so it has no brand context | 🟡 brand captions ✅; watermark is dropped by the Dart model (server and Kotlin done) |
| 8 | Director is script/calendar-aware and opens with a brand-aware proposal ("apply?") | ✅ greet intent, script alignment, `/director-context` | ❌ static greeting | ❌ the client never sends intent or piece ids and rejects an empty prompt |
| 9 | Conversation → proposal → consent → apply → undo; custom follow-ups | ✅ | 🟡 LLM plans auto-apply without confirmation; no history sent; a 15 s timeout silently falls back to keyword edits | ✅ |
| 10 | Tools: silence/filler cuts, captions, zooms, B-roll (Pexels/Pixabay), music with attribution, SFX, transitions, reframe, speed, ducking | 🟡 SFX suggested only, never placed on the timeline | 🟡 no music/SFX resolution | 🟡 transitions approximated; SFX missing |
| 11 | Manual editing on the same timeline as the AI (crop, filters, music, text, trim/split, etc.) | ✅ | ✅ | ✅ (watermark lost on manual edits) |
| 12 | One-click connect for IG/FB/YouTube/LinkedIn/X/TikTok, encrypted tokens | ✅ PKCE, AES-GCM vault, migration | ✅ real OAuth redirect + picker + Reconnect (Phase 3) | ✅ picker sheet for `status=select` (Phase 3) |
| 13 | Real publishing, per-platform status, scheduler that respects approval | ✅ real publishers, lease claims, approval gate (16+ tests) | 🔴 fake-success publish in ContentPieceDrawer | ✅ uses the real endpoint |
| 14 | Each project/client isolated | 🔴 legacy calendar CRUD, `syncVideoFromStudio`, engagement rules and video-studio `companyId` are all spoofable | n/a | n/a |
| 15 | Production quality (no hardcoded secrets, tests green, design system) | 🔴 hardcoded Meta webhook token (`8852feb`) | 🟡 2 TS errors in MediaStudioWorkspace | 🔴 analyze: 3 issues, tests: 7 failing; the new light theme breaks 27 screens |

## 2. Bugs by severity (all verified on `8852feb` unless marked)

### Critical: fix before any deploy
1. **Hardcoded secret.** `packages/domains/social-media/src/publishing/config.ts:103` and
   `.github/workflows/production-deploy.yml:172-174` embed a Meta webhook verify token. Remove the fallback
   (a missing value should return 503), remove the injection from the workflow, and **rotate the value**.
   It is in git history.
2. **Cross-tenant write.** `social-post.service.ts:286` `syncVideoFromStudio` updates any calendar piece
   and post by id alone. Scope it by `companyId`, or retire it in favour of `/calendar-pieces/:id/final-video`.
3. **Cross-tenant read/write/delete of calendars.** `content-calendar.service.ts:30,141,207,216,270` uses
   `findUnique`/`update`/`delete`, which bypass the tenant filter in `packages/db/src/index.ts:181`.
4. **Fake OAuth on web.** `ConnectedAccountsManager.tsx:98-112` stores `live_token_<platform>_<ts>`.
5. **Fake publish success on web.** `ContentPieceDrawer.tsx:92-106` sends a piece id as the post id and
   marks the piece published even when the request fails.

### High
6. `video-studio.controller.ts:9,19,32,58,133`: `companyId` is taken from a header, the body, the query, or
   `"default_company"`. It decides whose AI key and credits are used. Take it from `req.user` only.
7. `engagement-rule.service.ts:8-30`: a rule can reference another tenant's account, post or project and
   auto-DM from it.
8. `publish-dispatcher.ts` `ensureVariants` (~253-262): a post with no account is published to whichever
   active account the query happens to return first.
9. Web Studio export attaches a local path as `finalVideoUrl` (`MediaStudioWorkspace.tsx:957-966`, plus
   TS errors at :193 and :957).
10. Web director sends no transcript, silences, projectId, pieceId, postId or history
    (`tauri-bridge.ts:744-752`). It also swallows errors with `catch {}` after a 15 s timeout and silently
    switches to keyword edits.
11. Mobile watermark is dead end to end: `edit_ir.dart` has no field, `studio_controller.dart` drops it,
    and `media_engine_service.dart` never passes `watermarkPath`.

### Medium
12. Accounts are loaded with `include: { socialAccount: true }`, which leaks the legacy plaintext token
    columns (`engagement-rule.service.ts:67`, `social-inbox.service.ts:47`, `ai-engagement-agent.ts:51`).
    `engagement-dispatcher.ts:95-102` also falls back to plaintext tokens.
13. Engagement models (`schema.prisma:3907`) have no migration, and the deploy never runs
    `prisma migrate deploy`.
14. `token-vault.ts` proactive refresh never actually refreshes (skew window).
15. `POST /accounts/connect` accepts arbitrary tokens from any user. Restrict it to admins or remove it.
16. `social-insights.service.ts:300-309`: stored data is labelled "live", and invented numbers are shown
    for `mock_` accounts.
17. No LLM timeout (`ai-provider.service.ts`, `creative-planner.ts:98,126`).
18. LLM plans auto-apply on web (`MediaStudioWorkspace.tsx:440`, gated on `confirmationDetails`).
19. `/render` accepts a client `outputPath` and renders on the server (breaks the desktop-only rule).
20. Mobile: analyze fails (`integration_test` is missing from `dev_dependencies`). Tests fail on the
    engagement tab Row, the composer's `SwitchListTile` in a coloured Container, and a 24 px inbox overflow
    at 320 dp.
21. Mobile: "Clear cache" deletes the whole temp dir, including in-progress renders and uploads;
    `_loadDevices` swallows errors.
22. Mobile: the new light theme is not tokenised; 27 files use dark constants, so light mode shows dark
    cards and invisible text. `engagement_tab.dart` uses raw colours and emoji (design-system violation).
23. `desktop-device.ts:217-223`: the device cap was changed to LRU eviction. The test fails. Decide which
    behaviour is intended.
24. Mobile brand form invents defaults (`brand_voice_form.dart:35-37`).
25. Mobile teleprompter receives the raw JSON script (`calendar_detail_screen.dart:157,390`).

### Low
26. Invented `09:00` posting time (`autopilot/persistence.ts:24`).
27. Missing docs: `AUTOPILOT_API.md`, `CREATIVE_ENGINE.md`, `PUBLISHING.md`, carousel samples.
28. Many routes return raw `error.message` with a 400 (possible Prisma detail leak).
29. The debug APK is 176 MB. Check that release builds use `--split-per-abi` and tree-shaking.

## 3. Completion plan

Each phase ends with typechecks, all test suites and `flutter analyze/test` green. Fixes go in with
tests. Nothing is rewritten.

### Phase 0: Security and build blockers (first, small)
- Items 1–3, 6–8, 12, 13, 15, 23 plus cross-tenant tests for each.
- Mobile tests and analyze green again (item 20).

### Phase 1: AI Director complete (main focus)
Mobile:
- `greet()` with `intent:"greet"`, projectId, calendarPieceId and postId, called when Studio opens from a
  post or piece. It shows the brand-aware proposal with Apply.
- Watermark: Dart model field, carried through director and manual edits, logo downloaded at export, passed
  as `watermarkPath`, plus a round-trip test.
- Opening from a calendar piece passes the piece id. The export attaches to `/calendar-pieces/:id/final-video`,
  and the raw footage upload goes to `/raw-footage`.

Web:
- `tauri-bridge.ts` sends the local transcript and silences as telemetry, plus projectId, pieceId, postId
  and chat history.
- Timeout of about 90 s, with errors shown to the user. The planner source is visible, and the offline
  keyword fallback is labelled as such.
- A greet call when Studio opens. Confirmation is gated on `requiresConfirmation`.
- Export uploads the MP4 to `/final-video`, and the 2 TS errors are fixed.

Server:
- LLM timeout.
- The style agent uses `resolveBrandRendering`.
- SFX placed on an sfx audio lane (contract, compiler, Android renderer).
- `/render` hardened or removed.

### Phase 2: Clients wired to the finished backends
- **Web:** autopilot start/poll UI (7/14/30 days, progress); a drawer showing spoken hook, on-screen hook,
  beats, retention loop, CTA and shot notes; "Make carousel", with the job polled and slides shown and
  attached; raw-footage file upload; publish via the linked post with an honest error state.
- **Mobile:**
  - Brand-consciousness GET/PUT with every field and no invented defaults.
  - Autopilot job flow.
  - The teleprompter parses the structured script.
  - Carousel generate/view.
  - Piece raw upload and "Edit in Studio".

### Phase 3: Publishing completion
- Real web OAuth (authorize redirect plus a result page), and a page/org selection step on web and mobile.
- Forced token refresh; honest metrics; restricted `/connect`; `PUBLISHING.md`.

### Phase 4: Mobile polish
- Either tokenise colours through `Theme.of(context)` or remove the light theme until it is tokenised.
- Bring the engagement tab onto the design system.
- Scope Clear cache to the app's own cache folder, and give the settings errors a retry.
- Split-per-ABI release build.

### Phase 5: Verification loop, then live
- Full automated suite. A device test on a real Android phone: camera, transcription, AI Director greet,
  apply, manual edit, export with watermark, attach, approve, publish (sandbox accounts).
- The owner provides the keys below, followed by live end-to-end tests per platform and a launch checklist.

## 4. What the owner must provide for live mode

| Area | Items |
|---|---|
| AI | Workspace LLM key (Anthropic recommended) or `ANTHROPIC_API_KEY`; optional `TAVILY_API_KEY` or `BRAVE_SEARCH_API_KEY` for research |
| Images | The image model key chosen in `creative/` (see its provider config), plus `PEXELS_API_KEY` and `PIXABAY_API_KEY` for stock |
| Audio | `CARTESIA_API_KEY` (speech-to-text); optional `FREESOUND_API_KEY` (SFX) |
| Storage | R2/S3 credentials (logos, uploads, final videos) |
| Security | `SOCIAL_TOKEN_ENCRYPTION_KEY` (32 random bytes), a new `META_WEBHOOK_VERIFY_TOKEN`, `META_WEBHOOK_APP_SECRET` |
| Meta (IG + FB) | App ID/secret, Business Verification, App Review for `instagram_content_publish`, `pages_manage_posts`, `pages_read_engagement`, and messaging/comments |
| Google / YouTube | OAuth client ID/secret, verification of the `youtube.upload` scope |
| LinkedIn | Client ID/secret, Community Management API / `w_organization_social` approval |
| X | Client ID/secret on a paid tier that allows posting and media upload |
| TikTok | Client key/secret, Content Posting API audit, domain verification |
| URLs | `SOCIAL_OAUTH_CALLBACK_BASE_URL`, `CLIENT_URL`/`SOCIAL_OAUTH_WEB_ORIGINS`; register `…/api/v1/social-media/accounts/oauth/<platform>/callback` in every developer console |

## 5. Additions (2026-09-26)

### Phase 6: Free media sources and on-device AI tools for the AI Director (in progress)
| Source / tool | Status before | Plan |
|---|---|---|
| Pexels (video, photos) | ✅ integrated | keep; use in ranking |
| Pixabay (video, photos, music, SFX) | ✅ integrated | keep |
| Freesound (SFX, CC0/CC-BY) | ✅ integrated | keep; licence filter |
| Wikimedia Commons | 🟡 music catalogue only | add video, images and audio search (no key) |
| Openverse | 🟡 referenced only | add images and audio (no key, commercial filter) |
| Internet Archive | ❌ | add public-domain archival video and audio (no key) |
| Jamendo | ❌ | add, behind `JAMENDO_CLIENT_ID`; commercial-licence caveat |
| Unsplash | 🟡 referenced only | add photos, behind `UNSPLASH_ACCESS_KEY`, following the API guidelines |
| Free Music Archive | ❌ | skip: the public API is discontinued |
| Face tracking (Google ML Kit, on device) | ❌ | smart 9:16 reframe and zoom centre follow the speaker |
| Beat detection (on device) | ❌ | music beats sent to the director; option to snap cuts to beats |

Attribution flows into the director warnings and the export credit.

### Phase 7: Meta (Instagram / Facebook / Threads) go-live checklist
1. **Deploy.** Production (api.180workspace.com) runs `ed40b0d`, so the OAuth callback and webhook routes
   return 401. Deploy the current `main` after Phase 0 lands.
2. **Rotate the webhook verify token.** The old value is in git history and in a pasted audit. Set a new
   `META_WEBHOOK_VERIFY_TOKEN` in the server `.env`, then enter the same value in the Meta Webhooks
   product. The code no longer has a fallback.
3. **Verify the handshake** with `GET /api/v1/social-media/webhooks/meta?hub.mode=subscribe&hub.verify_token=<new>&hub.challenge=x`.
   It must return `x`.
4. **Enter the Meta dashboard URLs:** privacy, terms, data deletion, deauthorize, and the three OAuth
   callbacks. They are listed in the Meta readiness audit (unchanged).
5. **Smoke test with a tester account:**
   - OAuth login writes a `social_account_credentials` row.
   - A live Reel publish succeeds with `ALLOW_SIMULATED_PUBLISHING=false`.
   - A comment triggers the engagement rule, the reply and the DM, under the rate limit.
   - Deauthorizing sets `reauthRequired`.
6. **App Review.** Record the screencast (connect, schedule a Reel and a carousel, post goes live, inbox
   comment, disconnect/deletion). Request `instagram_business_content_publish`,
   `instagram_business_manage_messages`, `instagram_business_manage_comments`, `pages_manage_posts`,
   `pages_manage_engagement` and `pages_read_engagement`.

## Status: Phase 0 backend (2026-09-26, uncommitted)
Done: items 1 (no verify-token default, deploy fails if missing; **rotate the old value**), 2, 3, 6 (typed 404 via
`SocialDomainError`, `tenant-scope.ts`), 7 (engagement rule refs), 8 (no arbitrary account), 12 (SAFE_ACCOUNT_SELECT,
vault-only tokens), 13 (migration `20260926090000_social_engagement` + `prisma migrate deploy` in the deploy),
15 (`/accounts/connect` admin-only), 19 (`/render` removed), 23 (409 cap restored), 28 for the touched routes
(`social-media/route-errors.ts`). Tests: `packages/domains/social-media/test/tenant-isolation.test.ts`,
`apps/backend/src/api/v1/social-media/tenant-routes.test.ts`.

## 180 Engagement hardening (2026-09-26)
Done: per-account Redis GCRA limiter (`engagement/rate-limiter.ts`, 30/min default, `SOCIAL_ENGAGEMENT_RATE_LIMIT_PER_MIN`, in-memory only outside production) with rate-limited events stored and replayed by the scheduler tick (`EngagementDispatcher.retryDeferred`); capability matrix (`engagement/capabilities.ts`) incl. IG/FB 7-day private reply and one-message-until-reply; real per-platform calls (`platform-actions.ts`, FB + X added), no mock-token fake success in engagement adapter methods; webhook fails closed without secret (503), raw-body only, idempotent on message/comment ids, ignores echoes/self comments; AI agent + Reply All + smart replies use the company AI with brand profile (AI_NOT_CONFIGURED / AI_TIMEOUT, forbidden words, lead once); inbox manual replies now really send; honest platform metrics (live IG/FB/YouTube or labelled stored/unavailable). Migration `20260926160000_social_engagement_hardening`. Tests: `test/engagement-production.test.ts`.
Open: web parity screens (engagement rules / inbox Reply All), Flutter tests for the new sheet states, YouTube Analytics API (uses Data API channel stats), X ingestion (no webhook), legacy `MetaAdapter/LinkedInAdapter/TikTokAdapter/YouTubeAdapter.publish*`/`uploadCaption` still short-circuit on `mock_` tokens.

### Phase 1: mobile AI Director (done 2026-09-26)
- **Greeting.** When Studio opens from a calendar piece or post, it now asks the server for its greeting
  (`intent:"greet"` with projectId, calendarPieceId and postId). The reply is a brand- and script-aware proposal
  that waits for Apply. The old hardcoded local greeting, which used invented colour and font defaults, is removed.
- **Director context on every turn.** Each turn now sends `calendarPieceId` and `postId`.
- **Watermark.** The brand logo watermark now works end to end:
  - the Dart model (`EditIrWatermark`) keeps it through every director turn and manual edit;
  - the logo is downloaded at export and passed to the renderer as `watermarkPath`;
  - if the download fails, the export continues without the logo and shows a warning.
- **Export attach.** A video exported from a calendar piece is attached through
  `POST /calendar-pieces/:id/final-video`, which creates the post if needed. The camera now passes pieceId,
  hook and script through to Studio.
- **Tests.** Greeting and watermark tests added; `flutter test` passes 122/122, analyze is clean.
- **Still open on mobile:** placing SFX on Android (needs the contract `sfx` lane from the web/server agent);
  optional raw-footage upload from the piece sheet.

### Phase 1: web + server AI Director (done 2026-09-26, uncommitted)
- **Server.** Each planner LLM call has a timeout (`AI_DIRECTOR_LLM_TIMEOUT_MS`, default 60000). A timeout raises
  `DirectorTimeoutError` and falls back to the deterministic planner, with `plannerReason` starting `LLM_TIMEOUT:`
  and a warning (item 17). The style agent uses WS1 `resolveBrandRendering()`: `director-context.ts` puts it on
  `DirectorBrandContext.rendering`, and `brandStyleDefaults` uses it for colours, font, caption preset and watermark.
  Every neutral default is named in the warnings and never saved. On a greet turn, SFX suggestions are placed on an
  optional `audio.sfx[]` lane (`MobileSfxSchema`, documented in AI_DIRECTOR_CONTRACT.md §3.6), with credits.
  The web `/ai-direct` now forwards `history`. Tests: 4 new in `video-director.test.ts` (58/58 pass).
- **Web** (`media-editor/services/tauri-bridge.ts`, `components/MediaStudioWorkspace.tsx`, `AIDirectorPanel.tsx`,
  `ExportModal.tsx`):
  - Every turn sends projectId, calendarPieceId, postId and the last 12 chat turns, with a 90 s timeout
    (items 10 and 18).
  - Errors are shown in the chat with Retry and "Use offline rules". The offline rules are labelled
    `plannerSource:"offline"`, and the planner source and reason appear under every reply.
  - The static greeting is replaced by `GET /director-context`, whose Apply runs the suggested prompt.
  - Proposals are gated on `requiresConfirmation`, and a "yes/proceed" reply confirms them.
  - The export is uploaded as a multipart MP4 (with progress) to `/calendar-pieces/:id/final-video`, or to
    `/posts/:id/submit-for-approval`. The file is read from the desktop's asset-protocol URL. If that fails, the
    user can retry or pick the MP4 from disk. `sync-studio-render` is no longer called (item 9).
- **Still open:**
  - Local transcript and silence telemetry. The plumbing is ready (`telemetryFromGraph`), but the desktop app has
    no command for transcription, silences or audio extraction. It needs an `extract_speech_audio` preset (then
    `POST /transcribe`) and `detect_silences`. Until then, no telemetry is sent.
  - The web `compileAST` still runs server-side ffmpeg analysis when `currentEditIR` has a non-placeholder
    `sourcePath` (`video-ai-director.service.ts` ~L136). This breaks the desktop-only rule.
  - The `rawVideoUrl` asset in `MediaStudioWorkspace.tsx` still uses assumed metadata (15 s, 1080x1920).
  - The Android renderer for `audio.sfx`.
- **SFX on mobile (done).** The Dart model keeps `audio.sfx`. Effects follow the footage through cuts, and any
  effect inside a cut is dropped. Export downloads each effect with its credit, and any effect that fails to
  download is left out with a warning. The Android renderer plays each effect as a gapped audio sequence at its
  volume. Tests: 123/123; the Kotlin compiles.

### Phase 1: remaining items (next session)
1. **Desktop transcript for the web director.** The Tauri app has no audio-extract or silence command, so the
   web director still plans without a transcript. Add Rust commands in `apps/desktop-app/src-tauri`: an
   audio-extract preset, then `POST /transcribe`, plus `detect_silences`. `telemetryFromGraph` is already
   wired. Needs cargo (not installed on this machine).
2. **Server-side ffmpeg.** The web `compileAST` still runs ffmpeg on the server when the timeline has a real
   `sourcePath` (`video-ai-director.service.ts` ~136). This breaks the desktop-only rule and should be removed
   once item 1 lands.
3. **Assumed metadata.** `MediaStudioWorkspace.tsx`'s `rawVideoUrl` asset assumes 15 s at 1080x1920. Probe the
   file on the desktop instead.
4. **Export upload unverified.** Upload of desktop exports through `asset.localhost` has not been tested in the
   real Tauri app.

### Phase 1: web director speech analysis + desktop downloads (done 2026-09-26, not yet compiled locally)
- **New desktop commands** (`apps/desktop-app/src-tauri/src/media.rs`), both limited to files the user picked:
  - `detect_silences` runs the bundled ffmpeg `silencedetect` and flushes a trailing silence that runs to the
    end of the file.
  - `extract_audio_for_transcription` returns 16 kHz mono M4A bytes (25 MB cap) and deletes its temp file.
  - Both are registered in `lib.rs`, `build.rs` and `capabilities/main.json`, with Rust unit tests for the
    parser (CI runs `cargo test --lib`).
- **Web director.** `tauri-bridge.ts` now analyses the primary clip before planning: pauses are found locally,
  and the speech audio is sent to `/media-editor/transcribe`. The result is cached per file and sent as telemetry.
  Failures show as a chat warning.
- **Server-side ffmpeg removed.** `video-ai-director.service.ts` no longer runs ffmpeg or transcription on the
  server (desktop-only rule).
- **Downloads.**
  - The release workflow now builds macOS Intel (`macos-13`) in addition to Apple Silicon, Windows and Linux.
  - The download page offers separate Apple Silicon and Intel Mac buttons.
  - The Windows button now uses `/api/download/windows`. It used to point at
    `public/downloads/180Workspace-Setup-x64.exe`, which is a 29 KB placeholder, not the app.
  - `DESKTOP_DOWNLOAD_URL_MAC_INTEL` was added to the env example.
- **To verify:** run the "Desktop App Release" workflow (workflow_dispatch). It compiles the Rust code and runs
  the tests on Windows and macOS, then publishes a draft release.

### Phase 2: web clients (done 2026-09-26, uncommitted)
- **Service.** `apps/frontend/lib/services/social-autopilot.service.ts` holds the autopilot, creative, raw-footage and
  publish-via-post calls, plus `apiError()`, which normalises both error shapes (`{code,error}` and
  `{error:CODE,message}`). `social-engagement.service.ts` is fixed to match the real routes:
  - toggle is PATCH;
  - Reply All suggestions are POST, and dispatch sends `{conversationId, replyText}` and gets back per-item `results`;
  - the `stats*` counters are mapped to `total*`, and `totalLeadsGenerated` to `totalLeadsConverted`;
  - test-match sends an inbound event.
- **Autopilot create.** `content-calendar/create/AutopilotCreate.tsx` has a project picker, 7/14/30 days, start date,
  platforms and goals, then a polled progress view that opens the calendar when the job is done.
  - A 409 CONFLICT follows the job that is already running.
  - AI_NOT_CONFIGURED links to /settings/ai.
  - The legacy wizard is kept as a fallback, used only when the route returns a 404 with no code.
- **Content piece drawer.**
  - `piece/AutopilotScriptPanel.tsx` shows the spoken and on-screen hooks, hook type, the beats with retention
    devices, the retention loop, CTA, shot notes, carousel brief, per-platform captions and hashtags, posting time,
    sources and critic flags. Each has a copy button, and there is Regenerate with an instruction.
  - `piece/RawFootageUpload.tsx` is a multipart `video` upload with progress and cancel. It replaces the URL field.
  - `piece/PiecePublishPanel.tsx` finds the linked post and calls `/posts/:id/publish`. It shows the result for each
    platform and variant, and never fakes success.
  - `creative/CarouselMaker.tsx` handles carousel and static pieces, and the project post drawer: start, poll,
    slide grid, redo one slide, and IMAGE_MODEL_NOT_CONFIGURED with "Use stock photos" (`useImageModel:false`).
    It reopens the last job from `renderedCarousel.jobId` or `metadata.creative.jobId`.
  - The calendar page now passes `projectId` to the drawer.
- **Engagement.** The project Engagement tab gains edit, trigger type, and the auto-like and send-DM toggles. It also
  gets a real test matcher against saved rules, an error state with retry, and no placeholder deliverable URLs.
- **Inbox.** The `/inbox` page and the project Inbox tab were full of mock conversations and fake success. They now
  share `_components/inbox/InboxWorkspace.tsx`, which uses real data: send reply, smart suggestions, AI agent on/off,
  take over, and convert to lead. `AiReplyAllSheet.tsx` drafts replies, lets the user review and edit them, then
  dispatches and shows sent, failed or rate-limited for each item; rate-limited items can be re-sent.
- **Docs.** `AUTOPILOT_API.md` and `CREATIVE_ENGINE.md` describe the request and response JSON of the real routes, for
  the mobile client.
- **Check.** `npx tsc --noEmit -p apps/frontend` shows no errors in the touched files. No browser run has been done yet.

### Phase 2: mobile clients (done 2026-09-26, uncommitted)
- **Autopilot calendar**:
  - `lib/features/planner/autopilot_generator.dart` is now the default "Generate calendar" screen for the active project.
  - Inputs: 7/14/30 days, start date, platforms and up to 5 goals. It polls the job every 2 s and shows the stage label and %, then opens the calendar.
  - A 409 resumes the running job (`details.jobId`).
  - A failed job shows the server's reason, with Try again and "Use the classic generator". The classic stepper is still used to extend a calendar.
- **Structured scripts**: `PieceBrief.parse` (`lib/data/models/autopilot.dart`) reads the autopilot JSON in `videoScriptOrHooks`.
  - The piece sheet shows the spoken and on-screen hook, numbered beats, loop, CTA, shot notes, carousel brief and visual idea as copyable blocks.
  - The raw JSON is never shown or editable. Rewrite goes through "AI Autopilot Rewrite".
  - The teleprompter, camera and Studio get `teleprompterText` (hook, beats, loop, CTA with no labels) and the opening hook.
- **Carousels**: `lib/features/planner/carousel_sheet.dart` ("Design carousel slides" on carousel pieces).
  - Choose portrait or square, then it polls the creative job and shows a slide grid with a per-slide redo.
  - On `IMAGE_MODEL_NOT_CONFIGURED` it offers "Use stock photos", which retries with `useImageModel:false`.
  - The server attaches the slides to the piece/post.
- **Brand consciousness**: `lib/features/workspace/brand_identity_card.dart` sits on the Brand tab under the voice form.
  - GET/PUT `/projects/:id/brand-consciousness` for name, type, positioning, tagline, description, big idea, beliefs, background/text colours, target platforms, watermark (not chosen/yes/no) and guidelines.
  - It shows completeness % and "The AI still needs: …". Nothing is prefilled.
- **Raw footage**: `SocialApi.uploadPieceRawFootage` plus "Send raw footage to my editor" in the Edit-in-Studio sheet (`raw_footage_upload.dart`, progress dialog).
- **Tests**:
  - `test/sections/phase2_test.dart` has 8 tests.
  - The brand-consciousness PUT test is in `workspace_test.dart`.
  - Full suite: **141 passing**, `flutter analyze` clean. This includes lint fixes in the other tool's `finish_publishing_sheet.dart`, `platform_post_preview.dart` and `user_assisted_publishers.dart`.
- **Not done**:
  - Carousel design from a *post* (only pieces for now; the API supports `postId`).
  - Per-platform captions from the brief are not yet copied into the composer prefill.
  - Nothing has been device-tested yet.

### Phase 3: publishing completion (done 2026-09-26, uncommitted)
- **Web OAuth is real.** `ConnectedAccountsManager.tsx` no longer posts a fake `live_token_*`.
  - Connect calls `/accounts/oauth/:platform/authorize` and redirects the browser; the provider returns to the same page.
  - `status=connected` gives a toast and reloads the list. `status=error` shows the provider's reason. `status=select` opens `AccountSelectionDialog`, which has skeletons, a retry path and 44px targets.
  - A "Reconnect" button appears for accounts with `reauthRequired`. A missing server credential shows as "not set up on this server".
- **Mobile page/org picker.** `account_selection_sheet.dart` opens on the `status=select` deep link. Before this, that link was reported as "Connection failed".
  - Adds `SocialApi.getOAuthSelection`/`completeOAuthSelection` and the `OAuthCandidate` model.
  - Test: `test/sections/oauth_selection_test.dart`. Suite: **142 passing**.
- **Token refresh fixed** (audit item 14).
  - `getAccessToken(account, {forceRefresh})`: the proactive 7-day job now actually refreshes, and skips credentials whose company doesn't match.
  - The old no-op test was replaced with one that checks the provider refresh endpoint is called and the new token is stored.
  - Publishing tests: 29/29. Package rebuilt.
- **`PUBLISHING.md`** covers the flow, tokens, publish states, env per platform and tests.
- **Already done in Phase 0:** `/accounts/connect` restricted to admins (item 15), and honest metrics (engagement hardening).
- **Not verified live:** needs real app credentials and the callback URL registered in each developer console (see §4).

### Phase 4: mobile polish (done 2026-09-26, uncommitted)
- **Theme:** dark-only (`main.dart` forces `ThemeMode.dark`; the toggle was removed in Phase 1). The unused light theme code is left in place until it is tokenised.
- **Engagement tab:**
  - stats show a skeleton while loading, and an ErrorView with retry instead of hiding the error silently;
  - the refresh button has a tooltip;
  - the rule action row wraps on small screens.
- **Spinners replaced by skeletons:**
  - Inbox AI Reply All sheet: skeleton, ErrorView with retry and Home (it used to show a raw "Error: …" line), and an empty state with a Close action.
  - Settings device list.
  - Studio stock search, in two places.
  - Remaining spinners are only inside buttons and during camera start-up.
- **Clear cache and settings retry:** done in Phase 1.
- **Release build:**
  - `build.gradle.kts` no longer crashes debug/CI builds when `android/key.properties` is missing. Release assemble/bundle tasks now fail loudly without it. The key files are git-ignored and untracked (verified).
  - Sizes: the universal release APK is 62.8 MB. With `flutter build apk --release --split-per-abi`: arm64 35.1 MB, armeabi-v7a 29.9 MB, x86_64 37.7 MB.
  - **Play Store: upload `flutter build appbundle --release`**; Play serves per-ABI splits.
  - R8 resource shrinking was not enabled, because Media3 and ML Kit use reflection. Only try it together with a device test.
- 142 tests passing, analyze clean, `compileDebugKotlin` OK.

**Next: Phase 5.** A device test on a real Android phone, then live keys per platform (§4), then deploy (production still runs `ed40b0d`).

### Manual editor parity (2026-09-26, uncommitted)
- See `EDITOR_PARITY_PLAN.md`.
- M1 (mobile multi-track timeline, Library with music/SFX/video/photos/text templates/effects, item inspector) is done.
- M2 (effects and photo contract, director `addEffect`, Android renderer) is done.
- M3 (desktop editor and FFmpeg) is in progress.

## Social manager edge cases (2026-09-27)

All social web screens except the hub (`social-projects/page.tsx`) and the public review page were retired in
`3923a29`, so client-side fixes went to the public review page only. The mobile app is the main client for the rest.

### Gaps found (verified in code)
- **Client review links.**
  - Batch approve did not check expiry and approved every post in the window, including published and failed ones.
    It did not pin `approvedVersion` and left no audit entry.
  - Comments accepted any `postId`, including another tenant's posts, and a caller-supplied `authorType`.
  - Links could not be revoked.
  - `GET /reviews/sessions` did not exist; the web and mobile Approvals tabs both called it.
  - `createReviewSession` did not check that the client belonged to the caller, and link lifetime had no limit.
- **Post updates.**
  - `PUT /posts/:id` spread the whole body into the update. A caller could set `status: 'approved'`, `approvedVersion`,
    `versionNumber` or `publishedLinks`.
  - Editing a post that had been approved and then scheduled did not require approval again, so unapproved copy
    could publish.
  - Variants sent on update were silently dropped (mobile sends them).
  - Published posts could still be edited.
  - `scheduledFor` values in the past were accepted, so the scheduler published them on the next tick.
- **Disconnecting an account** left its scheduled posts in place to fail at publish time, although the UI promised
  they would be paused.
- **Unattended publish failures** from the scheduler were never shown to anyone.
- **Token expiry** was not shown before it lapsed.
- **Fake success and silent fallbacks.**
  - The legacy static helpers (`MetaAdapter`, `LinkedInAdapter`, `TikTokAdapter`, `YouTubeAdapter`) returned random
    fake URLs and IDs when the token was missing.
  - `LinkedInAdapter.getAnalytics` returned made-up numbers.
  - `linkedin/tools.ts` swallowed vault errors, including REAUTH_REQUIRED, and used a `mock_token` in live mode.
- **Platform rules.** Pinterest boards were not required. YouTube fell back to the title "Untitled".
- **Readiness** had no duplicate-content check. It could not tell scheduling blockers apart from "approval pending".
  With no company context it returned any post.

### Fixed
- **`packages/domains/social-media/src/post-guards.ts` (new, pure).**
  - `parseScheduledFor` rejects past times with `SCHEDULE_IN_PAST` (422). There is a 2-minute grace window, and
    `INVALID_SCHEDULE` covers unparseable values.
  - `sanitizePostUpdate` applies a whitelist. `STATUS_NOT_SETTABLE` blocks approved and publish states.
  - `hasSubstantiveChange` counts copy, media, first comment and variant edits.
  - `findDuplicateCaptions` flags the same caption on the same account or platform within 7 days, ignoring case,
    whitespace and links.
  - Review-link state helpers return `REVIEW_LINK_EXPIRED` or `REVIEW_LINK_REVOKED` (410) and `REVIEW_LINK_INVALID`
    (404).
- **`social-post.service.ts`.**
  - `createPost` and `updatePost` both validate the schedule.
  - `updatePost` is tenant-safe (`findFirst`/`updateMany`) and uses the whitelist.
  - It refuses to edit published posts (`POST_ALREADY_PUBLISHED`).
  - A substantive edit to an approved version bumps the version and moves the post to `in_review` when the project
    requires approval. The response includes `reapprovalRequired`.
  - A schedule-only change keeps the approval.
  - Variants are synced. Published, processing and assisted variants are never rewritten.
  - Readiness now:
    - requires a company;
    - returns `schedulingBlockers`, `approvalPending` and `warnings` (the duplicate-content warning).
- **`client-review.service.ts` and `reviews/client-review.routes.ts`.**
  - New endpoints: `GET /reviews/sessions` and `POST /reviews/sessions/:id/revoke`.
  - Every public action checks expiry and revocation.
  - Comments are limited to posts in the session and are always authored as `client`. They are recorded in post
    history.
  - Batch approve only touches review states and pins `approvedVersion`. The update filters on `versionNumber` to
    avoid races.
  - An optional `seenVersions` gives `REVIEW_STALE` (409) when the agency edited a post after the page loaded.
  - The client is checked on create, lifetime is capped at 90 days, and `postIds` are tenant-scoped.
  - Errors go through `sendRouteError` with typed codes.
- **`social-account.service.ts`.**
  - Disconnecting moves the account's `scheduled` and `approved` posts to `draft`. Each gets an `errorMessage` with
    the reason and a history entry, and the response returns `pausedPosts`.
  - Public accounts include `tokenHealth` (`ok | expiring_soon | expired | reauth_required`, `lapsesAt`, `message`).
    The lapse time is the refresh-token expiry when there is a refresh token, otherwise the access-token expiry. It
    warns 7 days ahead.
- **`publishing/publish-dispatcher.ts`.** A final scheduler failure (`failed` or `partially_published` with no retry
  left) creates a `Notification` for the post author. It carries each platform's provider error and a link to the
  post.
- **Adapters.**
  - A missing token gives `REAUTH_REQUIRED` and a missing account ID gives `ACCOUNT_NOT_CONNECTED`.
  - `mock_` sandbox tokens are honoured only outside production (`isSandboxToken`).
  - Pinterest requires a board. YouTube requires a title of at most 100 characters.
  - `linkedin/tools.ts` rethrows vault errors unless the provider mode is `mock`.
- **`tenant-scope.ts`.** `SocialDomainError` takes optional `details`.
- **Web: `app/(public)/review/[token]/page.tsx`.**
  - Distinct expired, withdrawn and invalid states.
  - Network errors show "Try again" plus "Reload page" (44px targets).
  - It sends `seenVersions` and reloads on `REVIEW_STALE`.
  - Server messages are shown, and the page no longer sends `authorType`.

### Tests
- `packages/domains/social-media/test/post-edge-cases.test.ts`: **15/15**.
- Existing suites still pass: publishing 29/29, tenant isolation 16, engagement 17, LinkedIn and YouTube 39,
  user-assisted 3, readiness 3, creative 20.
- Two suites fail for reasons unrelated to these changes:
  - `social-suite.test.ts` needs a live database (it fails on a `SocialConversation` foreign key);
  - `edge-cases-master.test.ts` reports 18/18 internally but its runner exits non-zero.
- `tsc` passes with 0 errors on the social-media package (rebuilt) and on the frontend. The backend files touched here
  have no errors.

### Remaining (with reasons)
- **Mobile follow-ups** (another agent owns `apps/social-studio-mobile`):
  - `approvals_tab.dart` can now use `GET /reviews/sessions`, `linkState` and revoke;
  - the composer should use `schedulingBlockers`, `warnings` and `reapprovalRequired`, and show `tokenHealth` on
    accounts;
  - handle `SCHEDULE_IN_PAST`, `STATUS_NOT_SETTABLE` and `POST_ALREADY_PUBLISHED`;
  - `approveBatch` should send `seenVersions`.
- **Web hub.** It has no composer or drawer anymore, so pre-publish validation in the web UI is out of scope unless
  those screens return.
- **Not done yet:**
  - A UTM-parameter option for links.
  - Checking brand forbidden words at dispatch time. Today it is a readiness issue only; blocking the scheduler
    needs a product decision because false positives would stop posts from publishing.
  - Showing times in the project timezone on the client. The server already stores UTC and honours offsets.
- **Token-expiry notifications.** A push or in-app notification when an account turns `reauthRequired` or
  `expiring_soon` needs an owner user on `SocialAccount`, which the schema does not have. The warning is currently
  shown through `tokenHealth` in the accounts list.
- **Legacy sandbox helpers.** `LinkedInAdapter.getAnalytics` and similar still return sandbox figures for `mock_`
  tokens outside production only. Delete these helpers once `social-suite.test.ts` and
  `youtube-production.test.ts` stop using them.

### Editor parity + social edge cases: verification (2026-09-27)
- **Mobile:** 164 tests passing, analyze clean.
  - 8 caption presets, with fonts passed to export.
  - Drag to move and edge trim on the timeline; per-track mute.
  - Transitions: DIP_WHITE, ZOOM_SWOOSH, ZOOM_OUT, GLITCH.
  - Accounts use the server's `tokenHealth`.
  - Review approve sends `seenVersions` and reloads after REVIEW_STALE.
- **Desktop:** jest 158/158, real-FFmpeg suite 27/27, `tsc` 0 errors.
  - Native export now covers captions (PNG overlays), camera zoom, rotation/crop, remote media download (`fetch_remote_media`), effects, photos and all 13 transitions.
  - The fallback renderer blocks export when there is audio instead of dropping it.
  - **Rust not compiled** (new `overlays.rs`, `remote.rs`, `reqwest`). Needs `cargo test --lib` in CI.
- **Social domain:** `post-edge-cases.test.ts` 15/15. Covers review links (expiry/revoke/stale/version pin), the post edit allow-list, re-approval, past-schedule rejection, account disconnect pausing posts, failure notifications, `tokenHealth` and adapter fake-success removal.
  - **Caution:** `social-suite.test.ts` connects to the configured DATABASE_URL. Do not run it against a shared DB.
- **Open:**
  - UTM parameters.
  - Blocking forbidden words at publish time (currently a warning only; needs a product decision).
  - Showing times in the project timezone.
  - Reconnect notifications (accounts have no owner user).
  - Device tests: real phone export, live stock downloads, Rust build.

### Publishing verification, sandbox, devices, push, settings and export (2026-09-27)

**Adapters.** All 8 adapters were checked against the current official docs. The per-platform table and sources are in
PUBLISHING.md §6.

- Fixed in `packages/domains/social-media/src/adapters/*`:
  - **Instagram.**
    - Reel size limit corrected from 1 GB to 300 MB.
    - Stories added.
    - `alt_text` and JPEG checks added.
    - Meta rate-limit and "not ready" error codes are now retryable.
    - Slow containers now end as `processing` and are published by `checkStatus`, instead of timing out and
      re-uploading.
  - **Facebook.**
    - Link posts added.
    - Reel processing is now tracked with `status.video_status` and `checkStatus`.
  - **Threads.**
    - Carousels allow 2–20 items (the limit was 10).
    - An `ERROR` container used to be published anyway; it now fails with `error_message`.
    - The permalink is read from the API.
    - The first comment is posted as a reply.
  - **YouTube.**
    - Quota and rate-limit errors are mapped.
    - A warning appears when YouTube forces the video private because the project is unverified.
    - `publishAt` and `containsSyntheticMedia` are supported.
  - **LinkedIn.**
    - The `LinkedIn-Version` default `202507` was sunset; it is now `202609`, via the new
      `publishing/linkedin-version.ts`.
    - Hashtags are no longer escaped.
    - Video limit corrected to 500 MB.
    - Documents wait for `AVAILABLE`.
    - Invalid formats are rejected.
  - **Pinterest.**
    - Video Pins used to send the video URL as an image; they now use the real media-upload flow.
    - Carousel Pins added (2–5 images).
    - Description limit raised to 800 characters.
  - **Reddit.**
    - Uses a compliant User-Agent.
    - Supports nsfw, spoiler and flair.
    - `json.errors` are mapped to validation or retryable errors.
    - A missing id gives `OUTCOME_UNKNOWN` instead of a fabricated `t3_<timestamp>`.
  - **X.**
    - Missing pay-per-use credits (402) give `PUBLISH_NOT_CONFIGURED`.
    - Duplicate text gives a validation error.
    - GIFs use `tweet_gif`.
    - Video limit raised to 20 minutes.
- New capability matrix: `adapters/capabilities.ts`. A test keeps it consistent with each validator.

**Sandbox.**

- `isAssistedPlatform` no longer sends keyless platforms to the assisted handoff when the sandbox is on.
- `SimulatedPlatformPublisher` re-validates, refuses to run when the sandbox is off, and labels its results.
- Mobile shows SANDBOX, SIMULATED and "Simulated publish" labels.
- `sandbox-e2e.test.ts` runs the full flow for all 8 platforms keyless and proves the sandbox is refused in production.

**Autonomy.** The scheduler holds unapproved AI-authored posts under `autonomy.publishing = MANUAL`.

**Devices.**

- At the device limit, the least-recently-seen device is evicted, provided it has been idle for at least
  `DESKTOP_DEVICE_EVICTION_MIN_IDLE_MINUTES` (default 30). The requesting device is never evicted. The evicted device
  is logged and returned in `evicted`. If no device qualifies, the request gets 409.
- `lastSeenAt` is refreshed on use (at most every 5 minutes).
- `GET /devices` marks the current device with `current`.
- After a reinstall, the device slot is reused via `installKey`: Android `ANDROID_ID`, hashed per company and user, sent
  over the Kotlin `…/device` channel.
- Settings copy corrected. It used to say "5 devices"; the limit is 20.

**Push.**

- Backend: `apps/backend/src/services/push/*` (FCM from env, typed `PUSH_NOT_CONFIGURED`), with routes at
  `/api/desktop/push/{status,test}`.
- Mobile: `firebase_core`/`firebase_messaging` and the `google-services` Gradle plugin. `android/app/google-services.json`
  exists and matches `com.workspace180.social_studio_mobile`.
- Mobile flow: permission request (Android 13+) → token registration and refresh → tapping a notification opens the
  post. Settings shows the real push status and has a test-send button.

**Settings.**

- **Appearance.**
  - The selector offers Dark and System, persisted.
  - Light mode is withheld on purpose. About 40 screens use the dark `AppTheme.*` constants directly, so light mode
    would put near-white text on white. The earlier change that enabled light mode without tokens was made safe.
  - A stored "light" choice falls back to dark.
  - To enable light mode: tokenise the screens through `Theme.of(context)`, then set
    `ThemeModeNotifier.lightModeAvailable = true`.
- **Removed fake status.** The hard-coded "ONLINE" and "PRODUCTION READY" labels and the wrong version string are gone.
- **Account deletion.** Uses the real URL `https://180workspace.com/account-delete` (in the Play metadata).
- **Sign out.** Revokes the device slot and posts `/api/auth/logout` with the refresh token (already implemented).

**Export (verified on the Pixel_7_API_34 emulator).**

- **Bug found and fixed.** `experimentalSetForceAudioTrack(...)` on sequences declared with explicit track types threw
  `IllegalStateException`. This made every video-only export fail, and exports with B-roll failed too. The calls are
  removed; declared `TRACK_TYPE_AUDIO` pads silence.
- **Error messages.** `RENDER_SETUP_FAILED` and `EXPORT_FAILED` now carry the root cause and where it was thrown,
  instead of a bare class name.
- **HDR.**
  - The OpenGL tone-map runs only for HDR sources.
  - If the GPU lacks `GL_EXT_YUV_target`, the export retries once with MediaCodec tone-mapping, then fails with a typed
    `HDR_NOT_SUPPORTED` and an actionable message.
  - A real HDR phone is still needed to see a successful tone-map.
- **AAC.** Requested only when audio exists. A video-only export has no audio track and no AAC encoder.
- **New test.** `integration_test/export_formats_render_test.dart` (3/3) covers silent, mixed-audio and HDR.
  `media_engine_render_test.dart` passes 6/6. Both ran on the emulator; fixtures are in the gitignored `test_assets/`.

**Tests.**

- Social domain: publishers 16, adapters-verified 16, sandbox-e2e 11, oauth-meta 7, webhooks 6, post-edge-cases 15,
  tenant-isolation 16, social-os 7.
- Backend: desktop devices and push-token ownership 21, push 5.
- Mobile: `flutter analyze` is clean for this work. `flutter test`, Kotlin compile and the debug APK build are green;
  exceptions are listed under Open.

**Open.**

- `user-assisted-publishing.test.ts`: case 1 expects unconfigured Instagram not to be assisted, which contradicts the
  dispatcher's "all unconfigured platforms are assisted" rule committed earlier. Case 3 needs a database.
- The concurrent SSO work (`lib/core/auth/*`, `login_screen.dart`) breaks two review-portal widget tests (a login-screen
  row overflow) and adds 2 analyzer infos. That work belongs to whoever is editing it.
- Real-device HDR tone-map check.
- TikTok was not re-verified.

### Production gate: verified 2026-09-27 (re-run by the lead, not only the agents' claims)
- **Mobile:** `flutter analyze` clean, `flutter test` 170/170.
  - Fixed the new 180 Identity login button: it overflowed by 144 px on phone width. Also fixed the undeclared `crypto` dependency.
  - The agent ran on-device export tests on a Pixel 7 API 34 emulator (3/3 + 6/6).
- **Desktop/web:** `tsc` 0 errors, jest 181/181, E2E studio journey 16/16 (10 steps fully real; the LLM, STT and caption raster are stubbed).
  - Desktop Apply/Undo now sends agent-memory feedback.
  - The canned "video created" message was replaced with a real summary.
- **Backend/contracts:**
  - Director 58/58.
  - video-contracts director-os 13/13 and effects-photos 3/3.
  - ai director-os 12/12, social-os 7/7, brand-bleed 2/2.
  - Publishing: adapters-verified 16, sandbox-e2e 11, publishers 16.
- **Blocking before public launch:**
  1. Apply migration `20260927100000_agent_os` (plus earlier ones) with `prisma migrate deploy`; restart the servers.
  2. CI `cargo test --lib` for the desktop Rust (analysis.rs, overlays.rs, remote.rs, render.rs); it was never compiled locally.
  3. Live keys and app reviews per platform (see PUBLISHING.md §6 and the key list), plus Firebase service-account env.
  4. A real-phone run of the full journey and a desktop install run; the new desktop UI has only been typechecked.
  5. Rotate the old Meta webhook verify token; deploy (prod was on `ed40b0d`).
- **Not blocking, but open:**
  - Light theme withheld: about 40 screens hard-code dark colours.
  - No local STT sidecar (whisper.cpp recommended).
  - No desktop OCR.
  - Performance memory needs a live insights sync.
  - `user-assisted-publishing.test.ts` case 1 conflicts with the committed manual-handoff rule; case 3 needs a DB.

## Re-audit 2026-10-02: start from PRODUCTION_READINESS_PLAN.md
Covers the 180 Manager, engagement automations, AI inbox, composer, shoot → Director loop, four-agent calendar and the
CapCut-style editor. It lists the gates, which have regressed since 2026-09-27:
- Flutter: 163/169 tests pass and analyze reports 19 issues;
- engagement: 66/67;
- autopilot: 16/17.

It also lists 23 bugs, including fake Manager and stock data, clip loss from the cache, and the 1-piece-a-day cadence
cap. Work proceeds in phases P0–P5.

## 2026-10-03: AI thumbnail designer + a real end-to-end edit (uncommitted)

**AI thumbnail designer** (Post detail → Media → "Design thumbnail with AI" when the post has a video):
- Phone: `ThumbnailScout.kt` (`thumbnailCandidates`) samples 24 frames, scores face size / eyes open / smile
  (ML Kit) + sharpness + exposure, saves the best 4 (≥1.5 s apart) as 1280 px JPEGs.
- Server: `creative/thumbnail-agent.ts` (copywriter → art director → measured render → QA critic → one revision)
  + `creative/thumbnail-compiler.ts` (deterministic @napi-rs/canvas render from the real frame; measures contrast
  under the text, text size, face overlap, Reels/YouTube safe zones). Routes `POST …/creative/thumbnails` and
  `/thumbnails/render` (manual, no AI). No key → `AI_NOT_CONFIGURED`; bad AI output twice → `AI_BAD_RESPONSE`.
- App: `features/posts/thumbnail_designer_sheet.dart` (9:16 / 16:9, variants with QA chips, Retry + "Design it myself").
- Tests: `packages/domains/social-media/test/thumbnail.test.ts` (4), flutter suite green.

**Real manual edit on the emulator** (`integration_test/real_edit_demo_test.dart`, NASA public-domain ISS interview
45 s → 28 s 9:16 Reel): 6 cuts, re-order, grade, crossfade, flash, title, 38 word captions, 2 punch-ins, Pexels
B-roll, Fluent 3D sticker, ccMixter music ducked. Output 1080x1920, 28.16 s; ~3.5–7 min render on the swiftshader
emulator (no GPU). Fixtures in `test_assets/` (gitignored); the test waits for `.ready` and hands evidence off via `.done`/`.pulled`.

Bugs found and fixed by this run:
- `TimelineOps.autoCaptions` grouped words in source order → after a clip re-order a caption got an empty range and
  the export failed (`INVALID_EDIT_IR`). Now sorted by timeline time; a word straddling a cut stays in its clip.
  Regression test in `test/timeline_ops_test.dart`.
- ccMixter files return 403 without a ccMixter `Referer` (hotlink protection) → every ccMixter track failed to
  download. `AssetCache.hostHeaders` adds it. Test in `test/core/asset_cache_test.dart`.

Open (not fixed):
- No loudness normalisation: output keeps the source level (−28 LUFS here; platforms target ≈ −14). Needs gain +
  a limiter in the renderer (`measureLoudness` already exists on device).
- Default sticker position (upper right) can sit on the face during a punch-in; place it away from detected faces.
- AI-Director-only edit: done, see below.

### AI-Director-only edit of the same footage (2026-10-03)
`integration_test/ai_director_demo_test.dart` drives the real app path: `StudioController.load` (on-device analysis +
server transcription) → `askDirector` (local backend `/ai-direct`, platform AI key from the admin vault; the dev test
user's session is pushed by the host) → `startExport` (stock B-roll/music resolved + downloaded, Media3 render).
Final run: OpenAI plan, 2 attempts (coverage retry completed 7 skipped asks), interviewer question + 4 "you know" +
pauses cut, captions, 2 punch-ins, Pexels B-roll, 🌌 sticker, VIVID grade, ducked Kevin MacLeod music (CC BY credit);
29.7 s 1080x1920, 3.3 min render on the emulator. Tip: nodemon on this box often misses package edits; `touch
apps/backend/server.js` to reload. A loaded emulator (load avg 20+) times requests out; cold-boot it.

Bugs found by these runs and fixed (tests added):
- Kotlin validator rejected a sticker over B-roll ("overlays overlap"): only full-frame cutaways may not overlap.
- Fragmented MP4 stock clips (Pexels): header duration 0 → `getVideoInfo` 0 ms; now sampled from the fragments, and
  `MediaTools.ensureSeekable` remuxes them (stream copy) before render (Media3: "not seekable to start").
- HDR stock B-roll on a phone without tone-mapping failed the whole export: the HDR B-roll is now left out with a
  warning (the creator's own HDR footage still gets HDR_NOT_SUPPORTED).
- Captions: words ran together (gap ignored the outline; `word_pop` scale overlapped neighbours) → gap includes
  the stroke and each word reserves its pop room (`VideoEffects.kt`).
- Compiler: two cuts leaving a < 250 ms sliver flashed frames → the sliver is cut too. Mobile export dropped words
  a cut clamped to zero length (they were still drawn). Titles get ≥ 5% of the short side (models sent 24 "pt").
- Director prompt: transcript also given as "spoken lines" split at pauses (the model could not find the
  interviewer's question); cleanFillers tool tells the model to pass phrase fillers it sees ("you know").
- Coverage check (`missingRequestedOperations`): a plan that skips explicitly requested features is sent back once;
  off for critic repairs (their prompt quotes the request → it duplicated B-roll/stickers/titles).
- `platform-ai-vault.service.ts` had a hardcoded fallback seed: now fails loudly without a vault key / JWT_SECRET.

Open:
- The model's critic repair sometimes deletes the requested title (`removeItem`) instead of moving it.
- The model still sometimes trims the speaker's first line as "dead air"; no speaker diarization yet.
- Server-side stock/music lookup hits its 8 s / 250 ms budget every turn; the phone resolves them at export.
- Loudness normalisation (both edits export at −28 LUFS) and face-aware default sticker placement (above).

Follow-up plan and status of every issue from these runs: `EDIT_RUN_FIX_PLAN.md` (B1–B9 fixed 2026-10-03).

## Captioning upgrade (2026-10-07)
Plan and status: `CAPTIONING_PLAN.md`. Done: spoken-language auto-detect (`/transcribe` `language=auto`, picker in the
Captions sheet), creator caption templates for the AI Director (`packages/video-contracts/src/caption-templates.ts`),
caption conversion to another language or Roman letters (`/captions/translate` by hand, `translateCaptions` op for the
Director), `word_box` / `word_reveal` motions on the phone, 4 more templates (Shamani, Mayya, Gadzhi, Mumbai Bubble).
Since then: provider order + bake-off script (Whisper only), Indic fonts, key-word emphasis, caption correction,
SRT/VTT export. Captions never get emoji; no paid STT added (owner rule). Open: desktop renderer
support for the new motions, transcript correction UI, SRT/VTT export, a device run with a Hindi clip.
Known unrelated failure: 4 lock-screen tests (`access_lock_test.dart`, `navigation_test.dart`) overflow in the
uncommitted `feature_lock_view.dart`.

## Platform Team + 8-agent calendar (2026-10-07, uncommitted)
Details: `PLATFORM_TEAM.md`. Commit `828b81cc` (another tool) shipped an Instagram crew whose agents returned
stock text (fixed "$18,000 ... cost me" hooks swapped into calendar pieces, canned scripts, replies and
competitor data, default hook score 88 on mobile). That code is removed and replaced:
- Craft kit `packages/domains/ai/src/content/craft/` (deterministic linters for Instagram, LinkedIn, YouTube, X,
  Facebook, TikTok; MIT notice kept).
- Calendar pipeline is now 8 agents (adds Hook Lab, Platform Craft, Voice Guard) plus the on-demand Shooting
  Script Director (`POST .../pieces/:pieceId/shooting-script`).
- `/api/v1/social-media/platform-team/:platform/*` replaces `/instagram/*`.
- Mobile: Command Center (`/command-center`), detailed script screen (`/planner/script`).
Verified: ai + social-media typecheck clean and rebuilt; 17 craft/agent tests, 7 platform-team tests, 17 autopilot
tests, 23 route tests; `flutter analyze` clean; 9 new Flutter tests pass. The 4 lock-screen tests still fail
(known, `feature_lock_view.dart` overflow). Open items are listed in `PLATFORM_TEAM.md` section 6.

### Platform Team follow-up (2026-10-07, uncommitted)
All six open items from the first pass are implemented; see `PLATFORM_TEAM.md` section 5. Own-post metrics are
read from each platform and stored on the variant, ranked automatically and fed to the strategist's memory
(background refresh every 3 h); competitor radar uses official APIs only (Instagram, YouTube, X); triaged
messages get AI reply drafts; X publishes real threads; calendar runs have a pre-run estimate, stored per-agent
usage and optional pricing; the web app has a Command Center per project. Verified with fakes only: 146 backend
tests in the related suites (144 pass; the 2 others are an environment-dependent Instagram credential check and a
cross-file ordering issue that passes when run alone), `flutter analyze` clean, 231 Flutter tests pass (the 4
lock-screen failures are the known ones), web typecheck adds no errors. Live-API checks are listed in
`PLATFORM_TEAM.md` section 7.
