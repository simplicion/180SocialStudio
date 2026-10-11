# Prompt for your coding agent (copy everything below the line)

---

You are continuing work on **180 Workspace: Social Studio**, a monorepo at `C:\Users\saavi\desktop\180workspace`
(pnpm + turbo, Node ≥20, Windows, Git Bash). Read `CLAUDE.md` first, then
`docs/social-studio-mobile/PRODUCTION_READINESS_PLAN.md`. The "Status" sections at the end of the plan are the source
of truth for what is done.

## Non-negotiable rules (from CLAUDE.md)
- No hardcoded secrets, not even as fallbacks (`process.env.X || "literal"` is forbidden).
- No fake data or fake success: no canned AI text, invented metrics or placeholder URLs. Missing provider → typed error.
- Tenant isolation on every query: `findFirst`/`updateMany` with `{ id, companyId }`; `companyId` only from `req.user`.
- Never run Prisma migrations or write scripts against the shared AWS RDS database in `.env`.
- Don't revert or reformat other people's uncommitted work. Don't run `dart format` on whole files. Commit only when
  the owner asks, with a message that describes the change.
- UI follows `.agents/rules/*`: skeletons (not spinners), empty states with an action, errors with retry plus a second
  recovery path, 44 px targets.

## Gates that must stay green after every change
- `cd apps/social-studio-mobile && flutter analyze && flutter test` (currently 194/194, analyze clean).
- `npx tsc --noEmit -p packages/domains/social-media` and `-p packages/domains/ai` (0 errors). After changing a package,
  rebuild it with `npx tsc -p packages/<pkg>`.
- Node suites, run as `npx tsx --test --test-force-exit <file>`:
  - `packages/domains/social-media/test/`: manager, engagement-p1, engagement, engagement-production,
    tenant-isolation, post-edge-cases, social-os, studio-library, `publishing/*`;
  - `apps/backend/src/api/v1/social-media/autopilot/autopilot.test.ts` (17) and `multi_calendar_loop.test.ts` (11);
  - `packages/domains/ai/tests/autopilot-cadence.test.ts` (8) and `video-director.test.ts` (58).
- Kotlin: `cd apps/social-studio-mobile/android && ./gradlew :app:compileDebugKotlin -q`.

## Tasks you can do (in order)
1. **Merge the work into a reviewable branch.** P1–P5 were committed by mistake inside `b5369514 feat(billing): …`.
   With the owner's approval, create a branch and a PR that describes the social-studio changes using the plan's status
   sections. Do not rewrite shared history without approval.
2. **Run the on-device render tests** (emulator `Pixel_7_API_34`; fixtures in `apps/social-studio-mobile/test_assets/`):
   - Push them as described at the top of `integration_test/media_engine_render_test.dart`, then run
     `flutter test integration_test/media_engine_render_test.dart -d emulator-5554` and
     `flutter test integration_test/export_formats_render_test.dart -d emulator-5554`.
   - The new cases "text motion" and "multi-asset timeline" must pass.
   - Pull `/sdcard/Android/data/com.workspace180.social_studio_mobile/files/evidence` and look at the frames.
3. **Write a Flutter integration test for the full journey** with the fake backend from `test/support/`:
   - planner → open piece → clips section → "Shooting done" → "Edit N clips in Studio" (with stub clips) → export
     sheet → "New post with this video" → composer funnel → publish result with Open buttons.
4. **Clean up the unused agent files.** `packages/domains/ai/src/content/autopilot/agents/*.agent.ts` are not used by
   the pipeline but are exported from `autopilot/index.ts`.
   - Grep them for canned fallback text (anything like "Stop scrolling", "Save this", default hooks or CTAs).
   - Either delete them and their exports (if the owner agrees), or remove the canned text so no future wiring can
     ship fake content.
5. **Inbox web parity (optional).** If the web app shows the inbox, add the AI auto-reply settings
   (`GET/PUT /api/v1/social-media/inbox/ai-settings`) and lead badges (`leadStage`, `leadScore`).
6. **Light theme (backlog).** About 40 screens use dark `AppTheme.*` constants directly. Tokenise them through
   `Theme.of(context)` and then set `ThemeModeNotifier.lightModeAvailable = true`.
7. After each task, add a short "Status" section to `PRODUCTION_READINESS_PLAN.md`.

## Tasks that need the owner (do not attempt; remind them)
- Apply migrations with `prisma migrate deploy` (6 new ones from 2026-10-02) on the target database.
- Rotate the Meta (Facebook / Instagram / Threads) and LinkedIn app secrets. The old values are in git history
  (commit `38f5a1a3`).
- Meta App Review (messaging and comment permissions); Google `youtube.upload` verification.
- A live-key run of the 10-calendar loop, which costs AI tokens.
- Decide whether published reels may be downloaded to the phone for on-device analysis.

Report back with: what changed (files), the test results (pass/fail counts), and anything you could not do and why.
