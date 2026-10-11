"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreativePlanner = void 0;
exports.requestedFeatures = requestedFeatures;
exports.missingRequestedOperations = missingRequestedOperations;
exports.directorLlmTimeoutMs = directorLlmTimeoutMs;
const video_contracts_1 = require("@workspace/video-contracts");
const ai_provider_service_1 = require("../kernel/ai-provider.service");
const MAX_TRANSCRIPT_WORDS = 2500;
const SPOKEN_LINE_PAUSE_SEC = 0.6;
const MAX_HISTORY_TURNS = 12;
/**
 * What the creator explicitly asked for, as tool families. A plan that skips one of these is sent back to the model
 * once ("you skipped …"); weaker models often stop after the cuts. Negated asks ("no music", "don't zoom") and asks
 * that cannot be done (captions without a transcript) are not required.
 */
const COVERAGE_RULES = [
    { label: "captions", ask: /\b(captions?|subtitles?)\b/, ops: ["autoCaptions", "styleCaption"], needsTranscript: true },
    { label: "caption translation", ask: /\b(translate (the |my )?(captions?|subtitles?)|(captions?|subtitles?) (in|into|to) (hinglish|roman|english|hindi|tamil|telugu|bengali|marathi|gujarati|urdu|punjabi|spanish|french)|hinglish (captions?|subtitles?))\b/, ops: ["translateCaptions"], needsTranscript: true },
    { label: "zoom / punch-in", ask: /\b(zooms?|punch[- ]?ins?)\b/, ops: ["addZoom", "reframeSubject"] },
    { label: "B-roll", ask: /\b(b[- ]?roll|cutaways?|stock (clip|footage|video))\b/, ops: ["insertBroll"] },
    { label: "sticker", ask: /\b(stickers?|emojis?)\b/, ops: ["addSticker"] },
    { label: "background music", ask: /\b(music|soundtrack|bgm)\b/, ops: ["addBackgroundMusic"] },
    { label: "colour grade", ask: /\b(colou?r ?grad\w*|grade|filter|lut)\b/, ops: ["applyFilter"] },
    { label: "title text", ask: /\b(title|headline|hook text|text overlay)\b/, ops: ["addText"] },
    { label: "transitions", ask: /\b(transitions?|crossfades?|dissolves?)\b/, ops: ["addTransition"] },
    { label: "filler-word removal", ask: /\bfillers?\b/, ops: ["cleanFillers"], needsTranscript: true, removal: true },
    { label: "sound effects", ask: /\b(sound effects?|sfx|whoosh\w*)\b/, ops: ["addSoundEffect", "autoSoundDesign"] },
];
const NEGATION = /\b(no|not|don'?t|do not|without|remove|keep|skip|never)\b[\w\s,'-]{0,24}$/;
/** Feature labels the creator explicitly asked for (see COVERAGE_RULES). */
function requestedFeatures(prompt, hasTranscript) {
    const text = prompt.toLowerCase();
    const out = [];
    for (const r of COVERAGE_RULES) {
        const m = r.ask.exec(text);
        if (!m)
            continue;
        // "remove / cut the fillers" is the ask itself, not a negation.
        if (!r.removal && NEGATION.test(text.slice(Math.max(0, m.index - 30), m.index)))
            continue;
        if (r.needsTranscript && !hasTranscript)
            continue;
        out.push(r.label);
    }
    return out;
}
/** Requested tool families the plan does not contain. */
function missingRequestedOperations(prompt, operationTypes, hasTranscript) {
    const have = new Set(operationTypes);
    const wanted = new Set(requestedFeatures(prompt, hasTranscript));
    return COVERAGE_RULES.filter((r) => wanted.has(r.label) && !r.ops.some((o) => have.has(o))).map((r) => `${r.label} (${r.ops.join(" / ")})`);
}
/** Model defaults per provider. Anthropic default follows the product decision (latest Sonnet). */
function modelFor(provider, override) {
    if (override)
        return override;
    if (provider === "claude")
        return process.env.AI_DIRECTOR_CLAUDE_MODEL || "claude-sonnet-5";
    if (provider === "openai")
        return process.env.AI_DIRECTOR_OPENAI_MODEL || undefined;
    return undefined;
}
/** Per-call LLM timeout: `AI_DIRECTOR_LLM_TIMEOUT_MS` (default 60 s). A timeout is a DirectorTimeoutError. */
function directorLlmTimeoutMs(override) {
    if (override && override > 0)
        return override;
    const env = Number(process.env.AI_DIRECTOR_LLM_TIMEOUT_MS);
    return Number.isFinite(env) && env > 0 ? env : 60000;
}
function llmFailureReason(what, label, err) {
    if (err instanceof video_contracts_1.DirectorTimeoutError)
        return `LLM_TIMEOUT: ${what} (${label}) ${err.message}`;
    return `${what} failed (${label}): ${truncate(err?.message || String(err), 240)}`;
}
class CreativePlanner {
    /**
     * Backwards-compatible entry point: returns only the plan.
     * Prefer `planWithSource`, which also reports whether an LLM or the deterministic engine planned.
     */
    static async plan(params) {
        return (await this.planWithSource(params)).plan;
    }
    /**
     * LLM-first planning via structured tool calling:
     *   1. resolve an LLM client (company key or platform env key)
     *   2. model calls one tool per CreativeOperation (schemas derived from the Zod union)
     *   3. every call is Zod-validated; on failure ONE repair retry is made with the errors
     *   4. no key / call failure / still-invalid output => deterministic planner, and the
     *      outcome says so explicitly (plannerSource + plannerReason). Never silent.
     */
    static async planWithSource(params) {
        const { client, reason: noClientReason, model } = await this.resolveClient(params);
        if (!client) {
            return this.deterministicOutcome(params, noClientReason, 0);
        }
        if (typeof client.generateWithTools !== "function") {
            return this.deterministicOutcome(params, `LLM provider "${client.provider}" does not support tool calling`, 0);
        }
        const tools = (0, video_contracts_1.buildDirectorToolDefinitions)();
        const basePrompt = this.buildPrompt(params);
        const options = { max_tokens: 16000, temperature: 0.2 };
        if (model)
            options.model = model;
        const label = `${client.provider}${model ? `/${model}` : ""}`;
        const timeoutMs = directorLlmTimeoutMs(params.llmTimeoutMs);
        let first;
        try {
            first = await (0, video_contracts_1.withTimeout)(client.generateWithTools(basePrompt, tools, options), timeoutMs, "LLM call");
        }
        catch (err) {
            return this.deterministicOutcome(params, llmFailureReason("LLM call", label, err), 1);
        }
        const firstCalls = first?.toolCalls || [];
        if (firstCalls.length === 0) {
            const text = (first?.text || "").trim();
            if (!text)
                return this.deterministicOutcome(params, `LLM (${label}) returned an empty response`, 1);
            // A text-only answer is a legitimate conversational reply (greeting, clarifying question).
            return {
                plan: this.buildPlan(params, [], text, false),
                plannerSource: "llm",
                plannerReason: `${label} replied without edits (conversational turn)`,
                llmAttempts: 1,
            };
        }
        let validation = (0, video_contracts_1.validateDirectorToolCalls)(firstCalls);
        let attempts = 1;
        let repairedErrors;
        if (validation.errors.length > 0) {
            repairedErrors = validation.errors;
            attempts = 2;
            const repairPrompt = this.buildRepairPrompt(basePrompt, firstCalls, validation.errors);
            let second;
            try {
                second = await (0, video_contracts_1.withTimeout)(client.generateWithTools(repairPrompt, tools, options), timeoutMs, "LLM repair call");
            }
            catch (err) {
                return this.deterministicOutcome(params, llmFailureReason("LLM repair call", label, err), 2);
            }
            const retry = (0, video_contracts_1.validateDirectorToolCalls)(second?.toolCalls || []);
            if (retry.errors.length > 0 || (retry.operations.length === 0 && !retry.finish)) {
                const errs = retry.errors.length > 0 ? retry.errors : ["no tool calls in repair response"];
                return this.deterministicOutcome(params, `LLM output (${label}) failed validation after 1 repair attempt: ${truncate(errs.join(" | "), 400)}`, 2);
            }
            validation = retry;
        }
        // Coverage: everything the creator explicitly asked for must be planned (or honestly skipped by the model).
        const hasTranscript = (params.mediaGraph?.transcript?.length ?? 0) > 0;
        const missing = params.checkCoverage === false ? [] : missingRequestedOperations(params.prompt, validation.operations.map((o) => o.type), hasTranscript);
        let coverageNote = "";
        if (missing.length > 0) {
            const calls = validation.operations.map((o) => ({ name: o.type, args: o }));
            const prompt = this.buildCoveragePrompt(basePrompt, calls, missing);
            try {
                const third = await (0, video_contracts_1.withTimeout)(client.generateWithTools(prompt, tools, options), timeoutMs, "LLM coverage call");
                const retry = (0, video_contracts_1.validateDirectorToolCalls)(third?.toolCalls || []);
                const stillMissing = missingRequestedOperations(params.prompt, retry.operations.map((o) => o.type), hasTranscript);
                if (retry.errors.length === 0 && retry.operations.length > 0 && stillMissing.length < missing.length) {
                    validation = retry;
                    coverageNote = `, completed ${missing.length - stillMissing.length} skipped request(s)`;
                }
                else {
                    coverageNote = ", coverage retry not better";
                }
            }
            catch {
                coverageNote = ", coverage retry failed";
            }
            attempts += 1;
        }
        const summary = validation.finish?.summary || this.summarizeOperations(validation.operations);
        return {
            plan: this.buildPlan(params, validation.operations, summary, validation.finish?.requiresConfirmation ?? false),
            plannerSource: "llm",
            plannerReason: `${label} tool-calling plan (${attempts} attempt${attempts === 1 ? "" : "s"}${repairedErrors ? ", repaired" : ""}${coverageNote})`,
            llmAttempts: attempts,
            repairedErrors,
            brandWatermark: validation.finish?.brandWatermark,
            preserve: validation.finish?.preserve,
        };
    }
    static async resolveClient(params) {
        if (params.llmClient !== undefined) {
            if (params.llmClient === null)
                return { client: null, reason: "LLM disabled for this request" };
            return { client: params.llmClient, reason: "", model: modelFor(params.llmClient.provider, params.llmModel) };
        }
        if (!params.companyId) {
            return { client: null, reason: "no workspace (company) context, so no LLM key could be resolved" };
        }
        let settings;
        try {
            // Lazy import: keeps prisma out of the module graph for callers that inject a client.
            const { AICompanyConfigService } = await Promise.resolve().then(() => __importStar(require("../kernel/ai-company-config.service")));
            settings = (await AICompanyConfigService.getCompanyAISettings(params.companyId)).settings;
        }
        catch (err) {
            return { client: null, reason: `could not load AI settings: ${truncate(err?.message || String(err), 160)}` };
        }
        const client = await ai_provider_service_1.AIProviderService.getInstance().getClient(settings);
        if (!client) {
            return { client: null, reason: `no LLM key configured for this workspace (provider "${settings.aiProvider || "none"}")` };
        }
        return { client, reason: "", model: modelFor(client.provider, params.llmModel) };
    }
    static deterministicOutcome(params, reason, attempts) {
        const plan = this.planDeterministically(params.prompt, params.timelineContext, params.mediaGraph, params.directorState, params.availableAssets);
        return { plan, plannerSource: "deterministic", plannerReason: reason, llmAttempts: attempts };
    }
    static buildPlan(params, operations, explanation, requiresConfirmation) {
        const ctx = params.timelineContext;
        const reframe = operations.find((o) => o.type === "reframeSubject" || o.type === "changeAspectRatio");
        const aspect = reframe?.targetAspect || ctx.currentAspect;
        return {
            version: "1.0.0",
            intent: {
                platform: aspect === "9:16" ? "tiktok" : "general",
                aspectRatio: aspect,
                resolution: ctx.currentResolution,
                stylePreset: "CUSTOM",
                energy: "medium",
                pacing: "dynamic",
                captionStyle: "HORMOZI_BOUNCE",
                audioStyle: "VOICE_PRIORITY_DUCKED",
                visualStyle: "CLEAN_ATTENTION",
            },
            constraints: ctx.userConstraints,
            selectedSegments: [],
            removedSegments: [],
            reorderedSegments: [],
            brollPlan: [],
            captionPlan: [],
            operations,
            confidence: 0.9,
            explanation,
            requiresConfirmation,
        };
    }
    static summarizeOperations(ops) {
        if (ops.length === 0)
            return "No changes were needed.";
        const names = Array.from(new Set(ops.map((o) => o.type)));
        return `Applied ${ops.length} edit${ops.length === 1 ? "" : "s"}: ${names.join(", ")}.`;
    }
    /** Builds the full director prompt. Exported for tests / prompt inspection. */
    static buildPrompt(params) {
        const ctx = params.timelineContext;
        const g = params.mediaGraph;
        const lines = [];
        lines.push(`You are the AI Director inside 180 Social Studio, an elite autonomous video directing and editing engine. You edit the creator's video by CALLING TOOLS with deep cinematic consciousness, editorial mastery, and viral retention intelligence. Each tool call is one timeline operation; the server validates every argument and applies them deterministically.`, ``, `## AI Director Consciousness & Editorial Mastery:`, `1. THE 3-SECOND RETENTION HOOK:`, `   - Short-form attention drops 65% in the first 3 seconds.`, `   - Eliminate dead air or throat-clearing at t=0 immediately (start tight on the first spoken syllable).`, `   - Introduce a visual pattern interrupt in the first 1.5s: punch-in zoom (addZoom 1.2x on speaker face), bold kinetic title, or a curiosity cutaway.`, `   - Punctuate the hook with an acoustic whoosh, riser, or pop using addSoundEffect or autoSoundDesign.`, ``, `2. PACING RHYTHM & PATTERN INTERRUPTS:`, `   - Human visual habituation occurs after 2.5-3 seconds. Never leave the frame completely static for longer than 4 seconds.`, `   - Conscious rhythm: Alternate between Main Camera -> Punch-in Zoom on key phrases -> Context B-roll Overlay -> Highlighted Captions -> Title Callouts.`, `   - For high-energy styles (MrBeast, Hormozi): cut silences > 0.4s, add dynamic zooms on punchlines, kinetic captions with highlight colors, frequent sound design.`, `   - For documentary / educational styles (Vox, Ali Abdaal): cleaner cuts, elegant lower thirds, atmospheric B-roll, calm color look, subtle background music.`, ``, `3. 4-TIER AUDIO MIXING & SOUND DESIGN:`, `   - Tier 1: Voice (clear, prioritised dialog, untouched or normalized).`, `   - Tier 2: Background Music (addBackgroundMusic with duckUnderSpeech=true; music must duck -18dB to -22dB beneath speech so voice is never masked).`, `   - Tier 3: Audio Punctuation (whoosh on zooms/cuts, pops on title reveals, sub-bass drops on revelations via autoSoundDesign or addSoundEffect).`, `   - Tier 4: Ambient Atmosphere (continuity under B-roll cutaways).`, ``, `4. B-ROLL & VISUAL SOURCING CONSCIOUSNESS:`, `   - You have access to vast global multi-provider media archives: Pexels 4K, Pixabay HD Videos & Vectors, NASA Public Domain Archive (Earth/Space/Technology/Science), Wikimedia Commons, and FreePD.`, `   - Use insertBroll with vivid, specific stockQuery terms (e.g. 'drone skyline sunset', 'spacewalk earth orbit', 'laptop keyboard typing code', 'cyberpunk neon crowd').`, `   - Keep B-roll overlays aligned with spoken concepts (cutaways should visually demonstrate or metaphorically amplify what the speaker is explaining).`, ``, `5. FRAMING & SAFE ZONES:`, `   - When reframing to 9:16 (TikTok/Reels/Shorts), keep faces and captions centered within the middle 60% vertical safe zone, avoiding top status bar and bottom platform UI overlays.`, ``, `Rules:`, `- All times are SECONDS on the CURRENT timeline described below (0 .. ${ctx.projectDurationSec.toFixed(2)}). Never go past the end.`, `- Times in one response all refer to the timeline as it is NOW, before any of your operations; the server orders cuts safely. Do not adjust later times for earlier cuts.`, `- Do what the creator asked. For vague style requests ("make it punchier for TikTok") choose a small set of concrete, tasteful operations (e.g. remove pauses, captions, 1-3 zooms on key moments, vertical reframe, autoSoundDesign).`, `- Use the transcript to find moments ("the punchline", "when I talk about the gym"). A zoom on a moment should start just before the key words.`, `- Prefer removeSilences over many removeRange calls for pauses, and autoCaptions for captions.`, `- Colours are #RRGGBB (yellow = #FFE600, cyan = #00E5FF, white = #FFFFFF).`, `- A named caption look (MrBeast, Hormozi, Ali Abdaal, neon, cinematic ...) is a template: set autoCaptions.template, or styleCaption.preset when captions already exist. Add highlightColor only when a colour is named ("MrBeast captions with red highlights" -> template MRBEAST_HYPE, highlightColor #EF4444).`, `- If something is impossible (e.g. captions without a transcript), do NOT fake it: skip that tool and say so in finish_edit.`, `- Finish with exactly one finish_edit call containing a short, specific summary of what you changed.`, `- When the creator asks to keep something unchanged ("don't touch the music", "keep the first 10 seconds"), put it in finish_edit.preserve and do not edit it.`, `- ${video_contracts_1.UNTRUSTED_DATA_POLICY}`, ``);
        lines.push(`## Current timeline`);
        lines.push(`- duration: ${ctx.projectDurationSec.toFixed(2)}s, canvas ${ctx.currentAspect} (${ctx.currentResolution.width}x${ctx.currentResolution.height}), ${ctx.clipsCount} clip(s)`);
        if (params.currentEditIR)
            lines.push(...this.describeEditIR(params.currentEditIR));
        lines.push(``);
        lines.push(`## Media analysis (timeline seconds)`);
        const words = g.transcript || [];
        if (words.length === 0) {
            lines.push(`Transcript: NONE AVAILABLE (captions, filler removal and transcript-based edits are not possible).`);
        }
        else {
            const shown = words.slice(0, MAX_TRANSCRIPT_WORDS);
            lines.push(`Transcript (${words.length} words, format start-end:word${words.length > shown.length ? `, first ${shown.length} shown` : ""}):`);
            // Spoken words are untrusted data (a video can say "ignore your instructions"): fenced and neutralised.
            // Phrase detection runs on the joined words (the timed listing would hide "ignore previous instructions").
            const safeWords = (0, video_contracts_1.neutraliseWordSequence)(shown.map((w) => w.word)).words;
            lines.push((0, video_contracts_1.fenceUntrusted)("transcript", shown.map((w, i) => `${w.startSeconds.toFixed(2)}-${w.endSeconds.toFixed(2)}:${safeWords[i]}`).join(" "), { maxChars: 120000 }).block);
            // The same words as spoken lines (split at pauses), so sentences, questions and changes of speaker are
            // readable; a long pause before/after a line that sounds like a question usually means another speaker.
            const spoken = [];
            let from = 0;
            for (let i = 1; i <= shown.length; i++) {
                if (i < shown.length && shown[i].startSeconds - shown[i - 1].endSeconds < SPOKEN_LINE_PAUSE_SEC)
                    continue;
                const gapBefore = from > 0 ? shown[from].startSeconds - shown[from - 1].endSeconds : shown[0].startSeconds;
                spoken.push(`[${shown[from].startSeconds.toFixed(2)}-${shown[i - 1].endSeconds.toFixed(2)}, pause before ${gapBefore.toFixed(1)}s] ${safeWords.slice(from, i).join(" ")}`);
                from = i;
            }
            lines.push(`Spoken lines (split at pauses of ${SPOKEN_LINE_PAUSE_SEC}s+; speakers are NOT labelled, judge from wording and pauses):`);
            lines.push((0, video_contracts_1.fenceUntrusted)("transcript", spoken.join("\n"), { maxChars: 60000 }).block);
        }
        const sil = g.silences || [];
        lines.push(sil.length === 0
            ? `Silences: none detected/supplied.`
            : `Silences (start+duration): ${sil.slice(0, 200).map((s) => `${s.startSeconds.toFixed(2)}+${s.durationSeconds.toFixed(2)}`).join(", ")}`);
        const sceneStarts = (g.scenes || []).map((s) => s.startSeconds).filter((t) => t > 0);
        if (sceneStarts.length)
            lines.push(`Scene cuts at: ${sceneStarts.slice(0, 100).map((t) => t.toFixed(2)).join(", ")}`);
        if (g.faces?.[0]?.averageCoords)
            lines.push(`Main face centre (0..1): x=${g.faces[0].averageCoords.x.toFixed(2)}, y=${g.faces[0].averageCoords.y.toFixed(2)}`);
        const assets = params.availableAssets || [];
        if (assets.length > 0) {
            lines.push(`Available assets for B-roll (assetId: name, duration):`);
            lines.push((0, video_contracts_1.fenceUntrusted)("filename", assets.slice(0, 30).map((a) => `${(0, video_contracts_1.sanitizeInlineUntrusted)(a.id, 128)}: ${(0, video_contracts_1.sanitizeInlineUntrusted)(a.name, 120)}, ${a.durationSeconds}s`).join("; ")).block);
        }
        const c = ctx.userConstraints;
        const constraints = [
            c.doNotRemoveIntro ? "do not cut anything in the first 5s" : null,
            c.doNotAddMusic ? "do not add music" : null,
            ...(c.protectedTimeRanges || []).map((r) => `LOCKED ${r.startSec.toFixed(2)}s-${(r.startSec + r.durationSec).toFixed(2)}s (no cuts, speed changes, reorders, zooms, B-roll, effects or text there)`),
            ...(c.lockedTracks || []).map((t) => `LOCKED ${t} track (do not change it)`),
        ].filter(Boolean);
        if (constraints.length)
            lines.push(`Creator constraints (enforced by the server; operations that break them are dropped): ${constraints.join("; ")}`);
        lines.push(``);
        const history = (params.history || []).slice(-MAX_HISTORY_TURNS);
        if (history.length) {
            lines.push(`## Conversation so far (oldest first)`);
            for (const t of history)
                lines.push(`${t.role === "user" ? "Creator" : "Director"}: ${truncate(t.content, 600)}`);
            lines.push(``);
        }
        if (params.contextSections?.length)
            lines.push(...params.contextSections);
        lines.push(`## Creator's request`);
        lines.push(JSON.stringify(params.prompt));
        return lines.join("\n");
    }
    static describeEditIR(ir) {
        const s = (t) => video_contracts_1.RationalTimeMath.toSeconds(t).toFixed(2);
        const out = [];
        const main = ir.tracks.videoTracks[0];
        if (main) {
            const clips = main.clips.slice(0, 40).map((c) => {
                const rot = c.transform?.rotationDeg ? ` rot${c.transform.rotationDeg}` : "";
                const flip = c.transform?.flipH ? " mirrored" : "";
                const mute = (c.volumeDb ?? 0) <= -60 ? " muted" : "";
                return `${c.id}[${s(c.timelineRange.start)}+${s(c.timelineRange.duration)}${(c.speedMultiplier || 1) !== 1 ? ` @${c.speedMultiplier}x` : ""}${rot}${flip}${mute}]`;
            });
            out.push(`- main clips: ${clips.join(" ")}${main.clips.length > 40 ? " ..." : ""}`);
        }
        const caps = ir.tracks.captionTrack.filter((c) => c.role !== "title");
        const titles = ir.tracks.captionTrack.filter((c) => c.role === "title");
        out.push(`- captions: ${caps.length}${caps[0] ? ` (preset ${caps[0].style.preset}, text ${caps[0].style.textColor}, highlight ${caps[0].style.highlightColor})` : ""}; titles: ${titles.map((t) => `${t.id}:"${(0, video_contracts_1.sanitizeInlineUntrusted)(truncate(t.text, 40), 60)}"@${s(t.timeRange.start)}+${s(t.timeRange.duration)}`).join(", ") || "none"}`);
        out.push(`- zooms: ${ir.tracks.cameraTrack.map((z) => `${z.id}@${s(z.timeRange.start)}+${s(z.timeRange.duration)} x${z.scale}`).join(", ") || "none"}`);
        const fx = ir.tracks.effectTrack ?? [];
        if (fx.length)
            out.push(`- effects: ${fx.slice(0, 40).map((e) => `${e.id}:${e.type}@${s(e.timeRange.start)}+${s(e.timeRange.duration)}`).join(", ")}`);
        const sfx = ir.tracks.audioTracks.filter((t) => t.type === "SFX").flatMap((t) => t.clips);
        if (sfx.length)
            out.push(`- sound effects: ${sfx.slice(0, 40).map((c) => `${c.id}@${s(c.timelineRange.start)}`).join(", ")}`);
        const vo = ir.tracks.audioTracks.filter((t) => t.type === "VOICEOVER").flatMap((t) => t.clips);
        if (vo.length)
            out.push(`- creator's recorded voiceovers (keep them; music ducks under them): ${vo.slice(0, 20).map((c) => `${s(c.timelineRange.start)}+${s(c.timelineRange.duration)}`).join(", ")}`);
        const broll = ir.tracks.videoTracks.filter((t) => t.type !== "MAIN_VIDEO").flatMap((t) => t.clips);
        const layerDesc = (b) => b.layer?.mode === "overlay" ? ` layer(x${b.layer.x} y${b.layer.y} scale${b.layer.scale}${b.layer.keyframes?.length ? " keyframed" : ""})` : "";
        out.push(`- b-roll overlays: ${broll.map((b) => `${b.id}(${(0, video_contracts_1.sanitizeInlineUntrusted)(b.assetId, 60)})@${s(b.timelineRange.start)}+${s(b.timelineRange.duration)}${layerDesc(b)}`).join(", ") || "none"}`);
        const bgm = ir.tracks.audioTracks.find((t) => t.type === "BGM" && t.clips.length > 0);
        out.push(`- music: ${bgm ? `yes (track "${bgm.id}", ${bgm.volumeDb}dB${bgm.duckWithSpeech ? ", ducked under speech" : ""})` : "none"}`);
        const original = ir.tracks.audioTracks.find((t) => t.id === "original");
        out.push(`- original audio (trackId "original"): ${original ? original.volumeDb : 0}dB`);
        // Measured edit style + the still-raw tail, so "complete / continue this video" follows the creator's own style.
        out.push(...(0, video_contracts_1.describeEditStyle)((0, video_contracts_1.deriveEditStyle)(ir)));
        return out;
    }
    static buildCoveragePrompt(basePrompt, calls, missing) {
        return [
            basePrompt,
            ``,
            `## Your previous plan skipped part of the creator's request`,
            `Previous tool calls: ${truncate(JSON.stringify(calls), 6000)}`,
            `The creator explicitly asked for these, and the plan has none of them:`,
            ...missing.map((m) => `- ${m}`),
            ``,
            `Call the tools again with the COMPLETE set of operations (keep the good ones, add the missing ones), then finish_edit. If one is truly impossible with this footage, skip it and say why in finish_edit.`,
        ].join("\n");
    }
    static buildRepairPrompt(basePrompt, calls, errors) {
        return [
            basePrompt,
            ``,
            `## Your previous attempt was rejected by the validator`,
            `Previous tool calls: ${truncate(JSON.stringify(calls.map((c) => ({ name: c.name, args: c.args }))), 6000)}`,
            `Errors:`,
            ...errors.map((e) => `- ${e}`),
            ``,
            `Call the tools again with the COMPLETE corrected set of operations (not only the fixed ones), then finish_edit.`,
        ].join("\n");
    }
    /**
     * Deterministic local planner (keyword + telemetry heuristics). Used only as a labelled
     * fallback when no LLM is available or the LLM output could not be validated.
     */
    static planDeterministically(prompt, context, graph, directorState, availableAssets = []) {
        return video_contracts_1.DeterministicPlanner.plan(prompt, context, graph, directorState, availableAssets);
    }
}
exports.CreativePlanner = CreativePlanner;
function truncate(s, n) {
    return s.length > n ? `${s.slice(0, n)}…` : s;
}
