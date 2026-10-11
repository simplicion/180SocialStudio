# Fix plan from the real edit runs (2026-10-03)

Source: one 45 s talking-head interview (NASA, public domain) edited twice, on the Android emulator, through the real
app code: once by hand with the manual editor (`integration_test/real_edit_demo_test.dart`), once by the AI Director
alone (`integration_test/ai_director_demo_test.dart`, platform AI key from the admin vault). Every problem hit along
the way is listed here, with its status.

## A. Already fixed during the runs (tests added)

| # | Where | Problem seen | Fix |
|---|---|---|---|
| A1 | AssetCache | every ccMixter track 403 (hotlink protection) | `hostHeaders` sends the ccMixter Referer |
| A2 | TimelineOps.autoCaptions | captions after a clip re-order got an empty range → export refused | sort by timeline time; straddling words stay in their clip |
| A3 | Kotlin validator | sticker over B-roll → "overlays overlap" → export refused | only full-frame cutaways may not overlap |
| A4 | MediaTools.getVideoInfo | Pexels fragmented MP4 read as 0 ms → export refused | duration sampled from the fragments |
| A5 | Renderer | fragmented MP4 "not seekable to start" → export refused | `ensureSeekable` stream-copy remux before render |
| A6 | Renderer | HDR stock B-roll on a phone without tone-mapping failed the whole export | HDR B-roll left out with a warning |
| A7 | Caption renderer | words glued together ("thedifferentways") | gap includes the outline; each word reserves its pop room |
| A8 | Compiler | 100–220 ms slivers between two cuts flashed on screen | sliver < 250 ms is cut too |
| A9 | Mobile export | a word the cut removed was still drawn ("home And know") | zero-length words dropped, caption text rebuilt |
| A10 | Compiler | Director title at 24 px on a 1080 px canvas | titles ≥ 5% of the short side |
| A11 | Director prompt | wrong "interviewer's question" cut; "you know" never removed | spoken-lines transcript view; filler tool hint |
| A12 | Director planner | model stopped after the cuts (no captions/B-roll/music…) | coverage check, one retry; off for critic repairs (it duplicated items) |
| A13 | AI vault | hardcoded fallback encryption seed | fails loudly without a key |

## B. Open → fixed in this round (all implemented, tested, and re-run on the emulator)

| # | Problem seen | Fix | Verified |
|---|---|---|---|
| B1 | Stock B-roll/music lookup always "budget used up" (the 8 s clock started at the request; planning ate it) | clock starts at the first stock lookup (`video-ai-director.service.ts`) | test; device: B-roll resolved on the server with its Pexels credit |
| B2 | Director trimmed the speaker's first line as "dead air" | `PlanExpander.speechSafeCut`: pause / silence / dead-air cuts remove only the gaps between words | test; device: "covered 7 spoken words; only the silence was cut" |
| B3 | Critic repair deleted the requested title (`removeItem`) | a repair that removes a requested feature is discarded (`featureCount`) | test; device: title kept |
| B4 | Both edits exported at −28 LUFS (platforms ≈ −14) | phone measures the voice, `LoudnessLimiterProcessor` applies gain + linked peak limiter (−1.5 dBFS ceiling) on the mix; Studio default on, "Platform loudness" switch in export settings | device: −28.1 → −14.1 LUFS |
| B5 | Sticker landed on the speaker's face | default sticker spot = farthest from the face (`TimelineOps.faceOnCanvas` / `stickerSpotAwayFrom`, contracts `stickerSpotAwayFrom` in PlanExpander) | tests |
| B6 | Fragmented MP4 stock clips could not be scrubbed in the preview | `makeSeekable` native method run by `AssetCache.videoFinalizer` right after download (export still remuxes as a backstop) | analyze + Kotlin build |
| B7 | Manual editor had no one-tap pause / filler removal | `TimelineOps.removePauses` / `removeFillers` (source-time, any clip order, slivers joined) + "Clean up" tool | tests |
| B8 | Preview popped the whole caption, export popped one word; manual "Bold pop" never popped in the export (word scale 1) | preview pops the spoken word like the export; manual word_pop captions get scale 1.15; restyling toggles it | tests |
| B9 | Cuts inside a title's time shortened it (2.5 s → 0.6 s) | titles keep their length when cuts/speed changes move them (`remapSecondaryTracks`) | test; device: 2.0 s title kept |
| B10 | Director's cleanFillers (default list) left four "you know"s, the manual Clean up removed them | the Director always includes "you know" / "I mean", like the manual tool | test |
| B11 | Normalised export true peak −0.5 dBTP (AAC overshoot) | limiter ceiling −2 dBFS (encoded true peak under −1 dBTP) | device: −0.8 dBTP at −1.5; lowered further |

Device evidence of the A6 HDR fallback: the last run's Pexels B-roll was HDR; the export finished with "The B-roll
at 22.2s is HDR and this phone cannot convert HDR, so it was left out" instead of failing.

## C. Remaining limits (not faked)

- The model does not always cut "the interviewer's question" (one of the last runs kept it): without speaker
  labels it guesses from wording and pauses.
- The server's music lookup can take > 6 s (network providers); the phone then finds the track at export (with
  its credit), so the export is complete, only the Director's preview of the music is later.

- Speaker labels: no diarization in the transcript, so "cut the interviewer" relies on wording + pauses (B2 makes a
  wrong guess cost pauses, not words). Needs a provider with speaker labels.
- Emulator renders take 3–7 min (software GPU); real phones use hardware codecs.
