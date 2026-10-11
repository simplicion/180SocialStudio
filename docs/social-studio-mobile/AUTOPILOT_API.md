# Autopilot calendar API

Multi-agent content calendar (research → strategy → hooks and scripts → per-platform copy → critic → save).
Router: `apps/backend/src/api/v1/social-media/autopilot/autopilot.routes.ts`. Service:
`packages/domains/social-media/src/autopilot-calendar.service.ts`. Pipeline: `packages/domains/ai/src/content/autopilot/*`.

Base: `/api/v1/social-media/projects/:projectId/autopilot` (the web client also reaches it through
`/api/social-media/...`, which the backend rewrites). Auth: Bearer JWT. The tenant always comes from `req.user.companyId`,
and every lookup is scoped to `(companyId, projectId)`.

Web client: `apps/frontend/lib/services/social-autopilot.service.ts` (`startAutopilot`, `getAutopilotJob`,
`regeneratePiece`).

## Errors

Every error has the same shape:

```json
{ "success": false, "code": "AI_NOT_CONFIGURED", "error": "human readable message", "details": {} }
```

| code | HTTP | when |
|---|---|---|
| `INVALID_INPUT` | 400 | bad `days` / `startDate` / `goals` / `platforms`, empty `instruction`, or regenerating a non-autopilot piece |
| `NOT_FOUND` | 404 | project, job or piece not in this company and project |
| `CONFLICT` | 409 | a job is already running for the project; `details: { jobId, calendarId }` (follow that job) |
| `AI_NOT_CONFIGURED` | 503 | no workspace LLM key; nothing is created |
| `AI_PROVIDER_ERROR` | 502 | the provider failed |
| `AI_INVALID_OUTPUT` | 502 | the model output failed schema validation after repair |
| `JOB_STALLED` | 500 | only inside `job.error`: no heartbeat (server restart); start again |
| `UNAUTHORIZED` | 401 | no company context |

Note: a 404 **without** a `code` means the route itself is missing (an old backend). The web client falls back to the
legacy calendar wizard only in that case.

## POST /calendar — start a job

Request (every field is optional except `days`):

```json
{
  "days": 7,
  "startDate": "2026-10-01",
  "platforms": ["instagram", "linkedin"],
  "goals": ["Book 10 discovery calls", "Grow saves on carousels"],
  "name": "October launch",
  "createDrafts": false
}
```

- `days`: `7 | 14 | 30`.
- `startDate`: `YYYY-MM-DD` in the project timezone (`project.socialSettings.defaultTimezone`, else UTC). Omitted means today.
- `platforms`: a subset of `instagram, facebook, tiktok, youtube, linkedin, x`. Omitted means the brand profile's target
  platforms plus the active connected accounts; if that is empty, the response is 400 `INVALID_INPUT`.
- `goals`: up to 5, 200 characters each.
- `createDrafts`: `true` also creates draft posts.

Response `202`:

```json
{ "success": true, "jobId": "apj_3f0c2d9e-7a51-4d7e-9a53-2b8f1f0c6a11", "calendarId": "c7d1…", "status": "queued" }
```

The calendar row exists straight away with `status: "processing"`. Its pieces are written when the job completes.

## GET /jobs/:jobId — poll

Poll every 2–3 s until `status` is `completed` or `failed`.

```json
{
  "success": true,
  "jobId": "apj_3f0c2d9e-7a51-4d7e-9a53-2b8f1f0c6a11",
  "calendarId": "c7d1…",
  "status": "running",
  "stage": "hooks_scripts",
  "progress": 45,
  "detail": "Writing hooks for 7 pieces",
  "startedAt": "2026-09-26T10:00:00.000Z"
}
```

- `status`: `queued | running | completed | failed`.
- `stage`: `queued | research | strategy | hooks_scripts | copy | critic | saving | done`.
- `progress`: 0–100.
- When completed, the response adds `finishedAt`, `totalPieces`, `researchUsed` and `usage`.
- When failed, it adds `error: { "code": "AI_PROVIDER_ERROR", "message": "…" }` and `finishedAt`.

When the job completes, open `GET /api/v1/social-media/content-calendar/:calendarId`.

## Piece shape (autopilot fields)

Pieces from `GET /content-calendar/:id` (and from regenerate) include the stored columns plus these top-level fields,
which `expandAutopilotFields` in `autopilot/persistence.ts` adds, so clients never parse `videoScriptOrHooks`:

```json
{
  "id": "p1…",
  "headline": "Stop posting at 9am",
  "platform": "instagram",
  "contentType": "Reel",
  "dateScheduled": "2026-10-01T16:00:00.000Z",
  "postingTimeTz": "18:00 Europe/Berlin",
  "status": "ready",
  "autopilot": true,
  "format": "reel",
  "platforms": ["instagram", "linkedin"],
  "hookType": "contrarian",
  "spokenHook": "Posting at 9am is killing your reach.",
  "onScreenHook": "9AM = DEAD ZONE",
  "script": {
    "hook": "Posting at 9am is killing your reach.",
    "body": [
      { "beat": "Everyone posts at 9, so your post fights 10x the noise.", "retentionDevice": "open loop: the better time" },
      { "beat": "Your audience actually scrolls at 6pm after the commute." }
    ],
    "retentionLoop": "Stay to the end for the 20-second test that finds your slot.",
    "cta": "Comment TIME and I'll send the checklist.",
    "estimatedDurationSec": 35
  },
  "hasScript": true,
  "shotNotes": ["Face to camera, tight crop", "B-roll: phone clock at 9:00"],
  "carouselBrief": null,
  "captions": {
    "instagram": { "caption": "…", "cta": "Comment TIME", "hashtags": ["#socialmediatips"], "postingTime": "18:00" },
    "linkedin": { "caption": "…", "cta": "…", "hashtags": [], "postingTime": "08:30" }
  },
  "sources": ["https://example.org/study"],
  "critic": { "verdict": "ok", "issues": [] },
  "postingTime": "18:00 Europe/Berlin"
}
```

- `hookType`: `pattern_interrupt | curiosity_gap | contrarian | relatable_pain | story`.
- `format`: `reel | carousel | static | text`.
- `carouselBrief` (carousel pieces): `{ title, slides: [{ index, role: hook|value|proof|cta, headline, body, visualIdea }] }`.
- Legacy pieces return `"autopilot": false, "hasScript": false` and no other autopilot fields.
- Stored form: `videoScriptOrHooks` holds JSON with `"schema": "autopilot.v1"`, plus the legacy keys (`hookVariations`,
  `teleprompterScript`, `carouselSlides`) for older clients. After a carousel is rendered, it also holds
  `renderedCarousel: { jobId, postId, format, mediaType, urls, updatedAt }` (see CREATIVE_ENGINE.md).

## POST /pieces/:pieceId/regenerate

This rewrites one autopilot piece with an instruction. It is synchronous.

Request:

```json
{ "instruction": "Make the hook more contrarian and mention the 14-day trial" }
```

`instruction` is required and can be up to 1000 characters.

Response `200`:

```json
{ "success": true, "piece": { "id": "p1…", "autopilot": true, "spokenHook": "…", "script": { "…": "…" } }, "usage": { "calls": 1, "inputTokens": 1234, "outputTokens": 567, "estimated": false, "byRole": {} } }
```

`piece` has the same expanded shape as above. A 400 `INVALID_INPUT` means the piece was not created by autopilot.
