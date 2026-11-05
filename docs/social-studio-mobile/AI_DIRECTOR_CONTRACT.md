# AI Director contract (mobile)

Status: **v1** (implemented + tested, 2026-09-25). The server implementation lives in
`apps/backend/src/api/v1/media-editor/` and `packages/video-contracts/src/mobile-edit-ir.ts`.
The Zod schemas in `packages/video-contracts/src/ai-director-api.schema.ts` and
`packages/video-contracts/src/mobile-edit-ir.ts` are the source of truth. If this doc and those
schemas disagree, the schemas win. Please report the mismatch.

Media never leaves the device. The phone analyses its own clip, which means:
- duration, size and fps
- optionally a transcript, either on-device or from the `/transcribe` endpoint below
- optionally silences

It sends that analysis plus the user's command. The server returns a **timeline** (`editIR`) that
the Android Media3 renderer plays or exports locally.

All times in the mobile contract are **integer milliseconds**.

---

## 0. Auth and headers

Both endpoints are mounted behind `protect` (user auth) and `moduleGuard('media-editor')`.
They also require a registered native device token.

| Header | Value |
|---|---|
| `Authorization` | `Bearer <access token>` |
| `x-device-token` | native device token from device registration (owned by the auth/device engineer) |
| `Content-Type` | `application/json` (`/ai-direct`) or `multipart/form-data` (`/transcribe`) |

Base path: `/api/v1/media-editor` (`/api/media-editor` is an alias).

The `/stock/*` search routes (`/stock/search`, `/stock/unified`, `/stock/music`) need only
`Authorization` (`protect` + `moduleGuard('media-editor')` on the router mount). They do not need
the device token.

---

## 1. `POST /api/v1/media-editor/transcribe`

Word-level speech-to-text for a clip's **audio only**. Extract the audio on-device (AAC/m4a or
PCM wav) and upload it.

Request: `multipart/form-data`
| field | type | required | notes |
|---|---|---|---|
| `audio` | file | yes | `audio/mp4`, `audio/m4a`, `audio/x-m4a`, `audio/aac`, `audio/wav`, `audio/x-wav`, `audio/mpeg`, `audio/webm`, `audio/ogg`. Max **25 MB**. |
| `language` | string | no | ISO-639-1 code, or `auto` (default) to detect the spoken language |

200 response:
```json
{
  "success": true,
  "data": {
    "language": "en",
    "durationMs": 21480,
    "text": "so here's the thing about the gym ...",
    "words": [
      { "text": "so", "startMs": 320, "endMs": 480 },
      { "text": "here's", "startMs": 480, "endMs": 760 }
    ]
  }
}
```
Errors (`success:false`, `error` code, `message`):
| status | error | meaning |
|---|---|---|
| 400 | `AUDIO_FILE_REQUIRED` | no `audio` part |
| 413 | `AUDIO_TOO_LARGE` | over 25 MB |
| 415 | `UNSUPPORTED_AUDIO_TYPE` | mime type not in the list |
| 502 | `TRANSCRIPTION_FAILED` | the STT provider failed, or returned no word timings (the server never invents timings) |
| 503 | `TRANSCRIPTION_UNAVAILABLE` | `CARTESIA_API_KEY` is not configured on the server |

`data.language` is the ISO-639-1 code of the language that was spoken (detected when the request sent `auto`
or nothing); `und` when the provider could not name it.

Pass `data.words` straight into `media.transcript.words` of `/ai-direct`.

---

## 1b. `POST /api/v1/media-editor/captions/translate`

Caption text in another language, or the same language in Roman letters (Hindi → Hinglish). Words only: the
client keeps every caption's time range and spreads the new words over it.

Request: `application/json`
| field | type | required | notes |
|---|---|---|---|
| `captions` | `[{ id, text }]` | yes | 1–400 captions, text up to 300 characters |
| `targetLanguage` | string | yes | ISO-639-1 code from the supported list (`CAPTION_TARGET_LANGUAGES`) |
| `script` | string | no | `native` (default) or `roman` (Latin letters) |

200 response: `{ "success": true, "data": { "targetLanguage": "hi", "script": "roman", "captions": [{ "id": "cap_1", "text": "aaj hum baat karenge" }] } }`
— the same ids, one line per caption.

Errors: 400 `INVALID_REQUEST`, 401 `UNAUTHENTICATED`, 503 `AI_NOT_CONFIGURED` (no AI provider key),
502 `TRANSLATION_FAILED` (the provider failed or its answer did not line up one-to-one; nothing is invented).

---

## 2. `POST /api/v1/media-editor/ai-direct`

### 2.1 Request (mobile form)

```json
{
  "prompt": "remove the pauses and add yellow captions",
  "history": [
    { "role": "user", "content": "make it punchier for TikTok" },
    { "role": "assistant", "content": "Cut 4 pauses (2.1s) and reframed to 9:16." }
  ],
  "projectId": "optional-client-project-id",
  "media": {
    "assetId": "optional-stable-id-of-the-clip",
    "durationMs": 21480,
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "transcript": { "words": [ { "text": "so", "startMs": 320, "endMs": 480 } ] },
    "silences": [ { "startMs": 0, "endMs": 320 } ]
  },
  "currentEditIR": null
}
```

| field | type | required | notes |
|---|---|---|---|
| `prompt` | string, 1..2000 chars | yes | the natural-language command |
| `history` | `{role:"user"\|"assistant", content:string}[]`, max 20 | no | earlier turns, oldest first. The server uses only the last 12. |
| `projectId` | string | no | echoed back as `editIR.projectId` |
| `media.durationMs` | int > 0 | yes | duration of the **source** clip |
| `media.width` / `media.height` | int > 0 | yes | **display** size of the source, after applying rotation metadata |
| `media.fps` | number | no | default 30 |
| `media.assetId` | string | no | default `"primary"`. Echoed back in `clips[].assetId`. |
| `media.transcript.words` | `{text,startMs,endMs}[]` | no | **source-clip** time. Without it, captions/filler removal/pause removal are unavailable. The response says so in `warnings`. |
| `media.silences` | `{startMs,endMs}[]` | no | source time. If omitted but a transcript is present, the server derives silences from gaps of ≥ 500 ms between words, plus leading and trailing silence. |
| `currentEditIR` | `MobileEditIR` \| `null` | no | The current timeline: the `editIR` from the previous response, **including any manual edits** the user made since. Edits accumulate. `null` or omitted means start from the raw clip. See §3.8 for which fields the server keeps. |

Rule of thumb: always send the **original source** `media` analysis, even on turn 5. The server
maps source times onto the current (already cut) timeline itself.

The web editor's legacy form (`telemetry`, `currentEditIR` as rational-time EditIR,
`availableAssets`, `stylePreset`, …) is still accepted. `media` selects the mobile path.

### 2.2 Response

```json
{
  "success": true,
  "data": {
    "plannerSource": "llm",
    "plannerReason": "claude/claude-sonnet-5 tool-calling plan (1 attempt)",
    "summary": "Removed 4 pauses (2.3s total) and added yellow word-by-word captions.",
    "reply": "…same as summary, conversational…",
    "operations": [
      { "type": "removeSilences", "minDurationSec": 0.5, "reason": "user asked to remove pauses" },
      { "type": "autoCaptions", "highlightColor": "#FFE600", "textColor": "#FFFFFF", "wordsPerCaption": 3 }
    ],
    "appliedOperations": ["Removed range 0.0s - 0.3s: leading silence", "…"],
    "rejectedOperations": [],
    "warnings": [],
    "requiresConfirmation": false,
    "editIR": { "schemaVersion": "mobile-editir/1", "...": "see §3" },
    "ast": { "version": "1.0.0", "...": "canonical rational-time EditIR (web editor); mobile may ignore" }
  }
}
```

| field | meaning |
|---|---|
| `plannerSource` | `"llm"`: a language model produced the operations through tool calls. `"deterministic"`: the server's keyword/heuristic planner produced them. **Never hidden.** Show a small badge for `"deterministic"`. |
| `plannerReason` | why. Examples: `"no LLM key configured for this workspace"`, `"LLM call failed: 401 …"`, `"LLM output failed validation after 1 repair attempt"`, or the model id used |
| `summary` | one to three human sentences describing what changed. Show it in the chat. |
| `operations` | the validated high-level operations, in the order the model returned them. Use them for undo labels and analytics. |
| `appliedOperations` / `rejectedOperations` | human strings from the compiler. A rejected op did **not** change the timeline. |
| `warnings` | non-fatal problems, e.g. `"no transcript supplied — captions skipped"` or `"b-roll 'gym' needs a stock URL (PEXELS not configured)"` |
| `requiresConfirmation` | `true` when the planner wants the user to confirm before applying. The timeline is still returned, so the client may preview it and apply on confirm. |
| `editIR` | the full new timeline (§3). **Replace** your local timeline with it. It is not a diff. |

