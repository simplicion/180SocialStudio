# AI Director: why the edits are weak, and the permanent fix

Audit of `180SocialStudio-production` (Nov 2026). Scope: the mobile AI Director path
(`POST /api/v1/media-editor/ai-direct` → `VideoAIDirectorService.directMobile` → `CreativePlanner` →
`PlanExpander` → `EditIRCompiler` → critic → MobileEditIR → Media3 / AVFoundation render on the phone).

## Progress

| Phase | Status | Notes |
|---|---|---|
| 0. Baseline and visibility | Done 2026-11-13 | Turn log, `/media-editor/director-report`, phone fallback banner, `scripts/director-eval/`. Real-LLM baseline run is part of the final configuration pass. |
| 1. Provider layer | Done 2026-11-13 | See "Phase 1: what changed". Real-key check (0% fallback) is part of the final configuration pass. |
| 2. Eyes (frames + ShotLog) | Not started | Decided 2026-11-13: hybrid (see "Decision" below). |
| 3. Story pass | Not started | |
| 4. Agentic loop | Not started | |
| 5. Visual critic | Not started | |
| 6. Style playbooks | Not started | |
| 7. Regression gate | Not started | |

### Phase 0: what exists now

- **Turn log.** Every `directMobile` turn returns `turnLog` (provider, model, plannerSource, plannerReason, fallback,
  llmCalls, ops planned / after filters / applied / rejected / dropped, `drops[]` with the filter that dropped each
  op type, repair rounds, critic score, latency), prints it as one `[AI Director][turn] {json}` server log line, and
  stores it on the run's final `TimelineChanged` event. Code: `packages/domains/ai/src/builders/director-turn-log.ts`.
  Filters attributed: `renderer_gate`, `destructive_guard`, `scope`, `item_locks`, `validator`, `compiler`.
- **`plannerFallback`** (`{ code, reason }`) on the response when an edit turn was made by the offline rules because
  the model could not be used (`no_key`, `llm_disabled`, `no_tool_calling`, `timeout`, `budget`, `llm_error`,
  `empty_response`, `invalid_output`, `unknown`). Not set for the rule-based greeting or an offline clarifying
  question (deterministic by design).
- **Report.** `GET /api/v1/media-editor/director-report?days=7` (workspace admins): % of edit turns that fell back,
  by code, top reasons, provider/model mix, drops by filter, average latency and ops. Counts only runs with a
  verified project (those are the stored ones); the log line has every turn.
