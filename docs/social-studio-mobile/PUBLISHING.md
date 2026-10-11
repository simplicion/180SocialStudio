# Publishing: connect accounts, tokens, publish

Source of truth: `packages/domains/social-media/src/publishing/`
- `oauth.service.ts` and `oauth-providers.ts`: connecting accounts.
- `token-vault.ts`: stored tokens.
- `publish-dispatcher.ts` and `scheduler.ts`: sending posts.
- `webhooks.service.ts`: Meta webhooks.

Routes: `apps/backend/src/api/v1/social-media/accounts/social-account.routes.ts`. The public callback is registered in
`apps/backend/src/routes/index.routes.ts`.

## 1. Connecting an account (OAuth, PKCE)

1. **Start.** The client calls
   `GET /api/v1/social-media/accounts/oauth/:platform/authorize?projectId&redirectUri&client=web|mobile`
   and gets back `{ url }`.
   - `redirectUri` must be on the allow-list:
     - web: an https origin from `CLIENT_URL` or `SOCIAL_OAUTH_WEB_ORIGINS` (plain http only for localhost);
     - mobile: `workspace180://oauth/callback`;
     - extra exact URIs: `SOCIAL_OAUTH_ALLOWED_REDIRECTS`.
   - Otherwise the server returns `OAUTH_REDIRECT_NOT_ALLOWED`.
2. **Authorize.** The client sends the browser to `url`. The web app uses the same tab; mobile uses the system browser.
3. **Callback.** The provider returns to `{SOCIAL_OAUTH_CALLBACK_BASE_URL}/api/v1/social-media/accounts/oauth/<platform>/callback`.
   - The server checks the signed one-time state, exchanges the code with PKCE and discovers the accounts.
   - It then redirects to `redirectUri` with one of:
     - `?status=connected&platform=…&accountId=…`. The account and its encrypted tokens are saved.
     - `?status=select&platform=…&selectionId=…&count=N`. The provider returned several accounts (Facebook Pages,
       Instagram business accounts, LinkedIn member and organisations). Nothing is connected yet.
     - `?status=error&platform=…&error=…&error_description=…`.
4. **Selection** (only after `status=select`).
   - `GET /accounts/oauth/selections/:id` returns
     `{ candidates: [{ candidateId, kind, accountName, username, profileImageUrl }] }`.
     `kind` is one of `page | instagram_business | member | organization | channel | user`.
   - `POST /accounts/oauth/selections/:id {candidateIds}` returns `201 { accounts }`.
   - The selection is scoped to the company and user that started it. It can be completed once, and it expires.

Clients:
- **Web:** `social-media-assets/_components/ConnectedAccountsManager.tsx`. It redirects back to the same page,
  reads `status` from the URL, and shows the picker dialog after `status=select`. A "Reconnect" button appears when
  `reauthRequired` is set.
- **Mobile:** `lib/features/workspace/accounts_tab.dart` handles the deep link. After `status=select` it opens
  `account_selection_sheet.dart`.

`POST /accounts/connect` (a raw token pasted in) is for company admins only and exists for support use. It is not a
user flow.

## 2. Tokens

- **Storage.** Tokens live only in `social_account_credentials`, encrypted with AES-256-GCM and bound to the account id.
  The key is `SOCIAL_TOKEN_ENCRYPTION_KEY`; set `SOCIAL_TOKEN_ENCRYPTION_KEY_PREVIOUS` while rotating. The API never
  returns tokens (`toPublicAccount`).
- **Refresh when used.** `getAccessToken` refreshes a token that expires within `SOCIAL_TOKEN_REFRESH_SKEW_SEC`
  (default 300). Refreshes of the same account share one in-flight call, so they can't race.
- **Refresh ahead of time.** Each scheduler tick runs `proactiveRefreshExpiringTokens()`. It force-refreshes
  credentials that expire within 7 days and have a refresh token. This keeps 60-day Meta, Instagram and Threads
  tokens from lapsing on quiet accounts. Before 2026-09-26 this step only refreshed inside the 5-minute window, so in
  practice it never ran.
- **When a refresh is rejected**, the account gets `reauthRequired=true` with a reason, and the UI asks the user to
  reconnect. Transient failures increase `refreshFailureCount` and are retried later.

## 3. Publishing

- `POST /posts/:id/publish` and the scheduler both go through `PublishDispatcher`. Each variant ends in one of
  these states:
  - `published`, with a link;
  - `processing` (video still processing; the scheduler checks again);
  - `ready_to_publish` or `user_action_required` (assisted platforms such as X and Reddit hand off to the user);
  - `failed`, with the provider's error.
