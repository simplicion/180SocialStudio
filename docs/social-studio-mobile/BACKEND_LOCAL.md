# Backend (apps/backend) for Social Studio Mobile — local setup and API contract

## Running the backend locally (verified 2026-09-25)

**What it runs against:** `apps/backend/.env` points at the configured databases. There is **no local Postgres** in this
repo (no Postgres service in any `docker-compose*.yml`, and nothing listening on `localhost:5432`). `DATABASE_URL` is the
shared **AWS RDS** instance (`<your-rds-host>.rds.amazonaws.com`). It can be reached from this machine, so nothing had
to be started for it. Redis is the local **Memurai** service at `redis://127.0.0.1:6379`, which is already running as a
Windows service. Docker was not needed. Docker Desktop's daemon is not running, and the CLI needs elevation.

> ⚠️ Because the DB is shared RDS, everything you create locally (users, companies, posts) is written to that database.

```bash
cd apps/backend
npm run dev          # cross-env PORT=4002 nodemon --exec tsx server.js
# health check (DB + Redis):
curl http://localhost:4002/api/health
# {"status":"ok","database":"connected","redis":"connected",...}
```

Notes:
- nodemon also watches `packages/**/src` and `packages/**/dist`, so edits to shared packages restart the server.
- `GET /health` (without `/api`) returns 404. Use `/api/health`.
- `npm test` (jest) finds **no tests**: `testMatch` is `**/__tests__/**/*.test.js` and no such files exist. The backend's
  real tests use `node:test` and are run with tsx:
  ```bash
  npx tsx --test --test-force-exit apps/backend/src/api/v1/desktop/desktop-device.test.ts            # 14 tests
  npx tsx --test apps/backend/src/api/v1/social-media/posts/deliverable-upload.test.ts               # 2 tests
  ```

### Env added for local dev
- `DESKTOP_DEVICE_JWT_SECRET`: a random 64-hex value was generated with `openssl rand -hex 32` and appended to the
  git-ignored `apps/backend/.env`. Device registration returns 503 until this is set, and there is no default.

### Optional env (mobile)
| Var | Purpose |
|---|---|
| `GOOGLE_IOS_CLIENT_ID`, `GOOGLE_ANDROID_CLIENT_ID` | Extra accepted `aud` values for native Google ID tokens. `GOOGLE_CLIENT_ID` (web) is always accepted. |
| `GOOGLE_EXTRA_CLIENT_IDS` | Comma-separated list of further accepted client IDs. |
| `MOBILE_VIDEO_UPLOAD_MAX_MB` | Max rendered-video upload size. Default is 300. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` / `REFRESH_TOKEN_EXPIRE_DAYS` | Token lifetimes. Existing settings, default 15 min / 7 days. |

### Throwaway local-dev test users
These accounts were created through the normal `POST /api/auth/register` and `PUT /api/auth/complete-workspace-setup`
flow. They use `@example.com` addresses, so no email is delivered.

| Email | Company | Role | Enabled apps |
|---|---|---|---|
| `mobile-dev@example.com` | Mobile Dev Studio (`a13d0030-6c3d-4b7c-9384-4d9c4ef460fd`) | admin | social-media, projects |
| `mobile-dev-b@example.com` | Mobile Dev Studio B (`6a8dc65f-4703-4100-b3c6-b443d76e2bf0`) | admin | social-media, used for cross-tenant tests |

Password for both: `MobileDev-<random>`. It is stored only in the session scratchpad and **deliberately not written to
this committed doc**, because this is a shared RDS database. Ask the backend owner for it, or register your own the same way:

```bash
B=http://localhost:4002/api
curl -X POST $B/auth/register -H 'content-type: application/json' \
  -d '{"name":"Me","email":"me+dev@example.com","password":"<pw>","companyName":"My Dev Studio"}'
TOKEN=$(curl -s -X POST $B/auth/login -H 'content-type: application/json' \
  -d '{"email":"me+dev@example.com","password":"<pw>"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).accessToken")
curl -X PUT $B/auth/complete-workspace-setup -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"enabledApps":["social-media","projects"]}'
# then log in again
```

> Heads-up for the mobile UI: on this environment the superadmin feature flags currently **disable `social-media`,
> `media-editor` and `voiceforce` platform-wide**, so `/me` returns them under `entitlements.disabledByAdmin` and leaves
> them out of `availableApps`. The web shows these apps grayed out for the same reason. The social-media API routes
> themselves still work.

---

## API contract for mobile

Base URL: `http://<host>:4002/api`. Every route is also reachable under `/api/v1/identity/auth/...` (auth) and
`/api/desktop/...` (devices). Authenticated calls send `Authorization: Bearer <accessToken>`. **Do not send `x-company-id`**.
The workspace comes from the token. If you do send it and it differs from the token's company, the server answers
`403 {"error":"…","code":"WORKSPACE_MISMATCH"}`.

