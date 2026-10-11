# 180 Social Media Manager: Autonomous Multi-Agent Build Plan

Status: in progress (started 2026-09-25). This is the working plan for building the full product
end to end on the web app (`apps/frontend`), the mobile app (`apps/social-studio-mobile`) and the
backend (`apps/backend` + `packages/domains/*`).

## The rule that never changes

**AI decides** the strategy, hooks, scripts, captions, slide copy and edit plan. **Deterministic
engines decide how the media is built**: the timeline/EditIR compiler plus the on-device and
desktop renderers for video, a template compiler for carousels, and platform adapters for
publishing. The AI never generates or alters a single video pixel. The one exception is still
photography for carousels and posts, which comes from an image model or stock photos and is
placed by the carousel compiler.

## Product journey

1. **Create a project (brand consciousness).** The user answers: company, creator or agency;
   positioning, tagline, description, ideology; brand colours (primary, accent, background,
   text); logo; font; tone; audience; restricted words; CTAs; hashtags; target platforms; and
   which accounts to connect. After that, every agent reads this profile.
2. **Autopilot calendar.** A strategist agent plans N days: content mix, pillars, cadence per
   platform, and the audience psychology behind them. A hook and script agent writes each piece
   using 5 hook types (pattern interrupt, curiosity gap, contrarian, relatable pain, story),
   with full teleprompter scripts (hook, retention loop, CTA). A copy agent writes captions and
   hashtags. A research agent (optional web search) grounds topics in what is current. A critic
   agent checks everything against the brand rules before saving.
3. **Carousels and images.** A design agent writes the slide copy and art direction. An image
   agent gets realistic photos (image model, or stock as fallback). The carousel compiler lays
   them out in the brand's colours, font and logo and outputs PNGs attached to the piece.
4. **Shoot → edit.** On a reel's day the user uploads or records the raw video on the calendar
   piece. "Edit" opens Studio, where the AI Director greets them with the brand and script
   context and offers to cut the video to match the brand, script and platform. The user can
   accept, then adjust by hand or ask for changes in chat. The export is attached to the piece's
   post as the final video.
5. **Approve → publish.** A client review link (already built), then scheduled or immediate
   publishing to Instagram, Facebook, YouTube, LinkedIn, X and TikTok through each platform's
   official API, with per-platform status and retry.

## Work split (who owns which files)

Each workstream owns its files. Shared files (`packages/domains/social-media/src/index.ts`,
`apps/backend/.../index.routes.ts`, the Prisma schema) get small, targeted, re-read-before-edit
changes only.

| WS | Scope | Owns |
|---|---|---|
| 1 | Brand consciousness: model, validation, logo, API, web wizard | `social-project.service.ts`, brand-voice service and routes, project routes, web `social-projects/*`, `lib/services/social-project.service.ts` |
| 2 | Multi-agent autopilot calendar and scripts | `packages/domains/ai/src/content/*`, `content-calendar.service.ts`, content-calendar routes, web `content-calendar/*` (except the piece drawer) |
| 3 | Image agent and carousel compiler | new `packages/domains/social-media/src/creative/*`, creative routes |
| 4 | OAuth connect, token vault, publish adapters, scheduler | `packages/domains/social-media/src/adapters/*`, social-account routes, the publish parts of `social-post.service.ts`, the scheduler worker, the Prisma schema |
| 5 | Brand-aware AI Director and the calendar → Studio bridge (backend, contract, Android watermark) | `video-ai-director.service.ts`, `packages/video-contracts/*`, `media-editor` routes, `android/…/mediaengine/*`, `lib/core/native_engine/*`, web `ContentPieceDrawer.tsx` and `media-editor/*` |
| M | Mobile UI for all of the above | `apps/social-studio-mobile/lib/features/*`, `lib/data/*`, `lib/core/network/social_api_client.dart` |
| QA | End-to-end tests and the production-readiness loop | tests in every package, `test/**` |

## Definition of done (per workstream)

- It works against the real backend code path. There are no mock data paths in production code.
- Every external provider sits behind an interface. Keys come from env or the workspace
  settings, with no hardcoded fallbacks. A missing key gives a clear, typed error (for example
  `AI_NOT_CONFIGURED` or `PUBLISH_NOT_CONFIGURED`), never canned output.
- Every query is filtered by `companyId` and, where relevant, `projectId`. Tests prove that one
  tenant cannot read another tenant's data.
- There are automated tests with fake providers for the happy path, provider errors, missing
  keys and invalid input. Live tests are opt-in via env.
- The docs (`docs/social-studio-mobile/*.md`) describe the new endpoints so the mobile and web
  clients can use them.

## Keys and accounts needed from the owner (live mode)

This list is final once every workstream reports. See §Keys in the final report.