Errors: `400 INVALID_REQUEST` (with `issues` from Zod), `500` (`error` message). A failure never
returns `success:true` with an unchanged timeline pretending to be an edit.

Latency: an LLM turn is typically 4–20 s. Each LLM call has a server timeout of `AI_DIRECTOR_LLM_TIMEOUT_MS`
(default 60000 ms). On timeout the turn falls back to the deterministic planner with
`plannerReason` starting `LLM_TIMEOUT:` and a warning that the offline rule-based director made the edit.
Use a client timeout of at least **90 s** (the web Studio uses 90 s).

---

## 3. `MobileEditIR` (`schemaVersion: "mobile-editir/1"`)

The renderer must support **exactly** this subset. Anything not listed here is never emitted in
`mobile-editir/1`.

```json
{
  "schemaVersion": "mobile-editir/1",
  "projectId": "p_123",
  "canvas": { "aspect": "9:16", "width": 1080, "height": 1920, "fps": 30, "background": "#000000" },
  "durationMs": 19180,
  "sources": [ { "assetId": "primary", "durationMs": 21480, "width": 1920, "height": 1080 } ],
  "clips": [
    {
      "id": "c1", "assetId": "primary",
      "sourceStartMs": 320, "sourceEndMs": 5100,
      "timelineStartMs": 0, "timelineEndMs": 4780,
      "speed": 1.0,
      "volumeDb": 0,
      "crop": { "x": 0.3417, "y": 0, "width": 0.3164, "height": 1 },
      "filter": null,
      "transitionIn": null,
      "rotationDeg": 90,
      "flipH": true
    }
  ],
  "overlays": [
    {
      "id": "b1", "kind": "broll",
      "timelineStartMs": 5000, "timelineEndMs": 8000,
      "sourceStartMs": 0,
      "source": { "kind": "url", "url": "https://videos.pexels.com/…mp4", "query": "gym" },
      "fit": "cover", "opacity": 1, "muted": true
    }
  ],
  "captions": [
    {
      "id": "t1", "kind": "caption",
      "startMs": 0, "endMs": 1180,
      "text": "so here's the",
      "words": [ { "text": "so", "startMs": 0, "endMs": 160, "highlight": true, "color": "#FFE600", "scale": 1.0 } ],
      "style": {
        "preset": "HORMOZI_BOUNCE", "animation": "word_pop",
        "fontFamily": "Inter", "fontWeight": 800, "fontSizePx": 72,
        "textColor": "#FFFFFF", "highlightColor": "#FFE600",
        "strokeColor": "#000000", "strokeWidthPx": 6,
        "shadow": true, "background": null,
        "uppercase": false,
        "positionX": 0.5, "positionY": 0.72, "maxWidthFraction": 0.86
      }
    }
  ],
  "zooms": [
    { "id": "z1", "startMs": 9000, "endMs": 10400, "scale": 1.3, "centerX": 0.5, "centerY": 0.38, "rampMs": 250 }
  ],
  "audio": {
    "originalTrack": { "volumeDb": 0 },
    "music": [
      {
        "id": "m1", "timelineStartMs": 0, "timelineEndMs": 19180, "sourceStartMs": 0,
        "source": { "kind": "url", "url": "https://upload.wikimedia.org/…/Cheery_Monday_by_Kevin_MacLeod.ogg.mp3", "query": "upbeat energetic" },
        "volumeDb": -16, "fadeInMs": 500, "fadeOutMs": 1000,
        "duck": { "enabled": true, "duckDb": -12, "attackMs": 120, "releaseMs": 350 }
      }
    ],
    "speechRangesMs": [ [0, 4780], [4900, 9100] ]
  }
}
```

### 3.1 Canvas
- `canvas.width × canvas.height` is the export resolution. `aspect` is one of `16:9`, `9:16`, `1:1`, `4:5`.
- `background` is the fill colour for letterbox areas. Letterboxing only happens if crop is null and the aspect ratios differ.
- `width` and `height` must be even (H.264). `fps` (1..120, default 30) caps the output frame rate: faster or variable-frame-rate sources have frames dropped down to it. Slower sources are not padded.

### 3.2 Main track: `clips[]` (cuts, ripple deletes, order, speed)
- The array is sorted by `timelineStartMs`. The clips are **contiguous**: `clips[i].timelineEndMs == clips[i+1].timelineStartMs`. The first clip starts at 0, and `durationMs == last.timelineEndMs`.
- A cut or ripple delete is expressed **only** by the clip list. The removed source ranges simply do not appear. There is no separate "delete" instruction for the renderer.
- Clip order is array order. A clip may reference any source range in any order.
- `speed` is a playback multiplier, **0.25..4** inclusive (the schema rejects anything else). Invariant: `timelineEndMs - timelineStartMs == round((sourceEndMs - sourceStartMs) / speed)`, ±1 ms. Keep audio pitch (Media3 `SpeedChangeEffect` or `SonicAudioProcessor` with pitch 1.0).
- `rotationDeg` (optional, `0|90|180|270`, default `0`) rotates the source clockwise. `flipH` (optional, default `false`) mirrors it horizontally. Both are applied to the source **before** `crop`, so with 90/270 the crop is in the rotated (swapped width/height) frame. The server omits both when they are the default. Any other rotation value is invalid.
- `volumeDb` is the gain of the clip's own audio. `-60` or lower means mute.
- `crop`: normalized rect in **source** display coordinates, after `rotationDeg`/`flipH` (0..1, origin top-left). Take that rect from the source and scale it to fill the canvas. When `crop` is null, **fit** the source (contain) on `canvas.background`. When the server has to compute a crop (new clip, or the canvas or rotation changed) it computes a fill crop whenever the source aspect ≠ canvas aspect. This is how "reframe to vertical" is expressed. A crop the client sent is kept as is (§3.8).
  - Media3 `Crop(left,right,bottom,top)` uses NDC: `left = 2x-1`, `right = 2(x+width)-1`, `top = 1-2y`, `bottom = 1-2(y+height)`.
- `rotationDeg` (optional, default `0`): `0`, `90`, `180` or `270`, clockwise. `flipH` (optional, default `false`): mirror left-right. Both apply to the source picture **before** `crop`, so a crop rect is in the rotated/flipped picture's coordinates. Rotation happens first, then the flip.
- `filter`: `null` or `{ "preset": "NOIR_BW"|"VIVID"|"CINEMATIC_TEAL_ORANGE"|"VINTAGE_WARM"|"CYBER_NEON"|"GLOW"|"NORMAL", "brightness": 1.0, "contrast": 1.0, "saturation": 1.0 }`. The multipliers are relative (1.0 = unchanged). A renderer that only supports the three multipliers may ignore `preset`.
- `transitionIn`: `null` or `{ "type": "CROSSFADE"|"DISSOLVE"|"CUT", "durationMs": 300 }`. It applies between `clips[i-1]` and `clips[i]`. It is centred on the boundary and does **not** change durations: overlap by `durationMs/2` on each side, holding the edge frame if the source runs out. Treat unknown types as `CROSSFADE`. It is never set on `clips[0]`.

### 3.3 Overlays: `overlays[]` (B-roll)
- `kind` is always `"broll"` in v1. Draw it above the main track, full-canvas `cover`-fit (scale to fill, centre crop), for `[timelineStartMs, timelineEndMs)`. Play the source from `sourceStartMs`. If the source is shorter, hold its last frame.
- `muted` is always `true` in v1. The main-track audio continues underneath.
- `source.kind`:
  - `"url"`: an HTTPS video URL, currently Pexels. Download or cache it before export.
  - `"asset"`: `{ "kind":"asset", "assetId": "…" }`, a clip the user already has on the device.
  - `"stock_query"`: `{ "kind":"stock_query", "query":"gym", "url": null }`. The server could not resolve a URL. The client should resolve it through `GET /api/v1/media-editor/stock/search?query=gym&type=videos&orientation=portrait` and use the first result. If that also fails, skip the overlay and tell the user.

