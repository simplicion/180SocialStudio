# Manual editor parity ("CapCut-level") + AI Director on the same tools

Goal: a user can build and fix a video by hand. They browse music, sound effects, stock video, photos, text
templates and effects, add them to a multi-track timeline, and then move, trim, replace, restyle or delete anything.
The AI Director uses the same operations on the same timeline, so after the AI edits, every item it placed (music,
B-roll, captions, zooms, SFX, text) shows on the timeline and can be edited by hand.

Rules that still apply:
- The AI plans; a deterministic compiler builds the timeline; the renderer runs on the device (Android Media3 or
  desktop FFmpeg).
- Media never reaches the browser.
- No fake assets: an empty search is an empty state, and a missing key is a typed error.

## 1. What exists today (audit 2026-09-26)

| Capability | Mobile Studio (Flutter + Media3) | Desktop Media Studio (web UI + Tauri FFmpeg) | AI Director tool |
|---|---|---|---|
| Cut / split / trim / delete / reorder | ✅ `timeline_ops.dart` | ✅ `Timeline.tsx` | ✅ removeRange, splitClip, trimClip, moveClip, reorderSegment, rippleDelete |
| Silence / filler removal | ✅ via Director | ✅ SilenceRemovalModal | ✅ removeSilences, cleanFillers |
| Speed, volume, rotate, crop / aspect | ✅ | ✅ (+ speed curves) | ✅ |
| Colour filters / adjust | ✅ fixed looks | ✅ wheels, curves, scopes | ✅ applyFilter |
| Transitions | ✅ | ✅ | ✅ addTransition |
| Auto captions + style presets | ✅ 4 presets | ✅ CaptionStudioModal | ✅ autoCaptions, styleCaption |
| Free text | ✅ plain | ✅ | ✅ addText |
| Zoom / punch-in / reframe | ✅ | ✅ | ✅ addZoom, reframeSubject |
| Music: browse, preview, add, replace | ✅ Music sheet | ✅ StockMediaPanel | ✅ addBackgroundMusic, duckAudio |
| Stock video B-roll: browse + add | ✅ B-roll sheet | ✅ | ✅ insertBroll |
| **Sound effects: browse + add by hand** | 🔴 AI only (IR + renderer support it) | ✅ | ✅ addSoundEffect, autoSoundDesign |
| **Photos as overlays** | 🔴 the renderer is video-only | ✅ | 🟡 |
| **Text templates** (title, lower third, CTA, quote…) | 🔴 | 🔴 caption presets only | 🔴 |
| **Video effects** (shake, flash, blur-in, glitch, vignette, grain) | 🔴 | 🔴 | 🔴 |
| **Multi-track timeline** (see and tap each music / SFX / text / B-roll item) | 🔴 thin read-only lanes | ✅ | n/a |
| One "Library" to browse everything | 🔴 split across sheets | 🟡 stock panel (video/music/SFX/photo) | n/a |

## 2. Plan

### M1: mobile manual editing (no contract change; do first)
1. **Multi-track timeline** (`studio_timeline.dart`): labelled tracks for Video, B-roll, Text & captions, Zoom,
   Music and SFX.
   - Items are sized by time. Pinch changes the zoom; scroll horizontally.
   - Tapping an item selects it and opens an **item inspector** with Replace, Move to playhead, Nudge ±0.5 s, Trim
     start/end, Volume (audio) or Style (text), and Delete.
   - Whatever the AI Director placed shows here and is edited the same way.
2. **Library sheet** ("Add" button): tabs for Music, Sound FX, Video, Text.
   - Search uses the existing `/media-editor/stock/unified`, with a preview and "Add at playhead".
   - Credits are kept for export attribution.
   - Empty or missing-key results give an empty state or an error with retry.
3. **SFX ops**: `addSfx`, `moveSfx`, `setSfxVolume`, `removeSfx` in `timeline_ops.dart`. Cuts already remap SFX.
4. **Text templates** (`text_templates.dart`): about 8 presets built only from existing caption-style fields: Bold
   title, Lower third, Subscribe CTA, Quote, Big number, Minimal subtitle, Boxed label, Highlight. They are applied
   with `addText` / `styleCaptions`, and the brand font and colours override the preset colours when set.
5. Tests: ops unit tests and timeline/library widget tests.

### M2: contract and renderers (photos + effects)
1. `MobileOverlay.source` gets an `image` media kind (with `durationMs`).
   - Android: `EditedMediaItem` image with `setImageDurationMs`.
   - Desktop: FFmpeg `-loop 1`.
   - The compiler maps both ways.