- Projects that require approval only publish approved versions.
- Retries use `SOCIAL_PUBLISH_MAX_ATTEMPTS` with backoff between `SOCIAL_PUBLISH_RETRY_BASE_MS` and
  `SOCIAL_PUBLISH_RETRY_MAX_MS`.
- **No fake success.**
  - A missing platform credential returns `503 PUBLISH_NOT_CONFIGURED`.
  - `SIMULATE_SOCIAL_PUBLISHING=true` (for demos only) produces results marked `sim_*` / `meta.simulated`, and it is
    ignored when `NODE_ENV=production`.

## 4. Environment

These are required per platform you enable. There are no defaults, and a missing value returns
`PUBLISH_NOT_CONFIGURED`.

| Platform | Variables |
|---|---|
| Facebook / Instagram (via Facebook login) | `META_APP_ID`, `META_APP_SECRET`, optional `META_LOGIN_CONFIG_ID`, `META_FACEBOOK_SCOPES`, `META_INSTAGRAM_SCOPES`, `META_GRAPH_VERSION` |
| Instagram (Instagram login) | `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` |
| Threads | `THREADS_APP_ID`, `THREADS_APP_SECRET`, `THREADS_SCOPES` |
| YouTube | `YOUTUBE_CLIENT_ID`/`YOUTUBE_CLIENT_SECRET` (or `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`), `YOUTUBE_SCOPES` |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_SCOPES`, `LINKEDIN_API_VERSION`, `LINKEDIN_ENABLE_ORGANIZATIONS` |
| X | `X_CLIENT_ID`/`X_CLIENT_SECRET` (or `TWITTER_*`), `X_SCOPES` |
| TikTok | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_SCOPES` |
| Pinterest, Reddit | `PINTEREST_APP_ID`/`_SECRET`/`_SCOPES`, `REDDIT_CLIENT_ID`/`_SECRET`/`_SCOPES` |
| All | `SOCIAL_TOKEN_ENCRYPTION_KEY`, `SOCIAL_OAUTH_CALLBACK_BASE_URL`, `CLIENT_URL` / `SOCIAL_OAUTH_WEB_ORIGINS`, `SOCIAL_MEDIA_PUBLIC_BASE_URL` |
| Meta webhooks | `META_WEBHOOK_VERIFY_TOKEN`, `META_WEBHOOK_APP_SECRET`; see the Phase 7 checklist in `PRODUCTION_GAP_AUDIT.md` |

In every developer console, register this callback: `…/api/v1/social-media/accounts/oauth/<platform>/callback`.

## 5. Tests

- `packages/domains/social-media/test/publishing/*.test.ts`:
  - `oauth-meta`: OAuth, token storage, provider refresh;
  - `publishers`;
  - `webhooks-meta`: webhooks and proactive refresh.
- Mobile: `test/sections/oauth_selection_test.dart`.
  - `adapters-verified` (16): request builders, error mapping and async polling for every platform, checked against the
    docs in §6; also checks that the capability matrix matches each validator.
  - `sandbox-e2e` (11): the keyless sandbox flow for all 8 platforms, limits enforced in the sandbox, the sandbox
    refused in production, and publishing-autonomy gating.
- Backend: `apps/backend/src/services/push/push.test.ts` (5) and `apps/backend/src/api/v1/desktop/desktop-device.test.ts`
  (LRU eviction and reinstall reuse).
- Mobile: `test/sections/settings_test.dart` (devices, appearance, push status, simulated labels).

## 6. Publishing rules and limits (verified 2026-09-27)

Each adapter enforces these rules in `validate()`. `adapters/capabilities.ts` (`PUBLISH_CAPABILITIES`) exposes the same
information so clients offer only operations the platform supports. "Schedule" means our scheduler posts at the chosen
time; only YouTube also holds the schedule itself (`publishAt`).

