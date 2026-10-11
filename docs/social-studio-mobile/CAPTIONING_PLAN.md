# Captioning — implementation plan (Kalakar-level, any language)

Goal: the user drops in a video in **any** language, the app detects the language by itself and produces
word-synced, creator-style captions (MrBeast, Hormozi, Ali Abdaal …) that the user can correct, restyle and export.
Reference product: kalakar.io (20 South Asian languages, 13 creator templates, translation, SRT/VTT export).

Rules that do not change: AI returns **words and timings only**; the deterministic compiler and the on-device
renderer draw every pixel. No canned transcripts, no hardcoded keys, typed errors when a provider is missing.

Status legend: ✅ done · 🟡 partly · 🔴 not started.

> **Owner rules (2026-10-07):** speech-to-text and language detection use the best **open-source** model first
> (today: Whisper large-v3, MIT, hosted on Groq; OpenAI Whisper as fallback). No new paid provider (ElevenLabs,
> Sarvam, …) is added without the owner choosing it from options. Cartesia stays for text-to-speech / Voiceforce.
> **Captions never contain emoji.**

## 1. Where we are

| Area | State | Notes |
|---|---|---|
| Word-level STT | 🟡 | Groq Whisper → OpenAI Whisper (`apps/backend/src/api/v1/media-editor/media-transcription.ts`) |
| Language detection | ✅ (phase 1) | Was hardcoded `en` on phone and desktop; now `auto` end to end, with a manual override in the Captions sheet |
| Word-synced rendering | ✅ | `VideoEffects.kt` `drawCaption` + identical Flutter preview |
| Templates, manual | 🟡 | 12 presets in the Captions sheet; no per-word box, no keyword emphasis |
| Templates, AI Director | ✅ | `caption-templates.ts`: 8 creator templates by name ("MrBeast captions with red highlights") via `autoCaptions.template` / `styleCaption.preset` |
| Convert captions (translate / Roman letters), manual | ✅ | `POST /media-editor/captions/translate` + "Convert captions" in the Captions sheet |
| Convert captions, AI Director | ✅ | `translateCaptions` op; the director service translates the final captions after compiling (`caption-translation.ts` in video-contracts) |
| `word_box` / `word_reveal` motions | ✅ phone, 🔴 desktop | Contract, Flutter preview and `VideoEffects.kt`; the desktop renderer does not know them yet |
| Templates added 2026-10-07 | ✅ | Shamani Bold, Mayya Box, Gadzhi Luxe, Mumbai Bubble (approximations of those looks, to be tuned by eye against reference videos) |
| Script choice at transcription | 🔴 | Hindi comes back in Devanagari; convert to Roman letters afterwards |
| Indic fonts | 🔴 | Only Poppins covers Devanagari; others fall back to the system font |
| Transcript correction UI | 🔴 | To verify / build |
| SRT / VTT export, translation | 🔴 | Desktop has `ass-subtitle-generator.ts`; nothing on mobile |

## 2. Target pipeline

```
device: extract 16 kHz mono audio
   → POST /media-editor/transcribe  (language = auto | ISO code, script = roman | native | mixed)
        1. STT provider chain  → words + timings + detected language + confidence
        2. script step         → token-preserving transliteration (same word count, timings untouched)
        3. key-term bias       → brand / product names from Brand Consciousness
   → device: phrase-aware grouping → preset style → preview → on-device render
   → optional: Director marks emphasis words (words only) → compiler → render
```

### 2.1 Speech-to-text providers

| Provider | Word timings | Indic / code-mix | Cost (to verify) | Role |
|---|---|---|---|---|
| ElevenLabs Scribe v2 | yes | strong code-switching | paid | **Not used** (owner rule: open-source first; removed 2026-10-07) |
| Sarvam Saaras v4 | **no** (chunk-level only), sync API ≤ 30 s | Best Indic benchmarks; built-in `translit` / `codemix` modes | ₹30 / h | Candidate; needs forced alignment |
| Groq `whisper-large-v3` (open-source model) | yes | Usable, weaker on Hinglish | cheap | **Primary** |
| OpenAI `whisper-1` | yes | Usable | — | Last fallback |