Errors are JSON with an `error` string. Auth errors also carry `statusCode` and `correlationId`.

### POST /auth/login
Request:
```json
{ "email": "mobile-dev@example.com", "password": "…", "mfaToken": "123456" }
```
`mfaToken` is only needed when MFA is enabled.

200:
```json
{
  "token": "<accessJWT>",
  "accessToken": "<accessJWT>",
  "refreshToken": "<refreshJWT>",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": { "id": "…", "name": "Mobile Dev", "email": "…", "role": "admin", "permissions": [], "companyId": "…", "photoUrl": null, "…": "…" },
  "company": { "_id": "…", "companyName": "Mobile Dev Studio", "slug": "…", "customDomain": null, "logoUrl": null,
               "databaseConfigured": true, "isSuspended": false, "suspendedReason": null, "isOnboardingComplete": true, "metadata": {} }
}
```
- `token` and `accessToken` are identical. `token` is kept for the web.
- MFA required: `200 {"mfaRequired": true, "userId": "…"}`. Resend the request with `mfaToken`.
- Wrong credentials: `401 {"error":"Incorrect email or password. Please try again."}`.
- Suspended workspace: `403`.

### POST /auth/google (native Google Sign-In)
Request:
```json
{ "idToken": "<Google ID token from the native SDK>" }
```
The web's `{"tokenId": "…"}` is also accepted.

The server verifies the token with google-auth-library. Accepted audiences are `GOOGLE_CLIENT_ID`, `GOOGLE_IOS_CLIENT_ID`,
`GOOGLE_ANDROID_CLIENT_ID` and `GOOGLE_EXTRA_CLIENT_IDS`. It also requires `email_verified === true`. On Android, request
the ID token with **serverClientId = the web client ID** (`GOOGLE_CLIENT_ID`) or set `GOOGLE_ANDROID_CLIENT_ID`. On iOS,
set `GOOGLE_IOS_CLIENT_ID` to the iOS client ID.

200:
```json
{ "token": "…", "accessToken": "…", "refreshToken": "…", "tokenType": "Bearer", "expiresIn": 900,
  "user": { "…": "…" },
  "company": { "id": "…", "_id": "…", "name": "…", "companyName": "…", "slug": "…", "customDomain": null,
               "databaseConfigured": true, "isOnboardingComplete": true, "onboardingToken": null, "setupToken": null } }
```
- No token: `400 {"error":"Google tokenId is required"}`.
- Invalid, forged or wrong-audience token: `401 {"error":"Google authentication failed. Please try again."}`.
- Unverified email: `401`.
- No workspace for that email: `404`.
- No client ID configured on the server: `500`.

### POST /auth/refresh
Request:
```json
{ "refreshToken": "<refreshJWT>" }
```
200:
```json
{ "token": "<newAccess>", "accessToken": "<newAccess>", "refreshToken": "<newRefresh>", "tokenType": "Bearer", "expiresIn": 900 }
```
- **Sliding rotation:** store the returned `refreshToken` and use it next time. The old refresh token is **not**
  invalidated by a refresh, because the web reuses its original token. Only logout revokes a token.
- Errors are all `401`:
  - Revoked by logout: `{"error":"Your session has ended. Please sign in again.","code":"REFRESH_TOKEN_REVOKED"}`.
  - Invalid or expired: `{"error":"Invalid or expired refresh token"}`.
  - Deactivated user: `{"error":"Your account has been deactivated…"}`.
- A missing body returns `400 {"error":"Refresh token required"}`.

### POST /auth/logout
No access token is required, so this works after the access token has expired.

Request:
```json
{ "refreshToken": "<refreshJWT>" }
```
- 200 with a valid token: `{"message":"Logged out successfully","refreshTokenRevoked":true}`. The token is stored as a
  sha256 hash in Redis until its natural expiry.
- 200 with an invalid or expired token: `{"message":"Logged out successfully","refreshTokenRevoked":false,"reason":"token_invalid_or_expired"}`.
- 200 with no body: `{"message":"Logged out successfully","refreshTokenRevoked":false}`.
- 503: `{"error":"Could not complete sign-out on the server. Please try again."}`. Redis was unavailable and nothing was revoked, so retry.
- Access tokens are stateless and remain valid until they expire (≤ `expiresIn`). Delete them locally.
- Also call `DELETE /desktop/devices/:deviceId` if the user should fully unregister the phone.

