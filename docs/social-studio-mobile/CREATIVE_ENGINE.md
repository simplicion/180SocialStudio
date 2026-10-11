# Creative engine API (carousels and static posts)

An LLM design agent writes typed slides. An image agent sources a photo per slide (generative model, or stock when
allowed). A deterministic compiler renders the PNGs, which are uploaded to R2 and attached to the post.
Router: `apps/backend/src/api/v1/social-media/creative/creative.routes.ts`. Service:
`packages/domains/social-media/src/creative/creative.service.ts`. Slide contract: `creative/carousel-schema.ts`.

Base: `/api/v1/social-media/projects/:projectId/creative` (the web client also uses `/api/social-media/...`). Auth: Bearer
JWT. The tenant comes from `req.user.companyId`, and every lookup is scoped to `(companyId, projectId)`.

Web client: `apps/frontend/lib/services/social-autopilot.service.ts` (`getCreativeStatus`, `startCarousel`,
`startStaticPost`, `getCreativeJob`, `regenerateSlide`). UI:
`apps/frontend/app/(platform)/(social-media-management-app)/_components/creative/CarouselMaker.tsx`.

## Errors

```json
{ "success": false, "code": "IMAGE_MODEL_NOT_CONFIGURED", "error": "No image model is configured. …", "details": {} }
```

| code | HTTP | meaning, and what the client should do |
|---|---|---|
| `INVALID_INPUT` | 400 / 409 | Bad body, slide index out of range, or the post is already `publishing`/`published` (409). |
| `PROJECT_NOT_FOUND` / `PIECE_NOT_FOUND` / `POST_NOT_FOUND` / `JOB_NOT_FOUND` | 404 | Not found in this company and project. |
| `AI_NOT_CONFIGURED` | 503 | No LLM key. Send the user to Settings > AI. |
| `IMAGE_MODEL_NOT_CONFIGURED` | 503 | `useImageModel: true` with no image model. Offer **"Use stock photos"**: retry with `useImageModel: false` (stock if `PEXELS_API_KEY`/`PIXABAY_API_KEY` is set, otherwise typographic slides with a warning), or with `allowStockFallback: true` (stock only, and this 503 again if no stock provider is set). |
| `STORAGE_UNAVAILABLE` | 503 | R2 is not configured. Nothing is created. |
| `AI_PROVIDER_ERROR` / `AI_BAD_RESPONSE` / `IMAGE_PROVIDER_ERROR` / `RENDER_FAILED` | 502 / 500 | These usually arrive in `job.error` of a failed job. |
| `JOB_BUSY` | 409 | Slide regenerate while the job is still running. |

Configuration errors (AI, image model, storage) fail **synchronously** on start, so the client gets a typed 503 and no
failed job.

## GET /status

```json
{
  "success": true,
  "ai": { "configured": true },
  "imageModel": { "configured": false, "providers": [] },
  "stock": { "configured": true, "providers": ["pexels", "pixabay"] },
  "formats": { "portrait": { "width": 1080, "height": 1350 }, "square": { "width": 1080, "height": 1080 } }
}
```

## POST /carousels and POST /static-posts — start a job

Request. Give at least one of `pieceId`, `postId`, `brief`, `headline` or `slides`:

```json
{
  "pieceId": "p1…",
  "postId": "post1…",
  "brief": "5 mistakes new founders make with pricing",
  "headline": "Pricing mistakes",
  "slideCount": 7,
  "format": "portrait",
  "useImageModel": true,
  "allowStockFallback": false,
  "slides": [
    { "layout": "cover", "title": "Stop underpricing", "body": "", "imagePrompt": "founder at a desk, window light", "emphasis": "underpricing" }
  ]
}
```

- `slideCount`: 5–10 for carousels. A static post always has 1 slide.
- `format`: `portrait` (1080×1350, the default) or `square` (1080×1080).
- `useImageModel`: defaults to `true`. `allowStockFallback`: defaults to `false`.
- `slides` skips the design agent and renders the slides as given. Each slide is `{ layout: cover|point|quote|stat|list|cta,
  title ≤160, body ≤600, imagePrompt|null, emphasis|null }`.
- `pieceId`: the job designs from the piece's copy (autopilot `carouselBrief` when present).
- `postId`: the job designs from the post's copy and attaches to that post.