- **Phone.** `DirectorResponse.isFallback` + `FallbackBanner` in the director panel ("…, so basic offline rules made
  this edit." + the reason).
- **Eval harness.** `scripts/director-eval/` (see its README). First run with `--provider none` (rules only):
  5/5 deterministic, checks 14/25. It already shows two real problems: "edit this for reels" without an LLM
  returns a recommendation with 0 edits (the conversation gate, root cause 7), and the rules reframe the 16:9
  tutorial to 9:16.

### Phase 1: what changed

- **Model IDs in one file**: `packages/domains/ai/src/kernel/model-config.ts`. Director defaults (best quality):
  `claude-opus-5-5`, `gpt-6-astra`, `gemini-3.8-flash`. Everything else: `claude-sonnet-5-5` (was the retired
  `claude-3-5-sonnet-20240620`, so every non-Director Claude call failed), `gpt-4o` (served until 2027-01-14, then
  `gpt-6-luna`), `gemini-3.8-flash` (the old 1.5 / 2.0 list is shut down, so every Gemini call failed). Order:
  `AI_DIRECTOR_MODEL_<PROVIDER>` / `AI_MODEL_<PROVIDER>` → vault model (retired IDs ignored) → default.
- **Errors are loud**: every adapter throws a typed `ProviderError` (provider, model, code, status, the provider's
  message). Gemini no longer returns `{text:''}`; refusals are errors with their category.
- **Claude**: system prompt as a cached block, `output_config.effort` (Director `AI_DIRECTOR_EFFORT`, default
  `medium`), no `temperature` (current models reject it with a 400), no forced `tool_choice`, server-side refusal
  fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`; `AI_CLAUDE_FALLBACKS=0` turns it off).
  Non-streaming calls (the installed SDK 0.36 predates thinking-delta streaming).
- **OpenAI**: tools via the Responses API (`instructions`, `reasoning.effort`, `max_output_tokens`); plain text via
  chat completions with `max_completion_tokens` on reasoning models; no temperature on reasoning models.
- **Gemini**: honours the model, system instruction, clamped output tokens; tool schemas are cut down to the subset
  Gemini accepts (unknown JSON-Schema keys were a silent 400 before).
- **`generateAgentTurn(system, messages, tools, options)`** on every client: user text + images, assistant turns
  replayed verbatim to the same provider (Claude thinking blocks, OpenAI reasoning items, Gemini thought
  signatures), tool results with images (Claude: all in one user message). Ready for Phase 4.
- **Planner**: persona, rules and craft are the system prompt (stable per mode, cached); the user message holds the
  scope, timeline, media analysis and request. The persona no longer claims to see the video. Intent and coverage
  call failures are logged.
- **Provider precedence (Director)**: `AI_DIRECTOR_PROVIDER` → configured default → Claude, OpenAI, Gemini, Groq,
  custom (`chooseAiProvider`). Other features keep their order. Documented in `.env.example`.
- **Admin display**: `/ai-status` shows the model that really runs, plus `directorModel`; vault names and test
  pings use current models.
- Deviation from the plan: "pass temperature" is replaced by "send temperature only where the model accepts it".

---

## Part 1: Root causes (most important first)

### 1. The Director is blind. It never sees a single frame of the video.

What the model actually gets (`creative-planner.ts › buildPrompt`, `video-ai-director.service.ts › mediaContextSections`):
a word-timed transcript, silence timestamps, scene-cut timestamps, ML Kit label words ("person, sitting, room"),
OCR text, loudness, and **one average face centre**. No images, no keyframes, no contact sheet. `grep` for
`image`, `inlineData`, `vision` in the director and planner finds nothing.

Yet `DIRECTOR_PERSONA` tells the model *"You can see their video through the analysis below"*. It cannot. So it
guesses: zoom targets come from a default face position, B-roll queries come only from the words, it cannot tell
a good take from a bad one by looking, can't see bad framing, can't see that the speaker already gestures at
something, can't judge colour, and can't check that B-roll matches the shot.

When you edited with Claude directly, Claude extracted frames, *looked* at them, listened to the transcript, made
cuts, rendered, looked again and fixed. That look → act → look loop is the whole quality difference.

### 2. Planning is one-shot and open-loop.

- One LLM call must emit the entire edit as ~55 different tool calls in a single response
  (`DIRECTOR_TOOL_SPECS`, 63 operation types in `creative-plan.schema.ts`). Tool results are never returned to the
  model, so it is never told "this cut landed mid-word" or "this B-roll query found nothing".
- The Claude adapter (`ai-provider.service.ts`) sends one `messages.create` with a single user message. Claude
  answers with `tool_use` blocks and **stops, expecting tool results**, which never come. Plans come back partial;
  `COVERAGE_RULES` + a retry prompt are patching this symptom.
- The "critic" (`director-critic.ts`) is structural only: micro-clips, dead air, zoom count, loudness, caption
  length. It never judges whether the edit is *good* (hook strength, pacing feel, B-roll relevance, framing).
- Nothing ever looks at the rendered result. `lastExportQa` only measures black/frozen frames and LUFS.

### 3. The model/provider layer is outdated and fails silently into the rule-based planner.

In `packages/domains/ai/src/kernel/ai-provider.service.ts`:

- **Gemini**: hardcoded model list `gemini-1.5-flash, gemini-1.5-flash-latest, gemini-2.0-flash, gemini-1.5-pro,
  gemini-pro`; the 1.5 / `gemini-pro` models are retired. `options.model` and `temperature` are ignored. Every
  error is swallowed and `generateWithTools` returns `{ text: '' }`, so the planner reports "LLM returned an empty
  response" and **falls back to `DeterministicPlanner` (keyword rules)**. The planner also asks for
  `max_tokens: 16000`, above the output limit of the Flash models, which very likely makes those calls fail too.
- Gemini is **first** in the auto-fallback (`ai-company-config.service.ts`): if `AI_PROVIDER` is not set and a
  Gemini key exists, the Director runs on this broken path.
- **Claude**: no system prompt, temperature dropped, adapter default model `claude-3-5-sonnet-20240620`
  (retired). The planner overrides with `claude-sonnet-5` (`modelFor`); confirm that ID is valid for your key,
  because an invalid ID means every call errors and falls back to rules.
- **OpenAI**: default `gpt-4o`, an older model.
- The per-provider `model` saved in the Super Admin vault is never read; the admin panel still shows
  "Gemini 1.5 Flash / Claude 3.5 Sonnet".

Net effect: a large share of "AI" edits are very likely made by the deterministic keyword planner. The phone has
`isDeterministic`, but the user doesn't see it clearly. **Check `plannerSource` / `plannerReason` in your run
logs first; that number alone may explain most of the quality gap.**

### 4. No editorial "story" step. It decorates; it does not edit.

Real editing quality comes from **selection**: picking the hook, dropping retakes, false starts and repeated
points, and tightening the story to a target length. This pipeline mostly does `removeSilences`, `cleanFillers`,
captions, a few zooms and B-roll. `SemanticTakeCurator`, `repetition.ts`, `hooks.ts` and `highlights.ts` exist in
`video-engine-runtime/src/intelligence/` but are **not wired into the mobile Director path**.

### 5. Prompt overload, thin craft knowledge.

One user message carries: persona, rules, ~55 JSON schemas, up to ~24k chars of timeline JSON, a full
word-level transcript (up to 2,500 words) **and** the same transcript again as spoken lines. The craft guidance is
six bullets. There are no worked examples of a great edit and no numeric pacing targets per style. A model asked
to do everything at once in one pass does each part shallowly.

### 6. Many post-model filters quietly strip creative intent.

After the model answers, these can each delete or downgrade operations: scope filter, `guardDestructiveVariants`,
`applyItemLocks`, `CreativePlanValidator` (drops ops), `gateRendererFeatures`, `PlanExpander` rewrites,
`snapToBeats`, critic repairs. Each is sensible alone; together the user gets a thinner edit than the model
planned, with the reasons buried in `warnings`.

### 7. Conversation gate adds friction.

A vague ask ("edit this") goes greet → recommend → confirm → execute: up to three round trips before any edit,
and the greeting turn is deterministic (no LLM).

---

## Part 2: The permanent fix (architecture)

Rebuild the Director as **an agent that sees, plans in stages, acts with feedback, and checks its own render**:

```
Phone: analyse clip ──► keyframe contact sheet (1/scene + every ~2s, 512px JPEG) + transcript + signals
                                      │ (consented upload, deleted after analysis)
Server: 1. VISION PASS  ─► per-shot log (what's visible, framing, subject box, quality, B-roll-worthiness), cached by asset hash
        2. STORY PASS   ─► hook, keeper segments, retakes/repeats removed, target length   (cuts only)
        3. ENHANCE PASS ─► captions, zooms on real subject boxes, B-roll matched to words+shots, music, SFX
           (multi-turn tool loop with real tool_result messages; tools can query words/shots for a range)
        4. COMPILE + structural critic (existing)
Phone: render low-res proxy, sample frames at every cut / zoom / B-roll / title
Server: 5. VISUAL CRITIC (vision model) ─► repair ops, one or two bounded rounds ─► final timeline
```

Principles: correct current models from config; errors loud, never silent fallback; every stage has an eval;
keep all existing safety (locks, scope, untrusted-content fencing, renderer gating).

**Decision (2026-11-13): hybrid.** The phone keeps doing all heavy analysis on the device (face boxes, scene
cuts, motion, blur/exposure, OCR, labels) and never uploads the video. With the creator's one-time consent it
uploads only a small set of still frames (about 60 per clip, 512 px JPEG) for the vision pass and the visual
critic; they are deleted after the pass (24 h maximum). A creator who declines gets the on-device-only mode: the
Director uses the on-device signals and says it cannot see the footage. Reason: on-device vision models can
detect things but cannot judge an edit (best take, framing, B-roll fit); a server vision model can. Audio already
goes to the server for transcription, so this extends an existing consented upload rather than breaking a rule.

**The original question:** your rule today is "media never leaves the device". Steps 1 and 5 need
low-res frames on the server (with consent, short retention). The alternative is on-device image description
(weaker quality). The plan below assumes consented frame upload; change Phase 2 if you choose on-device.

---

## Part 3: Phases

Ground rules for every phase:
- Work one phase at a time. At the start of each phase, restate its goal, list the files you will touch, then
  implement. At the end, run `pnpm test` plus the phase's own tests and paste results. Stop and report; do not
  start the next phase.
- Do not remove existing safety: item locks, scope filtering, locked ranges, fenceUntrusted / prompt-injection
  handling, gateRendererFeatures, guardDestructiveVariants. You may make them report more clearly.
- Never fail silently. Any LLM/provider error must be logged with provider, model and reason and surfaced in
  plannerReason. A deterministic fallback must be clearly shown to the creator in the app.
- No hardcoded model IDs in code paths: every model ID comes from config (env or the admin vault) with one
  documented default per provider in a single file.
- Add tests for every behaviour change. Keep diffs focused; no unrelated refactors.

**PHASE 0 — Baseline and visibility**
1. Add a structured log line per Director turn: provider, model, plannerSource, plannerReason, llmCalls,
   ops planned vs ops applied vs ops dropped (with which filter dropped each), latency.
2. Add an admin/debug endpoint or report that shows the % of turns that were deterministic in the last N days.
3. In the Flutter director panel, when plannerSource == 'deterministic', show a clear banner with the reason.
4. Create an eval harness: scripts/director-eval/ with 5 fixture inputs (talking head 45s, interview with two
   speakers, vlog with motion, tutorial/screen, multi-clip). Each fixture = the MobileAIDirectRequest JSON the
   phone would send + reference notes on what a good edit must do. The harness runs directMobile against a
   configured real LLM and writes a report (ops, warnings, critic score, plannerSource).
Acceptance: logs present, banner visible in a widget test, eval harness runs and produces a report.

**PHASE 1 — Fix the LLM provider layer** (packages/domains/ai/src/kernel/ai-provider.service.ts and callers)
1. Central model config: AI_DIRECTOR_MODEL_<PROVIDER> env vars, then the vault's per-provider `model`, then one
   default per provider. Use current, supported tool-calling models (look up the provider's current model list;
   do not keep retired IDs like gemini-1.5-*, gemini-pro, claude-3-5-sonnet-20240620).
2. Gemini: honour options.model and temperature; clamp max output tokens to the model's limit; never return
   {text:''} on error: throw a typed ProviderError with the provider message.
3. Claude: use a proper system prompt (persona + rules) separate from the user content; pass temperature; use
   the Messages API multi-turn format so tool_result blocks can be returned (needed in Phase 4); support image
   content blocks.
4. OpenAI: same treatment (system message, current model, image input support, tool results).
5. Add a `generateAgentTurn(messages, tools, options)` method to AIClient that takes a full message list
   (system, user, assistant tool calls, tool results, images) for all providers that support it.
6. Fix the admin "model display" to show the real configured model.
7. Change provider precedence so the Director uses AI_DIRECTOR_PROVIDER if set, then the configured default,
   and only then any available key. Document it in .env.example.
Acceptance: unit tests with mocked SDKs for each provider (model passed through, errors thrown, tool results
round-trip, images accepted); eval harness shows 0% deterministic fallback with a valid key.

**PHASE 2 — Give the Director eyes**
1. Mobile (Kotlin MediaIntelligence/FrameJobs + Swift equivalent): extract a keyframe set per source: one frame
   per detected scene plus one every ~2 s (cap ~60 frames), 512 px long side, JPEG q≈70, with source timestamps.
   Cache by source hash. Only upload after the creator has consented (add a one-time consent sheet + setting).
2. Backend: POST /api/v1/media-editor/frames (requireNativeDevice, size/type limits, per-asset), stored with a
   short TTL (e.g. 24 h) and deleted after the vision pass. Update AI_DIRECTOR_CONTRACT.md.
3. Vision pass service: send frames in batches to a vision model; produce a ShotLog per source:
   [{startMs,endMs, description, subjects:[{label, box:{x,y,w,h} in 0..1}], framing (wide/medium/close),
   cameraMotion, quality issues (blur, dark, overexposed, shaky), onScreenText, brollSuitability 0..1,
   emotion/energy}]. Zod schema in packages/video-contracts. Cache by asset hash so it runs once per clip.
4. Feed a compact ShotLog section into the planner prompt (replace the label-word list). Use real subject boxes
   for zoom targetCoords and reframe tracking.
5. Fix DIRECTOR_PERSONA: claim it can see the video only when a ShotLog exists; otherwise say what is missing.
Acceptance: fixtures extended with frames; ShotLog schema tests; eval report shows zooms centred on detected
subjects and B-roll queries that reference both words and visuals.

**PHASE 3 — Story pass (editorial selection) before decoration**
1. New stage `StoryPlanner` (packages/domains/ai/src/builders/story-planner.ts). Input: transcript (spoken lines,
   speaker labels when present), ShotLog, brand/piece context, target platform and target duration. Output (Zod):
   hook segment, ordered keeper segments with narrative role (hook/setup/point/proof/payoff/cta), removed
   segments with reason (retake, false start, repeated point, off-topic, dead air), target duration.
2. Wire in the existing helpers in packages/video-engine-runtime/src/intelligence (repetition.ts, hooks.ts,
   highlights.ts, semantic-take-curator.ts) as signals the StoryPlanner sees; do not trust them blindly.
3. Convert the story into removeRange / reorderSegment ops; keep PlanExpander.speechSafeCut so no word is
   clipped; respect locked ranges.
4. For a full edit, run StoryPlanner first, compile, then run the enhancement planner on the cut timeline.
Acceptance: eval fixtures with known retakes/repeats are cut correctly; the hook starts within the first
spoken line of the chosen hook segment; no clipped words (existing critic checks).

**PHASE 4 — Agentic enhancement loop with real tool feedback**
1. Replace the one-shot planWithSource call for full edits with a bounded loop (max ~8 model turns, overall
   time budget configurable) using generateAgentTurn:
   - read-only tools: get_words(startSec,endSec), get_shots(startSec,endSec), get_timeline_summary(),
     search_broll(query, aspect) -> top results with thumbnails (images returned to the model),
     search_music(mood, durationSec).
   - edit tools: the existing DIRECTOR_TOOL_SPECS, applied to a working timeline via EditIRCompiler after each
     turn; return a tool_result per call: applied / rejected + reason / what changed.
   - finish_edit ends the loop.
2. Split the enhancement into ordered stages inside the loop, each with only its tools: captions → zooms and
   reframe → B-roll and stickers/titles → music and SFX → transitions/colour. Fewer tools per turn.
3. Keep the scoped path (modify_existing) as a short loop limited to its tools.
4. Every filter that drops an op (scope, guards, locks, validator, gating) must return its reason as a tool_result
   so the model can adapt, instead of dropping silently.
Acceptance: unit tests with a scripted fake LLM covering apply / reject / retry; eval report shows fewer dropped
ops and no partial plans; COVERAGE retry becomes rarely needed (log it).

**PHASE 5 — Look at the result (visual critic)**
1. Phone: after the Director's timeline is applied, render a fast low-res proxy (e.g. 360p, hardware encoder) or
   grab frames directly from the composition at: every cut ±0.2 s, each zoom peak, each B-roll/title/sticker
   midpoint, first 3 s (hook). Upload as frames (same consent + TTL rules).
2. Server: VisualCritic (vision model) scores against a rubric: hook in 1.5 s, subject in frame/safe zone,
   captions readable and not covering face, B-roll relevant and not jarring, zooms not cropping heads, no awkward
   jump cuts, colour consistent, pacing for the chosen style. Output: score + issues + concrete repair ops.
3. Run at most 2 repair rounds through the Phase 4 loop; never undo what the creator explicitly asked for.
4. Report the final score and the fixes in the creator-facing "done" message (short, plain words).
Acceptance: fixtures with planted problems (caption over face, zoom cutting off head, irrelevant B-roll) are
detected and repaired in the eval.

**PHASE 6 — Craft knowledge and style playbooks**
1. Move editing craft into versioned style playbooks (packages/video-contracts/src/style-playbooks/*.ts):
   per style (fast/Hormozi/MrBeast, calm/educational, cinematic vlog, podcast clip) numeric targets: max static
   shot length, cut rate, zoom frequency and scale, caption template, B-roll density, music level, SFX density.
2. Inject only the chosen playbook (not all of them) into each stage prompt, plus 1–2 compact worked examples of
   a great edit for that style (input summary → ops).
3. Measure each finished edit against its playbook in the critic (pacing stats from deriveEditStyle).
Acceptance: eval report shows playbook targets met within tolerance per fixture.

**PHASE 7 — Regression gate**
1. Add the eval harness to CI as a nightly job (real LLM, small budget) and a PR job with recorded LLM responses.
2. Add an LLM-as-judge score (vision model, rubric from Phase 5) per fixture, stored over time; fail the nightly
   if the median drops by more than a set threshold.
3. Write docs/social-studio-mobile/AI_DIRECTOR_V2.md describing the pipeline, contracts, consent and retention.
Acceptance: CI job green; dashboard/report of scores per run.

---

## Part 4: Quick wins (before the big rebuild)

1. Set `AI_PROVIDER=claude` (or `openai`) explicitly and set `AI_DIRECTOR_CLAUDE_MODEL` to a current model ID
   valid on your key, so the Director stops landing on the broken Gemini path.
2. Check the run log: count turns with `plannerSource: "deterministic"` and read their `plannerReason`
   (now: `GET /media-editor/director-report` or grep `[AI Director][turn]`).
3. Remove "You can see their video" from `DIRECTOR_PERSONA` until frames exist; the false claim makes the model
   overconfident about visual choices.
