# Social Studio: Production Readiness Audit and Implementation Plan

Audited 2026-10-02 on `fafafddf` (working tree clean apart from `vector_store.json`). This audit covers the features
requested since the 2026-09-27 production gate in `PRODUCTION_GAP_AUDIT.md`:

- the 180 Manager and its agent system;
- engagement automations and AI DM replies;
- OAuth with multiple accounts;
- the two-step composer;
- the calendar → shoot → Director → post loop;
- the planner and the four-agent calendar;
- the teleprompter and library folders;
- the CapCut-style editor.

It also re-runs the quality gates. **No feature is removed.** Every item below finishes, fixes or hardens code that
already exists.

Legend: ✅ works · 🟡 partial · 🔴 broken or fake · ❌ missing

## 0. Gate results (re-run today)

| Gate | Result | Compared with 2026-09-27 |
|---|---|---|
| `flutter analyze` | 19 issues: `withOpacity` deprecations in `planner/autopilot_generator.dart` and `planner/calendar_detail_screen.dart` | regressed (was clean) |
| `flutter test` | **163 pass / 6 fail**. Failures: Brand save ×2, Channels "link another account", Studio library SFX, plus 2 more | regressed (was 170/170) |
| `tsc` social-media, ai | 0 errors | = |
| social-media `engagement-production` / `tenant-isolation` / `post-edge-cases` | 16/16 · 16/16 · 15/15 | = |
| social-media `engagement.test.ts` | **66/67**. FAIL 33: "No invented public reply" (`engagement-dispatcher.ts:72-78` returns a canned reply) | regressed |
| backend `autopilot.test.ts` | **16/17**. "repair retry" fails because the pipeline now truncates instead of repairing | regressed |
| backend `multi_calendar_loop.test.ts` | 11/11 | new |
| Manager / video-intel tests | **none exist** | — |
| Stock providers (live probe, `nature`, portrait) | Pexels 3, Pixabay 3, free sources 3: the server keys work | — |

## 1. Feature status (verified in code)

| # | Feature you asked for | Status | Evidence |
|---|---|---|---|
| F1 | **180 Manager** chat with full awareness of accounts, calendar, inbox and Director | 🔴 | Exists (`social-media/src/manager/*`, `manager_copilot_sheet.dart`, `/manager/*` routes), but most answers are canned. See B1–B6. |
| F2 | Manager → sub-agents (Calendar, Inbox, Analytics, Director, Video-Intel) | 🟡 | The sub-agents are DB queries, not agents. The calendar "pivot" writes placeholder posts (B4). The Director rule is real (`agent-memory`). |
| F3 | Video/audio understanding of *published* posts (why a video worked) | 🔴 | `video-intelligence.service.ts` scores only caption text. When the LLM fails it invents scores (84/80/"high"). It never downloads frames or audio. |
| F4 | Manager opens the exact inbox chat (deep link) | 🟡 | The server builds `/#/inbox?conversationId=`, but the client pushes plain `/inbox` (`manager_copilot_sheet.dart:146`). |
| F5 | Comment → auto-DM on an **existing** IG post | 🔴 | "Link Post URL" (`engagement_tab.dart:656-690`) creates a fake *published* SocialPost with no `externalId`. The webhook matches by `externalId` (`webhooks.service.ts:353`), so the rule never fires. The create may also be refused by `STATUS_NOT_SETTABLE`. |
| F6 | Composer comment funnel (keyword or any comment → DM + public reply + auto-like) | 🔴 | The composer sends `actionReplyComment`/`actionCommentReplyTemplate` (`post_composer_screen.dart:430-433`), which the service ignores, so the public reply is dropped. It also creates the rule with `catch (_) {}`, so a failure is silent. The rule is only created on *new* posts, and `actionEnableAiAgent` defaults to true even though you asked for it to be removed. |
| F7 | AI auto-reply on **all** DMs of 5 IG accounts at once | 🟡 | Only per-conversation toggles exist (`aiAgentActive`), plus a workaround through a `dm_inbound` rule. There is no account-level "AI inbox mode" and no bulk switch. |
| F8 | Lead qualification | 🟡 | The `qualify_lead` goal asks for an email or phone. A lead is created when the message contains one. There is no scoring (need, budget, timeline, fit) and no stage. See §4. |
| F9 | YouTube/Facebook connect, multiple accounts, no demo channel | 🟡 | The `/oauth-callback` route and picker exist. Multiple accounts are allowed (`@@unique companyId+platform+platformAccountId`). The demo branch in `oauth.service.ts:147-216` is **not gated on production** (`*_PROVIDER_MODE=mock` mints "(Demo)" accounts in prod). Old demo rows are not cleaned up. |
| F10 | Two-step composer (content → schedule/funnel), per-platform bottom sheets that inherit title and caption | 🟡 | The two-step header exists. Per-platform sheets with inheritance are not verified as built. The objective, hook and first-comment fields are still present. |
| F11 | Publish progress per platform, open-link buttons, scheduled countdown | 🟡 | Server statuses exist. The live progress and countdown UI need verifying and finishing. |
| F12 | Scheduled posting when the phone is offline | ✅ by design | Media is uploaded when the post is saved and the **server** scheduler publishes it, so the phone does not need to be online. Gap: a draft whose upload is still queued in the outbox (`core/offline/outbox.dart`) is not flagged as "won't publish until uploaded". |
| F13 | Calendar day → Shoot (teleprompter) → clips linked to the piece → Mark shoot done → Send all clips to Director → Export → new post prefilled | 🟡 | The camera, folders and multi-take flow exist. The **Shoot button drops `pieceId`** (`calendar_detail_screen.dart:972`). The piece sheet has no clip list, rename/retake/delete, "Shooting done" state or "Send N clips to Director". Export attaches to the piece and opens post detail, not a prefilled composer. |
| F14 | Teleprompter: paste script, speed, folder, add clips to folder, edit from folder ⋮ | ✅/🟡 | `teleprompter_setup_sheet.dart` + `camera_screen.dart` work. **Clips stay at the camera's cache path** (`camera_screen.dart:342,408,453,504` store `file.path`), so the OS or "Clear cache" can delete them. The library is a SharedPreferences JSON blob (`vault_storage_service.dart`) that is never synced to the DB. |
| F15 | Planner = list of campaigns → calendar → day grid → day sheet with several pieces | 🟡 | The grid and `DayScheduleSheet` exist (`calendar_detail_screen.dart:193,414`). The planner list falls back to the project name when there is no campaign name. |
| F16 | Generator: campaign name, mix chips + custom stepper, alternate days, reel length, slide count, structure and reference boxes | 🟡 | The inputs reach the pipeline (`types.ts:27-30`). **The mix is ignored**: `expectedSlots = min(days*cadence, days)` (`pipeline.ts:117`), so you never get more than 1 piece a day, and `mode: 'alternate'` is never read. |
| F17 | Four robust agents (neuromarketing research, cadence planner, SOP writer, QC) in separate files | 🔴 | `autopilot/agents/*.agent.ts` exist but are **dead code**: nothing in `pipeline.ts` imports them. The old research → strategist → hook_script → copy → critic chain still runs. |
| F18 | Elastic validation (no "invalid output twice" crash) | 🟡 | Hooks are now truncated mid-sentence (`pipeline.ts:460-481`). Missing scripts and slides are replaced with **canned text** ("Stop Scrolling", "Save this checklist…", `pipeline.ts:463-500`), which breaks the no-fake-content rule. |
| F19 | B-roll shows as real video on the timeline, with trim, crop, mute, remove audio and overlay controls | 🟡 | The overlay inspector has audio, framing and opacity. Timeline items are **coloured text blocks** with no thumbnails or filmstrip (`studio_timeline.dart:512-530`). The preview renders only the first active overlay (`studio_session_screen.dart:454`, `firstOrNull`). |
| F20 | "+" at the start and end of the main track, an asset sheet with device upload | 🟡 | `addTimelineClip` exists. Its entry points and the asset sheet (library + device + stock tabs) need confirming and finishing. |
| F21 | Stock B-roll search ("nature" finds nothing) | 🔴 | The providers work (live probe above). The route and client hide the real error. See B10–B12. |
| F22 | Text: drag on canvas, style, colour, stroke, shadow, **in/out/loop animations**, emoji/stickers | 🟡 | Dragging, templates, stroke and shadow exist. **There are no text animations** anywhere in the IR or the Kotlin renderer. There are no emoji or sticker packs. |

