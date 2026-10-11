# 180 Social Media Manager (Flutter): Feature Parity Spec

Status: research snapshot, 2026-09-25. Sources are the files named in each row. Paths are relative to the repo root.

- **Web app:** `apps/frontend/app/(platform)/(social-media-management-app)/**`, the public review portal `apps/frontend/app/(public)/review/[token]/page.tsx`, and the services `apps/frontend/lib/services/social-project.service.ts`, `content-calendar.service.ts` and `social-edge-guard.ts`. These pages use no Redux or RTK Query slices. They call axios `api` directly.
- **Backend routes:** `apps/backend/src/api/v1/social-media/**`, with all business logic in `packages/domains/social-media/src/**`.
- **Flutter app:** `apps/social-studio-mobile/lib/**`.

Legend for the **Flutter** column:
- **Real**: calls the correct backend endpoint and uses the response with no fake fallback.
- **Mocked**: UI exists, but the data or the action is fake, local-only, calls a wrong path, or falls back to demo data.
- **Missing**: nothing in Flutter.
- **N/A**: out of scope for mobile. See the note on the desktop-only media rule in §0.

Legend for the **Backend** column:
- **Real**: persists to the DB and does what it says.
- **Partial**: works, but with caveats that are listed.
- **Stub**: canned or fake output.
- **None**: no endpoint.

---

## 0. Ground rules for the mobile build

1. **API prefix.** `server.js:207` mounts `app.use('/api', apiRoutes)`. The social routes are mounted in `apps/backend/src/routes/index.routes.ts:264` as `router.use('/v1/social-media', protect, moduleGuard('social-media'), socialMediaRoutes)`. **The canonical base is `/api/v1/social-media`.** Aliases also exist:
   - `/api/social-media/*` is rewritten to `/v1/social-media` (lines 91 and 169) and is also mounted directly (line 265).
   - `/api/content-calendar/*` and `/api/saved-banks/*` are rewritten and also mounted directly (lines 87–90, 266–267).
   - Flutter should use `/api/v1/social-media/...` only.
2. **Public review portal.** It is mounted without auth at `/api/v1/social-media/reviews/public/:token` (index.routes.ts:259). It is registered before the protected mount, so it wins.
3. **Every authenticated social route runs these checks in order:**
   1. `companyContext` (server.js:196).
   2. `subscriptionGuard`, which is global from index.routes.ts:336 onward. The social mount comes after it, so it applies.
   3. `protect`.
   4. `moduleGuard('social-media')`.
4. **Response envelope.** Most handlers return `{ success: true, ...payload }` or `{ success: false, error }` with status 400 or 404. The content-calendar and saved-banks handlers differ; see §2.4 and §2.9.
5. **Desktop-only media rule.** This is a standing product rule. FFmpeg and video editing run only in the desktop Tauri app. Server media routes such as `/api/media-editor/ai-direct` and `/api/v1/social-media/posts/sync-studio-render` use `requireDesktopDevice`. The Flutter app's on-device editor, AI Director and FFmpeg pieces (`features/editor`, `features/director`, `core/native_engine`) conflict with that rule unless product explicitly extends "native app" to mobile. The backend already partly anticipates this: `desktop-device.ts:115` issues a `native-device` token for `platform: ios|android`. **A product decision is needed before investing further there.** This doc marks those items N/A for parity.

---

## 1. Auth for a non-browser client

### 1.1 Login and tokens (JWT is in the response body; there are no cookies)

All of these are public. They are mounted at `index.routes.ts:198`, `router.use('/auth', authRoutes)`, so the full path is `/api/auth/...`. The same routes are also reachable under `/api/v1/identity/...`.

| Purpose | Method and path | Body | Response |
|---|---|---|---|
| Email/password login | `POST /api/auth/login` | `{ email, password, mfaToken? }` (zod: email + password, passthrough) | `200 { token, refreshToken, user, company: { _id, companyName, slug, customDomain, logoUrl, databaseConfigured, isSuspended, suspendedReason, isOnboardingComplete, metadata } }`. `token` is the **access JWT** `{ id, companyId }`. It expires after `ACCESS_TOKEN_EXPIRE_MINUTES`, default **15 min**. |
| MFA required | same | same | `200 { mfaRequired: true, userId }`. Resend with `mfaToken`. |
| Password setup / onboarding | same | same | `403 { error, setupToken }` or `403 { error, onboardingRequired: true, onboardingToken }` |
| Google login | `POST /api/auth/google` | Google credential payload (`AuthService.googleLogin`) | `{ token, refreshToken, user, company: { id, _id, name, ... } }` |
| Refresh | `POST /api/auth/refresh` | `{ refreshToken }` | `{ token }`: new access token only. **The refresh token is not rotated.** It is a JWT signed with `JWT_REFRESH_SECRET`, TTL `REFRESH_TOKEN_EXPIRE_DAYS`, default **7 d**. After 7 days the user must log in again. |
| Current session | `GET /api/auth/me` (protected) | none | `{ user (sanitized, +isModuleLead), company: { _id, companyName, slug, ..., metadata, enabledApps, enabledModules } }` |
| Logout | `POST /api/auth/logout` (protected) | none | `{ message }`. **Server-side no-op.** Tokens stay valid until they expire. The client must discard them. |
| Workspace discovery | `GET /api/auth/find-workspaces?email=` | none | `{ workspaces }` |
| Password reset | `POST /api/auth/forgot-password` `{ email }` | | `{ message }` |

Source: `apps/backend/src/api/v1/identity/auth/auth.routes.ts`, `auth.controller.ts:37–128`, and `packages/domains/identity/src/auth/auth.service.ts:372–531`.

**Sending the token.** `protect` (`system-configs/middleware/auth/auth.ts:14–18`) reads `Authorization: Bearer <token>`, or `?token=` as a fallback. It does not read cookies, so a mobile client works natively. On 401, call `/api/auth/refresh`, retry once, and on failure force a re-login.

### 1.2 Tenant (`companyId`)

`company-context.ts:33–150` resolves the tenant in this order:

1. Subdomain of the `Host` header.
2. The `x-company-id` header.
3. **The `companyId` claim decoded from the Bearer JWT.**

The code first reads the header, then falls back to the JWT when the header is absent, then overrides with the subdomain if one is present.

A mobile client hitting a non-tenant host needs **no tenant header**. The JWT carries `companyId`. **Do not send `x-company-id` unless it is a real id.** A header value whose length is not 24, 25 or 36 returns `400 "Invalid company workspace identifier"` (line 154). Store `company._id` from the login response for display only.

The request context also drives the tenant-scoped Prisma proxy (`packages/db/src/index.ts:136–280`). This proxy auto-injects `companyId` into queries on every model that has a `companyId` column. It is why the unscoped calendar queries in §2.4 do not leak across tenants.

### 1.3 Subscription and `enabledApps`

- **Web source of truth:** `useSubscription()` (`apps/frontend/lib/useSubscription.ts`) calls `GET /api/billing`. That path is rewritten to `/api/v1/platform-billing` (index.routes.ts:60) and handled by `BillingController.getBillingInfo`.
- **Response:** `{ currentSubscription, subscription, plan, companyConfig: { ..., enabledApps, enabledModules, storageUsedBytes }, enabledApps, enabledModules, isPaidPlan, isExpired, isWarning, isTrialing, status, daysLeft, teamMembersCount, activeAppsCount, activeWebsitesCount, paymentsEnabled }` (billing.controller.ts:85–153).
- **Paid plans:** when `isPaidPlan` is true, the server and client both union `enabledApps` with every platform app.
- **App ids use kebab-case.** The social app is `'social-media'`.
- **Admin kill-switch:** the web client also calls `GET /api/feature-flags` → `{ flags, disabledApps }` (index.routes.ts:326; `settings-context.tsx:159–168`). `hasApp(id)` returns false if `disabledApps` contains `social-media` or `social_media`, or if `flags['app_social_media'] === false`.
- **Mobile gate:** show the lock screen when `!(isPaidPlan || enabledApps.includes('social-media')) || adminDisabled`. Re-check on app resume.
- **Trust the server response.** `moduleGuard` returns 403 `code: APP_DISABLED`, and `subscriptionGuard` returns 403 `{ subscriptionExpired: true }` or `{ companySuspended: true }`. The client should map these three to specific screens.

### 1.4 What `moduleGuard('social-media')` checks

Source: `system-configs/middleware/auth/module-guard.ts`.

