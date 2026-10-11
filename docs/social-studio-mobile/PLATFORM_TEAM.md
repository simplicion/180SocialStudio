# Platform Team, craft kit and the 8-agent calendar

Status 2026-10-07. Replaces the Instagram-only crew from commit `828b81cc` (stock-text agents removed).
The Instagram skills from `github.com/Jakeschincariol/instagram-agent-skill` (MIT, see
`packages/domains/ai/src/content/craft/NOTICE.md`) are now one rule set per platform: Instagram, LinkedIn,
YouTube, X, Facebook (TikTok rules included).

## 1. Craft kit: `packages/domains/ai/src/content/craft/` (deterministic, no AI)

| File | What it does |
|---|---|
| `platform-specs.ts` | Per platform: caption cap, feed fold, hashtag cap, link behaviour, hook window, speaking pace, carousel spec, playbook rules (fed to the writer agents), rewarded signals |
| `hook-scorer.ts` | 0-100 hook score (length, concreteness, stakes, front-load, address), dealbreakers, 26 formula names. `spoken: false` scores text-post opening lines |
| `beat-sheet.ts` | Times a script at the platform pace; flags a slow hook, lines over 4s, abstract runs, missing loop |
| `copy-linter.ts` | Fold preview, length, hashtags, filler tags, links, one ask, keywords in the fold, stock phrases. X: URL weight 23 and `splitIntoThread`. YouTube title lint |
| `text-humanizer.ts` | Strips invisible characters, dashes, stock AI phrases; 5-check human score. `{typographic:'dashes', lexical:false}` is the meaning-safe mode used in the pipeline |
| `profile-auditor.ts` / `platform-profile-audit.ts` | Profile rubrics for all five platforms. Only supplied fields are scored |
| `swipe-classifier.ts` | Outlier multiple vs account median |
| `craft-review.ts` | `reviewPieceCraft` (one report per piece), `buildTimedBeats`, `inventedFigures` (numbers not present in the context) |

Import with `@workspace/ai/content/craft` (deep import; the root `@workspace/ai` index boots Redis services).

## 2. Calendar pipeline: 8 agents (`content/autopilot/pipeline.ts`)