## 2. Bugs by severity

### Critical (rule violations: fake data, data loss, or tenant risk)
- **B1** `manager-orchestrator.service.ts:99-233`. When the LLM fails, it answers from canned text and invents metrics:
  "5 connected accounts", "3.4x more DM lead conversions", "Hook Score 88/100". It also claims "AI Director Style
  Updated" without writing anything. `catch (_) {}` at :97 hides `AI_NOT_CONFIGURED`.
- **B2** `analytics-subagent.ts:47,55-57`. `estimatedReach = posts*1250` is invented. "Best/worst format" and
  "keyLearning" are hard-coded strings that the LLM then quotes as facts. It also runs 2 count queries per account
  (N+1).
- **B3** `video-intelligence.service.ts:55-87`. Scores are invented on parse failure and in the catch block. The upsert
  uses `where: {postId: input.postId || 'standalone'}` (:92), so every standalone analysis in every tenant writes to one
  row. Because `postId` is globally unique and the key is not tenant-scoped, a caller can also overwrite another
  tenant's row.
- **B4** `calendar-subagent.ts:115-130` and `executeAction`. The pivot creates draft SocialPosts with placeholder copy
  ("In-depth viral breakdown…"). It creates them under any `projectId` taken from the action payload without checking
  ownership, and with no `socialAccountId`.
- **B5** Manager persistence is dead. There is **no migration** for `ManagerConversation`, `ManagerMessage` or
  `PostVideoIntelligence` (the last is `20260927100000_agent_os`). The server uses `conversationId:
  'active_manager_session'` and the client uses `session_<ts>`. Neither row exists, so the FK insert fails silently and
  no history is kept.
- **B6** The `DirectorSubagent.applyEditingRule` upsert targets the unique key `companyId_projectId_key`, which does not
  exist. It always throws, then falls back to `create`, which duplicates preferences on every call.
- **B7** Studio clips can be lost. Teleprompter takes are saved by their camera cache path. Android may purge the cache,
  and Settings → Clear cache deletes it.
- **B8** The demo OAuth accounts are reachable in production (`oauth.service.ts:147-149`), with simulated tokens.
- **B9** `media-editor.routes.ts:237-335`. When the search is empty it returns a **fake "stock" catalogue**: Google
  sample MP4s labelled `provider: "pexels"` / `"pixabay"` with Pexels thumbnails. This is false data and false
  licensing.

### High (features that silently do not work)
- **B10** `/stock/unified` computes `pixabayOrientation` (:125) but passes the raw `portrait` value to Pixabay. Every
  provider error is swallowed into an empty list (:123, :133, :149-157).
- **B11** `ai_director_service.dart` stock search (`searchStockVideos` and the music/SFX searches) uses `catch (_) {}`
  and returns `[]`. The UI therefore shows "no clips" instead of the real error (auth, feature lock, timeout). This is
  the most likely cause of the "nature" result: the server providers answer, so the request is failing before it gets
  there. Confirm the root cause in step P2.4.
- **B12** The stock response is very large (it sends raw Pexels, Pixabay, Freesound, music and free-media blocks *plus*
  the unified lists). The mobile client only reads `unified*`.