1. `req.company` and `req.prisma` exist. Otherwise 403 `NO_COMPANY_CONTEXT`.
2. It loads `CompanyConfig`, auto-creating it if needed, with a 60 s in-memory cache. It takes `enabledApps` from `company.metadata.enabledApps`. **If that list is empty, it defaults to all apps, including `social-media`.**
3. If the enabled list is non-empty and does not include `'social-media'`, it returns 403 `APP_DISABLED`.
4. It does no module-level check here, because no `moduleId` is passed.
5. **It does not check the plan.** Plan and expiry are the job of `subscriptionGuard` (`auth/subscription-guard.ts`). That guard returns 403 for a suspended company, `trial_expired`, or an expired subscription, and it fails open on errors. `checkBillingStatus` is a no-op.

### 1.5 Device token (optional, only for native media routes)

- **Register:** `POST /api/desktop/devices/register` (also `/api/v1/desktop/...`, protected) with body `{ label?, platform: 'ios'|'android', deviceId? }` → `201 { success, deviceId, token, expiresAt, renewed }`. The device TTL is 30 d and there is a limit of 5 devices per user (409 `DEVICE_LIMIT`).
- **Use:** send the token as `x-device-token`. Only routes wrapped in `requireDesktopDevice` need it, and only when `DESKTOP_DEVICE_ENFORCEMENT=enforce`.
- **Social-media scope:** that is only `POST /posts/sync-studio-render`.
- **List and revoke:** `GET /api/desktop/devices` and `DELETE /api/desktop/devices/:deviceId`.

### 1.6 Current Flutter auth state: entirely mocked

| Issue | Location |
|---|---|
| There is no login screen and no call to `/api/auth/login`. The app boots straight into a hardcoded demo session: `usr-creator-01`, `co-agency-01`, "Apex Creative Agency", `enabledApps: ['social_media','media_editor']`. | `features/auth/auth_provider.dart:72–79` (the `defaultSession`), `:81–86` (the initial state is `isAuthenticated: true`), `:113–127` ("Seed default demo creator session") |
| If a token is stored, the session is still built from prefs with demo fallbacks and a hardcoded `enabledApps`. It never calls `/api/auth/me` or `/api/billing`. | `auth_provider.dart:96–112` |
| `enabledApps` defaults to `['social_media']`, and the gate checks `'social_media'` (snake case). The backend and web use `'social-media'`. Because the defaults are hardcoded, the lock screen can never trigger. | `auth_provider.dart:23,32`; `main.dart:37–47` |
| The upgrade button is a no-op. | `main.dart:41–43` |
| There is no refresh flow and no 401 handling. | `core/network/api_client.dart:63–88`, `social_api_client.dart:43–47` |
| There are two HTTP clients with **different token keys**. `ApiClient` reads `access_token`, `device_token` and `device_id`. `SocialApiClient` reads `auth_token`, `x_device_token`, `companyId` and `workspaceId`. Nothing writes `auth_token`, so **every social call is unauthenticated.** | `api_client.dart:33–35` vs `social_api_client.dart:29–32` |
| `SocialApiClient` always sends `x-company-id: default_company_id` when there is no stored value. That string has 18 chars, so `company-context.ts:154` returns **400 on every social request**. It also sends a fake `x-device-token: flutter_native_device_token` and `x-workspace-id: default_workspace_id`. | `social_api_client.dart:29–36` |
| `registerDeviceToken()` exists but is never called. | `auth_provider.dart:134–151` |
| `ApiClient` timeouts are 4 s connect and 6 s receive. AI calendar generation takes far longer, so it will always time out on this client. `SocialApiClient` uses 15 s / 20 s, which is still too short for LLM calls. | `api_client.dart:17–19`; `social_api_client.dart:15–16` |
| **Secret in client:** Groq Whisper is called directly from the app with a key compiled in via `String.fromEnvironment('GROQ_API_KEY')`. There is no literal fallback, but a dart-define key ships inside the APK/IPA and can be extracted. This violates the project's no-embedded-secrets rule in spirit. Proxy the call through the backend instead. | `core/network/audio_transcription_service.dart:56–71` |

---

## 2. Feature inventory

Each row: **Web feature** (where) | **Endpoint(s)** | **Request → Response** | **Backend** | **Flutter** (file:line).
Unless noted, paths are relative to `/api/v1/social-media`.

### 2.1 Projects (multi-client identity)

| # | Web feature | Endpoint | Request → Response | Backend | Flutter |
|---|---|---|---|---|---|
| P1 | Projects list with search, status chips (all / in_progress / in_review / completed), and cards showing client, linked platforms, and scheduled / pending review / task counts (`social-projects/page.tsx:20–40`) | `GET /projects` | query `search, status, clientId, limit=50, offset=0` → `{ success, projects: [{ id, name, description, status, priority, startDate, deadline, ownerId, clientIds, memberIds, socialServices, socialSettings, socialAccounts: [{ id, platform, accountName, username, profileImageUrl, reauthRequired, capabilities }], brandVoiceProfile, metrics: { scheduledPosts, pendingApprovals, outstandingTasks, publishedPosts, totalPosts }, pendingReviewSessions, createdAt, updatedAt }], total }` | Real (`social-project.service.ts:39–166`). The list payload has **no `client` object**, only `clientIds`. The web card reads `project.client?.name`, so it always shows "Internal Project" (a web bug). | **Mocked.** Seeded with 2 demo projects (`features/projects/project_provider.dart:115–146`). Errors or empty results silently keep the demo data (`:150–167`). `StudioProject.fromJson` reads non-existent fields `clientName`, `connectedPlatforms`, `scheduledPosts`, `pendingShoots`, `brandVoice`, with fake defaults `['Instagram','TikTok']`, `12`, `3` (`:71–81`). There is no search or status filter. |
| P2 | Create-project wizard with 5 steps (`social-projects/new/page.tsx`): (1) name, existing client or create new (name + email), description, start/end date; (2) services multi-select (`content_calendar, short_form_video, static_posts, publishing, inbox, analytics`); (3) brand voice: tone preset, audience, pillars, forbidden words, CTAs; (4) select existing connected accounts; (5) approval required, default timezone, retention days | `POST /projects`. Prerequisites: `GET /api/clients` (→ `/v1/crm-and-sales/clients`) `{clients}`, `GET /social-media/accounts` `{accounts}`, `GET /api/users` (→ `/v1/identity/users`) `{users}` | body `{ name*, clientId? , clientName?, clientEmail?, description, startDate, endDate, socialServices[], brandProfile: { tone, targetAudience, contentPillars, forbiddenWords, standardCtas, (sampleViralPosts, defaultHashtags, metadata) }, connectedAccountIds[], teamMemberIds[], settings: { approvalRequired, defaultTimezone, storageRetentionDays, defaultReviewerId? } }` → `201 { success, project }` (full detail, see P3) | Real (`:235–332`). It auto-creates a CRM client `CLT-000N` when `clientName` is given, creates `BrandVoiceProfile`, and re-parents accounts. **`brandProfile.contentPillars` is silently dropped** because the schema has no column for it; the web sends it anyway. The web collects `teamMemberIds` but the wizard has no UI for it. | **Mocked.** `create_project_screen.dart` has its own wizard. It sends only `{ name, clientName, connectedPlatforms }` (`project_provider.dart:204–210`). There are no services, dates, email, accounts or settings. On failure `createProject` returns the input map (`social_api_client.dart:65–75`) and the provider invents the id `proj-<timestamp>` (`project_provider.dart:211`), so offline "creates" look successful. It then calls a separate brand-voice save (see B2). |
| P3 | Project workspace header (client, name, status, "Send for Approval", "Create Content") and 11 tabs selected by `?tab=` (`social-projects/[id]/page.tsx`, `ProjectHeader.tsx`) | `GET /projects/:id` | → `{ success, project: { ...Project, socialAccounts[], brandVoiceProfile, contentCalendars_ProjectContentCalendars[{ calendarContentPieces[≤100] }], socialPosts[≤100]{ variants, reviewComments }, tasks[]{ assignee{ id,name,email,image,photoUrl } }, clientReviewSessions[]{ comments }, socialConversations[≤50], client } }` (404 if not found or another tenant) | Real (`:171–230`) | **Missing.** There is no project detail screen. |
| P4 | Overview tab: "Action Required" list (Resolve jumps to tab), 4 KPI tiles, upcoming content (≤6), recent activity (`tabs/OverviewTab.tsx`) | `GET /projects/:id/dashboard`, `GET /projects/:id/activity?limit=10` | dashboard → `{ success, dashboard: { projectId, metrics: { postsScheduledThisWeek, postsAwaitingApproval, editingTasksInProgress, overdueTasks, postsPublishedThisMonth, publishingFailures, unreadInboxCount }, attentionItems: [{ id, type: approval_required\|publishing_failed\|overdue_task\|unread_inbox, title, description, priority, actionLink:"/social-projects/:id?tab=x" }], upcomingContent: SocialPost[] (with variants, socialAccount{platform,accountName}) } }`. activity → `{ success, activity: [{ id, type: post\|task\|approval, title, action, description, timestamp }] }` | Real (`:340–584`). The `reauth_needed` attention type is declared but never produced. | **Missing.** The dashboard screen shows calendar pieces instead. |
| P5 | Settings tab: name, status (in_progress / in_review / paused / completed), description, approval-required toggle, default timezone (6 options), retention days (`tabs/SettingsTab.tsx`) | `PUT /projects/:id` | `{ name, description, status, socialServices?, socialSettings: { approvalRequired, defaultTimezone, storageRetentionDays } }` → `{ success, project }` (raw row). `socialSettings` is shallow-merged. | Real (`:589–611`) | **Missing.** |
| P6 | Delete project (soft) | `DELETE /projects/:id` | → `{ success, result }` | Real (`:646–661`). **The web has no UI for this.** | **Missing.** |
| P7 | Link / unlink an account to a project | `POST /projects/:id/accounts` `{ accountId }`; `DELETE /projects/:id/accounts/:accId` | → `{ success, result }` | **Partial and unsafe:** `socialAccount.update` by id has no tenant check in the service (`:616–641`). The tenant Prisma proxy mitigates this only if `findUnique`/`update` are in its filter set, so verify. **The web has no UI for this.** | **Missing.** |
| P8 | Project switcher (web: navigate between project pages) | uses P1 | | | **Mocked.** A local dropdown over the demo list works (`dashboard/studio_dashboard_screen.dart:223–235`). |