### GET /auth/me (Bearer)
200:
```json
{
  "user": { "id": "…", "name": "…", "email": "…", "role": "admin", "permissions": [], "companyId": "…", "isModuleLead": false, "…": "…" },
  "role": "admin",
  "permissions": [],
  "entitlements": {
    "subscriptionStatus": "ACTIVE",
    "trialEndDate": null,
    "plan": { "id": "…", "planName": "180 Kickstart", "price": 0 },
    "isPaidPlan": false,
    "enabledApps": ["social-media", "projects"],
    "enabledModules": [],
    "disabledByAdmin": ["media-editor", "social-media", "voiceforce"],
    "availableApps": ["projects"]
  },
  "company": { "_id": "…", "companyName": "…", "slug": "…", "customDomain": null, "logoUrl": null, "databaseConfigured": true,
               "isSuspended": false, "suspendedReason": null, "isOnboardingComplete": true, "metadata": {},
               "enabledApps": ["social-media","projects"], "enabledModules": [] }
}
```
- `entitlements` is computed exactly the way the web's `useSubscription` + `settings-context` compute it from
  `GET /api/billing` + `GET /api/feature-flags`. A paid plan unlocks all apps, and the superadmin kill-switch removes apps.
  **Gate UI on `entitlements.availableApps`.** `company.enabledApps` is the raw company setting, kept for the web.
- `401` means the access token is expired or invalid. Refresh and retry once.

### Device tokens: POST /desktop/devices/register (Bearer)
Request:
```json
{ "label": "Pixel 8", "platform": "android", "deviceId": "<stored id, to renew>" }
```
- `platform` is case-insensitive. `ios` and `android` get a `native-device` token. `windows`, `macos`, `linux`, unknown
  values and no value get a `desktop-device` token, which keeps the desktop app backward compatible.
- Send the stored `deviceId` to renew without using a new slot. The token lasts 30 days, and the limit is 5 devices per user.

201:
```json
{ "success": true, "deviceId": "5b55ac92-…", "token": "<deviceJWT>", "label": "Pixel 8", "platform": "android",
  "kind": "native-device", "expiresAt": 1792897063921, "renewed": false }
```
- `409 {"success":false,"error":"DEVICE_LIMIT","message":"…"}`.
- `503 {"success":false,"error":"DESKTOP_DEVICE_UNAVAILABLE",…}`: the server secret or Redis is unavailable.

Send the device token as header **`x-device-token: <deviceJWT>`**. `x-desktop-device-token` is also accepted. It goes on
device-gated routes such as `POST /social-media/posts/:id/submit-for-approval`, `/media-editor/render` and
`/social-media/posts/sync-studio-render`. Enforcement depends on `DESKTOP_DEVICE_ENFORCEMENT` (`off` by default locally).

When enforced, a rejection is `403`:
```json
{ "success": false, "error": "DESKTOP_APP_REQUIRED", "reason": "missing_token|invalid_token|wrong_user|revoked", "message": "…" }
```
The messages name the desktop *or mobile* app. If `reason` is `invalid_token` or `revoked`, register again.

### GET /desktop/devices (Bearer)
```json
{ "success": true, "devices": [ { "deviceId": "…", "label": "Pixel 8", "platform": "android", "createdAt": 1790305063921,
  "lastSeenAt": 1790305065219, "push": { "provider": "fcm", "registered": true, "updatedAt": 1790305065219 } } ] }
```
`push` is `null` when no push token is registered. The push token itself is never returned.

### DELETE /desktop/devices/:deviceId (Bearer)
- 200: `{"success":true}`. The device token stops working immediately.
- 404: `{"success":false,"error":"Device not found"}`.

### PUT /desktop/devices/:deviceId/push-token (Bearer)
Push notification readiness. This endpoint only stores the token. The server does not send pushes yet (no FCM/APNs sender
is configured).

Request:
```json
{ "provider": "fcm", "token": "<FCM registration token>" }
```
- `provider` is `"fcm"` or `"apns"`.
- To clear the token, send `{ "token": null }`.

Responses:
- 200: `{"success":true,"device":{ …same shape as the list, push:{provider,registered:true,updatedAt} }}`.
- 400: invalid provider, or a token that is not a 16–4096-character string without whitespace.
- 404: the device is not yours or not in your company.

### POST /social-media/posts/:id/submit-for-approval (Bearer + `x-device-token`, multipart/form-data)
This endpoint uploads a client-rendered video, attaches it to the post and moves the post to **`in_review`**. The web
project content list and `ContentDetailDrawer` show that status as "In Review" / awaiting approval.

| Field | Required | Rules |
|---|---|---|
| `video` | yes | `video/mp4` (or `video/quicktime`), must be ISO-BMFF (`ftyp`), ≤ `MOBILE_VIDEO_UPLOAD_MAX_MB` (default 300 MB) |
| `thumbnail` | no | `image/jpeg`, `image/png` or `image/webp`, ≤ 5 MB |
| `notes` | no | Text, ≤ 5000 chars. Stored as `post.revisionNotes`. |
| `source` | no | Free text, ≤ 40 chars, e.g. `social-studio-mobile`. |