2. `MobileClip.effects: Array<{ id, type: shake|flash|blur_in|glitch|vignette|grain|zoom_pulse, startMs, endMs, intensity }>`
   (a fixed enum).
   - Android: Media3 `GlEffect` shaders.
   - Desktop: FFmpeg filter chain equivalents.
   - Older clients ignore the field.
3. Director tools `applyEffect` and `insertPhoto`, a validator, and `AI_DIRECTOR_CONTRACT.md` updates.
4. Golden tests: the same IR renders the same on both engines (frame-hash tolerance).

### M3: desktop editor parity
1. A Text templates panel using the same template IDs as mobile, a Photos tab that adds image overlays, and an
   Effects panel (M2 enum) with preview.
2. After the director applies, the Timeline selects and highlights the new items so the user can adjust them
   straight away.

### M4: director quality
- Brand-aware defaults: templates use the brand font and colours, and music is picked from the brand mood.
- The greet message lists what was placed and where ("music 0:00–0:32, 4 B-roll shots, captions in Bold"), so the
  user knows what to tweak.

## 3. Status

**M1: done (2026-09-26).**
- `studio_timeline.dart` (multi-track timeline, pinch/buttons zoom, item inspector).
- Library tool with Music, Sound FX, Video, Photos, Text and Effects tabs (`studio_tools.dart`).
- `text_templates.dart` (8 templates, brand font and colours).
- `TimelineOps`: `addSfx`, `setSfxVolume`, `removeSfx`, `items`, `moveItem`, `setItemRange`, `deleteItem`, `editText`, and `addText(style:)`.
- The preview now draws real text-box colours and photo overlays.

**M2: done on the contract, server and Android (2026-09-26).**
- **Contract:** `VIDEO_EFFECT_TYPES`, `EditIR.tracks.effectTrack?`, `VideoClip.mediaType?`, `MobileEditIR.effects?` and overlay `mediaType?`; both converters updated.
- **Director:** new `addEffect` op, compiled and remapped on cuts and reorders. `insertBroll.mediaType:'image'` needs a URL or asset; it is never searched as stock video. The AI Director has an `addEffect` tool.
- **Android:** `TimelineEffects.kt` covers:
  - shake and zoom pulse (`MatrixTransformation`);
  - flash, dip to black, black & white (`RgbMatrix`);
  - vignette (`CanvasOverlay`).
  - Photo overlays use `setImageDurationMs` and `setFrameRate`. Export keeps the image file extension.
- **Tests:**
  - `packages/video-contracts/tests/effects-photos.test.ts`: 3 tests.
  - Director tests: 58/58.
  - Flutter: 152 tests passing, analyze clean.
  - `compileDebugKotlin` OK.
- **Not verified:** the effects and photos have not yet been rendered on a real phone, and there are no Kotlin JVM unit tests (the project has no unit-test setup).

**M3 (desktop editor + FFmpeg):** in progress in a separate workstream.

**M4:** planned.

## Mobile parity (agent 2) status

- **Caption presets**: the 8 desktop Caption Studio presets (`HORMOZI_BOUNCE`, `MRBEAST_HYPE`, `ALI_ABDAAL_CLEAN`,
  `DAN_KOE_MINIMAL`, `CYBER_NEON`, `KARAOKE_FROSTED`, `VOX_EXPLAINER`, `CINEMATIC_SUBTITLE`) are in
  `TimelineOps.viralCaptionPresets` / `captionStyle` with the web values (sizes/strokes are canvas px on both). Classic
  `CLEAN/BOLD_POP/KARAOKE/BOXED/TITLE` unchanged. Highlight override is now optional (null = preset colour). Optional
  style key `glow` (Cyber Neon) lives only in the style map; Kotlin draws it as a highlight-coloured shadow, older
  clients ignore it. Captions sheet: live sample cards (`CaptionPresetCard`) + "Apply to all captions".
- **Fonts in export**: `caption_fonts.dart` — the preview loads the family via `google_fonts`; before rendering,
  `CaptionFonts.resolveForExport` awaits the same fonts and passes the cached files (`<Family>_<variant>_<hash>.ttf` in
  app support dir) as `fontPaths`. A failed download adds an export warning and the renderer uses bundled Inter
  (Kotlin fallback changed from system sans-serif to bundled Inter, also warned). Relies on google_fonts' cache file
  naming (6.x) — re-check on a google_fonts major upgrade.