### 2.2 Brand voice

| # | Web feature | Endpoint | Request → Response | Backend | Flutter |
|---|---|---|---|---|---|
| B1 | Read brand voice for a project | `GET /brand-voice/:projectId` | → `{ success, profile: { id?, projectId, companyId, tone, targetAudience, sampleViralPosts[], forbiddenWords[], defaultHashtags[], standardCtas[], metadata } }`. Returns a synthetic default when none exists. | Real (`brand-voice.service.ts:14–37`) | **Partially real.** `getBrandVoice` calls the correct path (`social_api_client.dart:78–88`). `BrandVoice.fromJson` expects `contentPillars` and `hookStyle`, which the backend never returns, and ignores `standardCtas`, `defaultHashtags` and `sampleViralPosts` (`project_provider.dart:29–39`). Errors fall back to `BrandVoice.sample()`, the fitness demo (`:19–27, 76`). |
| B2 | Brand Voice tab in project: tone presets, audience, pillars, forbidden words, CTAs, Save (`tabs/BrandVoiceTab.tsx:36–55`) | Web calls **`POST /brand-voice`** with `projectId` in the body. **This path does not exist.** The backend is `POST /brand-voice/:projectId`. | body `{ tone, targetAudience, sampleViralPosts[], forbiddenWords[], defaultHashtags[], standardCtas[], metadata }` → `{ success, profile }` | Real upsert (`:39–68`). Unknown keys such as `contentPillars` are dropped; store pillars in `metadata.contentPillars`. **Web save is broken (404).** | **Mocked.** It is only saved once, at project creation (`project_provider.dart:214`), with `{ tone, targetAudience, contentPillars, forbiddenWords, hookStyle }`. Pillars and hookStyle are dropped server-side (`:41–49`). The dashboard shows guidelines read-only (`studio_dashboard_screen.dart:~300–330`). There is no edit screen. |
| B3 | Global "Brand Voice DNA" manager on the assets hub: tone, audience, up to 5 sample viral posts, forbidden words, default hashtags, CTAs (`social-media-assets/_components/BrandVoiceManager.tsx`) | Web calls `GET /brand-voice?projectId=` and `POST /brand-voice`. **Both are wrong** (no `:projectId` in the path). It is rendered without a projectId (`social-media-assets/page.tsx:~198`). | as B2 | **None** for a company-wide profile. Brand voice is per-project only. **The web tab is broken.** | **Missing.** |
| B4 | "Generate New Concepts" produces 3 ideas; "Create Post from Idea" turns one into a post (`BrandVoiceTab.tsx:57–92`, `[id]/page.tsx:84–99`) | Idea generation: **none**. The web uses a hardcoded `mockIdeas` array. Create-from-idea calls `POST /posts` (F2). | | **Stub on the web, None on the backend.** | **Missing.** |
| B5 | Brand-safety and tone-match audit, forbidden-word alerts, character/hashtag counts in the content drawer (`socialEdgeGuard.auditBrandSafetyCopy`, `validatePlatformConstraints`: IG 2200, LinkedIn 3000, TikTok 2200, YT Shorts title 100) | client-side only (`lib/services/social-edge-guard.ts`). The server has a similar, unexposed `BrandSafetyAuditor`. | | N/A (client lib) | **Missing.** Port `social-edge-guard.ts` to Dart. |

### 2.3 Connected social accounts

| # | Web feature | Endpoint | Request → Response | Backend | Flutter |
|---|---|---|---|---|---|
| A1 | Connected Channels list: 5 platform cards (IG, FB, LinkedIn, TikTok, YouTube) with account rows (`social-media-assets/_components/ConnectedAccountsManager.tsx`) | `GET /accounts?projectId=` | → `{ success, accounts: [{ id, companyId, projectId, clientId, platform, platformAccountId, accountName, username, profileImageUrl, accessToken, refreshToken, tokenExpiresAt, scopes, metadata, isActive, reauthRequired, capabilities, project{id,name}, client{id,name} }] }` | Real (`social-account.service.ts:19–34`). **Security: it returns `accessToken` and `refreshToken` to the client.** These must be stripped server-side before mobile ships. | **Mocked.** It calls `GET /accounts` with no projectId (`social_api_client.dart:146–156`). An empty or failed response yields 4 hardcoded Apex demo accounts (`features/accounts/account_provider.dart:132–180`). `fromJson` reads non-existent `displayName`, `avatarUrl`, `followerCount`, `engagementRate` and `isConnected`, with fake defaults: Unsplash avatar, 45000 followers, 4.5% (`:59–69`). It never parses `accountName`, `profileImageUrl`, `tokenExpiresAt` or `reauthRequired`. The project filter falls back to all accounts (`:212–218`). |
| A2 | Connect account button per platform | `POST /accounts/connect` | body `{ platform*, platformAccountId*, accountName*, username*, profileImageUrl?, accessToken*, refreshToken?, tokenExpiresAt?, scopes[]?, metadata?, projectId?, clientId? }` → `201 { success, account }` (upsert on `companyId+platform+platformAccountId`) | **Partial.** It stores whatever tokens the client sends. **There is no OAuth flow anywhere (no authorize URL, no callback, no token exchange, no refresh).** **The web fabricates tokens** (`live_token_${platform}_${Date.now()}`) in a "simulated OAuth handshake" (`ConnectedAccountsManager.tsx:103–118`). | **Mocked.** The button shows a "Redirecting to OAuth…" snackbar and does nothing (`accounts_screen.dart:177–183`). |
| A3 | Disconnect (confirm dialog) | `DELETE /accounts/:id` | → `{ success, message }` (soft: `isActive=false`) | Real (`:99–113`) | **Mocked.** It flips a local `isConnected` flag only, with no API call (`account_provider.dart:186–205`, `accounts_screen.dart:111`). |
| A4 | Re-auth warning (dashboard `reauth_needed`, validate-publish issue) | the `reauthRequired` field | | Partial. The field exists, but nothing ever sets it. | **Missing.** |

### 2.4 AI content calendar (generator)

Mounted at `/content-calendar` under social-media (and the `/api/content-calendar` alias). Responses **do not** use the `{success}` envelope. Errors go to the global handler as `{error}`.