### 3.4 Text: `captions[]` (captions, kinetic word captions, titles)
- `kind`: `"caption"` is speech-synced with per-word timing. `"text"` is a title or lower-third, and its `words` holds a single entry spanning the whole item.
- Visible during `[startMs, endMs)`, timeline time. Word times are timeline time too and lie within the caption.
- Layout: `positionX/positionY` is the **centre** of the text block as a fraction of the canvas. Wrap at `maxWidthFraction × canvas.width`. `fontSizePx` is in canvas pixels, so scale it if you preview at a smaller size. Apply `uppercase` before layout.
- `stroke*` draws an outline around the glyphs. `shadow: true` means a 0,4px 12px `#000000A0` drop shadow. `background` is `null` or `{ "color": "#000000B3", "paddingPx": 16, "radiusPx": 16 }`, a rounded pill behind the whole block.
- `animation`:
  - `"none"`: static text.
  - `"word_pop"`: all words are visible for the caption's duration. The active word, `startMs ≤ t < endMs`, is drawn in its `color` (default `highlightColor`) and scaled by `scale`, with a 120 ms ease-out pop from 1.0. Inactive words use `textColor`, except words with `highlight:true`, which keep their `color` all the time.
  - `"karaoke"`: like `word_pop`, but no scale, and words already spoken stay in `highlightColor`.
- Font: captions the server creates use `Inter`, so bundle Inter 400/600/800. A `fontFamily` (and `maxWidthFraction`, `preset`) set by the client is kept as is (§3.8).

### 3.5 Camera: `zooms[]` (punch-ins)
- For `[startMs, endMs)`, scale the **composited main track** by `scale`, around the canvas-normalized point (`centerX`, `centerY`), clamped so no background shows. Overlays and captions are not zoomed.
- Envelope: ease-out from 1.0 to `scale` over `rampMs`, hold, then ease-in back to 1.0 over the last `rampMs`. Zooms never overlap.

### 3.6 Audio
- `originalTrack.volumeDb` is the gain applied to all main-track clip audio, on top of each clip's own `volumeDb`.
- `music[]` (0 or 1 item in v1) is background music:
  - `source.kind`: `"url"` (HTTPS audio, with the mood `query` it was found for when the server resolved it) or `"stock_query"` (`{query, url:null}`).
  - **Resolution:** the server resolves a music `stock_query` inside `/ai-direct`, the same way as B-roll. The mood keywords are mapped to a genre (upbeat/energetic → electronic upbeat, chill/lofi → lo-fi, epic/cinematic → cinematic, acoustic/warm → acoustic, calm/ambient/piano or a generic "background music" → ambient). The server then picks a track from its royalty-free catalogue, preferring one at least as long as the timeline. So `editIR` normally arrives with `kind:"url"`. Catalogue tracks are Kevin MacLeod (incompetech.com) recordings hosted on Wikimedia Commons as HTTPS MP3. They are **CC BY 3.0/4.0**, which means the published video needs the credit line. The server puts that line in `warnings` (`music "…": using "Title". Credit required when publishing: …`), and `GET /stock/music` returns it as `attribution`.
  - When no track fits (a mood the catalogue does not cover, e.g. "heavy metal", or the lookup failed), `source` stays `"stock_query"` and `warnings` contains `music "<query>" needs a track URL …`. The client then calls `GET /api/v1/media-editor/stock/music?query=<query>` and uses the first result, or skips the music and tells the user.
  - A `"url"` source the client sent is never replaced.
  - The track loops if it is shorter than `timelineEndMs - timelineStartMs`. Apply `fadeInMs` and `fadeOutMs`, then `volumeDb`.
  - **Ducking**: when `duck.enabled`, whenever the playhead is inside any `speechRangesMs` interval, reduce music by an **additional** `duckDb` (a negative number). Ramp down over `attackMs` before the interval starts and back up over `releaseMs` after it ends. `speechRangesMs` is timeline time, sorted, non-overlapping, computed server-side from the transcript. If there is no transcript it is `[]` and there is no ducking. Don't run your own VAD.
- dB → linear gain: `10^(dB/20)`.
- `speechRangesMs` is recomputed every turn for the **edited** timeline. Each source word is intersected with every clip that plays it, so reordered, duplicated, sped-up and partly cut clips are all handled. Clips at `volumeDb ≤ -60` are skipped. When `originalTrack.volumeDb ≤ -60`, the list is `[]`.

#### `GET /api/v1/media-editor/stock/music`
Royalty-free music search for the phone. It returns metadata and HTTPS URLs only. Nothing is downloaded or processed on the server.

| query param | notes |
|---|---|
| `query` | required, 1..120 chars, mood/genre keywords (`upbeat energetic`) |
| `limit` | optional, default 10, max 30 |
| `minDurationSec` | optional. Tracks at least this long come first. |

```json
{
  "success": true,
  "query": "upbeat energetic",
  "genre": "ELECTRONIC_UPBEAT",
  "genreMatched": true,
  "providers": ["catalog"],
  "warnings": [],
  "tracks": [
    {
      "title": "Cheery Monday",
      "url": "https://upload.wikimedia.org/wikipedia/commons/transcoded/7/7d/Cheery_Monday_by_Kevin_MacLeod.ogg/Cheery_Monday_by_Kevin_MacLeod.ogg.mp3",
      "durationSec": 80,
      "license": "CC-BY-4.0",
      "attribution": "\"Cheery Monday\" by Kevin MacLeod (incompetech.com), licensed under CC BY 4.0",
      "artist": "Kevin MacLeod",
      "genre": "ELECTRONIC_UPBEAT",
      "provider": "catalog",
      "sourcePage": "https://commons.wikimedia.org/wiki/File:Cheery_Monday_by_Kevin_MacLeod.ogg"
    }
  ]
}
```
- The curated catalogue is always searched. When the server has `FREESOUND_API_KEY`, Freesound results are added after the catalogue, restricted to CC0 / CC BY, 30 s–15 min, with HTTPS MP3 previews, and `providers` includes `"freesound"`. Without the key, Freesound is skipped and `providers` shows it.
- No match returns `tracks: []`, with the reason in `warnings`. `400 QUERY_REQUIRED` / `QUERY_TOO_LONG`. `500 MUSIC_SEARCH_FAILED`.
- `GET /stock/unified?type=audio` (or `music`) now searches music too, and no longer queries the video/photo providers for audio-only types. `unifiedAudio` holds `{kind:"music", …track}` and `{kind:"sfx", title, url, durationSec}` entries.

#### `audio.sfx[]` (optional, added 2026-09-26)
One-shot sound effects on their own lane. **Optional**: the field is omitted when there are none, so older
clients (which ignore unknown fields) keep working; a client that renders it must also send it back in
`currentEditIR` so it round-trips.
```json
"sfx": [
  { "id": "sfx_4120_0", "timelineStartMs": 4120, "durationMs": 800,
    "source": { "kind": "url", "url": "https://cdn.freesound.org/previews/…/whoosh.mp3" },
    "volumeDb": -12, "credit": "\"Whoosh\" by A (CC BY 4.0)" }
]
```
- `timelineStartMs` is edited-timeline time; `durationMs` (optional) is how long to play from the start of the
  file (absent = the whole file). `volumeDb` is the effect's gain; SFX are **not** ducked.
- `credit` (optional) must be shown with the published video (CC BY). The same item is in `credits[]` with `kind:"sfx"`.
- The director places SFX on the **greet** proposal when an SFX search is available (Freesound with
  `FREESOUND_API_KEY`, else Openverse CC0/CC BY): up to 4 effects at the proposal's transitions (B-roll starts,
  then joins between main clips), 80 ms early so the whoosh lands on the cut. Cuts in later turns move each effect
  with the footage under it; an effect whose position is cut away is dropped.
- Only HTTPS files are emitted. Synthetic desktop SFX (`synthetic://…`) are dropped with a warning.
- Renderer: mix each effect into the output at `timelineStartMs` with `volumeDb`, on top of the original audio and
  music. (Android support: pending in the mobile engine.)

### 3.7 Things v1 never emits
Picture-in-picture, stickers, image overlays, J/L-cuts, freeze frames, synthetic SFX, colour
wheels/curves, keyframes. The canonical `ast` may contain some of these for the web editor. The
mobile `editIR` projection drops them and adds a `warnings` entry when that happens.