- **Timeline direct manipulation** (`studio_timeline.dart`): long-press-drag moves non-video items (not music/voice)
  with a live time tooltip, committed once via `moveItem`; tapping an item selects it and shows trim handles
  (44 px hit area) that commit via `setItemRange` (min 300 ms). Haptic tick on grab. Video clips unchanged.
- **Track mute**: `TrackKind.voice` row (speech ranges) + header toggles for Voice/Music/Sound FX
  (`TimelineOps.setTrackMuted/isTrackMuted/trackVolumes`, −60 dB, previous levels restored; undoable).
- **Transitions**: sheet offers CROSSFADE, DISSOLVE, DIP_BLACK, DIP_WHITE, ZOOM_SWOOSH, ZOOM_OUT, GLITCH (+ hard cut);
  `EditIrTransition.types`. Android: `TransitionFade` (black dip / white dip / glitch flash) + `TransitionMotion`
  (zoom ramps, glitch jitter; scale ≥ 1). Unknown types still render as crossfade with a warning.
- Verified: `flutter analyze` clean, `flutter test` 164 passing, `compileDebugKotlin` OK. **Not verified on a device**:
  visual look of the new transitions, glow, and real Google Fonts download/export.

## M3 status (desktop Media Studio, 2026-09-26)
Built:
- **Text templates**: new Text tab (`components/TextTemplatesPanel.tsx`). It has the same 8 ids and styles as mobile
  (`services/editor-library.ts` `TEXT_TEMPLATES`, presetLabel `TPL_*`), a live preview, a text input and "Add at
  playhead". The result is a `role: "title"` caption segment.
  - The brand font and accent come from the director-context greeting (`brand.font`, `brand.highlightColor`). There is no
    primary colour in that payload, so the lower third and highlight keep their defaults.
  - Titles show in the caption lane: click to select, drag to move or trim, Delete to remove.
  - The preview and the compatibility exporter draw titles with their own style and position.
- **Photos**: images from Stock or the Asset Bin are added as B-roll with `mediaType: "image"` for 3 s. The preview,
  the canvas exporter and the native FFmpeg export all cover the canvas with them (FFmpeg uses loop + scale-increase +
  crop).
- **Effects**: new FX tab (`components/EffectsPanel.tsx`). It lists the 6 `VIDEO_EFFECT_TYPES`, each with an intensity
  slider and the default durations.
  - When an effect is selected, the tab also shows its intensity and a delete button.
  - The FX lane in `Timeline.tsx` supports select, move, trim both edges, Delete, and lock.
  - Preview and canvas export use `effectVisualsAt`. Native export uses `buildEffectChains`, which follows the same
    formulas (constants in `services/effect-constants.ts`).
- **Transitions**: all 13 `TRANSITION_TYPES` are offered in the ClipInspector dropdowns and the Timeline cut picker
  (`TRANSITION_OPTIONS`) and are drawn in the Remotion preview.
  - WIPE now wipes left, per the contract; WIPE_RIGHT is the old look.
  - Native export: the bundled FFmpeg is 4.1 and has **no xfade**, and timeline clips do not overlap. So the incoming
    clip is drawn over a **freeze of the outgoing clip's last frame** (overlay `eof_action=repeat`).
  - How each type is drawn:
    - CROSSFADE and DISSOLVE: alpha fade.
    - SLIDE_*: animated overlay position.
    - WIPE and WIPE_RIGHT: `geq` alpha mask.
    - DIP_BLACK and DIP_WHITE: `fade` through the colour.
    - BLUR_PUNCH: `gblur` burst on a hard cut.
    - GLITCH: `rgbashift` + seeded `noise` burst.
    - ZOOM_SWOOSH and ZOOM_OUT: a zoom that settles on the composite (zoompan).
  - Transitions no longer force the compatibility renderer.
- **AI Director**: the editor applies the director's EditIR as returned, so its `effectTrack`, `mediaType` photos and
  titles appear on the lanes above and can be edited the same way. After an apply, the first new item is selected
  (`newTimelineItemIds`).
- Native allowlist (TS `native-render-validate.ts` + Rust `render.rs`): these filters were added:
  crop, split, zoompan, hue, vignette, fade, geq, gblur, rgbashift, noise. None of them read files.

- Native allowlist: `rotate` was also added.