```bash
curl -X POST $B/social-media/posts/$POST_ID/submit-for-approval \
  -H "authorization: Bearer $TOKEN" -H "x-device-token: $DEVICE_TOKEN" \
  -F "video=@final.mp4;type=video/mp4" -F "thumbnail=@thumb.jpg;type=image/jpeg" -F "notes=Cut v1"
```
201:
```json
{ "success": true,
  "post": { "id": "…", "companyId": "…", "status": "in_review", "mediaType": "video", "versionNumber": 1,
            "finalVideoUrl": "https://pub-….r2.dev/social-media/deliverables/<companyId>/<postId>/<ts>-<rand>.mp4",
            "thumbnailUrl": "https://pub-….r2.dev/…-thumb.jpg", "revisionNotes": "Cut v1",
            "metadata": { "lastDeliverable": { "…": "…" }, "deliverableHistory": [ "…" ] }, "…": "…" },
  "deliverable": { "url": "…", "thumbnailUrl": "…", "bytes": 13773, "contentType": "video/mp4",
                   "uploadedById": "…", "uploadedAt": "2026-09-25T02:58:15.393Z", "source": "social-studio-mobile", "deviceId": "…|null" } }
```
Behaviour:
- If the post was `approved`, `versionNumber` is incremented because the new cut needs approval again.
- A linked calendar piece gets the same `finalVideoUrl` and `thumbnailUrl` and moves to `pending_review`.
- The file is stored as uploaded. No server transcoding runs.

Errors:
| Status | Body |
|---|---|
| 400 | `{"success":false,"error":"VIDEO_REQUIRED",…}` or `BAD_UPLOAD` (malformed multipart, or unknown file field) |
| 404 | `{"success":false,"error":"Post not found"}` (includes posts in another company) |
| 409 | `POST_ALREADY_PUBLISHED` (post is `publishing` or `published`) |
| 413 | `FILE_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA` (wrong type, or content is not MP4/MOV) |
| 502 | `UPLOAD_FAILED` (R2 error) |
| 503 | `STORAGE_UNAVAILABLE` (R2 env missing) |

Related existing endpoints the app can use unchanged:
- `GET /social-media/posts?projectId=&status=`
- `GET /social-media/posts/:id`
- `PUT /social-media/posts/:id`
- `POST /social-media/reviews/sessions`, with body `{clientId, projectId?, name, startDate, endDate, postIds?}`. It returns
  a public `/review/<token>` link for the client.

### Social account connections
`GET /social-media/accounts?projectId=`, `POST /social-media/accounts/connect` and `DELETE /social-media/accounts/:id`
already exist.
- Responses now **omit `accessToken` and `refreshToken`**. They carry `hasAccessToken` and `hasRefreshToken` instead.
- `connect` rejects a `projectId` or `clientId` that belongs to another company with 404.
- **There is no server-side OAuth flow** (no authorize/callback endpoints and no redirect-URI validation anywhere). The web
  "connect" button currently posts simulated tokens. The redirect `workspace180://oauth/callback` therefore cannot be
  allow-listed yet. See "Blocked" below.

---

## Verified by curl on 2026-09-25 against localhost:4002
- login returns tokens in the body. A bad password gives 401.
- `/me` returns role, company and entitlements.
- refresh rotates the token.
- logout revokes the token: a refresh with the revoked token gives 401 `REFRESH_TOKEN_REVOKED`, while the original web
  token still refreshes.
- `/auth/google` answers 400 for a missing token and 401 for a forged token (no real Google token was available).
- Device register and renew, with platform `android` giving `native-device`.
- Push token set. Another tenant setting it gets 404.
- submit-for-approval:
  - 400 with no file, 415 for a fake MP4, 415 for the wrong type, 404 from another tenant.
  - 201 for a real 2-second MP4 plus thumbnail. The post became `in_review` and the R2 URL served `video/mp4`.
- Cross-tenant checks:
  - A token with another company's `x-company-id` gets 403 `WORKSPACE_MISMATCH`. Before the fix this returned the other
    company's posts.
  - Unauthenticated `GET /api/v1/settings/configs` with an `x-company-id` gets 401. Before the fix it returned that
    company's settings.
- `connect` to another company's project gets 404.

## Blocked / not done
- **Social OAuth for Instagram, Facebook, TikTok, YouTube and LinkedIn:** there is no OAuth start/callback implementation
  and no app credentials in `.env` (no META_APP_ID, TIKTOK_CLIENT_KEY and so on), so there is nowhere to allow-list
  `workspace180://oauth/callback`. This needs a real OAuth implementation, which means provider apps and secrets.
- **Push delivery:** the tokens are stored, but no FCM/APNs sender or credentials exist.
- **Google sign-in with a real ID token:** not exercised end-to-end, because it needs a device or an interactive Google
  login. The rejection paths were verified.