### 3.8 Round trip of client edits
Everything the client sends in `currentEditIR` is kept unless an operation in **this** turn changes it on purpose. Specifically:
- Clip `crop` (including `null` = fit), `rotationDeg`, `flipH`, `volumeDb`, `filter`, and `transitionIn`.
- `canvas.background`, `canvas.fps` (non-integer rates such as 29.97 included), and `sources`.
- `audio.originalTrack.volumeDb`, the music `source` (URL and `query`), `volumeDb`, fades, and the full `duck` object (also when `enabled:false`).
- Caption `fontFamily`, `maxWidthFraction`, and any `preset` name.
- Zoom `rampMs`, and overlay sources.

Which operations change what:
- `reframeSubject` / `changeAspectRatio` (mode `fill`) recompute every clip's crop for the new canvas.
- `changeAspectRatio` mode `fit` sets all crops to `null` and may set `canvas.background`.
- `rotateClip` recomputes the crop of a clip whose rotation changed, and mirrors it when only `flipH` changed.
- Cuts, trims, splits and reorders produce new clip ids for the pieces they create. Crop, rotation and filter carry over to those pieces.
- A clip `crop:null` counts as "fit" only when the oriented source aspect differs from the canvas. Otherwise it means "no crop needed".

---

## 4. Operations the director can produce

These are the `operations[].type` values. They are informational for the client, because the
renderer only consumes `editIR`. All times are **seconds on the timeline as it was before this
turn**.

| type | effect on `editIR` |
|---|---|
| `removeRange` `{startSec,durationSec,reason}` | ripple cut |
| `removeSilences` `{minDurationSec}` | ripple cuts for every silence ≥ min (needs silences or a transcript) |
| `cleanFillers` `{fillerTypes[]}` | ripple cuts for filler words (um, uh, …) found in the transcript |
| `autoCaptions` `{textColor,highlightColor,stylePreset,wordsPerCaption,position,uppercase,fontSize,animation}` | word-synced captions from the transcript |
| `addCaption` | a single caption with explicit words |
| `styleCaption` `{preset,highlightColor,position}` | restyles existing captions |
| `addText` `{text,timelineStartSec,durationSec,position,style}` | title or lower-third (`kind:"text"`) |
| `addZoom` `{startSec,durationSec,scale,targetCoords}` | zoom punch-in |
| `reframeSubject` `{targetAspect}` | canvas aspect plus a fill crop |
| `changeAspectRatio` `{targetAspect, mode?:"fill"\|"fit", background?, width?, height?}` | canvas aspect. `fill` (default) crops to fill. `fit` sets `crop:null` on every clip and letterboxes on `background`. The size defaults to the standard one for the aspect. |
| `changeSpeed` `{clipId:"all"\|id, speedMultiplier 0.25..4}` | speed |
| `splitClip` `{clipId, splitTimeSec}` | splits one clip into `<clipId>_1` and `<clipId>_2`. Nothing changes visually, but later ops can target one part. Speed-aware. |
| `rippleDelete` `{clipId}` | removes one clip and closes the gap (ripple) |
| `trimClip` `{clipId, startTrimSec, endTrimSec}` | removes seconds from a clip's head and/or tail (ripple). It is rejected if less than 0.1 s would remain. |
| `moveClip` `{clipId, targetTimelineStartSec}` | reorders a whole clip, inserting it at the nearest clip boundary to that point (0 = first, total duration = last). The duration is unchanged. Captions, zooms and overlays move with the footage they are on. The music bed does not move. |
| `reorderSegment` `{segmentStartSec, segmentDurationSec, newStartSec}` | the same for an arbitrary time range. Clips are split at the range edges. |
| `adjustVolume` `{trackId, volumeDb -60..12}` | `trackId:"original"` sets `audio.originalTrack.volumeDb`. `"music"` sets the music `volumeDb`. An exact audio track id is also accepted. An unknown id, or `"music"` with no music, is **rejected** and not reported as done. |
| `rotateClip` `{clipId:"all"\|id, rotationDeg?:0\|90\|180\|270, flipH?}` | sets clip `rotationDeg`/`flipH` (absolute values) and refits the crop. It is rejected when neither field is given. |
| `insertBroll` `{stockQuery\|sourceUrl\|assetId, timelineStartSec, durationSec}` | B-roll overlay |
| `addBackgroundMusic` `{query, sourceUrl?, volumeDb, duckUnderSpeech}` | music |
| `duckAudio` `{duckDb,attackMs,releaseMs}` | ducking on existing music |
| `applyFilter` `{preset,brightness,contrast,saturation}` | clip filter |
| `addTransition` `{transitionType,durationSec}` | transition at every cut boundary |

---

## 5. Behaviour notes the client can rely on