Decide the primary with a bake-off on 20–30 real creator clips (Hindi, Hinglish, Tamil, Bengali, English):
word error rate, timing drift, and script correctness. Vendor benchmarks disagree with each other.

Forced alignment (only if a provider without word timings is chosen): Meta MMS aligner (open source).

### 2.2 Script step (the Hinglish problem)

Most Indian creators caption Hindi speech in **Roman** letters ("aaj hum baat karenge"). Providers return
Devanagari. The step:

- Input: word list in native script. Output: the same number of words in the chosen script.
- Runs through the existing AI kernel (company key → platform vault). Validation: equal word count, no empty
  word, no added words; on failure keep the native words and return a warning (never invent text).
- `mixed`: English words stay Latin, Indic words stay native.
- Roman output needs no new fonts, so every existing preset works.

### 2.3 Contract additions (must round-trip in TypeScript, Dart and Kotlin)

- Transcript word: `confidence?: number`, `lang?: string`.
- Transcript: `language` (detected ISO code), `script`, `provider`.
- Caption style `animation`: add `word_box` (rounded box behind the spoken word) and `word_reveal`
  (words appear as spoken).

## 3. Creator templates (what makes each one recognisable)

| Template | Font | Case | Look | Motion | Words / caption |
|---|---|---|---|---|---|
| MrBeast | Komika-style comic (Bangers) | UPPER | White, very thick black outline, coloured key words | Hard pop + slight tilt | 1–3 |
| Hormozi | Montserrat Black / Anton | UPPER | White, key words yellow / green / red, heavy shadow | Pop on spoken word | 2–3 |
| Ali Abdaal | Rounded sans (Poppins) | Sentence | White on soft dark pill, box behind spoken word | `word_box` | 4–6 |
| Iman Gadzhi | Thin sans / serif mix | lower | Small, white, no outline, one italic serif key word | Fade | 3–5 |
| Raj Shamani | Bold sans | Sentence | White + yellow key words, Hinglish Roman | Pop | 3–4 |
| Varun Mayya | Clean grotesque | Sentence | White, single accent colour, tight tracking | `word_reveal` | 2–4 |
| Mumbai / bubble | Baloo 2 (Indic-ready) | Sentence | Rounded, colourful pill | Bounce | 2–3 |

Shared ingredients we still need: key-word emphasis chosen automatically (numbers, money, negations, nouns the
Director flags), per-word box, safe-area aware position per platform.

## 4. Phases

### Done on 2026-10-07 (phase 1 plus parts of 3 and 4)
- Auto language detection (below), spoken-language picker in the Captions sheet.
- Caption template catalog shared with the AI Director; template colours win over brand colours unless the
  creator names a colour; a template's font is not replaced by the brand font.
- Caption conversion endpoint and sheet action (any of 31 languages, native script or Roman letters).
- Not verified on a device or against live providers: tests use fake providers. Needs one real run with a Hindi clip.

### Second pass, 2026-10-07
- `word_box` (box behind the spoken word) and `word_reveal` (words appear as spoken) in the contract, the
  Flutter preview and the Android renderer. The preview box has square corners; the export box is rounded.
- Four more templates (16 in the Captions sheet, 12 known to the Director by name).
- Director op `translateCaptions` (language and `roman` script); a failed translation is rejected and the
  captions stay as spoken.
- Still to do from phase 4: automatic key-word emphasis, phrase-aware grouping, desktop
  renderer support for the two new motions.

### Phase 1 — any-language detection ✅
- Backend: `language` is optional; missing or `auto` lets the provider detect. The detected language is returned
  as an ISO-639-1 code. Auto and non-English requests use `whisper-large-v3` on Groq (turbo stays for explicit `en`).
- Flutter: transcription defaults to `auto`; the Captions sheet shows the detected language and lets the user
  override it (re-transcribes).