1. Research and audience psychology (LLM + web search, optional)
2. Strategy and cadence (LLM)
3. Hook and script writer (LLM; now gets each platform's playbook)
4. **Hook Lab** (`agents/hook-lab.agent.ts`): scores every hook; weak ones get one LLM rewrite with the scorer's
   feedback. A rewrite is kept only if it scores higher and adds no figure missing from the piece/brand context.
5. Copywriter (LLM; platform playbooks + "never invent figures")
6. **Platform Craft** (`agents/platform-craft.agent.ts`): lints each platform copy; failures get one LLM fix,
   kept only if it lints better.
7. **Voice Guard** (`agents/voice-guard.agent.ts`, deterministic): removes invisible characters and dashes.
8. Critic (LLM + deterministic brand rules), then `attachCraftReport` stores `hookScore`, `hookFormula`,
   `humanScore`, `craft {score, blocking, advice}`, `timedBeats`, `teleprompterText` on the piece.

Agents 4 and 6 are fail-soft: if their LLM call fails the writer's text stays and the weakness is recorded on
the piece. Nothing is ever replaced with a stock line. Job stages gained `hook_lab` and `craft`.

On demand: **Shooting Script Director** (`agents/production-script.agent.ts`),
`POST /api/v1/social-media/projects/:id/autopilot/pieces/:pieceId/shooting-script` `{force?}` ->
`{productionScript, cached}`. Scenes carry shot, framing, action, B-roll, edit cue, audio cue, delivery. The
spoken lines must equal the stored script word for word (checked); timecodes are computed from word counts.
Stored in the piece JSON as `productionScript`.

## 3. Platform Team API: `/api/v1/social-media/platform-team/:platform`

`platform` = instagram | linkedin | youtube | x | twitter | facebook | tiktok. Tenant from `req.user` only.

| Route | Kind |
|---|---|
| `GET /spec` | rules for the platform |
| `GET /overview?projectId=` | monitoring: connected accounts, publishing pipeline (30d), craft score of every queued post, inbox triaged into LEAD / KEYWORD / QUESTION / SUBSTANCE / SUPPORT / NOISE, live metrics passed through from social-insights with their source labels |
| `POST /hooks/score`, `/beat-sheet`, `/copy/lint`, `/thread`, `/humanize`, `/profile/audit`, `/outliers`, `/comments/triage`, `/posts/audit` | deterministic |
| `POST /draft` `{idea, format: video\|carousel\|text, projectId?, keywords?}` | AI: ranked hooks, timed script or slides, caption, lint, `unverifiedFigures` |
| `POST /repurpose` `{text, projectId?}` | AI: post ideas, each tied to an exact quote from the source (others are dropped) |

AI routes return 503 `AI_NOT_CONFIGURED` without a workspace AI key. Service:
`packages/domains/social-media/src/platform-team/`.

## 4. Mobile

- `lib/features/command_center/`: Command Center at `/command-center?platform=`. Platform chips, tabs
  Monitor / Create / Check. Entry points on the dashboard app bar and profile sheet.
- `lib/features/planner/detailed_script_screen.dart`: `/planner/script`. Tab "Script" (timed lines, pacing flags,
  craft report) and tab "Shooting script" (generate / regenerate). Opened from "View detailed script" on a piece.
- `PieceBrief` reads `craft`, `timedBeats`, `productionScript`; for older pieces it only times the real lines.

## 5. Own-post metrics, competitor radar, replies, threads, cost (added 2026-10-07)

### Own-post metrics and outlier ranking (`platform-team/post-metrics.ts`)
- `fetchPostMetrics` reads one published post from its platform with the vault token: Instagram media insights,
  Facebook post + insights, YouTube `videos.statistics`, X `public_metrics`, LinkedIn `socialActions` (+
  `organizationalEntityShareStatistics` for company pages). A metric the platform does not return stays null.
- Stored on the variant as `platformMeta.metrics` (no schema change). `refreshProjectPostMetrics` skips posts
  measured in the last 6 hours and simulated posts, and reports per-post failures with the provider's reason.
- `rankOwnPosts`: multiple of the account's own median over 90 days; basis = views, else reach, else engagements
  (returned as `basis`). Needs 5 measured posts; before that it says how many more.
- `rememberPostPerformance` upserts one `AgentMemory` row per post (kind `performance`); the calendar strategist
  now also gets a line listing the account's own 3x+ outliers (`formatMemoryContext`).
- `PostMetricsScheduler` (started in `apps/backend/server.js` with the publish scheduler): every
  `SOCIAL_POST_METRICS_INTERVAL_MS` (default 3 h). `SOCIAL_POST_METRICS_ENABLED=false` turns it off.
- Routes: `GET /posts/outliers?projectId=`, `POST /posts/refresh-metrics {projectId, force?}`; `overview.ownPosts`.

### Competitor radar (`platform-team/competitor-radar.ts`): official APIs only, no scraping
- Instagram Business Discovery, YouTube Data API (handle -> uploads -> statistics), X API v2 user posts, always
  through the project's own connected account. LinkedIn, Facebook and TikTok have no such API:
  `COMPETITOR_API_UNAVAILABLE` (422) and the UI keeps the manual check.
- Up to 10 handles per platform in `Project.socialSettings.competitorRadar[platform]`, with the last scan (top 40
  posts). Each post is ranked against that account's own median; basis views or likes+comments, per account.
- Routes: `GET /radar?projectId=`, `PUT /radar {projectId, handles[]}`, `POST /radar/scan {projectId}`.

### Reply drafts for triaged messages
- `POST /replies/draft {projectId, conversationId}`: triages the last inbound message, then asks the engagement
  LLM for 3 replies with bucket-specific guidance and the brand profile. Forbidden words filtered; noise gets no
  AI call. Drafts only: mobile sends through the existing inbox endpoint after a confirmation; web copies.

### X threads (`adapters/twitter.adapter.ts`)
- `platformMeta.thread = true` splits a caption over 280 into numbered posts; `thread = string[]` is explicit.
  Post 1 carries the media, each later post replies to the previous one, max 25 posts. A mid-thread failure
  leaves what was published and returns a warning with the count. Ids are saved in
  `platformMeta.publishResult.threadIds`.
- Mobile composer sets `thread: true` automatically for X text over 280. Mobile still forces
  `publishingMode: 'user_assisted'` for X (hand-off to the X app), so API threads apply when X is published by
  API (`publishingMode: 'api'` or unset with X credentials configured).

### Cost of a calendar run (`content/autopilot/budget.ts`)
- `POST /projects/:id/autopilot/estimate {days, platforms?, contentMix?}`: AI calls and output-token ceiling per
  agent, from the same caps the run uses (`AGENT_TOKEN_CAPS`). No AI key needed. Mobile: "See AI usage for this
  plan" in the generator.
- Finished runs store `usage` per agent plus `usage.cost`, which is null unless
  `AUTOPILOT_PRICE_INPUT_PER_MTOK_USD` and `AUTOPILOT_PRICE_OUTPUT_PER_MTOK_USD` are set. No price is assumed.
- Limits: `AUTOPILOT_CRAFT_MAX_FIX_CALLS` (default 3, worst failures first), `AUTOPILOT_REWRITE_AGENTS=off`
  (Hook Lab and Platform Craft only score).
- `npx tsx apps/backend/scripts/autopilot-usage-report.ts [--company id] [--days 30] [--json]`: what real runs
  consumed, per agent, from stored usage.

### Web
- `apps/frontend/app/(platform)/(social-media-management-app)/social-projects/[id]/command-center/page.tsx`
  (`?platform=&tab=monitor|create|check|scripts`), panels in `_components/command-center/`, API client
  `lib/services/platform-team.service.ts`. Linked from each project card. Scripts tab = video pieces of the
  project's three newest calendars with the timed script, craft report and shooting script.
- `@workspace/ui` gained `Textarea`.

## 6. Tests

- `npx tsx --test --test-force-exit packages/domains/ai/tests/craft-agents.test.ts` (17)
- `npx tsx --test --test-force-exit packages/domains/social-media/test/platform-team.test.ts` (7)
- `npx tsx --test --test-force-exit packages/domains/social-media/test/platform-metrics-radar.test.ts` (9)
- `packages/domains/social-media/test/publishing/adapters-verified.test.ts` (X thread case added)
- `apps/backend/src/api/v1/social-media/autopilot/autopilot.test.ts` (18, incl. estimate vs actual calls)
- Flutter: `test/core/piece_brief_craft_test.dart` (4), `test/sections/command_center_test.dart` (5),
  `test/sections/command_center_insights_test.dart` (4)

## 7. Not verified / open

- Nothing here has run against live platform APIs or a real AI key; provider calls are tested with fakes. First
  live checks to do: Instagram `view_count` in business discovery (falls back to likes+comments if rejected),
  Facebook post insights on Reels, LinkedIn share statistics scope, X read access on the app's tier.
- Web Command Center is typechecked, not opened in a browser.
- Token counts are estimated from text length (the provider client returns text only), so cost is approximate.
- Autopilot runs are not charged to the AI credit meter; that is a billing decision, not made here.
- X threads in the mobile hand-off flow still open the X app with the full text; splitting there is manual.
- Known unrelated failures: 4 Flutter lock-screen tests (`feature_lock_view.dart` overflow);
  `user-assisted-publishing.test.ts` case 1 expects Instagram credentials in the environment.