- **B13** Existing-post automation (F5) and the composer funnel field mismatch (F6).
- **B14** The calendar "Shoot" button drops `pieceId` (F13).
- **B15** The cadence math caps output at 1 piece a day and ignores `alternate` (F16).
- **B16** The four SOP agents are not wired in. The pipeline fills gaps with canned content (F17, F18).
- **B17** The manager deep link ignores `conversationId` (F4).

### Medium
- **B18** `engagement-dispatcher.ts:72-78` canned public replies (dead at runtime because `capabilities.ts:114` skips
  replies when none are configured, but the test fails and a refactor could expose them).
- **B19** Flutter regressions: 6 failing tests and 19 analyzer infos.
- **B20** `autopilot.test.ts` "repair retry" no longer matches the pipeline's behaviour. Decide the contract (see P3)
  and update one side.
- **B21** The library is stored as a whole-list JSON rewrite in SharedPreferences on every change. This is O(n) per
  save, can lose data if the app is killed mid-write, and never syncs to the DB, which goes against your rule that
  everything except media lives in the database.
- **B22** The manager prompt interpolates raw user text and DB content without `fenceUntrusted`, so a DM could
  prompt-inject the Manager (the autopilot already fences untrusted data).
- **B23** `findOpportunities` runs one `findFirst` per conversation (N+1, up to 150 queries per chat turn) and marks
  every unread thread as an "opportunity".

### Performance
- **P-1** Studio preview: a 40 ms `Timer.periodic` plus `setState` drives playback
  (`studio_session_screen.dart:210`). Use the player's listener or a `Ticker` and rebuild only the playhead and preview
  layers (`ValueListenableBuilder`).
- **P-2** Timeline: with no thumbnails the cost is low today. Thumbnails must be generated once on device (Kotlin
  `MediaMetadataRetriever` → disk cache) and drawn with `cacheWidth`, never decoded per frame.
- **P-3** 43 `ListView(children:)` in features. Convert the unbounded ones (inbox, posts, library, calendar weeks,
  manager transcript) to `.builder`.
- **P-4** 18 `Image.network` calls without `cacheWidth`/`cacheHeight`: decoding full-size stock thumbnails wastes
  memory. Add a shared `NetImage` widget in `core/widgets`.
- **P-5** Manager chat: 5 context loaders run per turn with no caching. Cache per (company, project) for about 60 s and
  load only what the routed intent needs.
- **P-6** Autopilot and carousel polling every 2 s with no backoff. Use 2 s → 5 s → 10 s backoff, and stop when the app
  is backgrounded.
- **P-7** Release size: the debug APK was 176 MB. Confirm that `--split-per-abi`, `--obfuscate` and tree-shake-icons are
  set for release.

## 3. Architecture decisions (proposed)

1. **180 Manager = tool-calling orchestrator, not a keyword router.** The LLM gets typed tools (`get_account_metrics`,
   `get_calendar(month)`, `find_inbox_opportunities(filters)`, `get_post_insights(postId)`,
   `propose_calendar_pivot(fromDate, brief)`, `set_director_rule(text)`, `assign_conversation_to_ai(id)`). Each tool
   calls the existing service as a sub-agent. Writes always come back as a **proposal card** that the user confirms
   (the same consent pattern as the Director). There is no keyword fallback: with no AI key, the API returns
   `AI_NOT_CONFIGURED` and the UI shows "Connect an AI key" with a retry.
2. **Calendar pivot = autopilot regenerate for the remaining range.** It reuses `pipeline.ts` with
   `startDate = max(today, fromDate)` and a "pivot brief". Past and published pieces are never touched. It produces
   real calendar pieces, not placeholder posts.
3. **Video intelligence runs on the device, and only text goes to the server** (the desktop-only media rule). For the
   user's *own* footage, the transcript, silences, faces, cuts per minute and keyframe descriptions are already computed
   on device (`MediaIntelligence.kt`, `media-index`). Published Instagram reels are not on the device, so the API
   exposes only the caption, metrics and (for IG) `media_url`. **Decision needed:** let the phone download a published
   reel temporarily for on-device analysis, or limit "why it worked" to caption, metrics and transcript. Server-side
   processing is not allowed.
4. **Engagement targets platform media, not SocialPost.** Add `SocialEngagementRule.platformMediaId` (with
   `platformMediaPermalink` and `platformMediaThumb`). The matcher compares `event.mediaId` against it. A new
   `GET /accounts/:id/media` lists recent IG/FB posts through the Graph API for a picker grid. A rule on a post created
   in the app resolves `platformMediaId` from the variant's `externalId` after publish.
5. **AI inbox mode per account.** Add `SocialAccount.aiInboxMode` (`off | ai_reply | ai_qualify`), `aiInboxGoal`, and
   optional `aiInboxHours`. The webhook DM path activates the agent when the conversation is new or the account mode is
   on and there is no human takeover. A bulk "Enable on all Instagram accounts" switch sits in Inbox → AI settings. The
   existing per-thread toggle and "Assign to 180 Manager" (⋮) still override it.
6. **Library = DB metadata + device media.** New `MediaFolder` and `MediaAsset` tables store the name, folder, pieceId,
   duration, script and take number, plus a device-local URI that is never uploaded unless the user exports. The phone
   copies each take into app documents (`/clips/<project>/<uuid>.mp4`) before indexing it. SharedPreferences becomes a
   cache that is migrated once.
7. **The four calendar agents are the pipeline**, one file per agent (they already exist), behind a small
   `AgentStage<I,O>` interface with its own schema, token cap, timeout and *repair-then-degrade* policy. Degrade means
   the piece is marked `needs_rewrite` with the validation reason, never filled with canned copy. QC runs once per batch
   and can request at most one targeted rewrite per failing piece.

## 4. How lead qualification should work (answer + plan)

**Today:** the AI replies within 3 sentences toward the goal "understand their need and ask for an email or phone". A
CRM lead is created the first time an email or phone appears in a message. If the AI cannot help or the person is
angry, it escalates to a human.