| Platform | Formats via API | Limits enforced | Async / errors | Account and app requirements | Sources |
|---|---|---|---|---|---|
| Instagram | Reel (`REELS`), image, carousel of 2–10 images/videos, Story (`STORIES`, `platformMeta.instagramFormat='story'`). No text-only posts. | Caption ≤ 2,200 characters, ≤ 30 hashtags, ≤ 20 mentions. JPEG only, ≤ 8 MB, aspect 4:5 to 1.91:1, `alt_text` ≤ 1,000. Reel 3 s–15 min, ≤ 300 MB. Story video 3–60 s, ≤ 100 MB. Carousel video ≤ 60 s. | Container polls `status_code`. If still `IN_PROGRESS` after the poll budget, the result is `processing` (`container:<id>`) and `checkStatus` publishes it once `FINISHED`. `ERROR`/`EXPIRED` surface Meta's status text. Codes 4/17/32/613/80001/80002/9007 and subcodes 2207027/2207042 are retryable; 190 → reconnect. | Business or Creator account. `instagram_business_content_publish` (Instagram login) or `instagram_content_publish` (Facebook login). 100 API posts per 24 h. | [content publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing), [IG media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media) |
| Facebook Page | Text, link (`platformMeta.link`, text posts only), photo, 2–30 photo multi-post, video (`file_url`), Reel (`facebookFormat='reel'`). | Up to 63,206 characters. Photo ≤ 10 MB. Reel 3–90 s at 9:16. Video ≤ 4 h and ≤ 1 GB via `file_url`. | Reel: start → rupload (`file_url` header) → finish, then poll `status.video_status`. If not ready it returns `processing` (`fbvideo:<id>`) and `checkStatus` finishes it. Processing errors surface the phase error. | A Page, not a profile. `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, plus `publish_video` for video. User needs the CREATE_CONTENT task. | [Pages posts](https://developers.facebook.com/docs/pages-api/posts), [Reels publishing](https://developers.facebook.com/docs/video-api/guides/reels-publishing) |
| Threads | Text, image, video, carousel of 2–20 items. First comment is posted as a reply. | Text ≤ 500 characters (a first comment too). Images JPEG/PNG ≤ 8 MB, aspect ≤ 10:1. Video ≤ 5 min, ≤ 1 GB. | Media containers are polled until `FINISHED`. `ERROR`/`EXPIRED` fail with `error_message` and are never published. Still in progress → `processing` plus `checkStatus`. The permalink is read from the API. | `threads_basic`, `threads_content_publish` (reply scopes for first comments). 250 posts per 24 h. | [Threads posts](https://developers.facebook.com/docs/threads/posts) |
| YouTube | Video only (Shorts: square or vertical, ≤ 3 min). | Title ≤ 100 characters, no `<>`. Description ≤ 5,000 bytes. Tags ≤ 500 characters. `publishAt` must be in the future and forces `private`. | Resumable upload in 256 KiB-multiple chunks. `quotaExceeded`/`uploadLimitExceeded` are non-retryable with a clear message. `rateLimitExceeded` is retryable. If YouTube returns a different privacy than requested, a warning says the project is unverified. | Verified Google Cloud project, otherwise API uploads from projects created after 2020-07-28 are forced to private. `videos.insert` costs 1 unit of the upload bucket (about 100 uploads per day). | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert), [Shorts length](https://support.google.com/youtube/answer/15424877) |
| LinkedIn | Text, image, multiImage 2–20, video, document (PDF/PPT(X)/DOC(X)). An organic "carousel" is sponsored-only, so image carousels post as multiImage and PDF carousels as documents. | Commentary ≤ 3,000 characters (reserved characters escaped, hashtags kept). Images < 36 MP. Video 3 s–30 min, 75 KB–500 MB. Documents ≤ 100 MB, ≤ 300 pages. | Video: init → 4 MB part PUTs (ETags) → finalize → wait `AVAILABLE`. Documents also wait `AVAILABLE`. `PROCESSING_FAILED` surfaces the reason. Post id comes from `x-restli-id`. | `LinkedIn-Version` must be under 12 months old. The default is now `202609` (`publishing/linkedin-version.ts`); the old `202507` default in `config.ts` is sunset. Members need `w_member_social`. Pages need `w_organization_social` and the ADMINISTRATOR/CONTENT_ADMIN role. | [Posts API](https://learn.microsoft.com/linkedin/marketing/community-management/shares/posts-api), [Videos](https://learn.microsoft.com/linkedin/marketing/community-management/shares/videos-api), [MultiImage](https://learn.microsoft.com/linkedin/marketing/community-management/shares/multiimage-post-api), [Documents](https://learn.microsoft.com/linkedin/marketing/community-management/shares/documents-api) |
| Pinterest | Image Pin, carousel Pin of 2–5 images (`multiple_image_urls`), video Pin (`video_id`). | Title ≤ 100, description ≤ 800, link ≤ 2,048, alt text ≤ 500. Video 4 s–15 min, ≤ 2 GB. A board is required. | Video: `POST /v5/media` → multipart upload to `upload_url` → poll `GET /v5/media/{id}` (`registered|processing|succeeded|failed`) → create the Pin with a cover. | Business account. Standard access (Trial access only creates sandbox Pins). Scopes `boards:read`, `pins:read`, `pins:write`, `user_accounts:read`. | [pins create](https://developers.pinterest.com/docs/api/v5/pins-create/), [OpenAPI v5](https://github.com/pinterest/api-description) |
| Reddit | Self post (text), or a link post for media or `platformMeta.link`. Native image/video upload is not used because it only reports the post id over a websocket; the result carries `meta.postedAs`. | Title ≤ 300 characters (required). Self text ≤ 40,000. Subreddit name validated. `nsfw`, `spoiler`, `flair_id`/`flair_text`, `sendreplies` are supported. | Errors come back as HTTP 200 with `json.errors`: content/subreddit codes → `VALIDATION_FAILED`, `RATELIMIT` → retryable. No post id → `OUTCOME_UNKNOWN`, never a fake id. | Data API approval for commercial use. 100 requests/min per client. A descriptive User-Agent (`REDDIT_USER_AGENT`, or the default plus `REDDIT_DEVELOPER_USERNAME`). Scopes `identity`, `submit`, `read`. | [api/submit](https://www.reddit.com/dev/api#POST_api_submit), [Data API wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki) |
| X | Text, up to 4 images, or 1 GIF, or 1 video. No mixing. First comment is posted as a reply. | 280 weighted characters (URLs count 23; 25,000 with long posts). Images ≤ 5 MB, GIF ≤ 15 MB, video ≤ 512 MB, 0.5 s–20 min, aspect 1:3 to 3:1. | Chunked upload v2: initialize → append (≤ 5 MB chunks) → finalize → STATUS polling. 402 or "no credits" → `PUBLISH_NOT_CONFIGURED`. Duplicate text → `VALIDATION_FAILED`. | Paid, pay-per-use API since 2026-02-06 (about $0.015 per post; no free write tier). OAuth 2.0 scopes `tweet.read tweet.write users.read media.write offline.access`. | [media upload](https://docs.x.com/x-api/media/quickstart/media-upload-chunked), [best practices](https://docs.x.com/x-api/media/quickstart/best-practices), [pricing](https://docs.x.com/x-api/getting-started/pricing) |

TikTok is outside this verification pass; its adapter and tests are unchanged.

### Keyless sandbox (development only)

With `SIMULATE_SOCIAL_PUBLISHING=true`, and never when `NODE_ENV=production`, the whole flow runs for all 8 platforms
without keys: connect (sandbox account, `metadata.simulated`) → compose → validate → schedule → publish → status.

- Keyless platforms use the simulated API path instead of the assisted handoff.
- Every real `validate()` rule still applies. `SimulatedPlatformPublisher` re-validates and refuses to run once the
  sandbox is off.
- Results are marked `sim_<platform>_…`, `meta.simulated`, and a "Simulated publish" note.
- Mobile shows a SANDBOX chip on the account and a SIMULATED chip on the variant, has no "View live post", and titles the
  publish dialog "Simulated publish".
- Push titles are prefixed `[Simulated]`.

### Publishing autonomy

The scheduler enforces the brand consciousness setting `autonomy.publishing`, which defaults to `MANUAL`:

- Under `MANUAL`, an AI-authored post (`metadata.source` of `autopilot`, `agent`, `ai`, `director` or `agent_os`) that
  nobody approved is held. It is reported as `skippedAutonomy` and rechecked every `SOCIAL_APPROVAL_RECHECK_MS`.
- Posts written or scheduled by a person are never held by this rule.

### Push notifications

- **Setup.** Set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` (a service-account PEM; `\n`
  escapes are allowed). There is no fallback: if these are missing, sends fail with `PUSH_NOT_CONFIGURED`.
- **Endpoints:**
  - `GET /api/desktop/push/status`;
  - `POST /api/desktop/push/test`;
  - token registration: `PUT /api/desktop/devices/:id/push-token`, scoped to company and user.
- **Events:**
  - published or partly published;
  - final failure (not sent while a retry is pending);
  - reconnect needed (`REAUTH_REQUIRED`);
  - approval requested (post moved to `in_review`; sent to the project owner).
- **Behaviour:**
  - Each notification is sent once per post, status and attempt.
  - Dead tokens are removed.
  - Tapping a notification opens `workspace180://posts/<id>`.
- **Code:** `apps/backend/src/services/push/*`.
