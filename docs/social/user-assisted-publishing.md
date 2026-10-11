# 180 Workspace: User-Assisted Social Publishing Architecture (X & Reddit)

## 1. Overview & Core Philosophy

In **180 Workspace**, social media publishing adheres to two distinct paradigms:
1. **API-Driven Publishing**: Platforms like Instagram, YouTube, LinkedIn, Facebook, and TikTok use official OAuth tokens, encrypted vaults (`SocialTokenVault`), and direct background API dispatch via `PublishDispatcher`.
2. **User-Assisted Publishing**: For **X (Twitter)** and **Reddit**, publishing is executed through a **redirection and preloaded handoff model** on mobile devices.

### Why User-Assisted Publishing?
- **Avoid Expensive / Restrictive API Tiers**: X and Reddit impose severe API costs and commercial developer application requirements for automated posting.
- **Full Creative & Review Control**: The creator reviews the final video, caption, hashtags, and subreddit selection within the official platform apps before submission.
- **Deterministic Hands, AI Brain**: AI scripts and renders the media, but 180 Workspace NEVER simulates user taps, manipulates accessibility APIs, or auto-clicks the final platform "Post" button.

---

## 2. Intent Design & Android Package Visibility

### Android 11+ Package Visibility (`AndroidManifest.xml`)
On modern Android (API 30+), external apps cannot be probed or launched without explicit `<queries>` declarations. In `apps/social-studio-mobile/android/app/src/main/AndroidManifest.xml`:
```xml
<queries>
    <package android:name="com.twitter.android" />
    <package android:name="com.reddit.frontpage" />
    <intent>
        <action android:name="android.intent.action.SEND" />
        <data android:mimeType="video/mp4" />
    </intent>
    <intent>
        <action android:name="android.intent.action.VIEW" />
        <data android:scheme="twitter" />
    </intent>
    <intent>
        <action android:name="android.intent.action.VIEW" />
        <data android:scheme="reddit" />
    </intent>
</queries>
```

### Media URI Security (`content://` vs `file://`)
- Raw `file://` URIs throw `FileUriExposedException` on Android 7.0+ (API 24+).
- All video files from Media Studio renders and local caches are shared via `FileProvider` (`content://...`) with `FLAG_GRANT_READ_URI_PERMISSION`.
- External applications receive temporary read access without exposing device filesystem directories (`/storage/emulated/...`).

---

## 3. Platform Intent Realities & Dual Handoff Strategy

Based on physical device testing across current versions of the X and Reddit Android applications:

| Platform | Video Attachment (`EXTRA_STREAM`) | Caption / Text (`EXTRA_TEXT`) | Known Receiving Behavior | 180 Workspace Dual Handoff Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **X** (`com.twitter.android`) | Reliable (`video/mp4`) | Inconsistent when video is attached | Many X versions drop `EXTRA_TEXT` when a media stream is passed. | **Dual Handoff**: Video is attached via Intent + caption is copied to clipboard (`ClipboardAssistService`) + toast instructions: *"Video attached. Caption copied — paste in X."* |
| **X Web** | Not supported via intent | Reliable | Web intent handles text/URLs, not raw local video uploads. | Open `https://x.com/intent/post?text=...` with prefilled text + prompt user to attach video. |
| **Reddit** (`com.reddit.frontpage`) | Reliable (Media composer) | Ignored when video stream is attached | Reddit composer has distinct fields: Subreddit, Title, and Body. Does not parse `EXTRA_TEXT` into Title. | **Assisted Handoff**: Subreddit selector -> Copy Title & Body to Clipboard -> Launch Reddit composer with video -> prompt user to paste title. |
| **Reddit Web** | Not supported for local video | Reliable | Can prefill Subreddit and Title in submission URL. | Open `https://www.reddit.com/r/{subreddit}/submit?title=...`. |

---

## 4. Honest State Machine & Post Confirmation

180 Workspace NEVER reports a post as `PUBLISHED` without verifiable confirmation.
User-assisted publishing introduces truthful lifecycle states:

```
[READY] ──> [PREPARING] ──> [HANDED_OFF_TO_PLATFORM] ──> User reviews in native app
                                                              │
                                     ┌────────────────────────┴────────────────────────┐
                                     ▼                                                 ▼
                       [USER_CONFIRMED] (User posted)                  [USER_CANCELLED] (User cancelled)
```

### Return-to-App Confirmation Dialog
When the user switches back from X or Reddit to 180 Workspace:
- The app lifecycle listener (`didChangeAppLifecycleState`) detects the resume event.
- `PostPublishReturnDialog` appears: *"Did you publish on [Platform]?"*
  - **[Yes, I posted]**: Updates status to `USER_CONFIRMED` via `POST /api/v1/social-media/posts/:id/assisted-status`.
  - **[Not yet]**: Leaves post in `READY_TO_PUBLISH`.
  - **[Cancel]**: Marks as `USER_CANCELLED`.
- Clear disclosure: *"This is based on your confirmation; 180 Workspace cannot independently verify external posts."*

---

## 5. Absolute Rule: No UI Automation / Auto-Clicking

180 Workspace strictly forbids:
1. Simulating accessibility taps or key events to press the platform's "Post" button.
2. Scraping or injecting clicks into external app UIs.
3. Using private or undocumented reverse-engineered endpoints.
4. Bypassing Reddit or X developer policies.

The creator retains 100% final authorization by pressing "Post" themselves in the official platform client.