**Proposed (P1.6):** each AI turn also returns structured `qualification = { need, budget, timeline, authority, fit, score
0-100, stage: new|engaged|qualified|disqualified|handoff }`. These criteria come from the brand profile (offer, price
band, ideal customer) and can be edited under Inbox → AI settings, for example "qualified = budget ≥ ₹50k and
timeline < 60 days". The score is stored on `SocialConversation`. When a thread becomes `qualified`, the AI stops
selling, sends the booking link or contact capture, and notifies the owner through push. The 180 Manager's "find
deals" tool then ranks threads by this score instead of keywords. The AI never invents prices, links or promises, which
is already enforced.

## 5. Implementation plan

Each phase ends with these gates green: `flutter analyze`, `flutter test`, package `tsc`, all touched node suites, and
a Kotlin compile when the native code changes. Every fix ships with a test. Phases are ordered by risk; P0 must ship
before any deploy.

### P0: Stop fake data, data loss and regressions (about 1 day)
| Task | Files | Acceptance |
|---|---|---|
| P0.1 Remove the Manager keyword fallback and invented numbers; surface `AI_NOT_CONFIGURED`/`AI_TIMEOUT` | `manager-orchestrator.service.ts`, `analytics-subagent.ts` | With no key → typed 503. Analytics returns only DB-backed numbers; `estimatedReach` is removed or replaced with stored insights labelled `stored`. |
| P0.2 Video intel: no invented scores; tenant-scoped upsert (`findFirst {postId, companyId}` + update/create); no `'standalone'` | `video-intelligence.service.ts` | Test: two tenants analysing do not collide; an LLM failure gives a typed error. |
| P0.3 Migration for `ManagerConversation`, `ManagerMessage` and `PostVideoIntelligence`; the server creates the conversation (scoped to company and project) and the client stores the returned id | `prisma/migrations/2026100…_manager`, orchestrator, `manager_copilot_sheet.dart` | History reloads after an app restart. Test: another tenant's `conversationId` → 404. |
| P0.4 `executeAction`: verify the project belongs to the company; disable the placeholder pivot until P1.3 | orchestrator, `calendar-subagent.ts` | Test: a foreign project → 404. |
| P0.5 Fix the Director rule upsert (`findFirst`+update/create on company, project and key) | `director-subagent.ts` | Applying the same rule twice leaves 1 row. |
| P0.6 Gate the demo OAuth branch on `NODE_ENV !== 'production'`; one-off script to deactivate `metadata.simulated` accounts | `oauth.service.ts`, `scripts/` | In production with mock mode → `PUBLISH_NOT_CONFIGURED`. |
| P0.7 Delete the fake stock catalogue; return `warnings[]` and provider errors; fix `pixabayOrientation`; slim the response (`?shape=unified`) | `media-editor.routes.ts` | Test: no keys → empty list + warning, never sample MP4s. |
| P0.8 Copy camera takes into app documents before indexing; migrate existing vault items whose files still exist; Clear cache spares `/clips` | `camera_screen.dart`, `vault_provider.dart`, settings | Test: an item path is under the documents dir; Clear cache leaves it. |
| P0.9 Delete the canned public reply (return `''`); update the "repair retry" autopilot test to the agreed contract | `engagement-dispatcher.ts`, `autopilot.test.ts` | engagement 67/67, autopilot 17/17. |
| P0.10 Fix the 6 Flutter test failures and 19 analyzer infos (`withValues`) | planner files, failing sections | `flutter analyze` clean, `flutter test` all green. |

### P1: Engagement and inbox you can trust (about 2 days)
- **P1.1 Existing-post automation.**
  - Add `platformMediaId`, `platformMediaPermalink` and `platformMediaThumb` (migration) and update the matcher.
  - New route `GET /accounts/:id/media?cursor=` (IG `/{ig-user-id}/media`, FB `/{page-id}/posts`, tenant-checked).
  - Replace "Link Post URL" with a **media picker grid** (thumbnail, caption, date). Keep URL paste as a fallback that
    resolves through oEmbed or the media list.
  - Delete the fake published-post creation.
- **P1.2 Composer funnel** (step 2).
  - Fields: trigger keyword(s), where **empty = any comment** (send `comment_any`), DM message (links go inside it),
    comment reply, and auto-like.
  - Drop the deliverable-URL and AI-follow-up fields from the composer UI, and send `actionEnableAiAgent: false`. The
    inbox agent handles follow-ups.
  - Map comment replies to `actionPublicReplies`.
  - Create *or update* the rule on edit.
  - Show errors with a retry; no `catch (_) {}`.
  - After publish, bind `platformMediaId` from the variant's `externalId`.
- **P1.3 AI inbox mode per account** (§3.5).
  - Migration on `SocialAccount`; a webhook DM branch; an Inbox → "AI auto-reply" sheet with a per-account switch and
    an "all Instagram accounts" bulk switch.
  - ⋮ → "Assign to 180 Manager" / "Take over" on each thread.
  - The rate limiter and the IG 24 h/7-day messaging windows still apply (`capabilities.ts`).
- **P1.4 Deep links.** Add the `/inbox?conversationId=` route param. The inbox opens the thread directly, and the
  Manager uses `act.payload.deepLink`.
- **P1.5 Opportunity scan.** One query with the latest message per conversation (window/`distinct`), and scoring from
  P1.6 instead of "unread = opportunity".
- **P1.6 Lead qualification** (§4). Structured output, stored score and stage, owner push notification on `qualified`.
- **Tests:** existing-media rule fires on a webhook for that media only; empty keyword fires on any comment; per-account
  AI mode replies once per inbound DM across 5 accounts in parallel under the limiter; human takeover stops the AI; a
  cross-tenant media id is rejected.

