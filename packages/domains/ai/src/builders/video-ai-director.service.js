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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoAIDirectorService = exports.VideoAIDirectorService = void 0;
const video_contracts_1 = require("@workspace/video-contracts");
const agent_events_1 = require("../agent-runs/agent-events");
const director_sub_agents_1 = require("./director-sub-agents");
const context_resolver_1 = require("./context-resolver");
const creative_planner_1 = require("./creative-planner");
const crypto_1 = __importDefault(require("crypto"));
class VideoAIDirectorService {
    builderType = "video";
    static instance;
    static getInstance() {
        if (!VideoAIDirectorService.instance) {
            VideoAIDirectorService.instance = new VideoAIDirectorService();
        }
        return VideoAIDirectorService.instance;
    }
    /**
     * Compiles an autonomous edit plan into concrete EditIR AST mutations.
     * Follows the production pipeline:
     * USER INTENT -> CONTEXT RESOLVER -> CREATIVE PLANNER -> VALIDATION -> EDITIR COMPILATION
     */
    async compileAST(params) {
        const baseIR = params.existingAST || this.synthesizeDeterministicEditIR(params.meta?.telemetry || {
            mediaId: "sample_media",
            sourcePath: params.meta?.videoPath || "source.mp4",
            duration: video_contracts_1.RationalTimeMath.fromSeconds(15.0),
            totalFrames: 450,
            transcript: [],
            silenceGaps: [],
            energyPeaks: [],
            sceneCuts: [],
            trackedObjects: [],
        }, params.meta?.stylePreset || "MRBEAST_FAST");
        const prompt = params.prompt || `Apply ${params.meta?.stylePreset || "MRBEAST_FAST"} autonomous style`;
        // 1. Resolve Timeline Context
        const timelineContext = context_resolver_1.ContextResolver.resolveTimelineContext({
            editIR: baseIR,
            selectedClipId: params.meta?.selectedClipId,
            selectedRange: params.meta?.selectedRange,
            playheadSec: params.meta?.playheadSec,
            userConstraints: params.meta?.userConstraints,
        });
        // 2. Resolve or Build Media Intelligence Graph
        const technicalMetadata = {
            durationSeconds: timelineContext.projectDurationSec,
            width: baseIR.meta.resolution.width,
            height: baseIR.meta.resolution.height,
            fps: 30,
            hasAudio: true,
            fileSizeBytes: 1024 * 1024 * 20,
            sha256Hash: "hash_placeholder",
            isVariableFrameRate: false,
        };
        const telemetryTranscript = (params.meta?.telemetry?.transcript || []).map((t, idx) => ({
            id: `w_${idx}`,
            word: t.word,
            startSeconds: t.startSeconds,
            endSeconds: t.endSeconds,
            confidence: t.confidence || 0.95,
            isEmphasis: t.isEmphasis || false,
            emphasisScore: t.isEmphasis ? 0.9 : 0.2,
            energyScore: 0.5,
        }));
        const telemetrySilences = (params.meta?.telemetry?.silenceGaps || []).map((s, idx) => {
            const start = video_contracts_1.RationalTimeMath.toSeconds(s.timeRange.start);
            const dur = video_contracts_1.RationalTimeMath.toSeconds(s.timeRange.duration);
            return {
                id: `sil_${idx}`,
                timeRange: s.timeRange,
                startSeconds: start,
                durationSeconds: dur,
                averageDecibels: s.averageDecibels || -40,
                classification: dur > 0.5 ? "DEAD_AIR" : "SHORT_NATURAL_PAUSE",
                recommendation: dur > 0.5 ? "REMOVE" : "KEEP",
                confidence: 0.95,
                contextReason: "Pause detected via silencedetect",
            };
        });
        // Media is analysed only on the user's device (desktop-only processing rule): the desktop app sends the
        // transcript and pauses as telemetry. The server never runs ffmpeg or transcription on the source video.
        const mediaGraph = params.meta?.mediaGraph
            ? params.meta.mediaGraph
            : video_contracts_1.MediaGraphBuilder.build({
                assetId: timelineContext.assetIds[0] || "asset_01",
                technicalMetadata,
                transcript: telemetryTranscript,
                silences: telemetrySilences,
            });
        // 3. Formulate Creative Edit Plan (LLM tool-calling first, labelled deterministic fallback)
        const outcome = await creative_planner_1.CreativePlanner.planWithSource({
            prompt,
            timelineContext,
            mediaGraph,
            companyId: params.companyId,
            availableAssets: params.meta?.availableAssets,
            currentEditIR: baseIR,
            history: normalizeHistory(params.history),
            llmClient: params.meta?.llmClient,
            contextSections: webContextSections(params.meta?.contextSections, params.meta?.telemetry),
        });
        const expansionWarnings = [];
        const creativePlan = video_contracts_1.PlanExpander.expand(outcome.plan, mediaGraph, expansionWarnings);
        // 4. Validate Creative Edit Plan
        const validation = video_contracts_1.CreativePlanValidator.validate(creativePlan, baseIR, params.meta?.availableAssets);
        if (!validation.valid) {
            console.warn("[VideoAIDirectorService] Creative plan failed validation:", validation.errors);
        }
        // 5. Deterministically Compile Plan into EditIR
        const compilation = video_contracts_1.EditIRCompiler.compile(baseIR, creativePlan, params.meta?.availableAssets);
        return {
            plannerSource: outcome.plannerSource,
            plannerReason: outcome.plannerReason,
            operations: outcome.plan.operations,
            appliedOperations: compilation.appliedOperations,
            rejectedOperations: compilation.rejectedOperations,
            warnings: [...expansionWarnings, ...validation.errors],
            success: true,
            builderType: this.builderType,
            entityId: compilation.updatedEditIR.meta.projectId,
            title: compilation.updatedEditIR.meta.title,
            editUrl: `/video-studio/editor/${compilation.updatedEditIR.meta.projectId}`,
            reply: creativePlan.explanation,
            explanation: creativePlan.explanation,
            actions: compilation.actionBadges,
            ast: compilation.updatedEditIR,
            requiresConfirmation: creativePlan.requiresConfirmation,
            confirmationDetails: creativePlan.confirmationDetails,
        };
    }
    /**
     * Mobile AI Director: the client keeps the media on device and supplies its own analysis
     * (duration/size/transcript/silences). Returns the new timeline as MobileEditIR (ms).
     */
    async directMobile(request, opts = {}) {
        const events = opts.events || (0, agent_events_1.createLocalEmitter)();
        events.emit("AgentStarted", { agent: "director", intent: request.intent === "greet" || !(request.prompt || "").trim() ? "greet" : "edit", promptChars: (request.prompt || "").length, hasTimeline: !!request.currentEditIR });
        try {
            const result = await this.runMobileDirector(request, opts, events);
            events.emit("TimelineChanged", {
                final: true,
                durationMs: result.editIR.durationMs,
                clips: result.editIR.clips.length,
                captions: result.editIR.captions.length,
                zooms: result.editIR.zooms.length,
                overlays: result.editIR.overlays.length,
                autoApplied: result.autoApplied,
                requiresConfirmation: result.requiresConfirmation,
            });
            await events.flush();
            return result;
        }
        catch (err) {
            events.emit("AgentFailed", { agent: "director", message: String(err?.message || err).slice(0, 300) });
            await events.flush();
            throw err;
        }
    }
    /** Caption translator backed by the turn's LLM client, or the workspace's AI provider; null when there is none. */
    async defaultCaptionTranslator(opts) {
        let client = opts.llmClient;
        if (client === undefined && opts.companyId) {
            try {
                const { AICompanyConfigService } = await Promise.resolve().then(() => __importStar(require("../kernel/ai-company-config.service")));
                const { AIProviderService } = await Promise.resolve().then(() => __importStar(require("../kernel/ai-provider.service")));
                const { settings } = await AICompanyConfigService.getCompanyAISettings(opts.companyId);
                client = await AIProviderService.getInstance().getClient(settings);
            }
            catch {
                client = null;
            }
        }
        if (!client || typeof client.generate !== "function")
            return null;
        const c = client;
        return (lines, targetLanguage, script) => (0, video_contracts_1.translateCaptionLines)(lines, targetLanguage, script, (p) => c.generate(p));
    }
    async runMobileDirector(request, opts, events) {
        const media = { ...request.media, assetId: request.media.assetId || "primary" };
        const projectId = request.currentEditIR?.projectId || request.projectId || crypto_1.default.randomUUID();
        const baseIR = request.currentEditIR
            ? (0, video_contracts_1.editIRFromMobile)({ ...request.currentEditIR, projectId })
            : (0, video_contracts_1.editIRFromMobileMedia)(media, projectId);
        const ctx = opts.context || { warnings: [] };
        const words = media.transcript?.words || [];
        const prompt = (request.prompt || "").trim();
        const intent = request.intent === "greet" || !prompt ? "greet" : "edit";
        const stockBudgetMs = opts.stockTimeoutMs ?? 8000;
        // The budget starts at the first stock lookup, not at the request: planning (LLM calls) used to eat all of it,
        // so every B-roll / music lookup was skipped and left to the phone.
        let stockDeadline = 0;
        const remaining = () => {
            if (!stockDeadline)
                stockDeadline = Date.now() + stockBudgetMs;
            return Math.max(0, stockDeadline - Date.now());
        };
        const warnings = [...ctx.warnings];
        if (!words.length) {
            warnings.push("no transcript supplied: captions, filler removal and transcript-aware edits are unavailable");
        }
        if (words.length && (0, video_contracts_1.looksLikePromptInjection)(words.map((w) => w.text).join(" "))) {
            warnings.push("the transcript contains instruction-like text; it was treated as data only");
        }
        events.emit("ContextLoaded", {
            brand: !!ctx.brand, piece: !!ctx.piece, memoryLines: opts.memoryContext?.length || 0,
            autonomy: (0, video_contracts_1.normalizeAutonomy)(opts.autonomy || ctx.brand?.autonomy).editing,
        });
        events.emit("MediaAnalyzed", {
            durationMs: media.durationMs, words: words.length, silences: media.silences?.length || 0, faces: media.faces?.length || 0,
            beats: media.beatsMs?.length || 0, scenes: media.scenesMs?.length || 0, ocr: media.ocr?.length || 0,
            loudnessLufs: media.loudness?.integratedLufs ?? null, lastExportQa: !!request.lastExportQa,
        });
        // Preservation constraints: request + the creator's own words (deterministic). The model can only add more.
        const baseDurationMs = Math.round(video_contracts_1.RationalTimeMath.toSeconds(baseIR.meta.totalDuration) * 1000);
        const fromWords = intent === "edit" ? (0, video_contracts_1.extractConstraintsFromPrompt)(prompt, baseDurationMs) : { lockedRanges: [], lockedTracks: [], notes: [] };
        let constraints = (0, video_contracts_1.mergeDirectorConstraints)(baseDurationMs, request.constraints, fromWords);
        const toUserConstraints = (c, ranges = c.lockedRanges) => ({
            protectedTimeRanges: ranges.map(([a, b]) => ({ startSec: a / 1000, durationSec: (b - a) / 1000 })),
            lockedTracks: c.lockedTracks,
        });
        // Style agent + script alignment (deterministic, from the server-loaded context).
        const style = (0, director_sub_agents_1.styleAgent)(ctx);
        if (ctx.brand)
            warnings.push(...style.warnings);
        const alignment = ctx.piece?.sections.length && words.length ? (0, video_contracts_1.alignScriptToTranscript)(ctx.piece.sections, words) : null;
        const graph = (0, video_contracts_1.graphFromMobileMedia)(media, baseIR);
        const timelineContext = context_resolver_1.ContextResolver.resolveTimelineContext({ editIR: baseIR, userConstraints: toUserConstraints(constraints) });
        // LLM budget: every planner call (first plan, validation repair, critic repairs) goes through this counter.
        const budget = opts.llmCallBudget ?? 6;
        let llmCalls = 0;
        const countedClient = (c) => {
            if (!c || typeof c.generateWithTools !== "function")
                return c;
            const inner = c.generateWithTools.bind(c);
            return {
                ...c,
                generateWithTools: async (p, tools, options) => {
                    if (llmCalls >= budget)
                        throw new Error(`LLM call budget (${budget}) for this turn is used up`);
                    llmCalls++;
                    return inner(p, tools, options);
                },
            };
        };
        let outcome;
        let plannerContextSections = [];
        let proposal = null;
        let sfx = [];
        let brandApplied = [];
        if (intent === "greet") {
            // Opening turn: the sub-agents build a proposal. No LLM call (fast, predictable, labelled).
            const broll = words.length ? (0, director_sub_agents_1.brollResearchAgent)({ words, baseIR, assetId: media.assetId }) : [];
            const sound = await (0, director_sub_agents_1.soundAgent)({ ctx, resolveSfx: opts.resolveSfx, timeoutMs: Math.min(3000, remaining()), warnings });
            sfx = sound.sfx;
            proposal = (0, director_sub_agents_1.buildGreetingProposal)({
                ctx, style, alignment, baseIR, assetId: media.assetId, words,
                hasSilences: !!media.silences?.length, broll, music: sound.music,
            });
            outcome = {
                plan: {
                    version: "1.0.0",
                    intent: {
                        platform: "general", aspectRatio: baseIR.meta.targetAspect, resolution: baseIR.meta.resolution, stylePreset: "CUSTOM",
                        energy: "medium", pacing: "dynamic", captionStyle: style.captionPreset, audioStyle: "VOICE_PRIORITY_DUCKED", visualStyle: "CLEAN_ATTENTION",
                    },
                    constraints: timelineContext.userConstraints,
                    selectedSegments: [], removedSegments: [], reorderedSegments: [], brollPlan: [], captionPlan: [],
                    operations: proposal.operations,
                    confidence: 0.8,
                    explanation: "",
                    requiresConfirmation: true,
                },
                plannerSource: "deterministic",
                plannerReason: "opening proposal built from the brand profile, the calendar script and the transcript (no LLM call)",
                brandWatermark: proposal.watermark ? "add" : "keep",
            };
        }
        else {
            const contextSections = (0, video_contracts_1.describeDirectorContext)(ctx, style, alignment);
            if (contextSections.length)
                contextSections.push(`(SOURCE times equal timeline times until cuts are made; map them through the main clips above.)`, ``);
            contextSections.push(...mediaContextSections(media));
            if (opts.memoryContext?.length)
                contextSections.push(`## Project memory (this project only)`, ...opts.memoryContext, ``);
            const planned = await creative_planner_1.CreativePlanner.planWithSource({
                prompt,
                timelineContext,
                mediaGraph: graph,
                companyId: opts.companyId,
                history: request.history,
                currentEditIR: baseIR,
                llmClient: countedClient(opts.llmClient),
                llmModel: opts.llmModel,
                llmTimeoutMs: opts.llmTimeoutMs,
                contextSections: contextSections.length ? contextSections : undefined,
            });
            outcome = planned;
            plannerContextSections = contextSections;
            if (planned.preserve) {
                const extra = {
                    lockedRanges: (planned.preserve.lockedRanges || []).map((r) => [Math.round(r.startSec * 1000), Math.round(r.endSec * 1000)]),
                    lockedTracks: (planned.preserve.lockedTracks || []),
                };
                constraints = (0, video_contracts_1.mergeDirectorConstraints)(baseDurationMs, constraints, extra);
            }
            if (planned.plannerReason.startsWith("LLM_TIMEOUT")) {
                warnings.push("the AI planner timed out: this edit was made by the offline rule-based director");
            }
            if (ctx.brand)
                brandApplied = (0, director_sub_agents_1.applyBrandDefaults)(planned.plan.operations, prompt, style);
        }
        // FACE zooms centre on the on-device face track, in the canvas the plan renders at.
        const aspectOp = [...outcome.plan.operations].reverse().find((o) => o.type === "reframeSubject" || o.type === "changeAspectRatio");
        const canvas = aspectOp
            ? (aspectOp.width && aspectOp.height ? { width: aspectOp.width, height: aspectOp.height } : video_contracts_1.EditIRCompiler.resolutionFor(aspectOp.targetAspect))
            : baseIR.meta.resolution;
        events.emit("PlanCreated", { plannerSource: outcome.plannerSource, plannerReason: outcome.plannerReason, operations: outcome.plan.operations.map((o) => o.type) });
        for (const op of outcome.plan.operations.slice(0, 25))
            events.emit("ToolCalled", { tool: op.type });
        const expandedRaw = video_contracts_1.PlanExpander.expand(outcome.plan, graph, warnings, { canvas });
        const expanded = { ...expandedRaw, constraints: { ...expandedRaw.constraints, ...toUserConstraints(constraints) } };
        const violations = [];
        const dropInvalid = (plan, base) => {
            const v = video_contracts_1.CreativePlanValidator.validate(plan, base, []);
            if (v.valid)
                return plan;
            // Drop only the offending operations, and say so (constraint violations are reported separately).
            const bad = new Set();
            for (const e of v.errors) {
                const m = e.match(/^Operation #(\d+)/);
                if (m)
                    bad.add(parseInt(m[1], 10));
                if (!/ violates constraint: /.test(e))
                    warnings.push(e);
            }
            violations.push(...v.violations);
            return { ...plan, operations: plan.operations.filter((_, i) => !bad.has(i)) };
        };
        const planToCompile = dropInvalid(expanded, baseIR);
        events.emit("PlanValidated", { operations: expanded.operations.length, kept: planToCompile.operations.length, violations: violations.length, constraints: { lockedRanges: constraints.lockedRanges, lockedTracks: constraints.lockedTracks } });
        if (fromWords.notes.length)
            warnings.push(`constraints from your request: ${fromWords.notes.join("; ")}`);
        // Caption translation needs the AI provider, so it runs after compiling (see below), not in the compiler.
        const translateOps = planToCompile.operations.filter((o) => o.type === "translateCaptions");
        const compilePlan = translateOps.length
            ? { ...planToCompile, operations: planToCompile.operations.filter((o) => o.type !== "translateCaptions") }
            : planToCompile;
        const compilation = video_contracts_1.EditIRCompiler.compile(baseIR, compilePlan, []);
        let finalIR = compilation.updatedEditIR;
        const appliedOperations = [...compilation.appliedOperations];
        const rejectedOperations = [...compilation.rejectedOperations];
        const allOperations = [...outcome.plan.operations];
        events.emit("ToolCompleted", { tool: "compile", applied: compilation.appliedOperations.length, rejected: compilation.rejectedOperations.length });
        // Keep every source the client already knows about (manual editor), refreshed by `media`.
        const sources = [
            ...(request.currentEditIR?.sources || []).filter((s) => s.assetId !== media.assetId),
            { assetId: media.assetId, durationMs: media.durationMs, width: media.width, height: media.height },
        ];
        const sourceWords = words.map((w) => ({ startSec: w.startMs / 1000, endSec: w.endMs / 1000 }));
        const faceCenter = (0, video_contracts_1.dominantFaceCenter)(media.faces);
        const critiqueOf = (ir) => {
            const mobile = (0, video_contracts_1.toMobileEditIR)({ editIR: ir, sources, sourceWords, primaryAssetId: media.assetId, faceCenter, sfxCredits: {} }).editIR;
            const locked = constraints.lockedRanges.length ? (0, video_contracts_1.verifyLockedRangesPreserved)(baseIR, ir, constraints.lockedRanges) : { ok: true, problems: [] };
            return (0, video_contracts_1.critiqueDirectorEdit)({
                editIR: mobile, sourceWords: words, primaryAssetId: media.assetId, loudness: media.loudness,
                lastExportQa: request.lastExportQa, exportedEditIR: request.currentEditIR || null, lockedRangeProblems: locked.problems,
            });
        };
        // Observe -> critique -> bounded repair (max 3 rounds). Only CRITICAL issues with a known fix are repaired.
        const maxRounds = Math.max(0, Math.min(3, opts.maxRepairRounds ?? 3));
        events.emit("CriticStarted", { round: 0 });
        let crit = critiqueOf(finalIR);
        events.emit("CriticCompleted", { round: 0, score: crit.score, issues: crit.issues.length, critical: crit.issues.filter((i) => i.severity === "CRITICAL").length });
        // Repairs fix only problems THIS turn introduced: issues already present on the timeline the creator sent
        // (e.g. music they un-ducked by hand) are reported, never silently "fixed".
        const preexisting = new Set(critiqueOf(baseIR).issues.map((i) => i.id));
        const repairableOf = (c) => c.repairable.filter((id) => !preexisting.has(id));
        let repairRounds = 0;
        while (repairRounds < maxRounds && repairableOf(crit).length > 0) {
            const issues = crit.issues.filter((i) => repairableOf(crit).includes(i.id));
            let repairOps = [];
            let repairSource = "deterministic";
            const canUseLlm = intent === "edit" && outcome.plannerSource === "llm" && opts.llmClient !== null && llmCalls < budget;
            if (canUseLlm) {
                const lockedNow = (0, video_contracts_1.mapLockedRanges)(baseIR, finalIR, constraints.lockedRanges);
                const repair = await creative_planner_1.CreativePlanner.planWithSource({
                    prompt: buildRepairInstruction(prompt, issues),
                    checkCoverage: false,
                    timelineContext: context_resolver_1.ContextResolver.resolveTimelineContext({ editIR: finalIR, userConstraints: toUserConstraints(constraints, lockedNow) }),
                    mediaGraph: (0, video_contracts_1.graphFromMobileMedia)(media, finalIR),
                    companyId: opts.companyId,
                    currentEditIR: finalIR,
                    llmClient: countedClient(opts.llmClient),
                    llmModel: opts.llmModel,
                    llmTimeoutMs: opts.llmTimeoutMs,
                    contextSections: plannerContextSections.length ? plannerContextSections : undefined,
                });
                // A deterministic fallback of a repair prompt is not a repair: only real model output is used here.
                if (repair.plannerSource === "llm") {
                    repairOps = repair.plan.operations;
                    repairSource = "llm";
                }
            }
            if (!repairOps.length)
                repairOps = deterministicRepairOps(issues);
            if (!repairOps.length)
                break;
            repairRounds++;
            events.emit("RepairCreated", { round: repairRounds, source: repairSource, issues: issues.map((i) => i.id), operations: repairOps.map((o) => o.type) });
            const lockedNow = (0, video_contracts_1.mapLockedRanges)(baseIR, finalIR, constraints.lockedRanges);
            const repairGraph = (0, video_contracts_1.graphFromMobileMedia)(media, finalIR);
            const repairPlanRaw = video_contracts_1.PlanExpander.expand({ ...outcome.plan, operations: repairOps }, repairGraph, warnings, { canvas: finalIR.meta.resolution });
            const repairPlan = dropInvalid({ ...repairPlanRaw, constraints: { ...repairPlanRaw.constraints, ...toUserConstraints(constraints, lockedNow) } }, finalIR);
            const repaired = video_contracts_1.EditIRCompiler.compile(finalIR, repairPlan, []);
            // A repair must not take away what the creator asked for (a real run deleted the requested title).
            const lost = (0, creative_planner_1.requestedFeatures)(prompt, words.length > 0).filter((f) => featureCount(finalIR, f) > 0 && featureCount(repaired.updatedEditIR, f) === 0);
            if (lost.length) {
                repairRounds++;
                warnings.push(`critic repair round ${repairRounds} would have removed the requested ${lost.join(", ")} and was discarded`);
                break;
            }
            const next = critiqueOf(repaired.updatedEditIR);
            const better = repairableOf(next).length < repairableOf(crit).length || next.score > crit.score;
            events.emit("RepairApplied", { round: repairRounds, kept: better, score: next.score, applied: repaired.appliedOperations.length });
            if (!better) {
                warnings.push(`critic repair round ${repairRounds} did not improve the edit and was discarded`);
                break;
            }
            finalIR = repaired.updatedEditIR;
            appliedOperations.push(...repaired.appliedOperations.map((a) => `repair: ${a}`));
            rejectedOperations.push(...repaired.rejectedOperations);
            allOperations.push(...repairOps);
            crit = next;
            events.emit("CriticCompleted", { round: repairRounds, score: crit.score, issues: crit.issues.length, critical: crit.issues.filter((i) => i.severity === "CRITICAL").length });
        }
        // Caption translation, on the final captions (after cuts and repairs): text only, timings unchanged.
        if (translateOps.length) {
            const op = translateOps[translateOps.length - 1];
            const language = video_contracts_1.CAPTION_TARGET_LANGUAGES[op.targetLanguage];
            const caps = finalIR.tracks.captionTrack.filter((c) => c.role !== "title" && c.text.trim().length > 0);
            const translate = opts.translateCaptionLines ?? (await this.defaultCaptionTranslator(opts));
            if (!language) {
                rejectedOperations.push(`translateCaptions: "${op.targetLanguage}" is not a supported caption language`);
            }
            else if (caps.length === 0) {
                rejectedOperations.push("translateCaptions: there are no captions to convert");
            }
            else if (!translate) {
                rejectedOperations.push("translateCaptions: no AI provider is configured, so the captions were not converted");
            }
            else {
                try {
                    const lines = await translate(caps.map((c) => c.text), op.targetLanguage, op.script);
                    if (lines.length !== caps.length)
                        throw new Error("translation does not line up with the captions");
                    caps.forEach((c, i) => (0, video_contracts_1.retextCaptionSegment)(c, lines[i]));
                    appliedOperations.push(`Converted ${caps.length} caption(s) to ${language}${op.script === "roman" ? " in Roman letters" : ""}`);
                }
                catch (err) {
                    console.warn("[VideoAIDirector] caption translation failed:", err?.message || err);
                    rejectedOperations.push("translateCaptions: the translation failed, so the captions are unchanged");
                }
            }
        }
        const remainingCritical = crit.issues.filter((i) => i.severity === "CRITICAL");
        if (remainingCritical.length)
            warnings.push(`critic: ${remainingCritical.length} critical issue(s) remain: ${remainingCritical.slice(0, 3).map((i) => i.title).join("; ")}`);
        const critique = { score: crit.score, issues: crit.issues, repairRounds };
        // Credits of every stock item placed this turn (by URL): shown on export, required for CC BY / BY-SA.
        const credits = [];
        const addCredit = (kind, query, m) => {
            if (!m.attribution || credits.some((c) => c.url === m.url))
                return;
            credits.push({ kind, url: m.url, query, attribution: m.attribution, ...(m.title ? { title: m.title } : {}), ...(m.license ? { license: m.license } : {}), ...(m.sourcePage ? { sourcePage: m.sourcePage } : {}), ...(m.provider ? { provider: m.provider } : {}) });
        };
        // B-roll research: resolve stock queries (the server resolver tries Pexels, then Pixabay) under the turn deadline.
        for (const track of finalIR.tracks.videoTracks) {
            if (track.type !== "B_ROLL_OVERLAY")
                continue;
            for (const clip of track.clips) {
                if (!clip.sourcePath.startsWith("stock-query://"))
                    continue;
                const query = decodeURIComponent(clip.sourcePath.slice("stock-query://".length));
                let found = null;
                if (opts.resolveStockVideo) {
                    if (remaining() <= 0) {
                        warnings.push(`b-roll "${query}": stock lookup skipped (the ${stockBudgetMs} ms stock budget for this turn is used up)`);
                    }
                    else {
                        try {
                            const r = await (0, video_contracts_1.withTimeout)(opts.resolveStockVideo(query, finalIR.meta.targetAspect), remaining(), `b-roll "${query}" stock lookup`);
                            found = typeof r === "string" ? { url: r } : r;
                        }
                        catch (err) {
                            warnings.push(`b-roll "${query}": stock lookup failed (${err?.message || err})`);
                        }
                    }
                }
                if (found && /^https:\/\//i.test(found.url)) {
                    clip.sourcePath = found.url;
                    addCredit("broll", query, found);
                    if (found.attribution && found.creditRequired !== false) {
                        warnings.push(`b-roll "${query}": using ${found.title ? `"${found.title}"` : found.url}. Credit required when publishing: ${found.attribution}.`);
                    }
                }
                else
                    warnings.push(`b-roll "${query}" needs a stock URL: resolve it on the client via /stock/search`);
            }
        }
        // Resolve music mood queries to real tracks the same way (catalogue by default).
        const resolveMusic = opts.resolveStockMusic || (async (q, durSec) => (0, video_contracts_1.resolveMusicFromCatalog)(q, durSec));
        const timelineSec = video_contracts_1.RationalTimeMath.toSeconds(finalIR.meta.totalDuration);
        for (const track of finalIR.tracks.audioTracks) {
            if (track.type !== "BGM")
                continue;
            for (const clip of track.clips) {
                if (!clip.sourcePath.startsWith("stock-music://"))
                    continue;
                const query = clip.sourceQuery || decodeURIComponent(clip.sourcePath.slice("stock-music://".length)) || "background music";
                clip.sourceQuery = query;
                let found = null;
                try {
                    // The local catalogue is instant; the budget only bites for injected network resolvers.
                    const r = await (0, video_contracts_1.withTimeout)(Promise.resolve(resolveMusic(query, timelineSec)), Math.max(remaining(), 250), `music "${query}" lookup`);
                    found = typeof r === "string" ? { url: r } : r;
                }
                catch (err) {
                    warnings.push(`music "${query}": music lookup failed (${err?.message || err})`);
                }
                if (found && /^https:\/\//i.test(found.url)) {
                    clip.sourcePath = found.url;
                    addCredit("music", query, found);
                    const credit = found.attribution ? ` Credit required when publishing: ${found.attribution}.` : found.license ? ` Licence: ${found.license}.` : "";
                    warnings.push(`music "${query}": using ${found.title ? `"${found.title}"` : found.url}.${credit}`);
                }
                else {
                    warnings.push(`music "${query}" needs a track URL: no royalty-free track matched this mood; resolve it on the client via /stock/music`);
                }
            }
        }
        // SFX lane: the sound agent's effects placed at the proposal's transitions (greet turn only).
        // Credits of effects the client already has are carried by clip id.
        const sfxCredits = {};
        for (const fx of request.currentEditIR?.audio?.sfx || [])
            if (fx.credit)
                sfxCredits[fx.id] = fx.credit;
        if (sfx.length) {
            const placed = (0, director_sub_agents_1.placeSfxOnTimeline)(finalIR, sfx);
            Object.assign(sfxCredits, placed.credits);
            for (const fx of placed.used) {
                if (fx.attribution)
                    addCredit("sfx", fx.query, { url: fx.url, attribution: fx.attribution, ...(fx.title ? { title: fx.title } : {}), ...(fx.license ? { license: fx.license } : {}) });
            }
            if (placed.placed && proposal)
                proposal.steps.push(`add ${placed.placed} sound effect${placed.placed === 1 ? "" : "s"} on the transitions`);
        }
        const projected = (0, video_contracts_1.toMobileEditIR)({ editIR: finalIR, sources, sourceWords, primaryAssetId: media.assetId, faceCenter, sfxCredits });
        warnings.push(...projected.warnings);
        // Brand font on captions created this turn (the client's own font choices and a caption template's font are kept).
        const oldCaptionIds = new Set((request.currentEditIR?.captions || []).map((c) => c.id));
        const templatedIds = new Set(finalIR.tracks.captionTrack.filter((c) => c.style.presetLabel).map((c) => c.id));
        if (ctx.brand) {
            for (const cap of projected.editIR.captions) {
                // Text in a script the brand font does not cover keeps a font that can draw it.
                if (!oldCaptionIds.has(cap.id) && !templatedIds.has(cap.id))
                    cap.style.fontFamily = (0, video_contracts_1.captionFontFor)(cap.text, style.fontFamily);
            }
        }
        // Watermark: keep the client's, add/remove on request, never invent one without a brand logo.
        let watermark = request.currentEditIR?.watermark;
        const wantWm = intent === "greet" ? outcome.brandWatermark || "keep" : (0, director_sub_agents_1.watermarkIntent)(prompt, outcome.brandWatermark);
        if (wantWm === "add") {
            const wm = (0, video_contracts_1.brandWatermark)(ctx.brand);
            if (wm) {
                watermark = watermark ? { ...watermark, imageUrl: wm.imageUrl } : wm;
                if (intent === "edit")
                    brandApplied.push("brand logo watermark");
            }
            else if (intent === "edit") {
                warnings.push("watermark: this project has no brand logo (HTTPS image) to use");
            }
        }
        else if (wantWm === "remove") {
            watermark = undefined;
        }
        const editIR = { ...projected.editIR };
        delete editIR.watermark;
        if (watermark)
            editIR.watermark = watermark;
        let summary;
        if (intent === "greet" && proposal) {
            summary = (0, director_sub_agents_1.greetingReply)(proposal, editIR.durationMs / 1000);
        }
        else {
            summary = outcome.plan.explanation;
            if (outcome.plannerSource === "deterministic") {
                summary = appliedOperations.length > 0
                    ? `Applied ${appliedOperations.length} change(s) with the offline rule-based director: ${appliedOperations.slice(0, 4).join("; ")}${appliedOperations.length > 4 ? "; ..." : ""}`
                    : `The offline rule-based director could not map this request to an edit. (${outcome.plannerReason})`;
            }
            if (brandApplied.length)
                summary += ` Brand: ${brandApplied.join(", ")}.`;
        }
        if (rejectedOperations.length > 0) {
            summary += ` ${rejectedOperations.length} requested change(s) could not be applied.`;
        }
        if (violations.length > 0) {
            summary += ` ${violations.length} change(s) were skipped to respect what you asked to keep.`;
        }
        const autonomy = (0, video_contracts_1.normalizeAutonomy)(opts.autonomy || ctx.brand?.autonomy);
        const decision = (0, video_contracts_1.decideAutoApply)({
            editing: autonomy.editing,
            operationTypes: outcome.plan.operations.map((o) => o.type),
            plannerRequiresConfirmation: outcome.plannerSource === "llm" ? !!outcome.plan.requiresConfirmation : false,
            violations: violations.length,
            isGreeting: intent === "greet",
        });
        return {
            intent,
            plannerSource: outcome.plannerSource,
            plannerReason: outcome.plannerReason,
            summary,
            reply: summary,
            operations: allOperations,
            appliedOperations,
            rejectedOperations: rejectedOperations,
            warnings: Array.from(new Set(warnings)),
            requiresConfirmation: decision.requiresConfirmation,
            autoApplied: decision.autoApplied,
            critique,
            runId: events.runId,
            ...(violations.length ? { violations } : {}),
            ...((0, video_contracts_1.hasConstraints)(constraints) ? { constraints: { lockedRanges: constraints.lockedRanges, lockedTracks: constraints.lockedTracks } } : {}),
            editIR,
            ast: finalIR,
            llmCalls,
            ...(proposal ? { proposal: { steps: proposal.steps } } : {}),
            ...(alignment ? { scriptAlignment: alignment } : {}),
            ...(sfx.length ? { sfxSuggestions: sfx } : {}),
            ...(credits.length ? { credits } : {}),
            ...(ctx.brand || ctx.piece ? { context: summarizeContext(ctx, style) } : {}),
        };
    }
    /**
     * Conversational AI Director Copilot: modifies existing EditIR based on natural language instructions.
     */
    async patchAST(entityId, instruction, params) {
        return this.compileAST({
            ...params,
            prompt: instruction,
        });
    }
    async deleteEntity(entityId, _companyId) {
        return { success: true, message: `Video project ${entityId} deleted.` };
    }
    /**
     * Deterministic local synthesis guaranteeing 100% testability and reliability.
     */
    synthesizeDeterministicEditIR(telemetry, stylePreset = "MRBEAST_FAST") {
        const totalDurationSec = video_contracts_1.RationalTimeMath.toSeconds(telemetry.duration);
        const projectId = crypto_1.default.randomUUID();
        const style = video_contracts_1.DirectorStyleResolver.resolve(stylePreset);
        // 1. Camera Zoom Events
        const cameraTrack = [];
        if (totalDurationSec >= 3.0) {
            cameraTrack.push({
                id: crypto_1.default.randomUUID(),
                timeRange: {
                    start: video_contracts_1.RationalTimeMath.fromSeconds(1.5),
                    duration: video_contracts_1.RationalTimeMath.fromSeconds(Math.min(2.5, totalDurationSec - 1.5)),
                },
                targetType: "FACE",
                targetCoords: { x: 0.5, y: 0.38 },
                scale: style.zoomScale,
                spring: { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
                motionBlur: true,
            });
        }
        // 2. Kinetic Captions
        const captionTrack = [];
        if (telemetry.transcript && telemetry.transcript.length > 0) {
            captionTrack.push({
                id: crypto_1.default.randomUUID(),
                timeRange: {
                    start: video_contracts_1.RationalTimeMath.fromSeconds(0.5),
                    duration: video_contracts_1.RationalTimeMath.fromSeconds(Math.min(4.0, totalDurationSec)),
                },
                text: "Turn ideas into production videos",
                words: [
                    { word: "Turn", start: video_contracts_1.RationalTimeMath.fromSeconds(0.5), end: video_contracts_1.RationalTimeMath.fromSeconds(0.9), highlight: false, scaleMultiplier: 1.0 },
                    { word: "Ideas", start: video_contracts_1.RationalTimeMath.fromSeconds(0.9), end: video_contracts_1.RationalTimeMath.fromSeconds(1.4), highlight: true, color: style.captionColors.highlight, scaleMultiplier: 1.15 },
                    { word: "Instantly", start: video_contracts_1.RationalTimeMath.fromSeconds(1.4), end: video_contracts_1.RationalTimeMath.fromSeconds(2.2), highlight: true, color: style.captionColors.highlight, scaleMultiplier: 1.2 },
                ],
                style: {
                    preset: style.captionPreset === "HORMOZI_BOUNCE" ? "HORMOZI_BOUNCE" : "ALI_ABDAAL_CLEAN",
                    fontFamily: "Inter",
                    fontSize: 52,
                    textColor: style.captionColors.primary,
                    highlightColor: style.captionColors.highlight,
                    position: { x: 0.5, y: 0.76 }, // Guaranteed safe zone above platform navigation
                    shadow: true,
                },
            });
        }
        // 3. Master Video Track with Primary Footage Clip
        const mainClip = {
            id: crypto_1.default.randomUUID(),
            assetId: telemetry.mediaId,
            sourcePath: telemetry.sourcePath,
            sourceRange: {
                start: video_contracts_1.RationalTimeMath.fromSeconds(0),
                duration: telemetry.duration,
            },
            timelineRange: {
                start: video_contracts_1.RationalTimeMath.fromSeconds(0),
                duration: telemetry.duration,
            },
            transform: {
                scale: { start: 1.0, end: 1.0, easing: "spring" },
                position: { x: 0.0, y: 0.0 },
                anchor: { x: 0.5, y: 0.5 },
                rotationDeg: 0,
                opacity: 1.0,
            },
            speedMultiplier: 1.0,
            effects: [],
        };
        return {
            version: "1.0.0",
            meta: {
                projectId,
                title: telemetry.mediaId,
                targetAspect: "16:9",
                resolution: { width: 1920, height: 1080 },
                fps: { numerator: 30, denominator: 1 },
                totalDuration: telemetry.duration,
            },
            directorStyle: {
                preset: stylePreset,
                pacingMultiplier: stylePreset === "MRBEAST_FAST" ? 1.3 : 1.0,
                zoomAggressiveness: stylePreset === "MRBEAST_FAST" ? 0.75 : 0.4,
                brollFrequencySeconds: 12.0,
            },
            tracks: {
                videoTracks: [
                    {
                        id: crypto_1.default.randomUUID(),
                        type: "MAIN_VIDEO",
                        zIndex: 0,
                        clips: [mainClip],
                    },
                ],
                cameraTrack,
                captionTrack,
                audioTracks: [
                    {
                        id: crypto_1.default.randomUUID(),
                        type: "BGM",
                        volumeDb: -14.0,
                        duckWithSpeech: true,
                        duckingConfig: {
                            duckDb: -18.0,
                            attackMs: 120,
                            releaseMs: 350,
                        },
                        clips: [],
                    },
                ],
            },
        };
    }
}
exports.VideoAIDirectorService = VideoAIDirectorService;
/** Repair prompt: the creator's request plus the critic's structured issues. */
function buildRepairInstruction(prompt, issues) {
    return [
        `The automatic critic checked the edit you just made for this request: ${JSON.stringify(prompt).slice(0, 600)}`,
        `It found these problems (JSON). Fix ONLY these with the fewest operations. Times are seconds on the CURRENT timeline described above, which already includes your edit. Do not undo what the creator asked for.`,
        JSON.stringify(issues.map((i) => ({ id: i.id, severity: i.severity, category: i.category, problem: i.title, ...(i.timeRangeMs ? { atSec: [i.timeRangeMs[0] / 1000, i.timeRangeMs[1] / 1000] } : {}) }))),
    ].join("\n");
}
/** Known deterministic fixes for critic issues (used without an LLM). */
function deterministicRepairOps(issues) {
    const ops = [];
    if (issues.some((i) => i.id.startsWith("music_over_speech:")))
        ops.push({ type: "duckAudio", duckDb: -18, attackMs: 120, releaseMs: 350 });
    return ops;
}
/**
 * Web/desktop path: the desktop app sends its on-device scene cuts and loudness as `telemetry.scenesMs` /
 * `telemetry.loudness` (a top-level `media` key would select the mobile director). Validated loosely here and added
 * to the planner prompt the same way as the mobile path.
 */
function webContextSections(sections, telemetry) {
    const base = Array.isArray(sections) ? sections.filter((x) => typeof x === "string") : [];
    const ms = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 4 * 3600 * 1000;
    const scenesMs = Array.isArray(telemetry?.scenesMs) ? telemetry.scenesMs.filter(ms).slice(0, 2000) : undefined;
    const l = telemetry?.loudness;
    const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
    const loudness = l && num(l.integratedLufs, -100, 10)
        ? { integratedLufs: l.integratedLufs, ...(num(l.truePeakDb, -100, 20) ? { truePeakDb: l.truePeakDb } : {}), ...(num(l.clippingPct, 0, 100) ? { clippingPct: l.clippingPct } : {}) }
        : undefined;
    const ocr = Array.isArray(telemetry?.ocr)
        ? telemetry.ocr.filter((o) => o && ms(o.startMs) && ms(o.endMs) && typeof o.text === "string").slice(0, 200).map((o) => ({ startMs: o.startMs, endMs: o.endMs, text: o.text.slice(0, 500) }))
        : undefined;
    const extra = mediaContextSections({ scenesMs, loudness, ocr });
    const out = [...base, ...extra];
    return out.length ? out : undefined;
}
/** Scene cuts and on-screen text (OCR, fenced as untrusted data) for the planner prompt. */
function mediaContextSections(media) {
    const out = [];
    if (media.scenesMs?.length)
        out.push(`Scene cuts in the source (SOURCE s): ${media.scenesMs.slice(0, 100).map((t) => (t / 1000).toFixed(2)).join(", ")}`);
    if (media.ocr?.length) {
        out.push(`On-screen text detected in the source (SOURCE s):`);
        out.push((0, video_contracts_1.fenceUntrusted)("ocr", media.ocr.slice(0, 60).map((o) => `${(o.startMs / 1000).toFixed(1)}-${(o.endMs / 1000).toFixed(1)}: ${o.text}`).join(" | "), { maxChars: 4000 }).block);
    }
    if (media.labels?.length) {
        // ML Kit's label vocabulary is plain words; anything else is dropped so client data cannot carry instructions.
        const clean = (l) => (/^[a-z][a-z &'-]{0,38}$/i.test(l) ? l.toLowerCase() : null);
        const spans = media.labels
            .slice(0, 80)
            .map((s) => ({ s, words: s.labels.map(clean).filter((w) => !!w) }))
            .filter((x) => x.words.length > 0);
        if (spans.length) {
            out.push(`What the picture shows (on-device scene labels, SOURCE s; use them to pick B-roll, emoji stickers and titles that match the footage):`);
            out.push(spans.map(({ s, words }) => `${(s.startMs / 1000).toFixed(1)}-${(s.endMs / 1000).toFixed(1)}: ${words.join(", ")}`).join(" | "));
        }
    }
    if (media.loudness)
        out.push(`Source loudness: ${media.loudness.integratedLufs} LUFS${media.loudness.clippingPct != null ? `, ${media.loudness.clippingPct}% clipped samples` : ""}`);
    if (out.length)
        out.push(``);
    return out;
}
function summarizeContext(ctx, style) {
    return {
        ...(ctx.brand ? { brand: { projectId: ctx.brand.projectId, name: ctx.brand.name, highlightColor: style.highlightColor, textColor: style.textColor, captionPreset: style.captionPreset, font: style.fontFamily, hasLogo: !!ctx.brand.logoUrl, pacing: style.pacing } } : {}),
        ...(ctx.piece ? { piece: { calendarPieceId: ctx.piece.calendarPieceId, postId: ctx.piece.postId, headline: ctx.piece.headline, platform: ctx.piece.platform, targetDurationSec: ctx.piece.targetDurationSec, hasScript: ctx.piece.sections.length > 0 } } : {}),
    };
}
function normalizeHistory(history) {
    if (!Array.isArray(history))
        return undefined;
    return history
        .map((h) => ({
        role: (h.role === "assistant" || h.sender === "assistant" || h.sender === "ai" ? "assistant" : "user"),
        content: String(h.content ?? h.text ?? ""),
    }))
        .filter((h) => h.content.trim().length > 0);
}
exports.videoAIDirectorService = VideoAIDirectorService.getInstance();
/** How many items of a requested feature (label from requestedFeatures) the timeline has; -1 = not countable. */
function featureCount(ir, feature) {
    const t = ir.tracks;
    const overlays = t.videoTracks.filter((v) => v.type !== "MAIN_VIDEO").flatMap((v) => v.clips);
    switch (feature) {
        case "captions":
            return t.captionTrack.filter((c) => c.role !== "title").length;
        case "title text":
            return t.captionTrack.filter((c) => c.role === "title").length;
        case "zoom / punch-in":
            return t.cameraTrack.length;
        case "B-roll":
            return overlays.filter((c) => c.mediaType !== "image").length;
        case "sticker":
            return overlays.filter((c) => c.mediaType === "image").length;
        case "background music":
            return t.audioTracks.filter((a) => a.type === "BGM").flatMap((a) => a.clips).length;
        default:
            return -1;
    }
}