### M3.1: native export parity (AI Director timelines no longer fall back)
- **Captions and titles**:
  - `services/caption-raster.ts` is now the only caption drawing code. It reproduces the preview layout: the kinetic
    box with word highlight and pop, and titles at their own position and style. The compatibility renderer calls it
    for every frame.
  - For the native export, `captionStateTimeline` splits the timeline into the distinct caption pictures (which
    caption, which highlighted word, which titles). Each picture is drawn once to a transparent PNG at output size.
  - Before drawing, the export loads the preview's Google Fonts stylesheet (`STUDIO_FONTS_URL`, now shared) and
    waits for each family and weight it uses.
  - The new Tauri command `write_caption_overlays` (`src-tauri/src/overlays.rs`) writes the PNGs and an `ffconcat`
    list to `<app cache>/render-overlays/<set>/`. It is capped at 3000 images, 8 MB each and 512 MB in total, and
    accepts PNG data only. Sets older than a day are pruned, and `clear_caption_overlays` runs after each export.
  - `render_timeline` accepts only a list from that folder. It adds the list as the last input
    (`-f concat -safe 1`, with a forward-slash path) and the graph overlays it last. No libass or drawtext is used.
- **Camera zoom**:
  - `buildCameraChains` uses one zoompan branch on the composite, before effects and captions. It follows the
    preview's rules:
    - the first active event wins;
    - zoom = 1 + (scale−1)·min(1, spring) about `targetCoords`;
    - the spring is the closed form of Remotion's `spring()`, which uses the critically damped motion when ζ ≥ 1.
      It is checked against Remotion frame by frame.
  - The preview zooms every video track (B-roll included), so the export does too.
- **Rotation and crop**: rotation uses `rotate` about the centre with transparent corners. Crop (percent insets) keeps
  the clip where the preview draws it. `scale.end` is ignored, as it is in the preview.
- **Remote media**:
  - The new `fetch_remote_media` and `remote_media_status` commands (`src-tauri/src/remote.rs`, reqwest with rustls)
    download stock, music, SFX and photo links into `<app cache>/remote-media`. The render then uses the local path.
  - Rules:
    - https only, on the default port, with no credentials in the URL; every redirect is re-checked;
    - allowed hosts: Pexels (+ vimeo), Pixabay, NASA, FreePD, Freesound, Wikimedia, Jamendo, Unsplash, Flickr and
      archive.org. The platform's own hosts come from `STUDIO_MEDIA_HOSTS`, read at build time and at run time (host
      names only, no secrets);
    - Content-Type must be video, audio or image;
    - size caps are 1 GB for video, 200 MB for audio and 50 MB for images, with a 15 s connect timeout and 10 min
      overall;
    - results are cached by URL hash with a `.url` sidecar that is checked on a hit;
    - the web app polls for progress (`fetchRemoteMediaWithProgress`);
    - downloaded files are allowed for the current session only.
  - The commands are registered in `build.rs` and `capabilities/main.json`.
- **The compatibility renderer is now only a fallback**:
  - `renderExport` uses it only when the native plan reports something unsupported: keyframed motion, clip effect
    strings, speed outside 0.25x–4x, or media that is not a file.
  - If the timeline has any audio, the export is **blocked** with the reason and what to do (`ExportBlockedError`).
    The audio is never dropped silently.
  - A failed download is an error that suggests retrying or replacing the clip.
  - WebAudio mixing in the fallback was not built: it seeks frame by frame and is not real-time, so the audio could
    not be kept in sync.

Verified:
- `npx tsc --noEmit -p apps/frontend`: 0 errors.
- jest `tests/unit/offline`: 158/158 pass. This includes `native-export-parity.test.ts` (caption state timeline, the
  spring against Remotion, camera, rotation, crop and the overlay input) and the updated
  `editor-bridge-export.test.ts` (native captions, the download path, blocked exports and the silent fallback).
- `npx tsx tests/integration/native-render-plan.integration.ts` renders through the real bundled FFmpeg: 27/27 pass.
  Pixel checks cover:
  - photo cover;
  - all effects;
  - all 12 non-CUT transitions;
  - the caption PNG sequence at the right times, with the AAC audio stream present and audible;
  - camera zoom inside its event only;
  - 90° rotation.

Not verified:
- **Rust not compiled here** (no cargo on this machine). These need CI (`cargo test --lib`):
  - `overlays.rs`: base64, PNG check, ffconcat and path-confinement tests;
  - `remote.rs`: host allowlist, URL rules, content type and cache-key tests;
  - `render.rs`: overlay input, concat path and effects fixture tests;
  - the new `reqwest` dependency.
- The canvas rasteriser has not been compared pixel for pixel with the DOM preview; jsdom has no canvas, so no
  automated check was possible. The fonts, sizes, positions and colours follow the same style fields.
- The real download of a live Pexels URL has not been tested.