| # | Web feature | Endpoint | Request → Response | Backend | Flutter |
|---|---|---|---|---|---|
| C1 | Calendars list with client-side search (brand/industry) and status filter (draft / processing / active / archived / failed); cards; admin-only page (`content-calendar/page.tsx`; `user.role !== 'admin'` sees Access Denied) | `GET /content-calendar?limit=&offset=` | → `{ calendars: [{ ...ContentCalendar, ...metadata (brandName, industry, subdomain, targetAudience, platforms, calendarDuration, frequency, timezone, aiProviderUsed, userId), _id }] }` | Real (`packages/domains/social-media/src/content-calendar.service.ts:4–26`). Tenant scoping comes from the Prisma proxy. **Calendars are never linked to a project or client:** `createCalendar` does not set `projectId`/`clientId`, although the columns exist. | **Mocked/partial.** It calls the right path (`social_api_client.dart:100–110`) but only ever uses `calendars.first` (`calendar_provider.dart:207–237`). There is no list, search or filter. Errors keep 4 seeded fitness posts (`:144–205`). |
| C2 | "Create AI Calendar" 7-step wizard (`content-calendar/create/page.tsx`): step 0 type company/personal; 1 brand name*, industry*, subdomain; 2 target audience*; 3 platforms (Instagram, LinkedIn, Twitter/X, Facebook, TikTok, YouTube Shorts), duration (1 week / 2 weeks / 1 month), frequency (1x / 3x / 5x a week, Daily), start date, timezone; 4 content pillars; 5 brand voice; 6 engagement goal + marketingBudget (company) or personalGoals (personal); 7 hashtag strategy, competitors | `POST /content-calendar/create` | body `CalendarConfig { calendarType, brand_name, industry, subdomain?, target_audience, platforms[], durationWords, frequency, startDate, timezone, contentPillars[], brandVoice, engagementGoal, hashtagStrategy, competitors[], marketingBudget?, personalGoals?, contentCategoryMix? }` → `201 { status:'success', calendar_id, message, total_pieces, preview_url }`; 400 `{ error }` | **Real.** It calls the tenant's configured LLM (openai / gemini / claude / custom from company settings; `packages/domains/ai/src/content/ai-content-calendar.service.ts:120+`). It is slow (tens of seconds) and fails with 400 if no AI key is configured. It logs `aiRequestLog`. | **Mocked/broken.** `calendar_generator_wizard.dart:57–69` sends only `brand_name, industry, target_audience, platforms, durationWords, frequency, engagementGoal, hashtagStrategy`. Missing: `calendarType`, `startDate`, `timezone`, `contentPillars`, `brandVoice`, `competitors`. It prefills industry with the hardcoded "Fitness & Health Coaching" (`:37`). The client expects `res['calendar']` but the backend returns `calendar_id` (`social_api_client.dart:112–122`), **so success is always reported as failure.** Timeout risk (§1.6). |
| C3 | "Extend for Next Month": prefills the wizard from an existing calendar (`create/page.tsx:50–80`) | `GET /content-calendar/:id`, then C2 | | Real | **Missing.** |
| C4 | Calendar detail: header stats (duration, pieces, frequency, breakdown), goal, pillars, pieces grouped by week (`content-calendar/[id]/page.tsx`) | `GET /content-calendar/:id` (or `/:id/pieces`) | → `{ calendar, pieces: [{ ...CalendarContentPiece, _id, hashtags[], engagementTarget: { estimatedImpressions, estimatedEngagementPercent } }] }` (≤200). Piece fields: `id, calendarId, weekNumber, dateScheduled, platform, contentType, pillar, headline, adCopyFull, videoScriptOrHooks, visualAssetsBrief, hashtagsResearched, callToAction, postingTimeTz, notes, status (ready\|in_progress\|pending_review\|published), viralScore, rawMediaUrls, finalVideoUrl, thumbnailUrl` | Real | **Mocked/partial.** Pieces are rendered as a flat "30-day plan". `CalendarPost.fromJson` fakes `dayNumber = weekNumber*7+index` and the platforms default `['Instagram','TikTok']`. `viralScore` defaults to `90+index%8`, although the backend always stores 5. The impressions default is the string `'50k - 100k'` (`calendar_provider.dart:44–76`). `engagementTarget.estimatedImpressions` is numeric, so the `as String?` cast will throw at `:73`. |
| C5 | Piece quick-status menu: Mark Ready / In Progress / Pending Review / Publish (`[id]/page.tsx` ContextActions) | `PUT /content-calendar/:id/pieces/:pieceId` | body: any piece fields (`status`, or `hashtags[]` → JSON, or `engagementTarget{}` → columns, `dateScheduled`) → `{ piece }` | Real. **Mass-assignment:** the body is passed straight to `prisma.update`. There is no ownership check on the piece id beyond the tenant proxy. | **Mocked.** It collapses 4 statuses into `needsShoot / inEdit / approved / published` (`calendar_provider.dart:4–9, 45–58`). The sync only sends `published` or `in_progress` (`:268–275`), so "approved" is written back as `in_progress`. The `updateCalendarPiece` result is ignored. |
| C6 | Content piece drawer: edit headline, status, and tabs copy (adCopyFull, videoScriptOrHooks, CTA) / strategy (pillar, postingTimeTz, visualAssetsBrief, hashtagsResearched, notes) / metrics; Save (`_components/ContentPieceDrawer.tsx`) | same as C5 | | Real | **Mocked.** `content_piece_detail_sheet.dart` plus `master_composer_dialog.dart` edit hook, CTA and hashtags locally. `CalendarNotifier.updatePost` never calls the API (`calendar_provider.dart:278–287`). `_handleSave` also **drops the edited caption** (`master_composer_dialog.dart:69–77`). |
| C7 | Archive calendar | `PUT /content-calendar/:id` `{ status:'archived' }` | → `{ calendar }` | Real (mass-assignment of any column) | **Missing.** |
| C8 | Delete calendar | `DELETE /content-calendar/:id` | → `{ success, message }` | Real (hard delete of calendar and pieces) | **Missing.** |
| C9 | Save as template (prompt for a name) | `PUT /content-calendar/:id` `{ isTemplate:true, templateName }` | → `{ calendar }` | Real (template is only a flag; no "create from template" flow exists) | **Missing.** |
| C10 | Export CSV (client-side: Date, Platform, Type, Pillar, Headline, Copy, CTA, Hashtags, Reach) | none | | N/A | **Missing.** Use a share sheet with a CSV file. |
| C11 | "Client Magic Link" from a calendar (copies the review URL) | `POST /reviews/sessions` (see R1) with `clientId: calendar.clientId \|\| 'general-client'` | | **Broken:** calendars never have a `clientId`, so the `'general-client'` foreign key fails. The session's post window is also unrelated to the calendar pieces, because pieces are not posts. | **Missing.** |
| C12 | "Multi-Channel Post" opens the Master Composer (see F6) | | | | |

### 2.5 Posts, content pieces and the composer (project-scoped)