### P2: Content production loop (about 3 days)
- **P2.1 Calendar piece → shoot.**
  - The "Shoot" button passes `pieceId`. The camera's "Add to calendar day" links each take to the piece.
  - The piece sheet shows a **clip list**: Clip 1…N, with play, rename, retake (re-opens the camera on that slot),
    delete and reorder.
  - "Shooting done" sets `piece.productionStatus = shot` (new field or metadata).
  - Done returns to the calendar with the same day sheet open.
- **P2.2 Send to Director.** "Edit N clips in Studio" opens `/studio/session` with an ordered multi-source timeline,
  using `addTimelineClip` per clip, and greets with the piece script.
- **P2.3 Export → composer.** After export, open `/posts/new` prefilled with the video, piece title, caption and
  platforms. Keep the existing "Attach to calendar day" path as a secondary action.
- **P2.4 Stock search root cause.** Call `/stock/unified?query=nature&type=video&orientation=portrait` with the app's
  token and log the actual failure (feature lock, 401, timeout, parse). Show provider warnings and errors in the B-roll
  sheet with "Retry" and "Upload from device" as the second recovery path.
- **P2.5 Timeline B-roll as video.**
  - Thumbnail filmstrip per clip and overlay from the Kotlin thumbnail extractor, cached on disk.
  - The preview stacks **all** active overlays in z-order.
  - The inspector already has trim, crop/framing, opacity, mute and remove-audio; add speed and replace.
- **P2.6 Main-track "+"** at the start and end of the timeline. It opens the **Assets sheet** with tabs Library ·
  Device (image_picker / file_picker) · Stock · Music · SFX. Every tab can insert at the start, at the end, at the
  playhead or as an overlay.
- **P2.7 Text system v2.**
  - Add `animIn`, `animOut` and `animLoop` (`{type, durationMs, easing}`) to the caption IR on the Dart, contract and
    Kotlin sides.
  - Types: fade, slide (4 directions), pop/scale, typewriter, bounce, wiggle loop, pulse loop.
  - Render through Media3 `OverlayEffect`, using time-based alpha, translation and scale.
  - Add text background boxes, letter spacing, gradient fill and more font presets.
  - Emoji and stickers as image overlays (bundled Twemoji SVG→PNG; GIPHY behind a `GIPHY_API_KEY` if wanted).
  - Round-trip and render tests.
- **P2.8 Library in the database** (§3.6).
  - `MediaFolder`/`MediaAsset` tables and routes; the phone syncs metadata and keeps media local.
  - ⋮ on a folder → "Edit in Studio" opens all of its clips.
- **P2.9 Composer step 1.**
  - Post type (auto = video when there is media), title, caption, and account multi-select chips.
  - Tapping a platform opens that platform's sheet, prefilled from title and caption (YouTube title/description, FB,
    LinkedIn text, Threads, X, IG caption). Each value can be edited per platform and stored as `variants[].customContent`
    and `platformMeta`.
  - Remove objective, hook and first comment from the UI only (the fields stay in the API so nothing else breaks).
  - Step 2: visibility, schedule or now, and the funnel.
  - Publish now → per-platform progress list → "Open" buttons from `publishedLinks`. Scheduled → countdown.
  - Warn when the media upload is still queued offline.

### P3: Four-agent calendar engine (about 3 days)
- **P3.1** Wire `agents/neuromarketing-research → cadence-flow → creative-copywriter → qc-brand-auditor` into
  `pipeline.ts` behind `AgentStage`. Keep the existing research web search as a tool the research agent uses.
  - Each stage has: a zod schema, a token cap, a timeout, **one targeted repair**, then degrade to
    `needs_rewrite` with the reason (no canned text, no mid-sentence truncation).
  - Hook length is part of the prompt and the repair, not a hard crash.
- **P3.2** Cadence: compute the slots deterministically in code from the mix (daily N reels + M carousels, alternate
  days, custom stepper; chips take priority when set) before the LLM runs. The LLM only fills them.
  `expectedSlots = Σ per-day pieces`, chunked per week to fit token caps.
- **P3.3** The SOP becomes the system context: Client Master Context and Brand Context come from brand consciousness.
  Each unit carries format/series, title, hook/first frame, delivers, psychological job, CTA and visual direction.
  Carousels follow the slide logic, reels get target durations of 30/60/90 s.
  - **Reference handling:** the research agent rates the reference (specific / generic / boring). It always keeps the
    reference's *topic and constraints*, and replaces weak hooks and angles with SOP-grade ones.
  - **Psychological-job rotation:** no job is used more than about 30 % of the time, and no CTA twice in a row.
- **P3.4** Progress events per agent ("Research agent: finding tensions…") streamed to the generator screen.
- **P3.5** Generator UI: campaign name (with AI suggestion), mix chips plus custom stepper, alternate toggle, reel
  duration, slide count, structure box and reference box. The planner list shows campaigns, not project cards.
- **P3.6 Verification loop** (as you requested). Using the real pipeline with a stub LLM in CI, plus a live-key run you
  start:
  - 10 calendars of 30 days across niches (fitness, B2B SaaS, dentist, finance, food, fashion, real estate, edtech,
    coach, local café);
  - mixes: 1 reel/day; 2 carousels + 1 reel/day; alternate days;
  - edge cases: empty brand fields, a boring reference, a huge reference (truncated), a non-English language, a 7-day
    plan that starts on the 31st, a DST change, and a cancelled job.
  - Assertions: slot count matches the mix exactly; no canned strings; no job above 30 %; every unit has all SOP fields;
    hooks ≤ 12 words; carousels have 4–7 slides.

### P4: 180 Manager for real (about 3 days, after P0, P1 and P3)
- **P4.1** Tool-calling orchestrator (§3.1).
  - Tools come from the sub-agents, and the message history comes from `ManagerMessage`, capped by a token budget with
    a running summary.
  - Untrusted content (DMs, captions) is wrapped with `fenceUntrusted`.