Response `202`:

```json
{
  "success": true,
  "job": {
    "id": "crj_0b7f5a8e-2c1d-4f0a-9d7e-51a3c2b4e6f9",
    "kind": "carousel",
    "status": "queued",
    "step": "Queued",
    "progress": { "done": 0, "total": 4 },
    "format": "portrait",
    "useImageModel": true,
    "allowStockFallback": false,
    "imageMode": "generative",
    "pieceId": "p1…",
    "postId": null,
    "operation": { "type": "create" },
    "slides": null,
    "result": null,
    "warnings": [],
    "error": null,
    "createdAt": "2026-09-26T10:00:00.000Z",
    "updatedAt": "2026-09-26T10:00:00.000Z",
    "completedAt": null
  }
}
```

`imageMode`: `generative | stock | none`.

## GET /jobs/:jobId — poll

Poll every ~2 s while `status` is one of `queued | designing | sourcing_images | rendering | uploading`. The job ends as
`completed` or `failed`.

```json
{
  "success": true,
  "job": {
    "id": "crj_…",
    "status": "completed",
    "step": "Done",
    "progress": { "done": 4, "total": 4 },
    "pieceId": "p1…",
    "postId": "post9…",
    "slides": [{ "layout": "cover", "title": "Stop underpricing", "body": "", "imagePrompt": "…", "emphasis": "underpricing" }],
    "result": {
      "slides": [
        {
          "index": 0,
          "layout": "cover",
          "url": "https://r2…/slide-0.png",
          "width": 1080,
          "height": 1350,
          "imageUrl": "https://r2…/photo-0.jpg",
          "imageSource": { "provider": "pexels", "model": "…", "kind": "stock", "attribution": { "author": "…", "url": "…" } },
          "truncated": false,
          "contrastOk": true,
          "minContrast": 7.2,
          "version": 1
        }
      ],
      "mediaUrls": ["https://r2…/slide-0.png"],
      "coverUrl": "https://r2…/slide-0.png",
      "font": { "requested": "Inter", "used": "Inter", "fallback": false }
    },
    "warnings": ["No image model is configured; used stock photos instead."],
    "error": null,
    "completedAt": "2026-09-26T10:01:10.000Z"
  }
}
```

Failed: `"status": "failed", "error": { "code": "IMAGE_PROVIDER_ERROR", "message": "…" }`.

Slide `index` is **0-based**. `truncated` means the text was shortened to fit. `contrastOk: false` means the minimum
contrast is below target; show it as a warning.

After a server restart, a completed job is restored from the post's `metadata.creative`, so `GET /jobs/:id` keeps
working.

## Attachment (automatic, done by the backend)

When a job completes, the backend attaches the result. Clients only display it.

- With a post (`postId`): the post's `mediaUrls` = the slide PNGs, `mediaType` = `carousel` (or `image` for a static post),
  `thumbnailUrl` = the cover, and `metadata.creative` = `{ jobId, kind, format, useImageModel, allowStockFallback, slides,
  result, generatedAt }`.
- With a piece and no post: a **draft post** is created and linked to the piece (`calendarPieceId`), with those same
  fields.
- The piece gets `thumbnailUrl` = the cover. If its `videoScriptOrHooks` is JSON, it also gets `renderedCarousel: { jobId,
  postId, format, mediaType, urls, updatedAt }`. Clients read `renderedCarousel.jobId` (piece) or
  `metadata.creative.jobId` (post) to reopen the last job.
- A post that is `publishing`/`published` is never modified.

## POST /jobs/:jobId/slides/:index/regenerate — redo one slide

```json
{ "instruction": "Shorter headline, mention the free trial", "regenerateImage": false, "slide": { "title": "Try it free" } }
```

- Give at least one of `instruction` (2–1000 characters), `regenerateImage: true`, or a partial `slide`.
- Only that slide is re-rendered. The job goes back through the active states, so poll `GET /jobs/:id` again.
- The new `result.slides[i].version` is incremented.
- The job must be finished; otherwise the response is 409 `JOB_BUSY`.

Response `202`: `{ "success": true, "job": { … } }`. If the post is already publishing or published, the new slide is
not attached, and `job.warnings` says so.
