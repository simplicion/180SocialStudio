# Studio editor: CapCut-level parity and agentic editing

Audit date: 2026-10-02. Scope: Social Studio mobile editor (`apps/social-studio-mobile/lib/features/studio`), its
Android renderer (`android/.../mediaengine`), the shared timeline contract (`packages/video-contracts`) and the AI
Director (`packages/domains/ai`).

## 1. Principles
1. **One timeline, two editors.** Every manual tool is also an AI Director tool, and every Director tool is undoable
   and visible on the same timeline. The AI never generates pixels: it plans operations, a deterministic compiler
   applies them, and the phone renders.
2. **Preview equals export.** A control may only exist if the Android export renders it the same way. The renderer
   still warns about anything it approximates.
3. **The AI understands the footage, not just the words.** It gets:
   - the transcript, silences, faces, scene cuts and beats;
   - on-screen text (OCR) and visual labels per scene (on device);
   - the creator's current edit and **edit style**.
4. **Creator first.** CapCut-style flow: tap a clip → contextual toolbar; pinch to zoom the timeline; snapping; undo
   and redo everywhere.

## 2. CapCut feature matrix vs Social Studio

Legend: ✅ done · 🟡 partial · ❌ missing · 🔴 preview/export mismatch

| Area | CapCut | Studio today | Plan |
|---|---|---|---|
| Main-track edit (split, trim, delete, reorder, add clips at start/end) | ✅ | ✅ (manual + AI) | duplicate clip E2 |
| Multi-clip timeline from separate files | ✅ | ✅ (fixed P2; device-tested) | — |
| **Overlay / PiP layers** (position, scale, rotation, opacity, multiple layers) | ✅ | 🔴 the preview shows PiP and opacity; the export renders B-roll as a full-frame cutaway and drops opacity and audio | **E1.1** layered compositing (Media3 `VideoCompositorSettings`) |
| **Keyframes** (position, scale, rotation, opacity) | ✅ | ❌ | **E1.2** keyframes on layers (per-frame overlay settings) |
| Text: fonts, colours, stroke, shadow, background, glow | ✅ | ✅ | — |
| Text animations in / out / loop | ✅ | ✅ (P2.7; device-tested) | AI parity E1.4 |
| Text templates, stickers, emoji | ✅ | 🟡 templates and emoji in text; no image stickers | sticker layers E2 |
| Auto captions + styles | ✅ | ✅ | — |
| Filters | ✅ | ✅ 7 looks | — |
| Adjust (exposure, temperature, tint, highlights/shadows, sharpen, vignette, grain) | ✅ | 🟡 brightness, contrast and saturation only | **E2.1** GL colour shader |
| Transitions | ✅ (large library) | ✅ 13 (crossfade approximated as dip) | true overlapping crossfade E3 |
| Effects (flash, shake, glitch, …) | ✅ | ✅ 6 + transitions | more effects E3 |
| Speed (constant) | ✅ | ✅ | — |
| Speed curves / ramps | ✅ | ❌ | E3 (split-into-segments ramp) |
| Reverse, freeze frame | ✅ | ❌ | freeze frame E2 (still from a frame); reverse E3 |
| Crop, rotate, flip, canvas (aspect, colour, blur background) | ✅ | ✅ (blur background ❌) | blur background E3 |
| Chroma key (green screen) | ✅ | ❌ | **E2.3** GL shader on layers |
| Masks (linear, circle, rectangle) | ✅ | ❌ | E3 |
| Background removal (AI cut-out) | ✅ | ❌ | E3 (ML Kit selfie segmentation on device) |
| Audio: music, SFX, ducking, fades | ✅ | ✅ | — |
| Clip audio fade in/out, detach audio | ✅ | 🟡 fades only at transitions | **E2.2** per-clip fades |
| Voiceover recording | ✅ | ❌ | **E2.4** record on the timeline |
| Noise reduction / voice effects | ✅ | ❌ | E3 |
| Text-to-speech | ✅ | ❌ | E3 (needs a TTS key; typed error without one) |
| Beat sync (auto-cut on beats) | ✅ | 🟡 beats detected, not used for cuts | E3 Director tool `snapCutsToBeats` |
| Auto reframe (face follow) | ✅ | ✅ | — |
| Stabilisation | ✅ | ❌ | E3 |
| Export settings (720/1080/2K/4K, 24–60 fps, quality) | ✅ | 🟡 canvas only | **E2.5** export options |
| Timeline UX: pinch zoom, snapping, multi-select, copy/paste style | ✅ | 🟡 drag/trim yes; zoom and snapping limited | **E2.6** |
| Templates / "apply my style" | ✅ | ❌ | **E1.3** style profiles |