- **P4.2** Analytics tool: account, platform and month aggregates from stored insights and publishes (one `groupBy`, no
  N+1), plus a live refresh for IG/FB/YouTube where the token allows it. Every number carries its source label.
- **P4.3** Calendar tool: date-aware status and `propose_calendar_pivot` → P3 regenerate for the remaining days →
  proposal card → apply.
- **P4.4** Inbox tool: P1.5/P1.6 opportunities with deep-link cards; "Assign to AI" action.
- **P4.5** Director tool: read and set rules through agent memory; the proposal card shows the rule diff.
- **P4.6** Performance learning: a nightly insights sync joins post metrics with *on-device* video traits (transcript,
  cuts per minute, hook type), already uploaded as text through `media-index`. This produces a "format → median
  engagement" table, which the Manager and the strategist read. Decision §3.3 decides whether published reels are
  analysed.
- **P4.7** UI: the global FAB/drawer already exists. Add streaming replies, markdown, action cards (Update calendar,
  Open chat, Apply rule), a history list, and error states with retry and "Open settings".
- **Tests:** a no-key typed error; each tool is tenant-scoped; a pivot never touches past pieces; a prompt-injection DM
  cannot trigger a write; history is persisted.

### P5: Performance and release (about 1 day)
- P-1…P-7 above. Profile in `--profile` mode on a mid-range Android (timeline scroll, preview at 60 fps, opening the
  library with 500 items).
- Release build: `flutter build appbundle --release --obfuscate --split-debug-info`, size report, and a Play pre-launch
  report.
- Update `PRODUCTION_GAP_AUDIT.md`. Run the full journey on a real phone: calendar → shoot 3 takes → Director → export
  → composer → publish to 2 IG accounts → comment funnel fires → AI inbox replies → Manager answers with real numbers.

## 6. Decisions needed from you
1. **Published-reel analysis (§3.3):** may the phone download your own published reels temporarily for on-device
   analysis, or should "why it worked" use caption, metrics and transcript only?
2. **AI inbox default:** per-account mode `ai_reply` (answer everything) or `ai_qualify` (qualify, then hand off)?
3. **Text animation scope for v1:** the 8 types in P2.7 (recommended), or a full keyframe editor (about 3× the work)?
4. **Stickers:** bundled emoji only, or also GIPHY (needs a key and attribution)?

## 7. What you need to provide
These are unchanged from `PRODUCTION_GAP_AUDIT.md` §4. In addition:
- Meta App Review for `instagram_business_manage_messages` and `instagram_business_manage_comments`, needed for P1;
- an optional `GIPHY_API_KEY`;
- a live AI key for the P3.6 live run.

## Status: P0 (2026-10-02)

Done and verified:
- **P0.1–P0.5 Manager** (`social-media/src/manager/*`, `manager.routes.ts`):
  - no keyword fallback and no invented numbers (no AI → 503 `AI_NOT_CONFIGURED`, bad output → 502 `AI_INVALID_OUTPUT`);
  - conversations are server-owned and company-scoped, with history replayed;
  - new routes `GET /manager/conversations` and `/conversations/:id/messages`;
  - DMs are fenced as untrusted data, and actions are sanitised so invented inbox ids are dropped and the project is
    server-verified;
  - analytics uses `groupBy` counts plus labelled live metrics, with nothing estimated;
  - video intelligence validates the AI output, takes text only (`basis`), and writes per tenant (no shared
    `'standalone'` row);
  - Director rules use `AgentMemoryService`, so there are no duplicates;
  - the calendar pivot returns 501 `CALENDAR_PIVOT_UNAVAILABLE` instead of writing placeholder posts.
  - Migration `20261002100000_manager_agent` (not applied). Tests: `test/manager.test.ts` 11/11.
- **P0.6 OAuth demo.** `getYouTubeProviderMode`/`getLinkedInProviderMode` return `live` in production. They used to
  fall back to mock when credentials were missing, which was the source of the "(Demo)" channel. Cleanup:
  `apps/backend/scripts/deactivate-simulated-social-accounts.ts` (dry run by default, `--apply`).
- **P0.7 Stock.** The fake sample catalogue is gone. Provider errors come back as `warnings[]`, and `shape=unified` is
  supported. The client used `/stock/search?type=videos`, which returns 0 from Pexels (it needs `video`); it now makes
  one unified call that throws `StockSearchException`. The B-roll sheet shows the reason, and export skips B-roll with
  the reason.
- **P0.8 Clips.** `core/storage/clip_store.dart` moves each take into `<docs>/clips/<project>/`. Existing cached takes
  are rescued when the library loads. Tests: `test/core/clip_store_test.dart`.
- **P0.9** The canned public reply was removed (engagement 67/67).
- **P0.10 Flutter.** analyze clean, `flutter test` **174/174**. Stale tests were updated to the intentional changes:
  device music/SFX, the Uploads tab, the renamed brand tone field, and no cross-project account linking. The timeline
  label overflow on short items is fixed. Manager sheet:
  - uses the server conversation id;
  - shows real errors;
  - fake "SWARM ACTIVE" and "all 5 accounts" header removed.
  - Tests: `test/sections/manager_test.dart`.

Open:
- **Autopilot 15/17.** The `normalize` step added to `autopilot/pipeline.ts` in `6893b5e1` (another tool) fills invalid
  AI output with canned copy, so the "job failure" and "repair retry" tests fail. Per the no-fake-content rule, the
  code must change, not the tests. This is part of P3.1.
- **Schema drift.** The `User` (`age`, …) and `TrafficDirectorSubscription` schema changes have no migration
  (outside this scope).
- Apply the migrations with `prisma migrate deploy`. Run the demo cleanup script with `--apply` on production after
  reviewing the dry run.

## Status: P1 (2026-10-02)