- Desktop: sends no language, so it inherits auto-detect.
- Grouping breaks on `।`, `॥`, `؟`, `۔`, `。`, `！`, `？` as well as `.!?`.

### Phase 2 — provider adapter + accuracy
- `SttProvider` interface (done); open-source language-ID / STT options to be chosen by the owner.
- `confidence` in the response; key terms from Brand Consciousness.
- Bake-off script under `packages/video-engine-runtime/src/tests` (live keys only).

### Phase 3 — script choice + Indic rendering
- `script` request field and the transliteration step (§2.2).
- Fonts: Noto Sans Devanagari / Tamil / Bengali / Telugu, Mukta, Baloo 2, Anek; add to `CaptionFonts.exportFamilies`;
  pick an Indic-capable family automatically when the transcript script is not Latin.
- Typewriter reveal must cut on grapheme clusters, identically in `studio_session_screen.dart` and
  `VideoEffects.kt` (both cut on UTF-16 units today and split conjuncts).
- `uppercase` is a no-op for scripts without case; presets must still look right.

### Phase 4 — template parity
- `word_box`, `word_reveal` in schema, Dart preview, Kotlin renderer, desktop renderer.
- New presets from §3; Director op to mark emphasis words.
- Phrase-aware grouping (never end a caption on a conjunction / postposition; balance two-line captions).

### Phase 5 — correction, export, translation
- Transcript editor: tap a word to fix it; low-confidence words underlined; timings preserved.
- SRT / VTT export from the caption track.
- Translated captions: phrase-level timing, words spread evenly inside each phrase.

## 5. Tests per phase
- Backend: `npx tsx --test --test-force-exit apps/backend/src/api/v1/media-editor/media-transcription.test.ts`.
- Contracts: `packages/video-contracts/tests/*` round-trip for every new field.
- Flutter: `flutter analyze && flutter test` (caption grouping, sheet states, preview/export parity).
- Kotlin: `./gradlew :app:compileDebugKotlin -q`; a device export with a Hindi clip before calling a phase done.

## Third pass, 2026-10-07 (status of the remaining list)
| Item | State | Notes |
|---|---|---|
| Speech provider | ✅ | Whisper large-v3 on Groq, then OpenAI Whisper (`STT_PROVIDER_ORDER` reorders). ElevenLabs was added by mistake and removed the same day. |
| Bake-off | 🟡 | `npx tsx apps/backend/scripts/stt-bakeoff.ts <folder> [language]` prints WER, latency and detected language per provider. Needs real clips with reference `.txt` transcripts; not run yet. |
| Indic fonts | 🟡 | Captions in Devanagari, Bengali, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam or Arabic script switch to the matching Noto Sans family (Poppins and Baloo 2 are kept for Devanagari). Phone and Director. Fonts download at export like the others; not checked on a device. |
| Key-word emphasis | ✅ | One key word per caption (a number, else the longest content word). On by default by hand ("Highlight key words") and for the Director (`autoEmphasis`). Rule-based, tuned for English and Roman Hinglish. |
| Emoji | ❌ by rule | Removed: captions never get emoji (manual and AI Director). |
| Correction screen | ✅ | "Fix caption text" in the Captions sheet: one field per caption; same word count keeps every word's timing. Low-confidence underlining is not wired (the phone does not read `confidence` yet). |
| SRT / VTT export | ✅ | "Export .srt / .vtt" shares both files from the edited timeline. |

Still open: live checks above, `confidence` on the phone, typewriter reveal on grapheme clusters, desktop renderer
support for `word_box` / `word_reveal`, phrase-aware grouping, tuning the new templates against reference videos.

## Decision, 2026-10-07: language detection
Owner chose **Whisper's built-in language detection** (open source, MIT; already live through `/transcribe`
with `language=auto`). No separate language-ID model. Revisit only if a device test with Hindi and Hinglish
clips shows wrong detection; the next candidate then is SpeechBrain VoxLingua107 (Apache 2.0), subject to the
no-server-side-media-processing rule. Meta MMS-LID is excluded (non-commercial licence).