## 3. AI Director: agentic gaps
- **"Finish this in my style".** The Director sees a list of the timeline's items but no style fingerprint and no
  notion of which part is already edited.
  → **E1.3** `deriveEditStyle(ir)` produces:
  - cut rhythm (average shot length);
  - zooms, effects and B-roll per minute;
  - caption preset and colours; text fonts and animations;
  - transitions used; music and filter;
  - the **edited range** vs the **unedited tail**.

  The planner is told to continue the unedited part in that style.
- **Tool parity.** Manual tools without a Director tool:
  - text animations;
  - overlay layout (PiP position, scale, opacity, keyframes);
  - removing or retiming an existing caption, zoom, overlay, effect or SFX;
  - clip fades and duplicate.

  → **E1.4** new tools, each compiled deterministically and covered by tests.
- **Visual understanding.** OCR, faces and scene cuts exist; there is no "what is in the frame".
  → **E3** ML Kit on-device image labelling per scene keyframe, sent as text labels (no pixels leave the phone).

## 4. Phases
- **E1 (foundation: agentic and preview = export):**
  - E1.1 layered overlays in the export;
  - E1.2 keyframes;
  - E1.3 style fingerprint + "continue my edit";
  - E1.4 Director tool parity (text motion, overlay layout, remove/retime items).
- **E2 (creator tools):**
  - E2.1 colour adjustments;
  - E2.2 clip audio fades;
  - E2.3 chroma key;
  - E2.4 voiceover;
  - E2.5 export settings;
  - E2.6 timeline pinch/snap;
  - duplicate and freeze frame;
  - stickers.
- **E3 (advanced):** speed ramps, reverse, masks, background removal, stabilisation, true crossfade, beat-sync cuts,
  visual labels, TTS, noise reduction.

Every item ships with:
- a contract schema change (zod) that keeps old timelines valid;
- the Dart model, round-tripped in tests;
- the Kotlin renderer and an on-device render test (emulator);
- the phone preview, using the same maths as the renderer;
- a Director tool + compiler + test where it makes sense.

Status is appended below as phases land.

### Status (2026-10-02)
- **E1.1 layers — done, device-verified (Pixel 7 API 34 emulator, render suite 9/9 on 2026-10-02).**
  - Contract `OverlayLayerSchema` (`mode`, `x`, `y`, `scale`, `rotation`, `keyframes`) plus overlay `fit`/audio round trip (`tests/layers-roundtrip.test.ts`).
  - Phone preview: `layer_placement.dart`, drag to move.
  - Export: Media3 compositor layer tracks in `EditIrRenderer.layerCompositor`, at most 4 at once.
  - Device pixel test: "layers: PiP composited above …" in `integration_test/media_engine_render_test.dart`; run it with `tool/run_render_tests.sh`.
- **E1.2 keyframes — partial.** The engine interpolates every keyed property (Dart `layerAt` = Kotlin `LayerMotion.at`). The UI offers entrance presets (zoom / slide / rise / fade / spin), size, rotation and position. A full keyframe-lane editor is still open.
- **E1.3 style fingerprint — done.**
  - `deriveEditStyle` / `describeEditStyle` (`packages/video-contracts/src/edit-style.ts`) measure:
    - cut rhythm, zooms/min, B-roll/min, layer share;
    - effects, SFX, transitions, filter;
    - caption and title styles, music;
    - where editing stops (`uneditedRange`).
  - The planner prompt includes it, so "complete / continue this video" edits only the raw tail in the creator's style. Tests: `tests/edit-style.test.ts`.
- **E1.4 Director tool parity — done for text motion, layers and removal.**
  - `addText` gains `fontFamily`, `color`, `strokeColor`, `backgroundColor`, `uppercase`, `glow`, `enter`, `exit` and `loop`.
  - `insertBroll` gains `layout` (fullscreen / fit / pip / sticker), `position`, `scale`, `rotation`, `animationIn` and `keepAudio`.
  - New `removeItem` (caption / title / zoom / broll / effect / sfx, by id, by time or all); lock-aware.
  - The planner summary now lists item ids.
  - Tests: `tests/director-tool-parity.test.ts`. Contracts + Director suites: 86 + 13 pass.
