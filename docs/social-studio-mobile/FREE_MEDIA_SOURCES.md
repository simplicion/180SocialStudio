# Free media sources and on-device AI tools

The AI Director never generates pixels. It chooses operations (cut, reframe, zoom, add B-roll or
music), and deterministic engines execute them. This page lists the free media it can source and
the free on-device analysis it can use.

Code: `packages/video-engine-runtime/src/tools/sourcing/free-media-providers.ts` (providers,
licence filter, ranking), wired through `StockDecisionBroker.searchFreeMedia`,
`BgmSearchTool.searchTracks` and the backend resolvers in
`apps/backend/src/api/v1/workspace-tools/video-studio/video-studio.service.ts`.

## Licence rules (commercial use)

- Allowed: **CC0**, **public domain** (PD Mark), **CC BY**, **CC BY-SA**, and the Unsplash licence for Unsplash photos.
- Always dropped: any **NC** (non-commercial) or **ND** (no derivatives) licence, GFDL-only, non-free/fair-use files, unknown licences.
- An attribution line is kept for every item, even CC0. CC BY / BY-SA and Unsplash items are marked `creditRequired`.
- **CC BY-SA caution:** an edited video that includes a BY-SA clip may itself have to be shared under BY-SA. BY-SA ranks last so it is only used when nothing better matches.
- Ranking (`scoreFreeMedia`): licence (CC0 > PD = Unsplash > CC BY > CC BY-SA), orientation fit (portrait for 9:16), duration fit, resolution. Internet Archive gets a small penalty because its licences are uploader-asserted.

## Providers