- **Planner:** the LLM (Claude `claude-sonnet-5` by default. Override with env `AI_DIRECTOR_CLAUDE_MODEL`, or use the workspace's configured OpenAI/Gemini key) calls one tool per operation (§4). Every call is Zod-validated. On invalid arguments the server makes exactly **one** repair call that includes the validation errors. If there is still no valid plan, no key, or a provider error, the deterministic keyword planner runs, and `plannerSource:"deterministic"` plus `plannerReason` say so.
- **Deterministic planner limits:** it understands pauses/silence, captions (with colour words), "cut the first/last N seconds", `Nx` speed, "b-roll of X at Ns", "add … music", vertical/TikTok/Reels reframing, zooms, filler words, and colour looks. It will not locate content semantically ("zoom on the punchline" becomes generic emphasis zooms).
- **Pause removal** keeps 100 ms of air next to words, including before the first word and after the last.
- **Honesty:** an operation that cannot apply (e.g. `duckAudio` with no music, `styleCaption` with no captions, captions with no transcript) lands in `rejectedOperations`/`warnings`, and the `summary` says how many changes could not be applied.
- **Stock B-roll:** resolved server-side through Pexels when the server has `PEXELS_API_KEY`. Otherwise `source.kind:"stock_query"` plus a warning (see §3.3).
- **Music:** resolved server-side from the royalty-free catalogue (§3.6), so it normally arrives as `kind:"url"`, with the CC BY credit line in `warnings`. It stays `stock_query` with a warning only when no track fits. A URL the client chose is never replaced.
- **Times in one turn:** all operation times refer to the timeline as it was before the turn. Cuts are applied first, then reorders, with their times mapped through the cuts, then speed changes, then transitions.

## 6. Tests

- `npx tsx --test packages/domains/ai/tests/video-director.test.ts`: 46 tests. They cover:
  - LLM tool-call planning with a mocked provider, the repair retry, repair exhaustion and unknown tools.
  - The labelled deterministic fallback (no key / provider error), conversational replies, and history in the prompt.
  - 13 realistic director commands against a 23 s talking-head transcript fixture, and multi-turn source→timeline mapping.
  - Manual-edit round trips: a conversational turn returns the client timeline byte-for-byte; crop, fit, rotation/flip, originalTrack, background, fps, caption font and zoom ramp all survive an edit.
  - Music resolution (mocked resolver, no match, resolver failure, catalogue), and the split/rippleDelete/trim/move/reorder/aspect-fit/adjustVolume/rotate tools.
  - `speechRangesMs` after a reorder and after muting, and Unicode filler matching.
  - Renderer invariants on every output: contiguous clips, duration == source/speed, words inside captions.
- `npx tsx --test apps/backend/src/api/v1/media-editor/media-transcription.test.ts`: key-missing error, ms mapping, provider failures, mime list, and an opt-in live test.
- Both need `packages/video-contracts` and `packages/domains/ai` built (`npx tsc -p <pkg>`), because workspace imports resolve to `dist/`.

## 7. Live verification log

| date | what | result |
|---|---|---|
| 2026-09-25 | **Live Cartesia STT** (`transcribeAudioBuffer`, model `ink-whisper`, word granularity) on a 12.7 s synthesized English speech WAV | 29 words with real timings, e.g. `{"text":"So","startMs":20,"endMs":280}`, `{"text":"gym.","startMs":1360,"endMs":2160}`, `durationMs: 12747` |
| 2026-09-25 | **Live E2E**: that STT output sent to `directMobile("remove the pauses and add yellow captions")` | `plannerSource:"deterministic"`, `plannerReason:"no workspace (company) context, so no LLM key could be resolved"`. 8 word-synced captions (`#FFFF00` highlight). No pause cuts, because synthesized speech has no gaps ≥ 0.5 s. |
| 2026-09-25 | **Live LLM call** | **Not run.** No `ANTHROPIC_API_KEY`/`CLAUDE_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` exists in the server env files or the dev shell. The LLM path is covered only by mocked-provider tests. First real verification: set `ANTHROPIC_API_KEY` (or a workspace Claude key) and send any §2.1 request. `plannerSource` must be `"llm"`. |

## Addendum 2026-09-26: effects and photo overlays
- `effects?: [{ id, type, startMs, endMs, intensity 0..1 }]`, with `type` one of
  `flash | fade_black | shake | zoom_pulse | black_white | vignette` (`VIDEO_EFFECT_TYPES`). It is omitted when empty,
  and older clients ignore it.
- `overlays[].mediaType?: "image"` means a still photo held for the slot. It is absent for video. The source must be a
  `url` or an `asset`; photos never come from `stock_query`.
- Director op `addEffect { effect, startSec, durationSec, intensity }`. `insertBroll` gains `mediaType`.
- Both renderers use the same envelopes (see `TimelineEffects.kt`):
  - flash: fast attack, linear decay;
  - fade_black: triangle;
  - black_white and vignette: 150 ms ramps;
  - zoom_pulse: `1 + (0.06 + 0.14·i)·sin(πp)`;
  - shake: small sinusoidal jitter with cover scale.


## Addendum 2026-09-27: constraints, autonomy, critic, run log (Social OS P1/P3)

These are all **optional and backward compatible**. Older clients ignore the new response fields, and older requests
still parse. The schemas are the source of truth:
- `ai-director-api.schema.ts` (`constraints`, `lastExportQa`)
- `mobile-edit-ir.ts` (`media.scenesMs`, `media.ocr`, `media.loudness`)
- `director-constraints.ts`
- `director-critic.ts`

### Request additions
| field | type | notes |
|---|---|---|
| `constraints.lockedRanges` | `Array<[startMs, endMs]>`, max 50, end > start | ms on the **current** timeline (`currentEditIR`, or the raw clip). No cuts, speed changes, reorders or insertions inside the range, and no zoom, B-roll, effect, text or SFX over it. |
| `constraints.lockedTracks` | `Array<"music"\|"captions"\|"broll"\|"sfx"\|"effects"\|"text">` | Blocks: music → `addBackgroundMusic`, `duckAudio`, `adjustVolume(music)`; captions → `autoCaptions`, `addCaption`, `styleCaption`, `emphasizeWord`, `clearCaptions`; broll → `insertBroll`, `addImage`; sfx → `addSoundEffect`, `autoSoundDesign`; effects → `addEffect`, `applyFilter`, `addTransition`; text → `addText`. |
| `media.scenesMs` | `number[]` (source ms) | On-device scene cuts. Shown to the planner. |
| `media.ocr` | `Array<{startMs, endMs, text≤500}>` | On-screen text. Fenced as **untrusted data** in the prompt. |
| `media.loudness` | `{integratedLufs, truePeakDb?, clippingPct?}` | Used by the critic (quiet voice under music, clipping). |
| `lastExportQa` | `{durationMs, width, height, fps?, hasAudio, audioChannels?, blackRangesMs, frozenRangesMs, integratedLufs?, clippingPct?}` | QA of the last export of `currentEditIR`. See the critic below. |

The web and desktop form (`telemetry`) accepts `telemetry.scenesMs`, `telemetry.loudness` and `telemetry.ocr` with
the same meaning.

**Where constraints come from.** The server merges three sources. They are combined as a union, so nothing can
loosen them:
1. the request's `constraints`;
2. the creator's own words, parsed deterministically. Examples:
   - "don't change the music"
   - "keep my captions"
   - "no b-roll"
   - "keep the first 10 seconds"
   - "don't touch 0:05-0:12"
   - "keep the intro/ending" (5 s)
   - "keep the music but make it quieter" does **not** lock music.
3. the model's `finish_edit.preserve` argument. It can only add locks.

Operations that break a lock are dropped before compilation and listed in `violations`.

### Response additions
| field | meaning |
|---|---|
| `autoApplied` | `true` only when the project's `autonomy.editing` is `AUTO` **and** every operation is one of `removeSilences`, `cleanFillers`, `autoCaptions`, `styleCaption`, `adjustVolume`, `duckAudio`, `reframeSubject` or `changeAspectRatio`, **and** nothing was dropped for a constraint. `AUTO` with any other op is a proposal (`requiresConfirmation: true`). `MANUAL` is always a proposal. `ASSISTED` (the default) behaves as before. The greet turn is always a proposal. |
| `critique` | `{score 0..100, issues: [{id, severity: CRITICAL\|WARNING\|SUGGESTION, category: PACING\|VISUAL\|AUDIO\|SUBTITLE\|BROLL\|EXPORT\|CONSTRAINT, title, timeRangeMs?}], repairRounds}` |
| `runId` | The id of this turn in the agent run log (see below). |
| `violations?` | One human line per operation dropped because of a constraint. |
| `constraints?` | The locks that were enforced this turn (`lockedRanges` in ms, `lockedTracks`). |

`operations` now also includes the repair operations. Repair entries in `appliedOperations` are prefixed `repair: `.

### Critic and bounded repair
After compiling, the critic checks the following:
- micro clips under 250 ms;
- dead air left (gaps in speech of more than 1.5 s);
- zoom overlap and density;
- captions: overlap, running past the end, too short, words outside the caption;
- B-roll relevance against the transcript;
- music over speech (not ducked, ducked too little, or a quiet voice by `media.loudness`), and source clipping;
- locked ranges whose footage was cut;
- `lastExportQa` against `currentEditIR`:
  - duration;
  - **aspect** (the export pixel size is the user's choice and is not compared);
  - a missing audio stream;
  - unexpected black frames (`fade_black` and dip-to-black are excluded);
  - frozen frames (still photos are excluded);
  - loudness and clipping.

CRITICAL issues that are repairable **and introduced by this turn** are sent back to the planner as structured JSON.
This is at most 3 rounds. A round that does not improve the result is discarded. Without an LLM, only known
deterministic fixes are used (for example `duckAudio`). Anything that remains is reported in `critique` and
`warnings`; it is never hidden. `llmCallBudget` now defaults to **6** and caps every call in the turn, repairs
included.

### Run inspector (agent event log)
The run inspector is also used for the Autopilot, Creative and Publisher runs of the project. Tenant = the JWT
company, and the project must belong to it; otherwise the response is 404 `PROJECT_NOT_FOUND`.

- `GET /api/v1/social-media/projects/:id/agent-runs?limit=20` (limit max 100) returns
  `{success, runs: [{runId, agent, status, startedAt, lastEventAt, eventCount, lastEventType}]}`.
  - `agent` is one of `director`, `autopilot`, `creative`, `publisher`.
  - `status` is one of `running`, `completed`, `failed`.
- `GET .../agent-runs/:runId` returns `{success, runId, events: [{id, runId, type, ts, payload}]}`, oldest first. An
  unknown run returns 404 `RUN_NOT_FOUND`. When the event table is missing, both routes return 503
  `AGENT_EVENTS_NOT_CONFIGURED`.
- Event types:
  - `AgentStarted`
  - `ContextLoaded`
  - `MediaAnalyzed`
  - `PlanCreated`
  - `PlanValidated`
  - `ToolCalled`
  - `ToolCompleted`
  - `TimelineChanged`
  - `CriticStarted`
  - `CriticCompleted`
  - `RepairCreated`
  - `RepairApplied`
  - `PublishStarted`
  - `PublishCompleted`
  - `AgentFailed`
- A run is `completed` when an event has `payload.final: true`. It is `failed` after `AgentFailed`.
- Payloads are truncated, and keys that look like secrets are redacted.
- Director runs are stored only when `projectId` resolves to a social project of the caller's company. `runId` is
  returned either way.

### Project memory and library search (same router)
All of these are project-scoped: the project must belong to the JWT company, and every query filters by companyId
and projectId.

- `POST .../media-index`
  - Body: `[{assetId, kind: "transcript"|"scene"|"ocr"|"caption", text, startMs?, endMs?, url?}]` (or `{items}`),
    at most 500 items.
  - Upserts by (asset, kind, startMs) and returns `{created, updated}`. Only text is sent; media stays on the device.
- `POST .../media-search`
  - Body: `{query, limit?≤50}`.
  - Returns `{results: [{assetId, kind, text, startMs, endMs, url, score}]}`. `score` is a local BM25 score; higher is
    better.
- `GET .../agent-memory?kind=&limit=` lists the project's memory.
- `POST .../agent-memory/feedback` takes `{accepted, agent?, runId?, summary?, operations?, note?}`. Call it on
  Apply and Undo.
- `POST .../agent-memory/preferences` takes `{text}`.
- `POST .../agent-memory/performance` takes `{platform, postId?, format?, pillar?, hookType?, metrics}`.
- `DELETE .../agent-memory/:memoryId` deletes one item.
- The Director also remembers explicit preferences it finds in the prompt ("less zoom", "smaller captions") and gets
  a compact project-memory block in its prompt.

### Untrusted data
Transcripts (word by word), OCR, asset names, caption and title text, calendar scripts, research results and memory
notes are wrapped in `<<<UNTRUSTED_DATA …>>>` blocks. Instruction-like text inside them is replaced with
`[instruction-like text removed]`, and the prompt states that none of it can change the task, the tools, the
permissions or the constraints. When the transcript contains such text, `warnings` says so.

### Tests
- `packages/video-contracts/tests/director-os.test.ts`: 13
- `packages/domains/ai/tests/director-os.test.ts`: 12
- `video-director.test.ts`: still 58
- `apps/backend/.../projects/brand-bleed.test.ts`: 2 (brand bleed, and the routes over HTTP)

## Addendum 2026-11-05: the Director never destroys manual work (editor overhaul, Phase 1)

### Request additions
- `baseRevision` (int, optional): the phone's timeline revision `currentEditIR` was taken at. It is echoed back as
  `baseRevision` on the response. A response that arrives after newer manual edits is merged onto them
  (`timeline_merge.dart`, three-way, item lanes keyed by id), never swapped in. When both sides changed the cuts,
  nothing is merged and the chat offers: Re-run on my latest edit / Use Director's version / Keep mine.

### MobileEditIR additions (all optional, backward compatible)
- `audio.music[].source` and `audio.sfx[].source` also accept `{kind: "asset", assetId, query?, title?}` (preferred)
  and the legacy `{kind: "file", path, query?, title?}`. The server round-trips both verbatim and never resolves or
  replaces them. A timeline with local music used to be rejected with 400 INVALID_REQUEST. The phone registers device
  files through `StudioController.localMediaSource` and migrates old drafts.
- `audio.music[].source` (kind `url`) accepts `title`.
- An SFX without `durationMs` ("play the whole file") stays without it. It used to come back as 1000 ms.
- `http://` music stays that URL. It used to be turned into a stock search for its own address. The phone now
  refuses plain-http music / SFX links.

### Round trip (replaces the caveats in 3.8)
- Every item whose canonical form a turn did not change comes back exactly as the client sent it
  (`preserveUntouched`, `packages/video-contracts/src/mobile-preserve.ts`): clips, overlays, captions, zooms, effects,
  music, SFX, voiceovers, sources, canvas and original-track level. A turn with no operations returns
  `currentEditIR` unchanged (except `speechRangesMs`, which the server recomputes). This is checked by a property test
  over 200 generated timelines.
- Items the client already had are never trimmed against neighbours or dropped for being short, even when a cut moves
  them. A cut only drops an item it removed or shrank below a usable length.
- Titles keep their styled words (per-word colours / highlights).

### Operation changes
- `autoCaptions` on a timeline that already has captions restyles them (only the fields given: textColor,
  highlightColor, fontSize, uppercase, position, template). It no longer regenerates them, so hand-fixed text,
  translations and positions stay. `replaceExisting: true` regenerates them from the transcript.
- `styleCaption`: `preset` is optional, and the op also takes `textColor`, `fontSize` and `uppercase` as a partial
  patch. It never touches titles.
- `addBackgroundMusic` when music exists is rejected unless `replace: true`. Use `adjustVolume` (trackId `music`) to
  change the level.
- `addTransition` with `*` fills only cuts without a transition unless `overwrite: true`.
- `reframeSubject` to the aspect the canvas already has keeps crops, pans and caption positions (letterboxed clips
  switch to fill). To a new aspect, crops are refitted, and only captions at a default spot move.
- Coverage retry: only requests to ADD a feature count ("add music", "with captions", "yellow captions please"), not
  edits of existing items ("make the music quieter", "the zoom at 5s is too strong"). The retry's operations are merged
  with the first plan, never replace it.

### Autonomy (replaces the ASSISTED rule in the 2026-09-27 addendum)
- The phone follows `autoApplied`. It no longer derives its own rule from `requiresConfirmation`.
- MANUAL, greeting, the offline rule-based planner, a planner that asked, or an op dropped for constraints: proposal.
- ASSISTED (default): applied only when every operation is additive (`ADDITIVE_OPS`: add/restyle text, zooms,
  effects, stickers, B-roll, SFX, narration, volume/duck, filter, fades, voice cleanup, transitions on empty cuts,
  captions when there are none, music when there is none). Cuts, reorders, speed, reframe, removals, music
  replacement and caption regeneration are proposals.
- AUTO: `ADDITIVE_OPS` plus `SAFE_OPS`.
- "Yes" to the Director's own plan in the chat is the confirmation: applied.

### Tests
- `packages/video-contracts/tests/roundtrip-identity.test.ts`: 10 (two 200-seed property tests)
- `packages/domains/ai/tests/director-phase1.test.ts`: 8 (200-seed no-op property test through `directMobile`)
- `apps/social-studio-mobile/test/timeline_merge_test.dart`: 20
- `apps/social-studio-mobile/test/studio_controller_test.dart`: +6 (F-01, F-02, F-03, F-09)

## Addendum 2026-11-05 (b): the full editor toolbox, provenance and locks (editor overhaul, Phase 2)

### New operations (all change ONE existing item in place, by the id shown in the timeline summary)
| Tool | What it changes | Mirrors (TimelineOps) |
|---|---|---|
| `editText {id, text}` | the words of a caption or title; timing and look stay | `editText`, `retextCaptions` |
| `updateTextStyle {target: id \| all_captions \| all_titles, fontFamily?, fontSizePx?, textColor?, highlightColor?, strokeColor?, strokeWidthPx?, backgroundColor? (#hex \| none), uppercase?, glow?, enter?, exit?, loop?, positionX?, positionY?}` | partial style patch | `styleCaptions`, `updateCaptionPosition` |
| `retimeItem {kind, id, startSec?, durationSec?}` | caption, title, zoom, B-roll, effect, SFX, voiceover | `moveItem`, `setItemRange` |
| `updateOverlay {id, x?, y?, scale?, rotation?, opacity?, fit?, muted?, mask?, chromaKey?, sourceUrl? \| stockQuery?}` | a B-roll / PiP / sticker | `updateOverlay`, `replaceOverlaySource` |
| `setKeyframe / removeKeyframe {overlayId, atSec, ...}` | layer animation | `setLayerKeyframe`, `removeLayerKeyframe` |
| `updateZoom {id, scale?, centerX?, centerY?, rampMs?, startSec?, durationSec?}` | one zoom | (new) |
| `updateEffect {id, intensity?, effect?}` | one effect | `setEffectIntensity` |
| `updateMusic {volumeDb?, fadeInSec?, fadeOutSec?, duck?, duckDb?}` | the music bed; keeps the track | `updateMusic` |
| `changeMusicTrack {query? \| sourceUrl?}` | another track with the same level, fades, ducking | `setMusicSource` |
| `setSfxVolume {id, volumeDb}`, `setClipVolume {clipId \| all, volumeDb}`, `updateVoiceover {id, volumeDb?, fadeInSec?, fadeOutSec?}` | levels | same names |
| `setCrop {clipId, x, y, width, height}`, `panClip {clipId \| all, centerX, centerY}` | manual framing | `setCrop` |
| `muteTrack {track: original \| music \| sfx \| voiceover, muted}` | a whole track | `setTrackMuted` |
| `duplicateClip {clipId, targetTimelineStartSec?}` | inserts a copy (after it, or at the nearest boundary) | `duplicateClip` |
| `freezeFrame {clipId? = auto, timestampSec, durationSec}` | holds a frame; the clip's `assetId` is `freeze:<assetId>@<sourceMs>` and the phone captures that frame (`StudioController.materializeFreezeFrames`); the source entry has `durationMs` 600000 | `insertStill` |
| `replaceClip {clipId, replacementAssetId}` | other footage, same timing | `replaceClipSource` |
| `addCaption`, `emphasizeWord` | now exposed to the model | — |
| `removeItem` kinds | also `music`, `voiceover`, `sticker` | `remove*` |

`packages/video-contracts/src/director-tool-parity.json` maps every public `TimelineOps` operation to a tool, or to
`ui-only: <reason>`. A contract test and a Flutter test both fail when an operation is added without a mapping.
Under ASSISTED the update tools apply straight away. `changeMusicTrack`, `duplicateClip`, `freezeFrame` and
`replaceClip` are proposals.

### Provenance and locks: `MobileEditIR.itemMeta` (optional)
`itemMeta: { [itemId]: { origin?: "manual" | "director" | "template", locked?: boolean } }`. It sits beside the items
rather than on them, so every edit that rebuilds an item keeps it. Entries of items no longer on the timeline are
dropped.
- The phone marks every item a manual edit creates as `origin: "manual"`. "Lock from the AI Director" in the item
  sheet sets `locked`, and a lock badge shows on the timeline.
- The server marks items a turn creates as `origin: "director"` and keeps the creator's entries.
- Enforcement (`applyItemLocks`, before compiling):
  - an op naming a locked item is refused;
  - cuts, splits, speed changes, freezes, reorders and reframes over a locked clip are refused;
  - `clipId: "all"` sweeps skip locked clips;
  - locked music refuses every music op;
  - "remove the zooms" without an id keeps the creator's own and locked items unless the request says
    all / every.
- Backstop (`enforceItemLocks`, after projecting): a locked item a sweep still changed comes back as the creator's
  version. Only its timing follows cuts.
- Every refusal is listed in `violations`, which also makes the turn a proposal.

### Timeline description and history
- The model sees each item as one JSON line: id, `by` (origin), `locked`, time range, style, source label, levels,
  fades and ducking. Each lane shows at most 60 items, and the whole description is capped at about 24k characters.
- History turns may carry `status` (`applied` | `proposed_not_applied` | `undone`) and `appliedOps`. The phone
  tracks undo and redo of Director turns. The prompt labels each turn, e.g. "You (proposal, NOT applied)".

### Tests
- `packages/video-contracts/tests/phase2-update-tools.test.ts`: 17
- `packages/domains/ai/tests/director-phase2.test.ts`: 8
- `apps/social-studio-mobile/test/director_tool_parity_test.dart`: 4
- `apps/social-studio-mobile/test/studio_controller_test.dart`: +3 (F-16, F-21)
- The property tests now also generate `itemMeta` (provenance and locks).

## Addendum 2026-11-05 (c): understand first, then edit (editor overhaul, Phase 3); audio de-click (Phase 5.4)

### Scope step (before planning)
Every edit turn is classified first (`packages/video-contracts/src/director-intent.ts`). The mode is one of
`modify_existing`, `add_new`, `full_edit`, `question` or `ambiguous`. The classification also gives `targets`
(kind, ids?, timeSec?, `action`: add | change), `allowedTools` and `mustNotTouch`.
- **Offline rules first.** Clear requests ("make the music quieter", "add b-roll when I talk about the gym") are
  classified instantly, with no extra LLM call. Add vs change is decided per target, from its own clause.
- **LLM intent call** (`classify_request` tool, about 600 tokens) only when the rules recognise nothing (another
  language, a bare "yes"). Without it, the request is planned unscoped under "change only what was asked".
- **Whole edits over the creator's own work ask first.** A full edit of a timeline with `origin: manual` items
  becomes a clarifying question, unless the creator said "from scratch" / "everything", or answered yes to that
  question.
- **Vague requests ask** ("do something"). Small talk is a chat reply.
- **What a scoped turn gets:**
  - only the tools of its targets; creation tools only for targets being added;
  - every lockable track it does not target is locked for this turn only (not echoed in `constraints`);
  - out-of-scope operations are dropped and reported ("left out …: not part of what you asked");
  - critic repair rounds are off for `modify_existing`.
- **Destructive variants need the words in the request, in every mode:**
  - replacing music needs "different / another / new … music";
  - regenerating captions needs "redo the captions";
  - overwriting transitions needs "change all transitions".

  Otherwise the op is downgraded or dropped, with a note.
- **Response additions:**
  - `scope {mode, targets, source: llm | offline, note?}`;
  - `diffSummary {text, changes[], removed, cutSec, destructive}`, shown as "What changes" on the proposal card,
    with removals and cuts highlighted.

### Prompt (Phase 3.2)
- The prompt leads with "Change only what the creator asked…".
- The viral-craft block appears only for `full_edit`.
- The timed word list is left out when every target is untimed (music, sound level, colour, canvas, watermark,
  voiceover, transitions). Spoken lines with times stay.

### Eval (Phase 3.4)
`packages/domains/ai/tests/director-scope-eval.test.ts` has 48 cases across hand-edited and raw timelines.
- **Mocked mode** (CI) adds an over-eager "viral pass" to every model answer and checks two things: mode accuracy,
  and that nothing outside the request's lanes changes. Current result: 100% mode accuracy, 0 forbidden changes.
- **Live mode** (`AI_DIRECTOR_LIVE=1` plus provider keys) runs the same cases on a real model. Target: ≥ 95%
  accuracy and 0 forbidden changes. It has not been run yet.

### Audio de-click (Phase 5.4, F-17)
- **Android export:** every clip-to-clip boundary gets at least a 10 ms fade-out / fade-in.
  - The rule lives in `clipAudioFadesMs` in `AudioEnvelope.kt`, which `EditIrRenderer.clipAudioProcessors` uses.
  - A longer transition or manual fade always wins.
  - Clips under 40 ms and muted clips are skipped.
- **Preview:** `clipPreviewGainWithDeclick` in `clip_audio_fades.dart` mirrors the rule.
- **Not done:** the ±15 ms low-energy cut-point snap.
- **Not verified:** listening on a device.

### Tests
- `director-scope-eval.test.ts`: 3 mocked tests (48 cases) + 1 live test (skipped by default).
- `ClipAudioFadesTest.kt`: 4.
- `clip_audio_declick_test.dart`: 5.
- `director_diff_summary_test.dart`: 2.

## Addendum 2026-11-05 (d): every clip is analysed (editor overhaul, Phase 4)

### Request additions
- `mediaList` (optional, up to 20): the analysis of every other source on the timeline, with the same shape as
  `media` (transcript, silences, faces, beats, scenes, OCR, labels, loudness, in that file's SOURCE ms).
  - `media` stays the primary source, which is all older clients send.
  - An entry for the same `assetId` replaces it.
- `analysisPending` (optional): sources whose on-device analysis is still running.
  - The server says so in `warnings`.
  - It tells the planner not to invent what is said in those clips.

### Server
- `graphFromMobileMediaList` maps each source's analysis onto the timeline through the clips that play it, and
  merges them in timeline order. Captions, filler and pause cuts, face zooms and beats then cover clips 2..N.
- Speech ranges (music ducking) are computed per source: `speechRangesForClips(..., wordsByAsset)`.
- Fill crops centre on each source's own speaker (`faceCenterByAsset`).
- The critic's B-roll relevance check uses the words of every clip.
- A source on the timeline with no words is reported: "has no transcript", or "is still being transcribed" when
  pending.
- Fixed a Phase 1 issue: when the canvas changes, clips are re-projected. Before, a clip with an automatic crop was
  restored verbatim, so after a 16:9 → 9:16 reframe it was not cropped to fill.

### Phone
- `StudioController` analyses every added clip source (`ClipAnalysis`):
  - silences, faces, scenes, labels, OCR, loudness, beats, then the transcript;
  - at most 2 at a time;
  - a file added twice (same path, size and modified time) is analysed once;
  - restored drafts re-analyse their sources (the analysis is not stored in the draft).
- Speech ranges are recomputed from every clip's words when a transcript arrives.
- Before a Director turn, the phone waits up to 10 s for clips still being analysed ("Listening to your clips…").
  It then sends `mediaList` and `analysisPending`.
- F-11:
  - added clips are registered at their display size (rotation applied);
  - they get the same fill crop as the first clip;
  - that crop is re-centred on the speaker once faces are known, unless the creator changed it.

### Not done
Storing the analysis in the draft. The plan's "cached by file hash in the draft" is an in-session cache keyed by
path, size and modified time, so a reopened draft analyses again.

### Tests
- `packages/domains/ai/tests/director-phase4.test.ts`: 6 tests on a 3-clip, 3-file fixture:
  - the "um" in clip 2 is cut;
  - captions in all 3 clips;
  - ducking over all 3;
  - framing per speaker;
  - an older client is told the other clips have no transcript;
  - a pending clip is reported.
- `packages/video-contracts/tests/roundtrip-identity.test.ts`: +1 (canvas change re-projects clips).
- `apps/social-studio-mobile/test/clip_analysis_test.dart`: 5.

## Addendum 2026-11-05 (e): short-form craft, contract and Director side (editor overhaul, Phase 6)

### Renderer capabilities (read this first)
The request gains `rendererCapabilities` (`cropKeyframes`, `jlCut`, `textTransform`, `multiMusic`).
- The Director only uses a feature the phone lists (`gateRendererFeatures`):
  - a tracking reframe becomes a static one;
  - J/L cuts and part-of-video music beds are refused, with the reason;
  - text keeps no rotation or scale.
- This app version lists none: the Android renderer and the preview do not draw these features yet. That work is in
  progress, as Phase 5.1 plus the Phase 6 renderer pass. When it lands and is checked on a device, add the
  capability to `AiDirectorService.rendererCapabilities`.
- The current Kotlin `MobileEditIr.validate()` still fails an export with more than one music bed.

### MobileEditIR additions (all optional)
- `clips[].cropKeyframes: [{sourceMs, x, y}]` (max 240): a moving framing.
  - Each point is the crop window's top-left at SOURCE ms. Cuts, splits and speed changes never move them.
  - It keeps `crop`'s size. Interpolation is linear, held at the ends.
  - Reference implementation: `EditIrClip.cropAt` in Dart.
  - Setting a crop by hand (setCrop / panClip / TimelineOps.setCrop) clears it. A canvas change clears it.
- `clips[].audioLeadMs` / `audioLagMs` (0..2000): J-cut / L-cut.
  - A split or a cut keeps the lead on the front piece and the lag on the back piece.
- Caption / title `style.rotationDeg` (-180..180), `style.scale` (0.2..4), and
  `style.transformKeyframes [{atMs, rotationDeg?, scale?, positionX?, positionY?}]`.
- `audio.music` holds up to 4 beds that must not overlap (validated by the contract and the Dart `validate()`).
- `media.transcript.words[].speaker` (optional): a diarization label. When present, the planner splits the spoken
  lines by speaker.

### Director
- `reframeSubject.mode: "track"`: each clip's crop follows the speaker (`computeCropPath` in `reframe-path.ts`).
  - The subject is the largest face per sample.
  - A 6% dead zone; pans of at most 0.35 frame widths per second; exponential easing (the `smoothingFactor`).
  - A hard re-centre on each scene cut.
  - A still subject gives one static crop.
- `jlCut {clipId, leadMs?, lagMs?}`: clamped to the footage before / after the clip and to half the neighbouring
  clip. Classed as structural, so it is a proposal under ASSISTED.
- `addBackgroundMusic {startSec, durationSec}` adds a bed for part of the video beside the others (no overlap, max 4).
  `updateMusic` / `changeMusicTrack` take `id`.
- `updateTextStyle` takes `rotationDeg` and `scale`.
- `musicBeatsMs` (request; timeline ms, measured on the phone from the downloaded track): on a whole edit, new zooms,
  B-roll, effects and stickers within 150 ms of a beat move onto it.
- Frame-accurate cuts: every cut shrinks inwards onto frame boundaries (start up, end down), so no speech is lost.
  An edge within a frame of a clip boundary goes to that boundary, so no sliver is left. The phone's
  `TimelineOps._relayout` snaps clip ends the same way and is idempotent.

### Phone (TimelineOps)
- New: `setJLCut`, `addMusicBed`.
- `updateMusic` and `removeMusic` take `id` and leave the other beds alone. Before, editing one bed dropped the
  others, and a failed download removed all music from the export.
- Parity manifest entries added.

### Not done
- Speaker diarization needs a speech-to-text provider that labels speakers. Whisper (Groq / OpenAI) does not. It is a
  provider and key decision; the contract and the planner are ready.
- Pinch / rotate handles for text in the preview are part of the preview work.

### Tests
- `packages/video-contracts/tests/phase6-craft.test.ts`: 13.
- `packages/domains/ai/tests/director-phase6.test.ts`: 3.
- `apps/social-studio-mobile/test/phase6_craft_test.dart`: 5.

## Addendum 2026-11-06: one composition for preview and export (5.1), renderer support (Phase 6), telemetry (7), iOS first fixes (5.2)

### Android: preview = export (behind a flag)
- `CompositionFactory.build(ctx, ir, media, PREVIEW | EXPORT)` builds the Media3 composition for both.
  - EXPORT behaves as before when the new fields are absent.
  - PREVIEW uses proxies, a 720 px short side, no loudness pass and no frame-rate cap.
  - `EditIrRenderer` only runs the export.
- `MediaEnginePreviewView`: a `CompositionPlayer` on a SurfaceView.
  - One channel per view: `com.workspace180.socialmanager/media_engine_preview_<id>`.
  - Methods: `setTimeline` (debounced 150 ms), `seek`, `play`, `pause`.
  - Events: `position`, `timeline`, `error`.
- Dart: `lib/features/studio/native_preview.dart`.
  - The flag: `StudioPreviewMode`, default `dart`. Switch it with `--dart-define=STUDIO_PREVIEW=native`.
  - In native mode the frame is native; text hit boxes and selection stay in Dart.
- Not verified on a device: CompositionPlayer playback and performance, SurfaceView lifecycle, alignment of the
  handles with the native frame.
- Missing in native mode: layer (PiP / sticker) drag handles, and muting the footage while a voiceover records.

### Renderer support for the Phase 6 fields

| Field | Export | Native preview | Dart preview (default) |
|---|---|---|---|
| `cropKeyframes` | yes | yes | yes (`EditIrClip.cropAt`) |
| `audioLeadMs` / `audioLagMs` | yes | yes | no |
| text `rotationDeg` / `scale` / `transformKeyframes` | yes | yes | yes |
| up to 4 music beds | yes | yes | no music in the Dart preview (as before) |

`AiDirectorService.rendererCapabilities` is still empty: turn each feature on after a device check.
- The moving crop's timing at speeds other than 1x rests on Media3 applying speed before effects. If a 2x clip pans
  at the wrong rate, drop `* speed` in `CropPanTransformation`.
- A transform keyframe that leaves a field out uses the style's value at that keyframe.

### Telemetry (Phase 7.2)
- The final `TimelineChanged` event of each Director run carries a turn summary: `scopeMode`, `scopeSource`,
  `tools`, `plannerSource`, `itemsRemoved`, `cutSec`, `violations`, `rejected`.
- The phone posts `agent-memory/feedback` for each applied turn and each undo.
  - An undo within 30 s is reported as regret.
  - Merge conflicts go in the summary.
  - Telemetry failures are logged and never shown to the creator.

### iOS (Phase 5.2, first fixes; not compiled: needs a Mac)
- `extractAudio` (AVAssetExportSession, Apple M4A) returns the same keys as Android, so iPhone can transcribe.
- `detectSilences` / `detectBeats` return `NOT_AVAILABLE` instead of an empty list, which read as "no pauses / no
  beats".
- The full iOS renderer rewrite and the golden-frame tests (5.3) are not done.

### Tests
- Kotlin: `Phase6MathTest` 14, `ClipAudioFadesTest` 4 (30 JVM tests in total).
- Dart: `text_transform_test.dart` 5; a controller test for the feedback reports.

### Follow-up 2026-11-06: preview gaps closed
- **Layers:** picture-in-picture and stickers take one finger to move and two fingers to resize and rotate, in both
  previews. An animated layer is changed through its keyframe at the playhead, and each gesture is one undo step.
  - In the native preview, layers get invisible handles (`GhostLayerHandle`), placed with the export's maths from
    the media's own aspect.
- **Voiceover recording:** the native preview mutes playback while a voiceover records (new `setVolume` method on the
  preview channel; the level survives timeline rebuilds).
- **J/L cuts in the default (Dart) preview:** `clipJlMs`, `clipPreviewGainJl` and `jlNeighbourAt` mirror the export's
  `clipJlMs` / `clipAudioPlanMs`. An audio-only player plays the neighbour's sound over the lead or lag, while the
  on-screen clip fades under it. Without J/L cuts the gain equals the earlier de-click gain.
- Tests: `apps/social-studio-mobile/test/preview_gaps_test.dart` (7).