| # | Web feature | Endpoint | Request → Response | Backend | Flutter |
|---|---|---|---|---|---|
| F1 | Project Calendar tab: month grid with prev/next, project timezone badge, list/month toggle, day click creates a draft for that date, ≤2 chips + "+N more", **cannibalization warning** when 2+ posts are <15 min apart (`tabs/CalendarTab.tsx`). Content tab: search (client-side), status filter (draft, in_editing, in_review, approved, scheduled, published), version badge (`tabs/ContentListTab.tsx`) | `GET /posts?projectId=&status=` | query `projectId, clientId, status, calendarId, isEvergreen=true\|false, limit=50, offset` → `{ success, posts: [{ ...SocialPost, variants[], project{id,name}, client{id,name}, socialAccount{id,platform,accountName,username}, reviewComments[{id,resolved,authorType}] }] }` ordered by `scheduledFor`. SocialPost fields: `id, title, content, mediaUrls[], rawMediaUrls[], externalStorageLinks[{url,provider,label}], finalVideoUrl, thumbnailUrl, mediaType (video\|image\|carousel\|document), status (draft, scheduled, in_editing, in_review, pending_review, approved, ready, publishing, published, partially_published, failed), scheduledFor, publishedAt, publishedLinks{platform:url}, errorMessage (JSON string), isEvergreen, reuseCount, lastReusedAt, versionNumber, history[], metadata{hook,objective,firstComment}, revisionNotes, repurposedFromId` | Real (`social-post.service.ts:128–154`). **The default limit is 50 and there is no date-range filter**, so a month grid silently truncates. Add `from`/`to` query parameters. | **Missing.** Flutter has no SocialPost model at all. It treats AI calendar pieces as posts. |
| F2 | Create content draft ("Create Content" header button, "+ Add" on a day, "Create post from idea") (`[id]/page.tsx:64–99`) | `POST /posts` | body `CreateSocialPostDTO { title?, content*, mediaUrls?, rawMediaUrls?, externalStorageLinks?, finalVideoUrl?, thumbnailUrl?, mediaType?, scheduledFor?, projectId?, clientId?, calendarId?, calendarPieceId?, socialAccountId?, variants?: [{ platform, customContent, customMediaUrls?, firstComment?, platformMeta? }], metadata?, isEvergreen? }` → `201 { success, post }`. Status is `scheduled` if `scheduledFor` is set, else `draft`. If `calendarPieceId` is set, the piece's media and status are synced. | Real (`:36–102`). Note that **a draft with a date is marked `scheduled` immediately**, bypassing approval. | **Missing.** |
| F3 | Content Detail Drawer (`ContentDetailDrawer.tsx`, 6 tabs). **Script:** title, hook (0–3 s), objective/pillar, caption, first comment, "Automate First Comment" (moves #tags), brand-tone score and violations, char and tag counter. **Media:** client footage drive link (provider auto-detect), final video URL, thumbnail URL, schedule datetime, mediaType. **Studio:** "Open 180 Studio" (`/media-editor?projectId&postId`), "Assign Editor", list of `post.tasks` with "Submit Video". **Preview:** IG / LinkedIn / TikTok / YT Shorts mockups + safe-zone overlay. **Approvals:** "Send for approval", review comments list. **Publishing:** readiness check + "Publish Now". Footer: Save. | `PUT /posts/:id`; `GET /posts/:id/validate-publish`; `POST /posts/:id/publish` | PUT body: any subset of the DTO plus `status` (variants are ignored on update) → `{ success, post }` (with variants). **Versioning:** if the post was `approved` and `content` or `finalVideoUrl` changes, then `versionNumber++`, `status='in_review'`, and a history entry is added. Save sends `{ title, content, mediaType, finalVideoUrl, thumbnailUrl, scheduledFor, metadata{...hook, objective, firstComment}, externalStorageLinks[{url,provider,label,submittedAt}] }`. | Real (`:156–199`). **Mass-assignment:** `{...data}` goes straight to update, so a client can set `status:'published'`, `publishedLinks`, `companyId`, and so on. **Variant editing (per-platform caption and first comment) has no endpoint;** they can only be set at create. `post.tasks` is **never included** by any post query, so the Studio tab's task list is always empty (web bug). | **Missing.** `safe_zone_player_dialog.dart` is a static simulated preview (`:40, 55`) and is not bound to post data. |
| F4 | Get single post (repurpose lineage, comments, calendar links) | `GET /posts/:id` | → `{ success, post: { ..., variants, reviewComments(asc), project, client, socialAccount, calendar, calendarPiece, repurposedFrom{id,title,versionNumber}, derivedPosts[{id,title,status,scheduledFor}] } }` | Real. **It returns `socialAccount` in full, including tokens.** | **Missing.** |
| F5 | Master Composer / "Master Social Media Publisher" (`_components/MasterComposerModal.tsx`): pick platforms (IG, LinkedIn, TikTok, YT), title, caption, schedule datetime, drive link, "attach raw clips", "Launch Media Studio", reel vs image, PDF carousel toggle, safe-zone preview, **Schedule**, **Publish Now** | Schedule: `POST /posts` with `{ title, content, mediaUrls, rawMediaUrls, finalVideoUrl, thumbnailUrl, mediaType, scheduledFor, calendarId, calendarPieceId, projectId, clientId }` | as F2 | **Web "Publish Now" is fully simulated:** a timeout plus random fake live URLs (`:92–118`). "Attach clips" inserts mixkit stock URLs and "Launch Media Studio" sets an Unsplash image as the rendered video (`:66–84`). **Selected platforms are not sent as `variants`,** so the platform choice is lost. | **Mocked.** `master_composer_dialog.dart`: "Enhance with AI" is a 600 ms delay that prepends 🔥 and appends "Drop a YES" (`:50–66`). Save is local only (`:69–77`). |
| F6 | Submit footage (raw clips / drive links) | `POST /posts/:id/footage` `{ rawMediaUrls?, externalStorageLinks? }` | → `{ success, post, message }` | Real. The web does not call it; it writes `externalStorageLinks` through PUT. | **Missing.** Mobile camera and gallery upload should feed this after uploading to storage (`/api/files/upload` → `/v1/workspace-tools/storage/upload`). |
| F7 | Repurpose post (evergreen derivative) | `POST /posts/:id/repurpose` `{ newScheduleDate?, newProjectId?, newContent? }` | → `201 { success, post }` (increments `reuseCount`, sets `repurposedFromId`, `isEvergreen:true`) | Real. `socialProjectService.repurposePost` exists but **no web UI calls it.** | **Missing.** |
| F8 | Cannibalization / collision warning | client-side (CalendarTab). The server `SmartTimezoneScheduler.checkScheduleCollision` and peak-window recommendations exist but are not exposed. | | N/A | **Missing.** |

### 2.6 Editing tasks (footage → editor → deliverable)

| # | Web feature | Endpoint | Request → Response | Backend | Flutter |
|---|---|---|---|---|---|
| T1 | Tasks tab: list with priority, status, assignee, due date, "Open 180 Studio", "Submit Video" (`tabs/TasksTab.tsx`) | `GET /api/tasks?projectId=` (→ `/api/v1/projects-and-tasks/tasks`, `moduleGuard('projects')`) | → `{ tasks: [...] }` (projects-and-tasks domain) | Real (another module; it requires the `projects` app, not `social-media`) | **Missing.** |
| T2 | Assign editor modal: assignee (from `GET /api/users`), priority, deadline, instructions (`AssignEditorModal.tsx`) | With a post: `POST /posts/:id/assign-editor`. Without one: `POST /api/tasks` `{ projectId, assigneeId, title, description, priority, dueDate, contentPieceId }` | assign-editor body `{ assigneeId*, projectId*, clientId?, deadline?, priority='high', editingInstructions?, sourceMediaUrls? }` → `201 { success, task }` (post goes to `in_editing`) | Real (`editing-task.service.ts:20–89`). There is no validation that the assignee belongs to the tenant. | **Missing.** |
| T3 | Submit deliverable modal: final MP4 URL*, thumbnail URL, notes (`SubmitDeliverableModal.tsx`) | `POST /posts/tasks/:taskId/submit-deliverable` | `{ deliverableUrl*, thumbnailUrl?, notes? }` → `{ success, task, deliverableUrl, message }` (task becomes `submitted_for_review`, post becomes `in_review` with `finalVideoUrl`, piece becomes `pending_review`) | Real | **Missing.** On mobile: pick a video, upload, then submit. |
| T4 | Studio launch context (desktop editor handoff) | `GET /posts/:id/studio-launch-context` | → `{ success, context: { projectName, projectId, aspectRatio:'9:16', sourceClips[], aiDirectorContext } }` | Real (static pacing) | N/A (desktop-only rule). The mobile equivalent is "Open on desktop" or a deep link. |
| T5 | Sync studio render | `POST /posts/sync-studio-render` (`requireDesktopDevice`) `{ calendarPieceId*, finalVideoUrl*, thumbnailUrl? }` | → `{ success, piece, linkedPost }` | Real. **It has no tenant check on `calendarPieceId`**; it relies on the proxy. | N/A |
| T6 | Mobile-only extras (no web equivalent): teleprompter capture, AI Director, timeline editor, Whisper transcription | `/api/media-editor/ai-direct` (desktop-device gated) | | | **Mocked.** `ai_director_service.dart:61–83` returns a canned edit plan on any failure, with a 3 s timeout. `audio_transcription_service.dart:95–119` returns a hardcoded fitness transcript. `media_engine_service.dart:40–67` writes `SIMULATED_*` text files as "video". `timeline_screen.dart:59` seeds a fake timeline. The dashboard FAB "Shoot Next Post" (`studio_dashboard_screen.dart:208–219`). |

### 2.7 Reviews and client approval (including public links)

| # | Web feature | Endpoint | Request → Response | Backend | Flutter |
|---|---|---|---|---|---|
| R1 | "Send for Client Approval" modal: title, window start/end dates, expiry days (default 14) → shows the link and copies it (`SendForApprovalModal.tsx`) | `POST /reviews/sessions` | body `{ clientId*, projectId?, name*, startDate*, endDate*, postIds?, expiresInDays? }` → `201 { success, session: { id, companyId, clientId, projectId, token, name, startDate, endDate, expiresAt, status:'pending', client{id,name,email}, project{id,name}, publicReviewUrl:'/review/<token>' } }` | Real (`client-review.service.ts:18–56`). `postIds` → `in_review` (updateMany with no tenant filter beyond the proxy). **The web sends `clientId: project.clientIds[0] \|\| 'default_client'`, so projects without a client fail on the foreign key.** The session covers **all posts of that client in the date window**, not per project. | **Missing.** |
| R2 | Approvals tab: list sessions with status (pending / revisions_requested / approved), expiry, window, "Copy Review Link", "Open" (`tabs/ApprovalsTab.tsx`) | Web calls **`GET /reviews/sessions?projectId=`**, which **does not exist.** The error is swallowed and the list is always empty. The data is available via `GET /projects/:id` → `clientReviewSessions[]{comments}`. | | **None** (needs a `GET /reviews/sessions` endpoint) | **Mocked.** `GET /reviews` (not a real path) with a `reviews` key (`social_api_client.dart:197–207`). Falls back to one demo session (`review_provider.dart:112–126`). `fromJson` expects per-post fields (`postId`, `postTitle`, `clientEmail`, `shareableLink`, `revision_requested`) that do not exist. The real status is `revisions_requested` (plural), and the fake link is `https://app.180workspace.com/review/c-<ts>` (`review_provider.dart:29–53`). "Copy link" only shows a snackbar with no clipboard (`reviews_screen.dart:135–138`). |
| R3 | Agency-side approve / request changes (Flutter-only concept) | Flutter calls `PUT /reviews/:id` `{status, feedback}`, which **does not exist.** | | **None.** Agencies approve by setting post status via `PUT /posts/:id { status:'approved' }`. | **Mocked.** Local state change plus a failing call (`review_provider.dart:132–149`, `reviews_screen.dart:154–162`). |
| R4 | **Public client portal** `/review/[token]` (no login): feed and calendar views, per-post platform switcher, comments thread, add comment, "Approve Entire Calendar" (`app/(public)/review/[token]/page.tsx`) | `GET /reviews/public/:token`; `POST /reviews/public/:token/comments`; `POST /reviews/public/:token/approve-batch`. These are reachable unauthenticated at `/api/v1/social-media/reviews/public/...` (index.routes.ts:259). | GET → `{ success, session{ ..., client, project, company{id,name}, comments[] }, posts[{ ...SocialPost, variants, reviewComments }] }` (404 if expired or invalid). comments body `{ postId*, commentText*, authorName?='Client Reviewer', authorType?='client' }` → `201 { success, comment }`; a client comment sets the session to `revisions_requested`. approve-batch body `{ clientNotes? }` → `{ success, message, session }`; all posts in the window become `approved`. | **Partial, with security gaps:** (a) comments do not verify that `postId` belongs to the session's company, client or window, so any valid token can comment on any post id; (b) `approve-batch` **does not check `expiresAt`**; (c) `authorType` is caller-controlled, so a client can post as `agency`; (d) no rate limit beyond the global one. | **Missing.** On mobile, share the URL and open it in the browser. A native client-reviewer mode is optional. |
| R5 | Review comments per post (drawer Approvals tab) | comes from `GET /posts/:id` → `reviewComments` | | Real. **There is no agency endpoint to add or resolve comments** (only the public one). | **Missing.** |

### 2.8 Inbox (comments and DMs)

| # | Web feature | Endpoint | Request → Response | Backend | Flutter |
|---|---|---|---|---|---|
| I1 | Global inbox (`inbox/page.tsx`): platform filter, search, conversation list, thread. Project Inbox tab (`tabs/InboxTab.tsx`): per-project list | `GET /inbox/conversations?projectId=&platform=&isRead=&search=` | → `{ success, conversations: [{ id, companyId, projectId, socialAccountId, platform, platformThreadId, participantName, participantHandle, participantAvatar, lastMessageSnippet, lastMessageAt, isRead, convertedLeadId, socialAccount{id,accountName,username,platform}, project{id,name}, messages[≤50 asc]{ id, senderType, content, createdAt } }] }` | **Partial.** Reads work, but **nothing ingests conversations.** There are no webhooks and no polling of the IG/FB/LinkedIn/TikTok/YT APIs; `IngestMessageDTO` is declared but unused. `search` is accepted but ignored in the service. The table is always empty in production. **The global web page shows 3 hardcoded mock conversations when empty** (`inbox/page.tsx:32–95`). | **Mocked.** It calls `GET /inbox` (a wrong path) and reads key `items` (`social_api_client.dart:159–169`). It falls back to 2 fitness demo items (`inbox_provider.dart:120–149`). `fromJson` expects `authorName`, `authorHandle`, `content`, `postTitle` and `isReplied`, and maps every platform except TikTok to Instagram (`:36–55`). The sync buttons only show snackbars (`inbox_screen.dart:21–46`). |
| I2 | Open a conversation (marks it read) | `GET /inbox/conversations/:id` | → `{ success, conversation: { ..., socialAccount (full, **including tokens**), project, messages[] } }` | Real | **Missing.** |
| I3 | Send reply | `POST /inbox/conversations/:id/messages` `{ content*, senderType?='agent'\|'ai_bot' }` | → `201 { success, message }` | **Partial:** it writes a DB row and updates the snippet. **It is never sent to the platform.** The project tab web calls **`/reply`** (a wrong path, error swallowed, and it toasts "dispatched"). The global web page only appends locally. | **Mocked.** `POST /inbox/reply` `{ itemId, reply }` is a wrong path and body (`social_api_client.dart:171–181`). It marks the item replied locally regardless (`inbox_provider.dart:155–168`) and shows a "Reply posted in Brand Voice!" snackbar (`inbox_screen.dart:178–186`). |
| I4 | "Generate Brand-Voice AI Suggestions" (3 clickable suggestions) | `GET /inbox/conversations/:id/ai-suggestions` | → `{ success, suggestions: [{ tone, text }], brandToneApplied }` | **Stub:** 3 hardcoded templates with the handle interpolated. No LLM (`social-inbox.service.ts:92–126`). The project web tab treats suggestions as strings, which is a shape bug. | **Mocked.** `aiSuggestedReply` is a hardcoded default string (`inbox_provider.dart:53`). |
| I5 | "Add to CRM" / convert to lead | `POST /inbox/conversations/:id/convert-to-lead` | → `{ success, message, lead }` (creates a CRM `lead`, sets `convertedLeadId`) | Real. It is not idempotent: repeated taps create duplicate leads. | **Missing.** |

### 2.9 Assets and saved banks

The assets and saved-banks endpoints **share the `SavedBank` table**. `GET /assets` without a `type` filter therefore returns hashtag and hook items too, and `GET /saved-banks` returns linked assets. The web filters client-side.

| # | Web feature | Endpoint | Request → Response | Backend | Flutter |
|---|---|---|---|---|---|
| S1 | Linked Media tab: category chips (all / image / video / folder), cards, delete (`social-media-assets/page.tsx`) | `GET /assets?type=&search=` | → `{ success, assets: [{ id, url, type, title, description, tags[], createdAt }] }` | **Partial:** `search` is ignored and errors are swallowed (`.catch(()=>[])`). These are link records only; nothing is uploaded. | **Mocked.** It calls the right path (`social_api_client.dart:184–194`) but falls back to 3 demo assets (`assets_provider.dart:98–129`). `fromJson` invents `source: 'Device Camera 4K'`, `durationOrSize: '0:30 • 45MB'` and an Unsplash URL (`:40–48`). |
| S2 | Link External Asset drawer: url*, title, type (image / video / folder / other), tags (CSV), description (`AddAssetDrawer.tsx`) | `POST /assets` | `{ url*, type*, title?, description?, tags[] }` → `201 { success, asset }` | Real | **Mocked.** Import buttons only show snackbars (`assets_screen.dart:20–23, 71–73`). |
| S3 | Delete asset | `DELETE /assets/:id` | → `{ success, message }` | Real | **Missing.** |
| S4 | Hashtag Bank and Hook Bank tabs: list, search, copy to clipboard, delete, "Create New" drawer (name, content, tags) (`CreateBankDrawer.tsx`) | `GET /saved-banks`; `POST /saved-banks` `{ type:'hashtag'\|'hook', name*, content*, tags[] }`; `DELETE /saved-banks/:id` | GET → `{ success, banks: [{ id, companyId, type, name, content, tags, metadata, createdAt }] }`; POST → `{ success, bank }` (**status 200, not 201**); errors use key `message`, not `error` | Real | **Missing.** Hashtag and hook banks are high-value on mobile: insert them into captions from the keyboard. |
| S5 | Project Media Library tab: external drive links (Google Drive / Dropbox / Box / OneDrive auto-detect), deliverables with scratch-retention countdown badges (`tabs/MediaLibraryTab.tsx`) | **none**. The drive links are local React state seeded with 2 fake links. The deliverables are a hardcoded array of 3. | | **None.** The web tab is fully mocked. Real data could come from `posts[].externalStorageLinks / rawMediaUrls / finalVideoUrl`. | **Missing.** |

### 2.10 Evergreen queue

| # | Web feature | Endpoint | Request → Response | Backend | Flutter |
|---|---|---|---|---|---|
| E1 | Evergreen Queues tab: weekly slot list, add slot (day of week, UTC time "HH:mm", category preset), delete (`EvergreenQueueManager.tsx`) | Backend: `GET /evergreen/:projectId/slots`, `POST /evergreen/slots`, `DELETE /evergreen/slots/:id`. **The web calls `GET /evergreen?projectId=`, `POST /evergreen` and `DELETE /evergreen/:id`, which all 404,** and it is rendered without a projectId. | POST `{ projectId*, dayOfWeek (0–6), timeSlotUtc, category }` → `201 { success, slot }`; GET → `{ success, slots[] }`; DELETE → `{ success }` | **Partial:** slot CRUD is real, but **no worker consumes slots.** Nothing picks an evergreen post and publishes it. There is no toggle endpoint for `isActive`. | **Missing.** |

### 2.11 Publishing and scheduling

| # | Web feature | Endpoint | Request → Response | Backend | Flutter |
|---|---|---|---|---|---|
| U1 | Pre-publish readiness check (drawer Publishing tab) | `GET /posts/:id/validate-publish` | → `{ success, isReady, issues: string[], post }` | Real (`social-post.service.ts:223–264`) | **Missing.** |
| U2 | Publish Now (Publishing tab, drawer) | `POST /posts/:id/publish` | → `{ success, status: published\|partially_published\|failed, message, publishedLinks{platform:url}, errors?{platform:msg}, post }` | **Dangerous stub behaviour:** targets are `variants[].platform`, falling back to `socialAccount.platform \|\| 'instagram'`. Every adapter, when the token is missing or starts with `mock_`, **returns fake success with a random live URL** (`adapters/meta.adapter.ts:35–40,124–129`; `linkedin.adapter.ts:24–29`; `tiktok.adapter.ts:25–30`; `youtube.adapter.ts:25–30`). The service passes `'mock_meta_token'` and similar as fallbacks (`social-post.service.ts:343–379`). **A post with no linked account is therefore marked `published` with fabricated links.** The YouTube real path also returns a random id (`youtube.adapter.ts:74–78`). The accounts connected through the web UI hold fabricated tokens (A2), so real calls will fail. **It does not call `validatePublishingReadiness` first,** so approval-required is not enforced. | **Mocked.** "1-Tap Publish" only flips local status (`studio_dashboard_screen.dart:494–501`). The published card shows the hardcoded "Live across 3 channels • 2.4k views" (`:524`). |
| U3 | Retry a failed platform variant | `POST /posts/:id/retry-variant` `{ platform* }` | → `{ success, message, post }` | Partial. It sets `status:'published'` even if other platforms are still failing. `handleRetryVariant` exists in `PublishingTab.tsx:53` **but is not wired to any button.** | **Missing.** |
| U4 | Publishing queue with status, scheduled time, live links, "Publish Now", "Edit Post" (`tabs/PublishingTab.tsx`) | `GET /posts?projectId=` | | Real | **Missing.** |
| U5 | **Scheduled auto-publishing** (a post with `scheduledFor` goes live at that time) | **none** | | **None:** there is no cron, queue or worker in `packages/domains/social-media` or in the backend social routes. "Scheduled" posts never publish. | **Missing** (it is a backend gap). |
| U6 | Timezone handling (project `defaultTimezone`; the calendar shows the tz badge) | stored in `socialSettings.defaultTimezone`. `SmartTimezoneScheduler` exists but is not exposed. | | Partial | **Missing.** |

### 2.12 Analytics

| # | Web feature | Endpoint | Backend | Flutter |
|---|---|---|---|---|
| N1 | Analytics tab: 7d / 30d / 90d toggle, 4 KPIs (impressions 128.4K, engagement 14.2K, video views 89.6K, CRM leads 38), top 3 posts (`tabs/AnalyticsTab.tsx`) | **none**. **Every number is hardcoded in JSX** and the timeframe toggle changes nothing. | **None:** no insights fetch from any platform API, and no metrics model. | **Mocked:** the "2.4k views" string (`studio_dashboard_screen.dart:524`) and the fake follower / engagement numbers (`account_provider.dart:66–67, 141–176`). |

### 2.13 Navigation shell

| # | Web | Flutter |
|---|---|---|
| X1 | Sidebar routes: `/social-projects`, `/social-projects/new`, `/social-projects/:id?tab=overview\|calendar\|content\|media\|tasks\|approvals\|publishing\|inbox\|analytics\|brand\|settings`, `/content-calendar`, `/content-calendar/create[?extendFrom=]`, `/content-calendar/:id`, `/inbox`, `/social-media-assets` (tabs: accounts, voice, evergreen, linked_assets, hashtag, hook), public `/review/:token` | 5-tab bottom nav: 30-Day Plan, Channels, Inbox, Assets, Approvals (`studio_dashboard_screen.dart:54–78`). The sync buttons are fake snackbars (`:104–112`). |

---

## 3. Status summary

**64 user-facing features** are counted in §2: P1–P8, B1–B5, A1–A4, C1–C12, F1–F8, T1–T6, R1–R5, I1–I5, S1–S5, E1, U1–U6, N1 and X1.

| Flutter status | Count | Items |
|---|---|---|
| Real | **0** | B1 comes closest: right path, wrong model mapping, demo fallback. |
| Mocked (UI exists; fake data or action, wrong path, or demo fallback) | **25** | P1, P2, P8, B1, B2, A1, A2, A3, C1, C2, C4, C5, C6, F5, R2, R3, I1, I3, I4, S1, S2, U2, N1, X1, T6. Some of these are only partial UI. |
| N/A (desktop-only media rule) | **2** | T4, T5 |
| Missing | **37** | P3–P7, B3–B5, A4, C3, C7–C12, F1–F4, F6–F8, T1–T3, R1, R4, R5, I2, I5, S3–S5, E1, U1, U3–U6 |

Plus auth: the login, refresh, `/me`, billing gate and feature-flag gate are all Missing or Mocked (§1.6).

Web features that are **themselves mocked or broken** must be fixed on the backend and web side before the mobile client can reach real parity:

- B2, B3 (brand-voice path)
- B4 (idea generation)
- A2 (OAuth)
- C11 (magic link client FK)
- F3 (post.tasks never loaded)
- F5 (composer publish / clips / studio)
- R2 (sessions list endpoint)
- I1 (ingestion, mock conversations)
- I3 (reply path and platform send)
- I4 (AI stub)
- E1 (paths)
- S5 (media library)
- U2 (fake-success publish)
- U3 (retry unwired)
- U5 (no scheduler)
- N1 (analytics)

---

## 4. Mismatches (Flutter client vs backend)

| # | Flutter call (file:line) | Backend reality | Fix |
|---|---|---|---|
| M1 | Header `x-company-id: default_company_id` fallback (`social_api_client.dart:30,35`) | `company-context.ts:154` rejects ids that are not 24, 25 or 36 chars with 400 | Remove the header; the tenant comes from the JWT |
| M2 | Header `x-device-token: flutter_native_device_token` fallback (`:29,34`) | `desktop-device.ts:170` treats it as `invalid_token` (403 when enforced) | Send only a real registered token |
| M3 | Token read from pref `auth_token` (`:32`); the other client uses `access_token` (`api_client.dart:33`) | nothing writes either key | One client, one secure-storage key |
| M4 | `GET /api/v1/social-media/projects` → reads `clientName, connectedPlatforms, scheduledPosts, pendingShoots, brandVoice` (`project_provider.dart:71–81`) | returns `clientIds[]` (no client name in the list), `socialAccounts[].platform`, `metrics.{scheduledPosts,pendingApprovals,outstandingTasks,publishedPosts,totalPosts}`, `brandVoiceProfile` | Remap. Show the client name from `GET /projects/:id` → `client.name`, or add it to the list payload server-side |
| M5 | `POST /projects` body `{name, clientName, connectedPlatforms}` (`project_provider.dart:204–208`) | expects `connectedAccountIds[]` (ids, not platform names), `brandProfile{}`, `settings{}`, `socialServices[]` | Send the full DTO in one call; brand voice goes in `brandProfile` |
| M6 | Brand voice fields `contentPillars`, `hookStyle`, `restrictedWords` (`project_provider.dart:29–49`) | columns: `tone, targetAudience, sampleViralPosts, forbiddenWords, defaultHashtags, standardCtas, metadata` | Put pillars and hookStyle in `metadata`; add the missing fields |
| M7 | `POST /content-calendar/create` → reads `res['calendar']` (`social_api_client.dart:115`) | returns `{ status, calendar_id, message, total_pieces, preview_url }` | Read `calendar_id` |
| M8 | Calendar config sends a subset (`calendar_generator_wizard.dart:57–66`) | expects `calendarType, startDate, timezone, contentPillars, brandVoice, competitors` | Send them all |
| M9 | Piece status enum collapsed to 4 values and written back as `in_progress` or `published` only (`calendar_provider.dart:45–58, 273`) | `ready \| in_progress \| pending_review \| published` | Use the backend enum 1:1 |
| M10 | `engagementTarget.estimatedImpressions as String?` (`calendar_provider.dart:73`) | the value is numeric (from a string column, parsed) | Parse as `num`/`String` defensively |
| M11 | `GET /accounts` → reads `displayName, avatarUrl, followerCount, engagementRate, isConnected` (`account_provider.dart:59–69`) | returns `accountName, profileImageUrl, isActive, reauthRequired, tokenExpiresAt` and no follower stats | Remap; drop the fake stats |
| M12 | `GET /api/v1/social-media/inbox` key `items` (`social_api_client.dart:161–162`) | `GET /inbox/conversations` key `conversations` | Fix the path, key and model (participantName, participantHandle, lastMessageSnippet, messages[]) |
| M13 | `POST /inbox/reply` `{itemId, reply}` (`:173–176`) | `POST /inbox/conversations/:id/messages` `{content, senderType}` | Fix |
| M14 | `GET /reviews` key `reviews` (`:199–200`) | no list endpoint. Use `GET /projects/:id` → `clientReviewSessions`, or add `GET /reviews/sessions?projectId=` | Add the backend endpoint |
| M15 | `PUT /reviews/:id` `{status, feedback}` (`:211–214`) | does not exist | Agency approval = `PUT /posts/:id {status:'approved'}` |
| M16 | Review status string `revision_requested` (`review_provider.dart:34,145`) | `revisions_requested` | Fix |
| M17 | Platform parse maps unknowns to Instagram (`inbox_provider.dart:36–39`); `x`/`twitter` enum (`account_provider.dart:48–50`) | the backend supports only `instagram, facebook, linkedin, tiktok, youtube` | Match the enum; show unsupported values as "unknown" |
| M18 | `enabledApps.contains('social_media')` (`auth_provider.dart:23`) | app id is `'social-media'` | Fix |
| M19 | `POST /api/desktop/devices/register` expects `statusCode == 201 && data['token']` (`auth_provider.dart:137–143`) | correct, but the call is never made and `deviceId` is not sent for renewal | Call after login; send the stored `deviceId` |
| M20 | `/api/media-editor/ai-direct` body `{prompt, context}` → reads `operations, summary, duration` (`ai_director_service.dart:41–58`) | desktop-device gated. See `docs/social-studio-mobile/AI_DIRECTOR_CONTRACT.md` for the contract | Out of scope pending the desktop-only decision |

**Web-side mismatches** (also affect the parity target):

- `POST/GET /brand-voice` without `:projectId`: `BrandVoiceTab.tsx:45`, `BrandVoiceManager.tsx:39,90`.
- `/evergreen` paths: `EvergreenQueueManager.tsx:48,64,83`.
- `GET /reviews/sessions`: `ApprovalsTab.tsx:25`.
- `POST /inbox/conversations/:id/reply`: `InboxTab.tsx:66`.
- AI suggestions treated as `string[]`: `InboxTab.tsx:50–55`.
- `project.client` read on list cards.
- `post.tasks` read in the drawer.

---

## 5. Backend issues that block a trustworthy mobile client

1. **Fake-success publishing (U2).** Remove the `'mock_*'` token fallbacks in `social-post.service.ts` and the `mock_` short-circuits in the adapters for production. A post with no valid account must fail with a clear error.
2. **No OAuth for social accounts (A2).** Implement server-side OAuth: an authorize URL plus a callback that exchanges and stores tokens encrypted, with a refresh job. Mobile then uses a system browser tab (ASWebAuthenticationSession / Custom Tabs) and a deep-link return.
3. **Tokens returned to clients:** in `GET /accounts`, `GET /posts/:id` (`socialAccount`), `GET /inbox/conversations/:id` and `GET /projects/:id` (`socialAccounts: true`). Add a `select` that omits `accessToken` and `refreshToken`.
4. **No scheduler (U5)** and **no evergreen worker (E1).**
5. **No inbox ingestion or outbound reply (I1, I3)**, and the AI replies are a stub (I4).
6. **Mass-assignment:** in `PUT /posts/:id`, `PUT /content-calendar/:id` and `PUT /content-calendar/:id/pieces/:pieceId`. Whitelist the fields.
7. **Public review gaps (R4):** no expiry check on approve-batch, no post-ownership check on comments, and a client-controlled `authorType`.
8. **Missing list endpoint** for review sessions (R2). There is no `from`/`to` range on `GET /posts`, and it truncates at 50 (F1).
9. **Unscoped id updates** on models without `companyId` (`PostReviewComment`, `SocialMessage`, `SocialPostVariant`), and in `linkSocialAccount`/`unlinkSocialAccount`. These rely entirely on the Prisma proxy for models that do have `companyId`.
10. **Refresh tokens are not rotated or revocable, and logout is a no-op.** For a mobile app holding a 7-day token on-device, add rotation and a server-side revoke list.

---

## 6. Research: valuable additions (missing from both web and mobile)

1. **Push notifications (FCM/APNs) for approvals, comments, publish failures and new inbox messages.** The dashboard's attention items (P4) already compute exactly these triggers. Mobile is where agencies react fastest.
2. **Share-sheet "assisted publish" fallback.** When a platform API is unavailable (for example Instagram personal accounts, TikTok without Direct Post approval), the app pre-copies the caption and first comment, saves media to the gallery, and opens the target app through the OS share intent. It then marks the post published after the user confirms. Most mobile schedulers do this because API coverage is incomplete.
3. **Native client-approval mode.** Open review links (R4) in-app with swipe approve / request-changes per post and voice-note feedback. Clients approve on phones, and the current web portal only offers batch approval.
4. **Capture straight to a post's footage.** Record or pick from the gallery, run a resumable, background-safe upload to storage, then call `POST /posts/:id/footage` (F6). This is the one media step that fits the desktop-only editing rule, because it is capture and upload with no processing.
5. **Offline drafts with a sync queue.** Edit captions and hooks and schedule changes offline, then replay them with conflict detection on `versionNumber` (the backend already versions approved posts).
6. **Hashtag/hook bank keyboard insert.** Offer quick-insert from S4 inside every caption field, plus the first-comment extractor (F3). Typing hashtags is painful on a phone.
7. **Home-screen widget and "today" view.** Show today's scheduled posts and pending approvals, with deep links to each item.
8. **Re-auth expiry alerts.** Warn N days before `tokenExpiresAt` and when `reauthRequired` is set. Silent token expiry is the most common cause of failed scheduled posts.
9. **Biometric app lock plus secure token storage** (Keychain / Keystore via `flutter_secure_storage`). The app holds tokens that can publish to client brand accounts.
10. **Deep links for every entity** (`/social-projects/:id?tab=`, post, conversation, review token) so pushes, emails and shared links open the right screen.