| Provider | Media | Licence rules applied | Key | Rate limit (per provider docs) | Commercial use | Used in |
|---|---|---|---|---|---|---|
| Openverse API | images, music, SFX | `license_type=commercial,modification` (CC0, PDM, BY, BY-SA) + code filter | none | anonymous requests are throttled (burst and daily caps); register a free app for more | yes, per item licence | `/stock/search`, `/stock/unified` (photos, SFX), `/stock/music`, director music + SFX (when no Freesound key) |
| Wikimedia Commons API | video, audio, images | extmetadata `License`/`LicenseUrl`; `NonFree` files skipped; CC0/PD/BY/BY-SA only | none (descriptive User-Agent required) | no hard cap; keep requests serial and polite | yes, per item licence | `/stock/search`, `/stock/unified`, `/stock/music`, director B-roll + music |
| Internet Archive (advancedsearch + metadata) | video, audio | search restricted to publicdomain/creativecommons, NC/ND excluded in query and code | none | no published cap; be polite | yes, but licences are uploader-asserted (verify before paid campaigns) | `/stock/search`, `/stock/unified`, `/stock/music`, director B-roll + music |
| Jamendo API | music (mood/tempo/genre filters) | only tracks whose CC licence has no NC/ND | `JAMENDO_CLIENT_ID` (free) **and** `JAMENDO_ALLOW=true` | 35,000 requests/month on the free tier | tracks yes (CC BY/BY-SA); **the free API tier itself is for non-commercial apps** | `/stock/music`, `/stock/unified`, director music (only when both env vars are set) |
| Unsplash API | photos | Unsplash licence; guidelines followed: hotlink `urls.*`, report use via `download_location` (`POST /media-editor/stock/unsplash/track-download`), credit "Photo by X on Unsplash" with UTM links | `UNSPLASH_ACCESS_KEY` (optional `UNSPLASH_APP_NAME` for UTM) | 50/hour (demo), 5,000/hour (production approval) | yes | `/stock/search`, `/stock/unified` photos |
| NASA Media API | video, audio, images | 100% US Government Public Domain work | none | generous public usage; no key required | yes | `/stock/search`, `/stock/unified`, director B-roll, space/tech cutaways, mission audio |
| Free Music Archive | - | - | - | - | **skipped: its public API was discontinued** | - |
| ccMixter (Query API 2.0) | music | `lic=by` requested + `normalizeLicense` re-check (CC BY / PD only; NC, ND, Sampling+ dropped) | none | no published cap; be polite | yes, per track (credit line added) | `/stock/music`, `/stock/unified`, director music (via BgmSearchTool) — uses `f=js` because `f=json` duplicates the body into a ~40 KB `X-JSON` header that overflows Node's header limit |
| Microsoft Fluent Emoji (3D) | stickers (transparent PNG) | MIT (credit "Fluent Emoji … by Microsoft (MIT)") | none (optional `GITHUB_TOKEN` only raises GitHub's limit) | index: 1 GitHub tree call per day (cached); files from the jsDelivr CDN | yes | `/stock/stickers`, Stickers sheet "3D stickers", director `addSticker` style `3d` |
| Coverr | video | royalty-free, **logo credit required** | `COVERR_API_KEY` | 50 req/h demo; production needs a paid plan | yes | **not integrated** (paid production tier, mandatory logo, auth not documented publicly) |
| GIPHY | GIF / stickers | GIPHY terms | key | - | **no: the free API is personal / non-commercial** | not integrated |
| Tenor | GIF / stickers | - | - | - | **API shut down 30 June 2026** | not integrated |
| Noto animated emoji / LottieFiles | animated stickers | CC BY 4.0 / Lottie Simple License | none | - | yes | **not yet**: the export renders still images only (needs an animated-layer renderer) |

Existing keyed providers are unchanged: Pexels (`PEXELS_API_KEY`), Pixabay (`PIXABAY_API_KEY`), Freesound (`FREESOUND_API_KEY`).

A provider whose key is missing is skipped with a warning (never an error). `FREE_MEDIA_PROVIDERS`
(comma list such as `openverse,wikimedia`, or `none`) limits which providers run. Every provider call
has a timeout (6 s default; the director uses shorter ones inside its stock budget).

### Jamendo licensing caveat
Jamendo tracks are Creative Commons, but Jamendo's free API terms cover non-commercial applications.
Before setting `JAMENDO_ALLOW=true` for this commercial product, confirm Jamendo's current API terms or
get a commercial licence (Jamendo Licensing). Without it the provider stays off.

## Credits flow

- Director: resolved B-roll/music add a `warnings` line ("Credit required when publishing: ...") when the licence requires it, and every placed stock item is listed in the result's `credits` (`{kind, url, attribution, license, sourcePage, provider}`).
- Mobile: `StudioController.mediaCredits` (by URL) collects credits from director results, manual music/B-roll picks and export-time resolution; the export sheet lists every credit of media actually used, with a copy button.

## On-device AI tools (Android, free, no server tokens)

| Tool | Engine | Output | Used for |
|---|---|---|---|
| `detectFaces(sourcePath, sampleEveryMs=500)` | Google ML Kit face detection, bundled model (`com.google.mlkit:face-detection:16.1.7`) | per-sample face-centre boxes `{tMs, x, y, w, h}` (0..1, display orientation), max 240 frames | smart reframe: `TimelineOps.initial/setAspect` crop follows the dominant face (median, clamped 0.1..0.9); sent as `media.faces` to `/ai-direct`, where reframe crops and FACE zooms centre on it |
| `detectBeats(audioPath)` | energy flux + adaptive threshold on decoded PCM (`BeatDetector`) | `{beatsMs, bpm}` | sent as `media.beatsMs`; the director exposes it as the graph's beat track (tempo-aware planning) |

APK size: the bundled face model adds about 2.5 MB of models plus a native library of about 8.5 MB
(arm64, uncompressed; about 5 MB for armeabi-v7a). With an App Bundle or `--split-per-abi` a device
downloads roughly 4-5 MB extra; a universal (fat) APK grows by about 15 MB compressed because it
carries all four ABIs. If that is too much, switch to the unbundled
`com.google.android.gms:play-services-mlkit-face-detection` (model delivered by Google Play
services, under 1 MB in the APK); the Kotlin code is the same.

## Tests

- `packages/video-engine-runtime/src/tests/free-media-providers.test.ts`: normalizers on recorded
  fixtures (`src/tests/fixtures/free-media/`), licence filtering, ranking, provider gating. No
  network by default; `LIVE_MEDIA_TESTS=1` runs live calls.
- `packages/domains/ai/tests/video-director.test.ts`: face-centred reframe/zoom and credit flow.
- Flutter: `test/native_engine_test.dart` (detectFaces/detectBeats channel), `test/timeline_ops_test.dart` (face-centred crop).

## Downloading online media (2026-10-03)
- **One shared cache** (`lib/core/media/asset_cache.dart`) for stock B-roll, photos, stickers, music, SFX and logos:
  - content-addressed (`asset_cache/<sha1(url)>.<ext>`) and reused by preview, export and later edits;
  - trimmed least-recently-used above 3 GB.
- **Safe downloads:**
  - written to `.part`, resumed with HTTP Range after a drop, retried on 429 / 5xx with backoff;
  - checked before use: an HTML error page or empty file is rejected with a reason;
  - at most 3 at once; one download per URL even when requested many times.
- **Manual search:** every result tile shows a download badge (cloud → progress ring → tick). An asset is added to the
  timeline only after its download completes, so the export never has to fetch it.
- **AI Director:** right after a turn, search phrases (B-roll, music, 3D stickers) are resolved and everything online
  is downloaded with an on-screen "Downloading media n/m" banner, with Retry / Continue without.
  Export runs the same step first, so nothing is silently missing.
- The timeline keeps the real https URL (credits and the server contract are unchanged); the cache is transparent.