Done and verified:
- **P1.1 Existing posts.**
  - `SocialEngagementRule.platformMediaId`/`Permalink`/`Thumbnail` (migration `20261002120000_engagement_existing_media`).
    A media id requires `socialAccountId` and cannot be combined with `postId`.
  - New route `GET /accounts/:id/media?cursor=`: IG media and FB page posts, live, tenant-checked. Other platforms get
    422 `MEDIA_LISTING_UNSUPPORTED`.
  - The matcher fires a media rule only for that media, and the most specific rule wins.
  - The phone has a "Pick existing post" grid (`workspace/account_media_picker.dart`) that replaces the fake
    "published post" created by "Link Post URL". Presets no longer pre-fill 180workspace.com links.
- **P1.2 Composer funnel.**
  - Empty keywords send `comment_any`, and the comment reply goes into `actionPublicReplies` (it was dropped before).
  - `actionEnableAiAgent: false`. The DM text is required. Editing a post updates or pauses its rule, and errors are
    shown instead of swallowed.
  - The `keyword` trigger with no keywords is rejected server-side. Rule `status` is validated, and `updateRule` is
    company-scoped.
- **P1.3 AI inbox.**
  - `SocialAccount.aiInboxMode` (`off|reply|qualify`) and `aiInboxInstructions` (migration
    `20261002130000_ai_inbox_mode`).
  - Routes: `GET /inbox/ai-settings`, `PUT /inbox/ai-settings/accounts/:id`, and `PUT /inbox/ai-settings/bulk`
    (IG/FB only).
  - The agent answers when the thread switch or the account mode is on, unless a human took the thread over.
    Toggling AI off on a thread now means a human handles it.
  - DM text is fenced as untrusted. Phone: Inbox → "AI auto-reply" sheet (per account, plus "All N Instagram
    accounts", plus instructions).
- **P1.4** `/inbox?conversationId=` redirects to the thread. Used by the Manager and lead notifications.
- **P1.5** Opportunities come from one query and are ranked by the AI lead score. Unread chit-chat is no longer an
  "opportunity".
- **P1.6 Lead qualification.**
  - Need, budget, timeline, authority and fit, plus score and stage, are stored on the conversation.
  - The first qualified or handoff event triggers a notification to the project owner and marks the thread unread.
  - `handoff` hands the thread to a human. Malformed AI output is ignored.
- **Security (found during P1).** `publishing/config.ts` had base64-embedded app IDs and **secrets** for
  Facebook/Instagram/Threads/LinkedIn (commit `38f5a1a3`). They are removed; credentials now come from the environment
  only. **Rotate those four app secrets**: they are in git history.

Tests:
- social-media: `engagement-p1` 10/10, manager 11, engagement 67/67, engagement-production 16, tenant-isolation 16,
  post-edge-cases 15, social-os 7, webhooks-meta 6, sandbox-e2e 11 (was failing because of the embedded keys),
  publishers 16, adapters-verified 16, oauth-meta 7.
- Flutter: analyze clean, **177/177** (new: `test/sections/engagement_p1_test.dart`).

Open:
- Apply the 3 new migrations.
- Rotate the Meta and LinkedIn app secrets.
- Meta App Review for the messaging/comments permissions.

## Status: P2 (2026-10-02)

Done:
- **P2.1/P2.2 Shoot loop.**
  - Takes carry `pieceId` and `takeIndex` and are named Clip N.
  - The camera's "Done" returns to the piece sheet. The four duplicated save blocks became one, and save errors are
    shown instead of swallowed.
  - The piece sheet has a Clips section (`planner/piece_clips_section.dart`) with play, rename, retake, delete,
    move up/down, "Shooting done" (new piece status `shot`) and "Edit N clips in Studio".
  - A Studio folder or piece opens **all** of its clips, not just the first.
- **Multi-clip bug.** Export used to map every clip asset to the original video. Each clip now renders from its own
  file, stock main-track clips are downloaded first, and the preview switches player per asset.
- **P2.3** Export after a calendar piece opens the post editor. Otherwise "New post with this video" attaches the
  rendered file (`localMediaPath`).
- **P2.5** The preview stacks every active overlay, and local videos show real frame thumbnails
  (`studio/video_thumbnails.dart`). Add-clip errors are surfaced.
- **P2.6** The +start/end buttons and assets sheet were already present.
- **P2.7 Text motion.**
  - In (7 types), Out (6) and Loop (4) via `studio/text_motion.dart` and the Kotlin `TextMotion.kt`, using the same
    maths.
  - Contract `MobileCaptionStyleSchema` gains `enter`/`exit`/`loop`/`glow`; it used to strip them.
  - Legacy invalid `animation` values (fade_in, slide_up, typewriter, pulse) are migrated when a timeline loads.
- **P2.8 Library in the database.**
  - `StudioMediaFolder`/`StudioMediaAsset` (migration `20261002140000_studio_media_library`).
  - `GET`/`PUT /library/sync`: tenant-safe, soft deletes, ids owned by another company → 409.
  - The phone pushes every change through the outbox and merges on load. Media stays on the device (`deviceId`).
  - Deleting an item now removes the take file the app owns.
- **P2.9** An untouched per-platform caption/title copy now follows edits to the main caption; it used to publish the
  stale copy.

Tests:
- Flutter: analyze clean, **191/191**.
- New Flutter tests: `piece_clips`, `library_sync`, `text_motion`, `composer_variants`.
- social-media: `studio-library` 4/4.
- video-contracts: director-os 13, effects-photos 3.
- Kotlin compiles.

Next: P3 (four-agent calendar: fix the `normalize` canned fallbacks, cadence mix), P4 (Manager tool-calling),
P5 (performance and release).

## Status: P3 (2026-10-02)

Done:
- **No canned content.** `autopilot/normalizers.ts` replaces the inline normalisers that invented content when the AI
  output was incomplete:
  - strategy: audience psychology, pillars, "Strategic Content Insight Day N" slots;
  - hooks: "Stop scrolling…", "Save this and follow for part two", stock carousel slides;
  - copy: "Check out this insight.", 18:00 posting times.

  The new normalisers only fix shape and use the strategist's, brand's or platform's own data. The zod `.default(...)`
  stock texts in `schemas.ts` are removed. Hook/script problems (hook over 12 words, fewer than 3 beats, missing
  CTA/retention loop, fewer than 3 shot notes, fewer than 4 slides or the creator's slide count) go back to the agent
  for repair instead of being truncated or padded.
- **P3.2 Cadence.** `autopilot/cadence.ts`:
  - The mix decides the exact slots in code: daily N reels + M carousels; `alternate` = reel on odd days, carousel on
    even days.
  - Unsupported formats and plans over 120 slots return 400 at start.
  - The strategist gets an exact per-day plan and is checked against it. Reel duration and slide count apply to
    every slot.
  - The service validates `contentMix` with zod (it was passed through unvalidated).
- **P3.3 Prompts.**
  - Reference text is fenced as untrusted and judged: keep its topics and facts, upgrade weak hooks. With no
    reference, the SOP chain is used.
  - No psychological job may exceed about a third of the slots (checked).
  - The example JSON in the prompt uses `<placeholders>` and is checked so they are never copied.
- **P3.4** Progress names the agent: research & psychology → strategy & cadence → SOP writer → quality control.

Tests:
- `autopilot` **17/17** (repair-retry fixed).
- `multi_calendar_loop` **11/11**: exact counts for 1 reel/day, 1 carousel/day, 1+1, alternate, 2 carousels + 1 reel
  (90), custom mixes, references, structure.
- New `packages/domains/ai/tests/autopilot-cadence.test.ts` 8/8.
- Director 58/58 and director-os 12/12 unchanged.

Open:
- The files under `autopilot/agents/*.agent.ts` (from another tool) are still unused. The four agent roles are the
  pipeline stages above.
- A live-key run of the 10-calendar loop (costs real AI tokens) is waiting for the owner's go-ahead.

## Status: P4 + P5 (2026-10-02)

P4, 180 Manager:
- **Calendar pivot is real.** It rewrites this month's upcoming autopilot pieces from max(today, fromDay) through the
  calendar agents (`regeneratePiece`).
  - Only `ready`/`in_progress` pieces are touched (never shot, in review or published), at most 12 per action.
  - Failures and the remainder are reported per piece.
- The phone asks for confirmation before any Manager write (pivot or Director rule) and shows what changed.
- The analytics summary is cached for 60 s per company and project, so a chat turn does not call every platform API
  again. Failures are not cached.
- Not done: provider-native tool calling (the AI layer exposes `generate()` only). The Manager answers from fenced
  workspace data, and every write is a confirmed action.
- Not done: published-reel video analysis (decision §6.1 is still open).

P5, performance:
- Job polling backs off: 2 s → 5 s → 10 s (`core/util/poll_backoff.dart`) for autopilot and carousel jobs.
- Thumbnail-sized `Image.network` calls decode at display size (`cacheWidth`).
- The timeline uses cached on-device frame thumbnails.
- Preview playback switches player per clip (P2).
- Release: signing via `android/key.properties` (git-ignored); an unsigned release fails loudly; R8 shrinking is the
  Flutter default. Build with `flutter build appbundle --release --obfuscate --split-debug-info=build/symbols`, and for
  sideloading use `flutter build apk --release --split-per-abi`.

Gates (2026-10-02):
- Flutter: analyze clean, **191/191**.
- social-media: manager 12, engagement-p1 10, engagement 67/67, engagement-production 16, tenant-isolation 16,
  post-edge-cases 15, social-os 7, studio-library 4, sandbox-e2e 11, webhooks-meta 6.
- Autopilot: 17, multi-calendar 11, cadence 8.
- Director: 58 and 12. video-contracts: 13 and 3.
- Kotlin compiles. Backend: touched routes typecheck.

Before launch (owner):
1. `prisma migrate deploy` (6 migrations from 2026-10-02).
2. Rotate the Meta and LinkedIn app secrets that were in `publishing/config.ts`.
3. Run the demo-account cleanup script.
4. Meta App Review (messaging/comments).
5. A real-phone run of: calendar → shoot → clips → Studio → export → post → publish → comment funnel → AI inbox →
   Manager pivot.
6. Optionally, a live-key run of the 10-calendar loop.

## Status: publish feedback + folder editing (2026-10-02)
- **Post detail** (`posts/publish_status.dart`):
  - While publishing, one live row per platform (indeterminate; nothing invented). The result dialog has an **Open**
    button for each posted platform.
  - Scheduled or approved posts show a countdown ("Publishes in 2 h 14 min") and reload when due.
  - A post or variant that is still `publishing`/`processing` (IG/FB video) reloads itself with backoff until it
    settles.
- **Library.** Folder ⋮ "Edit in Studio" opens **all** of the folder's clips in take order (it used to open the first
  only). A folder whose clips were recorded on another phone says so instead of opening an empty editor.
- Tests: `test/sections/publish_status_test.dart` 3/3.

## Status: device verification (2026-10-02)
- `flutter build apk --debug`: OK (full Gradle/Kotlin build).
- Emulator `Pixel_7_API_34`, `integration_test/media_engine_render_test.dart`: **8/8**:
  - director render (11.19 s, 1080×1920, audio);
  - **text motion** (in/out/loop/typewriter; 4.0 s, no warnings);
  - **multi-asset timeline** (two files; frames differ; 5.0 s);
  - ducking (−13.7 dB);
  - cancel;
  - missing-media typed error.
- Demo-account cleanup dry run against the configured database: **0 active demo accounts**. The DB is the shared AWS
  RDS, so migrations and `--apply` were **not** run (CLAUDE.md rule).
- Agent handoff prompt: `docs/social-studio-mobile/AGENT_HANDOFF_PROMPT.md`.
