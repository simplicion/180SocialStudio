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