- **E2 creator tools — done except chroma key.** Every item has a contract field, the Dart model + preview, the Kotlin
  renderer, unit tests, and an emulator render test in `integration_test/media_engine_render_test.dart`.
  - **E2.1 colour:**
    - Adjustments: exposure, warmth (temperature), tint and vignette, next to brightness, contrast and saturation.
    - One affine colour matrix is shared by the preview and the export: `color_grade.dart` ⇄ `ColorGrade.kt`, using Media3
      `RgbMatrix`. Presets now also show in the preview.
    - Device: the export matches the preview maths to ≤ 2/255 per channel.
    - Director: `applyFilter` gains `exposure`, `temperature`, `tint` and `vignette`.
  - **E2.2 clip audio fades:**
    - `audioFadeInMs` / `audioFadeOutMs` per clip; the Volume sheet has fade sliders; split keeps the right fade on each half.
    - Preview gain = export gain (`TimelineOps.clipPreviewGain`).
    - Director: `fadeClipAudio`.
    - Device: −19 dB at the start, −13 dB at the end, 0 dB in the middle.
  - **E2.4 voiceover:**
    - Recorded natively (`VoiceRecorder.kt`, MediaRecorder AAC) from the Voiceover tool at the playhead.
    - `audio.voiceovers` holds `{kind: asset}` local files, round-tripped as an EditIR `VOICEOVER` track.
    - Music ducks under voiceovers. The new timeline track supports move, trim, volume and delete, and voiceovers play in the preview.
    - The Director sees voiceovers and keeps them.
  - **E2.5 export settings:**
    - Export sheet step: resolution (full / 1080 / 720 / 480 short side), frame rate (24 / 30 / 60) and quality (high = 2× bitrate).
    - The finished frame is scaled last, so the layout never changes.
  - **E2.6 timeline:** pinch-zoom already existed. Snapping is new: edges snap to cuts, the playhead and item edges, with a haptic tick.
  - **Duplicate clip** (Duplicate tool; ripple uses clip ids first, so copies map correctly).
  - **Freeze frame / photo clips on the main track:**
    - The frame is extracted on the phone and held as a still clip with the clip's look; stills are silent.
    - Preview holds the still on a timer.
  - **Stickers:**
    - Emoji drawn on the phone into transparent PNGs and placed as floating layers that pop in.
    - Director: `addSticker`, which the phone draws itself (`emoji:` assets).
    - Device: PNG transparency is preserved.
  - **Fix:** gallery photos and videos added as B-roll were stored as raw device paths. Export then tried to download them, and the
    contract rejected them for Director turns. They are now local asset references, and old drafts are migrated on load.
- **Round 3 (2026-10-02): the remaining E1/E2 items and most of E3.** Each item below is verified on the emulator
  (`media_engine_render_test.dart`, 20 cases) and unit-tested.
  - **E2.3 green screen (chroma key):**
    - Implementation:
      - one GLSL key (CbCr distance, smoothstep edge, spill suppression) in `ChromaKey.kt`, mirrored by
        `shaders/chroma_key.frag` for the preview (Impeller `ImageFilter.shader`);
      - applies to layers only; "Remove green / blue" in the overlay inspector, with strength and softness sliders;
      - Director: `insertBroll.greenScreen`.
    - Device: the subject is kept at 253 red; the background matches the video underneath to 0.2/255.
  - **E1.2 keyframe editor:**
    - "Add keyframe at playhead" captures the pose; keyframes are listed with seek and delete.
    - When a layer is keyframed, dragging it or using the Size / Rotation sliders edits the keyframe at the playhead.
  - **Voiceover while playing:** recording starts the preview with the footage's sound muted.
  - **Photo EXIF:** sideways phone photos are measured upright (Media3 decodes them with EXIF rotation).
  - **E3 visual understanding:**
    - Fix: scene cuts, OCR and loudness existed natively but the app never ran them or sent them. Now they do.
    - New: ML Kit image labels (offline) give "what the picture shows" spans in the Director prompt. Only words are sent,
      sanitised to plain words.
    - Device: labels "plant, leisure, forest"; OCR reads the on-screen text.
  - **E3 beat-sync cuts:**
    - Fix: `beatAlign` was faking a 120 bpm grid and desynced footage.
    - Now it ripple-trims each cut back onto a real on-device beat, or reports that there is no beat analysis.
    - Exposed to the Director.
  - **E3 AI narration (TTS):**
    - The phone's text-to-speech engine writes a WAV file that becomes a voiceover.
    - Voiceover sheet: "Generate AI voice". Director: `addNarration` (`tts:<text>` asset spoken on the phone; durations
      corrected after synthesis).
    - Without an engine or voice the app gives a typed error, never silence. Device: 2.8 s of real speech.
  - **E3 noise reduction:**
    - "Reduce background noise" = 80 Hz high-pass plus a noise-floor downward expander (export only; the preview player
      cannot run DSP, and the UI says so). Director: `cleanVoice`.
    - Device: noise between words −8.4 dB; the loudest speech windows −2.3 dB (100 ms windows that include word gaps).
  - **E3 masks:** circle / rounded layer shapes, as a GL mask in the export and clip paths in the preview.
    Director: `insertBroll.shape`.
  - **E3 speed ramps:** montage / hero / bullet / flash in / flash out, made by splitting the clip into constant-speed
    parts so the preview, ripple and captions keep working. Speed sheet + Director `speedRamp`.
- **Round 4 (2026-10-02): heavy items — done.**
  - **Shared frame pipeline** (`FrameJobs.kt`):
    - A clip range is decoded to upright frames (`getFramesAtIndex` chunks, ≤ 30 fps, ≤ 60 s), optionally transformed per
      frame or reversed, with its audio decoded to PCM (optionally reversed).
    - It is re-encoded with Media3 to a local mp4 that replaces the clip's file in place (`TimelineOps.replaceClipSource`).
    - The preview plays the processed file, so preview = export.
  - **Reverse:** Speed sheet "Play this clip backwards". Device: the reversed clip starts on the original's last frame, and
    the sound envelope runs backwards.
  - **Background removal:**
    - Videos: ML Kit selfie segmentation (stream mode) paints the background key green, and the overlay becomes a
      full-frame layer keyed with the existing chroma path.
    - Photos: a transparent PNG.
    - Overlay inspector: "Remove background (keep the person)".
    - Device: background pure green, the person kept, photo background alpha 0.
  - **Stabilisation:**
    - Global shift per frame (320 px greyscale, ±16 px block match, sub-pixel), camera path smoothed over the chosen
      strength, frames moved onto it with an automatic ≤ 1.3× zoom.
    - Stabilise tool (Light / Recommended / Smoothest).
    - Device: frame-to-frame jitter of a shaken shot 14.0 → 4.1 (−71%).
  - **True crossfade:**
    - CROSSFADE / DISSOLVE now overlap: the incoming clip's footage from before its in-point fades in on a full-frame
      compositor layer, or the outgoing clip's footage after its out-point fades out. Only cuts with no spare footage dip.
    - The preview plays the other side on a second player (`TimelineOps.crossfadeAt` mirrors the renderer).
    - Device: halfway frame within 0.5/255 of the exact 50/50 mix; no dip at the cut.
  - **Agentic:** Director tool `processFootage` (reverse / stabilize / remove_background) queues a `process` flag. The phone
    runs the job after the turn, swaps in the file and clears the flag (or reports why). Export waits until the job is done.
  - **Limits:**
    - Jobs take about 10–25× realtime on the software-GPU emulator (faster on phones) and handle ≤ 60 s per clip.
    - Stabilisation is translation only (no rotation / rolling-shutter correction).
- **Fix (2026-10-02): export frame rate.** The full device run showed that "24 fps" exports still came out at 30 fps.
  - Measured with exact frame counts (`countVideoFrames`); the container's frame-rate field is only a hint.
  - Causes:
    - Media3 ignores a FrameDropEffect in the composition effects;
    - frames were dropped before speed changes, so 2× clips exported at double rate;
    - any layer track (PiP / sticker / crossfade) became the compositor's primary input, and its gaps run at a fixed
      30 fps.
  - Now:
    - each video item is capped at canvas.fps ÷ speed;
    - layer gaps are transparent stills at canvas.fps.
  - Device: 24 fps → 24.1; 15 fps holds with speed changes, cutaways and music. Full suite 25/25.

