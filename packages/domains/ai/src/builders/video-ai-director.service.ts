import { IUniversalBuilder, BuilderGenerationParams, BuilderResult } from "./universal-builder.interface";
import {
  EditIR,
  EditIRSchema,
  MediaTelemetryManifest,
  RationalTimeMath,
  MediaIntelligenceGraph,
  CameraEvent,
  CaptionSegment,
  VideoClip,
  DirectorStylePreset,
  DirectorStyleResolver,
  CreativePlanValidator,
  EditIRCompiler,
  MediaGraphBuilder,
  PlanExpander,
  MobileAIDirectRequest,
  MobileEditIR,
  CreativeOperation,
  PlannerSource,
  editIRFromMobileMedia,
  editIRFromMobile,
  preserveUntouched,
  applyItemLocks,
  enforceItemLocks,
  asksForAll,
  classifyDirectorIntentOffline,
  finalizeIntent,
  confirmsFullEdit,
  scopedTools,
  scopedLockedTracks,
  ResolvedDirectorIntent,
  FULL_EDIT_QUESTION,
  DIRECTOR_TOOL_SPECS,
  summarizeTimelineDiff,
  TimelineDiffSummary,
  guardDestructiveVariants,
  gateRendererFeatures,
  FREEZE_ASSET_PREFIX,
  STILL_SOURCE_MS,
  graphFromMobileMedia,
  graphFromMobileMediaList,
  shotsFromCuts,
  toMobileEditIR,
  resolveMusicFromCatalog,
  DirectorContext,
  ScriptAlignment,
  MobileWatermark,
  alignScriptToTranscript,
  brandWatermark,
  describeDirectorContext,
  withTimeout,
  dominantFaceCenter,
  DirectorCritique,
  DirectorCritiqueIssue,
  ResolvedDirectorConstraints,
  AutonomyPolicy,
  critiqueDirectorEdit,
  extractConstraintsFromPrompt,
  mergeDirectorConstraints,
  mapLockedRanges,
  verifyLockedRangesPreserved,
  normalizeAutonomy,
  decideAutoApply,
  hasConstraints,
  fenceUntrusted,
  looksLikePromptInjection,
  CAPTION_TARGET_LANGUAGES,
  CaptionScript,
  translateCaptionLines,
  retextCaptionSegment,
  captionFontFor,
} from "@workspace/video-contracts";
import { AgentRunEmitter, createLocalEmitter } from "../agent-runs/agent-events";
import {
  styleAgent,
  brollResearchAgent,
  soundAgent,
  buildGreetingProposal,
  greetingReply,
  applyBrandDefaults,
  watermarkIntent,
  placeSfxOnTimeline,
  SfxSuggestion,
} from "./director-sub-agents";
import type { AgentContentPart, AIClient } from "../kernel/ai-provider.service";
import { ContextResolver } from "./context-resolver";
import { CreativePlanner, directorEffort, directorLlmTimeoutMs, missingRequestedOperations, requestedFeatures } from "./creative-planner";
import {
  DirectorConversation,
  DirectorPhase,
  MediaGist,
  agreedPlanPrompt,
  deterministicCalmPlan,
  deterministicRecommendation,
  didNotUnderstandReply,
  doneReply,
  followUpChips,
  isAffirmative,
  isOpenEnded,
  planFromHistory,
  startsWithAgreement,
  tidyReply,
} from "./director-conversation";
import crypto from "crypto";
import { neutraliseWordSequence, sanitizeInlineUntrusted, shotLogPromptLines, subjectSamplesFromShotLog } from "@workspace/video-contracts";
import { StoryPlanner, STORY_MIN_WORDS, type StoryOutcome, type StoryWord } from "./story-planner";
import { choosePlaybook, measurePlaybook, playbookStageBriefs, type PlaybookReport, type StylePlaybook } from "@workspace/video-contracts";
import { critiqueCheckpoints, isRepairable, visualRepairInstruction, type VisualCheckpoint, type VisualRepairRequest } from "@workspace/video-contracts";
import { AGENT_PROTOCOL, runDirectorAgent, wholeEditStages, type AgentEditResult, type DirectorAgentOutcome } from "./director-agent";
import {
  DirectorDropRecorder,
  classifyPlannerFallback,
  formatTurnLogLine,
  providerModelFromReason,
  type DirectorFallbackCode,
  type DirectorTurnLog,
} from "./director-turn-log";

export class VideoAIDirectorService implements IUniversalBuilder<EditIR> {
  public readonly builderType = "video" as any;
  private static instance: VideoAIDirectorService;

  public static getInstance(): VideoAIDirectorService {
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
  async compileAST(params: BuilderGenerationParams): Promise<BuilderResult<EditIR>> {
    const baseIR = params.existingAST || this.synthesizeDeterministicEditIR(
      params.meta?.telemetry || {
        mediaId: "sample_media",
        sourcePath: params.meta?.videoPath || "source.mp4",
        duration: RationalTimeMath.fromSeconds(15.0),
        totalFrames: 450,
        transcript: [],
        silenceGaps: [],
        energyPeaks: [],
        sceneCuts: [],
        trackedObjects: [],
      },
      params.meta?.stylePreset || "MRBEAST_FAST"
    );

    const prompt = params.prompt || `Apply ${params.meta?.stylePreset || "MRBEAST_FAST"} autonomous style`;

    // 1. Resolve Timeline Context
    const timelineContext = ContextResolver.resolveTimelineContext({
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
    const telemetryTranscript = (params.meta?.telemetry?.transcript || []).map((t: any, idx: number) => ({
      id: `w_${idx}`,
      word: t.word,
      startSeconds: t.startSeconds,
      endSeconds: t.endSeconds,
      confidence: t.confidence || 0.95,
      isEmphasis: t.isEmphasis || false,
      emphasisScore: t.isEmphasis ? 0.9 : 0.2,
      energyScore: 0.5,
    }));
    const telemetrySilences = (params.meta?.telemetry?.silenceGaps || []).map((s: any, idx: number) => {
      const start = RationalTimeMath.toSeconds(s.timeRange.start);
      const dur = RationalTimeMath.toSeconds(s.timeRange.duration);
      return {
        id: `sil_${idx}`,
        timeRange: s.timeRange,
        startSeconds: start,
        durationSeconds: dur,
        averageDecibels: s.averageDecibels || -40,
        classification: dur > 0.5 ? "DEAD_AIR" as const : "SHORT_NATURAL_PAUSE" as const,
        recommendation: dur > 0.5 ? "REMOVE" as const : "KEEP" as const,
        confidence: 0.95,
        contextReason: "Pause detected via silencedetect",
      };
    });

    // Media is analysed only on the user's device (desktop-only processing rule): the desktop app sends the
    // transcript and pauses as telemetry. The server never runs ffmpeg or transcription on the source video.
    const mediaGraph: MediaIntelligenceGraph = params.meta?.mediaGraph
      ? params.meta.mediaGraph
      : MediaGraphBuilder.build({
          assetId: timelineContext.assetIds[0] || "asset_01",
          technicalMetadata,
          transcript: telemetryTranscript,
          silences: telemetrySilences,
          // Scene cuts the desktop app detected: captions are grouped and timed so they never straddle one.
          shots: shotsFromCuts(
            (params.meta?.telemetry?.sceneCuts || []).map((c: any) => RationalTimeMath.toSeconds(c.timestamp)).filter((t: number) => Number.isFinite(t)),
            technicalMetadata.durationSeconds
          ),
        });

    // 3. Formulate Creative Edit Plan (LLM tool-calling first, labelled deterministic fallback)
    const outcome = await CreativePlanner.planWithSource({
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
    const expansionWarnings: string[] = [];
    const creativePlan = PlanExpander.expand(outcome.plan, mediaGraph, expansionWarnings);

    // 4. Validate Creative Edit Plan
    const validation = CreativePlanValidator.validate(creativePlan, baseIR, params.meta?.availableAssets);
    if (!validation.valid) {
      console.warn("[VideoAIDirectorService] Creative plan failed validation:", validation.errors);
    }

    // 5. Deterministically Compile Plan into EditIR
    const compilation = EditIRCompiler.compile(baseIR, creativePlan, params.meta?.availableAssets);

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
    } as BuilderResult<EditIR>;
  }

  /**
   * Mobile AI Director: the client keeps the media on device and supplies its own analysis
   * (duration/size/transcript/silences). Returns the new timeline as MobileEditIR (ms).
   */
  async directMobile(request: MobileAIDirectRequest, opts: MobileDirectOptions = {}): Promise<MobileDirectResult> {
    const events = opts.events || createLocalEmitter();
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
        // Turn summary for the run log (Phase 7.2): what the request was understood as, which tools ran, and how
        // destructive the result is. The phone reports applied / undone turns through agent-memory/feedback.
        scopeMode: result.scope?.mode ?? null,
        scopeSource: result.scope?.source ?? null,
        tools: [...new Set(result.operations.map((o) => o.type))].slice(0, 30),
        plannerSource: result.plannerSource,
        itemsRemoved: result.diffSummary.removed,
        cutSec: result.diffSummary.cutSec,
        violations: result.violations?.length ?? 0,
        rejected: result.rejectedOperations.length,
        turnLog: result.turnLog,
      });
      console.info(formatTurnLogLine(result.turnLog));
      await events.flush();
      return result;
    } catch (err: any) {
      events.emit("AgentFailed", { agent: "director", message: String(err?.message || err).slice(0, 300) });
      await events.flush();
      throw err;
    }
  }

  /** Caption translator backed by the turn's LLM client, or the workspace's AI provider; null when there is none. */
  private async defaultCaptionTranslator(opts: { companyId?: string; llmClient?: AIClient | null }) {
    let client: AIClient | null | undefined = opts.llmClient;
    if (client === undefined && opts.companyId) {
      try {
        const { AICompanyConfigService } = await import("../kernel/ai-company-config.service");
        const { AIProviderService } = await import("../kernel/ai-provider.service");
        const { settings } = await AICompanyConfigService.getCompanyAISettings(opts.companyId);
        client = await AIProviderService.getInstance().getClient(settings);
      } catch {
        client = null;
      }
    }
    if (!client || typeof client.generate !== "function") return null;
    const c = client;
    return (lines: string[], targetLanguage: string, script: CaptionScript) =>
      translateCaptionLines(lines, targetLanguage, script, (p) => c.generate(p));
  }

  /**
   * The agent loop (quality-fix Phase 4): stages of short model turns on a working timeline. Every edit call goes
   * through the same guards as a one-shot plan, ONE OP AT A TIME so each gets its own result (renderer gate,
   * destructive guard, scope, expansion, item locks, locked ranges, compiler), and the model is told exactly why
   * something was refused.
   */
  private async runAgentLoop(p: {
    client: AIClient;
    model?: string;
    request: MobileAIDirectRequest;
    prompt: string;
    plannerPrompt: string;
    medias: Array<MobileAIDirectRequest["media"] & { assetId: string }>;
    baseIR: EditIR;
    planBase: EditIR;
    graph: any;
    timelineContext: any;
    contextSections: string[];
    scope: ResolvedDirectorIntent;
    plannerScope: any;
    scopeTools: Set<string> | null;
    scopeLocks: string[];
    constraints: ResolvedDirectorConstraints;
    agreedToPlan: boolean;
    hasVision: boolean;
    allWordCount: number;
    playbook: StylePlaybook | null;
    drops: DirectorDropRecorder;
    violations: string[];
    opts: MobileDirectOptions & { resolveStockVideo?: any; resolveStockMusic?: any; llmTimeoutMs?: number };
    events: AgentRunEmitter;
  }): Promise<DirectorAgentOutcome<EditIR>> {
    const { request, medias, baseIR, scope, scopeTools, drops } = p;
    const baseDurationMs = Math.round(RationalTimeMath.toSeconds(baseIR.meta.totalDuration) * 1000);
    const turnConstraints = p.scopeLocks.length ? mergeDirectorConstraints(baseDurationMs, p.constraints, { lockedRanges: [], lockedTracks: p.scopeLocks as any }) : p.constraints;
    const sources = [
      ...(request.currentEditIR?.sources || []).filter((s) => s.assetId !== request.media.assetId && s.assetId !== (request.media.assetId || "primary")),
      { assetId: request.media.assetId || "primary", durationMs: request.media.durationMs, width: request.media.width, height: request.media.height },
    ];
    const itemCtx = { meta: request.currentEditIR?.itemMeta ?? {}, allowManualSweep: asksForAll(p.prompt) };
    const speechCaptions = (ir: EditIR) => ir.tracks.captionTrack.filter((c) => c.role !== "title").length;
    const planOf = (ops: CreativeOperation[], ir: EditIR): any => {
      const reframe = [...ops].reverse().find((o: any) => o.type === "reframeSubject" || o.type === "changeAspectRatio") as any;
      const locked = mapLockedRanges(baseIR, ir, turnConstraints.lockedRanges);
      return {
        version: "1.0.0",
        intent: {
          platform: "general", aspectRatio: reframe?.targetAspect ?? ir.meta.targetAspect, resolution: ir.meta.resolution, stylePreset: "CUSTOM",
          energy: "medium", pacing: "dynamic", captionStyle: "HORMOZI_BOUNCE", audioStyle: "VOICE_PRIORITY_DUCKED", visualStyle: "CLEAN_ATTENTION",
        },
        constraints: {
          protectedTimeRanges: locked.map(([a, b]) => ({ startSec: a / 1000, durationSec: (b - a) / 1000 })),
          lockedTracks: turnConstraints.lockedTracks,
        },
        selectedSegments: [], removedSegments: [], reorderedSegments: [], brollPlan: [], captionPlan: [],
        operations: ops, confidence: 0.9, explanation: "", requiresConfirmation: false,
      };
    };

    const apply = (ops: CreativeOperation[], ir: EditIR) => {
      const results: AgentEditResult[] = new Array(ops.length);
      const survivors: Array<{ i: number; ops: CreativeOperation[]; note?: string }> = [];
      const graphNow = graphFromMobileMediaList(medias, ir);
      ops.forEach((op, i) => {
        const notes: string[] = [];
        let cur: CreativeOperation[] = [op];
        if (scope.mode === "full_edit" && request.musicBeatsMs?.length) {
          const sn = snapToBeats(cur as any[], request.musicBeatsMs);
          if (sn.moved) notes.push("placed on the music's beat");
          cur = sn.ops as any;
        }
        const gated = gateRendererFeatures(cur as any[], request.rendererCapabilities);
        drops.record("renderer_gate", cur as any[], gated.ops as any[], gated.notes);
        if (!gated.ops.length) return (results[i] = { status: "rejected", reason: gated.notes.join("; ") || "this phone cannot render that yet" });
        if (gated.notes.length) notes.push(...gated.notes);
        cur = gated.ops as any;
        if (!p.agreedToPlan) {
          const g = guardDestructiveVariants(cur as any[], p.prompt);
          drops.record("destructive_guard", cur as any[], g.ops as any[], g.notes);
          if (!g.ops.length) return (results[i] = { status: "rejected", reason: g.notes.join("; ") || "the creator did not ask to replace that" });
          if (g.notes.length) notes.push(...g.notes);
          cur = g.ops as any;
        }
        if (scopeTools && !scopeTools.has(op.type)) {
          drops.record("scope", [op], [], `not part of the request's scope (${scope.mode})`);
          return (results[i] = { status: "rejected", reason: `not part of what the creator asked (${scope.mode})` });
        }
        const expWarnings: string[] = [];
        const canvas = (op as any).type === "reframeSubject" || (op as any).type === "changeAspectRatio"
          ? ((op as any).width && (op as any).height ? { width: (op as any).width, height: (op as any).height } : EditIRCompiler.resolutionFor((op as any).targetAspect))
          : ir.meta.resolution;
        let expanded = PlanExpander.expand(planOf(cur, ir), graphNow, expWarnings, { canvas, existingCaptions: speechCaptions(ir) }).operations as CreativeOperation[];
        if (!expanded.length) return (results[i] = { status: "rejected", reason: expWarnings.join("; ") || "nothing to change on this timeline" });
        if (expWarnings.length) notes.push(...expWarnings.slice(0, 2));
        if (request.currentEditIR) {
          const r = applyItemLocks(expanded as any, request.currentEditIR, itemCtx);
          drops.record("item_locks", expanded as any[], r.ops as any[], r.violations);
          p.violations.push(...r.violations);
          if (!r.ops.length) return (results[i] = { status: "rejected", reason: r.violations.join("; ") || "a locked item" });
          expanded = r.ops as any;
        }
        const v = CreativePlanValidator.validate(planOf(expanded, ir), ir, []);
        if (!v.valid) {
          const bad = new Set(v.errors.map((e) => e.match(/^Operation #(\d+)/)?.[1]).filter(Boolean).map(Number));
          const kept = expanded.filter((_, k) => !bad.has(k));
          drops.record("validator", expanded as any[], kept as any[], [...v.errors, ...v.violations]);
          p.violations.push(...v.violations);
          if (!kept.length) return (results[i] = { status: "rejected", reason: [...v.errors, ...v.violations].join("; ").slice(0, 400) || "invalid on this timeline" });
          expanded = kept;
        }
        survivors.push({ i, ops: expanded, ...(notes.length ? { note: notes.join("; ").slice(0, 300) } : {}) });
      });
      if (!survivors.length) return { ir, results, applied: [], rejected: [], compiled: [] };
      const flat = survivors.flatMap((x) => x.ops);
      const c = EditIRCompiler.compile(ir, planOf(flat, ir), [], { sources });
      // Compiler refusals ("insertBroll: ...") are matched to the op of that type in this batch.
      const refused = new Map<number, string>();
      for (const r of c.rejectedOperations) {
        const type = /^\s*([A-Za-z]\w*)\s*[:(]/.exec(r)?.[1];
        const owner = survivors.find((x) => !refused.has(x.i) && x.ops.some((o) => o.type === type)) ?? survivors.find((x) => !refused.has(x.i) && survivors.length === 1);
        if (owner) refused.set(owner.i, r);
      }
      for (const x of survivors) {
        const why = refused.get(x.i);
        results[x.i] = why ? { status: "rejected", reason: why } : { status: "applied", changes: c.appliedOperations.slice(0, 8), ...(x.note ? { note: x.note } : {}) };
      }
      return { ir: c.updatedEditIR, results, applied: c.appliedOperations, rejected: c.rejectedOperations, compiled: flat };
    };

    // Read-only tools.
    const clipsOf = (ir: EditIR) => (ir.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO")?.clips ?? []).map((c) => ({
      assetId: c.assetId,
      t0: RationalTimeMath.toSeconds(c.timelineRange.start),
      t1: RationalTimeMath.toSeconds(c.timelineRange.start) + RationalTimeMath.toSeconds(c.timelineRange.duration),
      s0: RationalTimeMath.toSeconds(c.sourceRange.start),
      speed: c.speedMultiplier || 1,
    }));
    const logs = new Map(medias.filter((m) => m.shotLog?.shots.length).map((m) => [m.assetId, m.shotLog!]));
    const brollFound = new Map<string, any>();
    const fmt = (n: number) => n.toFixed(2);
    const read = {
      getWords: (ir: EditIR, a: number, b: number) => {
        const ws = graphFromMobileMediaList(medias, ir).transcript.filter((w: any) => w.endSeconds > a && w.startSeconds < b).slice(0, 400);
        if (!ws.length) return `no words between ${fmt(a)} and ${fmt(b)} s`;
        const safe = neutraliseWordSequence(ws.map((w: any) => w.word)).words;
        return fenceUntrusted("transcript", ws.map((w: any, i: number) => `${fmt(w.startSeconds)}-${fmt(w.endSeconds)}:${safe[i]}`).join(" "), { maxChars: 12000 }).block;
      },
      getShots: (ir: EditIR, a: number, b: number) => {
        if (!logs.size) return "no vision pass for this video (the creator did not allow stills, or it is still running)";
        const lines: string[] = [];
        for (const c of clipsOf(ir)) {
          if (c.t1 <= a || c.t0 >= b) continue;
          const log = logs.get(c.assetId);
          if (!log) continue;
          const s0 = c.s0, s1 = c.s0 + (c.t1 - c.t0) * c.speed;
          for (const sh of log.shots) {
            const ss = sh.startMs / 1000, se = sh.endMs / 1000;
            if (se <= s0 || ss >= s1) continue;
            const ta = c.t0 + (Math.max(ss, s0) - s0) / c.speed, tb = c.t0 + (Math.min(se, s1) - s0) / c.speed;
            if (tb <= a || ta >= b) continue;
            const main = sh.subjects.find((x) => x.primary) ?? sh.subjects[0];
            lines.push(`${fmt(ta)}-${fmt(tb)} ${sh.framing} | ${sanitizeInlineUntrusted(sh.description, 200)}${main ? ` | main: ${sanitizeInlineUntrusted(main.label, 40)} centre (${fmt(main.box.x + main.box.w / 2)},${fmt(main.box.y + main.box.h / 2)})` : ""} | b-roll ok ${sh.brollSuitability.toFixed(1)}${sh.quality.length ? ` | issues: ${sh.quality.join(", ")}` : ""}`);
          }
        }
        return lines.length ? fenceUntrusted("vision", lines.slice(0, 80).join("\n"), { maxChars: 12000 }).block : `no shots between ${fmt(a)} and ${fmt(b)} s`;
      },
      getTimelineSummary: (ir: EditIR) => CreativePlanner.describeEditIR(ir, request.currentEditIR?.itemMeta).join("\n").slice(0, 16000),
      searchBroll: async (query: string, aspect: string) => {
        const asp = aspect || p.planBase.meta.targetAspect;
        if (p.opts.searchBroll) {
          const hits = (await withTimeout(p.opts.searchBroll(query, asp), 6000, "b-roll search")).filter((h) => /^https:\/\//i.test(h.url)).slice(0, 4);
          // Licence and credit of every result, so a clip used by URL still gets its credit line.
          for (const h of hits) brollFound.set(h.url, { query, ...h });
          if (!hits.length) return { text: `no stock clips for "${query}"; try other words` };
          const images: AgentContentPart[] = [];
          const fetchImage = p.opts.fetchImage ?? defaultFetchImage;
          const lines: string[] = [];
          for (const [k, h] of hits.entries()) {
            lines.push(`${k + 1}. ${sanitizeInlineUntrusted(h.title || "untitled", 80)} | ${h.provider || "stock"} | ${h.license || "licence unknown"}${h.durationSec ? ` | ${Math.round(h.durationSec)} s` : ""} | url: ${h.url}`);
            if (h.thumbnailUrl && images.length < 3) {
              const img = await fetchImage(h.thumbnailUrl).catch(() => null);
              if (img) images.push({ type: "text", text: `Result ${k + 1}:` }, { type: "image", mediaType: img.mediaType, data: img.data });
            }
          }
          return { text: fenceUntrusted("other", lines.join("\n"), { maxChars: 4000 }).block, images };
        }
        if (p.opts.resolveStockVideo) {
          const r: any = await withTimeout(p.opts.resolveStockVideo(query, asp), 6000, "b-roll search");
          const hit: any = typeof r === "string" ? { url: r } : r;
          if (!hit || !/^https:\/\//i.test(hit.url)) return { text: `no stock clips for "${query}"; try other words` };
          return { text: fenceUntrusted("other", `1. ${sanitizeInlineUntrusted((hit as any).title || "untitled", 80)} | url: ${hit.url}`, { maxChars: 1000 }).block };
        }
        throw new Error("no stock search configured");
      },
      searchMusic: async (mood: string, durationSec: number) => {
        const resolve = p.opts.resolveStockMusic || (async (q: string, d: number) => resolveMusicFromCatalog(q, d));
        const r = await withTimeout(Promise.resolve(resolve(mood, durationSec)), 5000, "music search");
        const t = typeof r === "string" ? { url: r } : r;
        if (!t || !/^https:\/\//i.test(t.url)) return `no track for "${mood}"; try another mood`;
        return `best match: ${sanitizeInlineUntrusted((t as any).title || "untitled", 80)}${(t as any).durationSec ? ` (${Math.round((t as any).durationSec)} s)` : ""}${(t as any).license ? `, ${(t as any).license}` : ""}. Add it with addBackgroundMusic and this mood as the query.`;
      },
    };

    const stages = scope.mode === "full_edit"
      ? wholeEditStages(scopeTools, p.playbook ? playbookStageBriefs(p.playbook) : {})
      : [{ id: "request", label: "the creator's request", tools: scopeTools ? [...scopeTools] : DIRECTOR_TOOL_SPECS.map((x) => x.name as string).filter((n) => n !== "finish_edit"), brief: "Do exactly what the creator asked and nothing more, then call finish_edit." }];
    const envInt = (k: string, d: number) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);
    const plannerParams: any = {
      prompt: p.plannerPrompt, timelineContext: p.timelineContext, mediaGraph: p.graph, history: request.history, currentEditIR: p.planBase,
      contextSections: p.contextSections.length ? p.contextSections : undefined, itemMeta: request.currentEditIR?.itemMeta, scope: p.plannerScope, hasVision: p.hasVision,
      ...(p.playbook ? { playbook: p.playbook } : {}),
    };
    const result = await runDirectorAgent<EditIR>({
      client: p.client,
      model: p.model,
      effort: directorEffort(),
      system: `${CreativePlanner.buildSystemPrompt(plannerParams)}\n\n${AGENT_PROTOCOL}`,
      firstMessage: CreativePlanner.buildPrompt(plannerParams),
      stages,
      initialIR: p.planBase,
      apply,
      read,
      missingRequested: (types) => missingRequestedOperations(p.plannerPrompt, types, p.allWordCount > 0, scopeTools),
      maxTurns: scope.mode === "full_edit" ? envInt("AI_DIRECTOR_AGENT_TURNS", 8) : 3,
      budgetMs: envInt("AI_DIRECTOR_AGENT_BUDGET_MS", 90000),
      perCallTimeoutMs: directorLlmTimeoutMs(p.opts.llmTimeoutMs),
      onTurn: (t) => p.events.emit("ToolCompleted", { tool: "agent_turn", ...t }),
    });
    return Object.assign(result, { brollFound });
  }

  /**
   * Story pass (quality-fix Phase 3): the story editor picks the hook, the keepers and the lines to cut; the cuts are
   * compiled at word boundaries on the creator's timeline (locked ranges and locked items respected), then the hook
   * is moved to the start when the model asked for it. Returns the cut timeline, or why the pass was skipped.
   */
  private async runStoryPass(p: {
    request: MobileAIDirectRequest;
    prompt: string;
    medias: Array<MobileAIDirectRequest["media"] & { assetId: string }>;
    baseIR: EditIR;
    constraints: ResolvedDirectorConstraints;
    ctx: DirectorContext;
    sources: Array<{ assetId: string; durationMs: number; width: number; height: number }>;
    client: AIClient | null | undefined;
    llmModel?: string;
    companyId?: string;
  }): Promise<{ ok: true; ir: EditIR; result: { outcome: StoryOutcome; applied: string[]; ops: CreativeOperation[]; hookMoved: boolean } } | { ok: false; reason: string }> {
    const resolved = await CreativePlanner.resolveDirectorClient({ llmClient: p.client, llmModel: p.llmModel, companyId: p.companyId });
    if (!resolved.client) return { ok: false, reason: resolved.reason || "no AI provider" };
    const graph = graphFromMobileMediaList(p.medias, p.baseIR);
    const words: StoryWord[] = graph.transcript.map((w: any) => ({ word: w.word, startSeconds: w.startSeconds, endSeconds: w.endSeconds, ...(w.speakerId ? { speakerId: w.speakerId } : {}) }));
    const durationSec = RationalTimeMath.toSeconds(p.baseIR.meta.totalDuration);
    // What the picture shows, per source (SOURCE seconds; the clips are still in place before the story cut).
    const visionLines = p.medias.flatMap((m) => (m.shotLog?.shots.length ? shotLogPromptLines(m.shotLog, 40) : []));
    const timeoutMs = Math.min(45000, directorLlmTimeoutMs());
    let outcome: StoryOutcome;
    try {
      outcome = await withTimeout(
        StoryPlanner.plan({
          words, durationSec, request: p.prompt, client: resolved.client, model: resolved.model,
          targetDurationSec: p.ctx.piece?.targetDurationSec, platform: p.ctx.piece?.platform, visionLines, timeoutMs,
        }),
        timeoutMs,
        "story pass"
      );
    } catch (err: any) {
      const reason = String(err?.message || err).slice(0, 240);
      console.warn(`[VideoAIDirector] story pass skipped (${resolved.client.provider}/${resolved.model}): ${reason}`);
      return { ok: false, reason };
    }
    const userConstraints = {
      protectedTimeRanges: p.constraints.lockedRanges.map(([a, b]) => ({ startSec: a / 1000, durationSec: (b - a) / 1000 })),
      lockedTracks: p.constraints.lockedTracks,
    };
    const planOf = (operations: CreativeOperation[]): any => ({
      version: "1.0.0",
      intent: {
        platform: "general", aspectRatio: p.baseIR.meta.targetAspect, resolution: p.baseIR.meta.resolution, stylePreset: "CUSTOM",
        energy: "medium", pacing: "dynamic", captionStyle: "HORMOZI_BOUNCE", audioStyle: "VOICE_PRIORITY_DUCKED", visualStyle: "CLEAN_ATTENTION",
      },
      constraints: userConstraints,
      selectedSegments: [], removedSegments: [], reorderedSegments: [], brollPlan: [], captionPlan: [],
      operations, confidence: 0.8, explanation: outcome.plan.summary, requiresConfirmation: false,
    });
    // The same guards as every plan: locked items, locked ranges.
    let ops = outcome.cutOps;
    if (p.request.currentEditIR) {
      ops = applyItemLocks(ops as any, p.request.currentEditIR, { meta: p.request.currentEditIR.itemMeta ?? {}, allowManualSweep: asksForAll(p.prompt) }).ops as any;
    }
    const v = CreativePlanValidator.validate(planOf(ops), p.baseIR, []);
    if (!v.valid) {
      const bad = new Set(v.errors.map((e) => e.match(/^Operation #(\d+)/)?.[1]).filter(Boolean).map(Number));
      ops = ops.filter((_, i) => !bad.has(i));
    }
    const applied: string[] = [];
    let ir = p.baseIR;
    if (ops.length) {
      const c = EditIRCompiler.compile(p.baseIR, planOf(ops), [], { sources: p.sources });
      ir = c.updatedEditIR;
      applied.push(...c.appliedOperations.map((a) => `story: ${a}`));
    }
    let hookMoved = false;
    const all: CreativeOperation[] = [...ops];
    if (outcome.hook) {
      const cutWords = graphFromMobileMediaList(p.medias, ir).transcript.map((w: any) => ({ word: w.word, startSeconds: w.startSeconds, endSeconds: w.endSeconds }));
      const move = StoryPlanner.hookMoveOp(outcome.hook, words, cutWords);
      if (move) {
        const c = EditIRCompiler.compile(ir, planOf([move]), [], { sources: p.sources });
        if (c.appliedOperations.length && !c.rejectedOperations.length) {
          ir = c.updatedEditIR;
          applied.push(...c.appliedOperations.map((a) => `story: ${a}`));
          all.push(move);
          hookMoved = true;
        }
      }
    }
    return { ok: true, ir, result: { outcome, applied, ops: all, hookMoved } };
  }

  private async runMobileDirector(
    request: MobileAIDirectRequest,
    opts: {
      companyId?: string;
      llmClient?: AIClient | null;
      llmModel?: string;
      /** Resolve a stock b-roll query to an HTTPS video URL, or the URL with its licence/credit (null when unavailable). */
      resolveStockVideo?: (query: string, aspect: string) => Promise<string | ResolvedStockMedia | null>;
      /**
       * Resolve a music mood query to an HTTPS audio track (null when nothing fits).
       * Defaults to the built-in royalty-free catalogue (`resolveMusicFromCatalog`).
       */
      resolveStockMusic?: (query: string, durationSec: number) => Promise<ResolvedMusicTrack | string | null>;
      /** Optional SFX search (metadata + HTTPS previews only), e.g. Freesound when FREESOUND_API_KEY is set. */
      resolveSfx?: (query: string) => Promise<SfxSuggestion[]>;
      /**
       * Translates caption lines one-to-one (`translateCaptions` op). Defaults to the workspace's AI provider;
       * without one the op is rejected, never faked.
       */
      translateCaptionLines?: (lines: string[], targetLanguage: string, script: CaptionScript) => Promise<string[]>;
      /** Brand + calendar piece context loaded by the server (never taken from the client). */
      context?: DirectorContext;
      /** Overall budget for all stock lookups (b-roll, music, SFX) in this turn. Default 8000 ms. */
      stockTimeoutMs?: number;
      /** Max LLM calls in this turn. Default 3 (the planner uses at most 2). */
      llmCallBudget?: number;
      /** Per-call LLM timeout (default `AI_DIRECTOR_LLM_TIMEOUT_MS` or 60000 ms). */
      llmTimeoutMs?: number;
    } & MobileDirectOptions,
    events: AgentRunEmitter
  ): Promise<MobileDirectResult> {
    const startedAt = Date.now();
    // Phase 0 turn log: which filter dropped which planned operation.
    const drops = new DirectorDropRecorder();
    let plannedCount: number | null = null;
    // A source without an on-device face track takes the ShotLog's main subjects as its track (Phase 2): FACE zooms and
    // moving crops then centre on what the vision model saw (a screen area, a product) instead of the frame centre.
    const withVisionSubjects = <M extends { faces?: any[]; shotLog?: { shots: any[] } }>(m: M): M =>
      !m.faces?.length && m.shotLog?.shots.length ? { ...m, faces: subjectSamplesFromShotLog(m.shotLog as any) } : m;
    const media = withVisionSubjects({ ...request.media, assetId: request.media.assetId || "primary" });
    const projectId = request.currentEditIR?.projectId || request.projectId || crypto.randomUUID();
    const baseIR = request.currentEditIR
      ? editIRFromMobile({ ...request.currentEditIR, projectId })
      : editIRFromMobileMedia(media, projectId);
    const ctx: DirectorContext = opts.context || { warnings: [] };
    const words = media.transcript?.words || [];
    // Every source on the timeline with its own analysis (Phase 4, F-10): clips 2..N are captioned, cleaned and ducked
    // from their own words. `media` stays the primary source; a mediaList entry for the same asset replaces it.
    const listed = (request.mediaList || []).map((m) => withVisionSubjects({ ...m, assetId: m.assetId || "primary" }));
    const hasVision = [media, ...listed].some((m) => !!m.shotLog?.shots.length);
    const medias = [listed.find((m) => m.assetId === media.assetId) ?? media, ...listed.filter((m) => m.assetId !== media.assetId)]
      .filter((m, i, all) => all.findIndex((x) => x.assetId === m.assetId) === i);
    const wordsByAsset: Record<string, Array<{ text: string; startMs: number; endMs: number }>> = Object.fromEntries(medias.map((m) => [m.assetId, m.transcript?.words || []]));
    const sourceWordsByAsset = Object.fromEntries(Object.entries(wordsByAsset).map(([id, ws]) => [id, ws.map((w) => ({ startSec: w.startMs / 1000, endSec: w.endMs / 1000 }))]));
    const faceCenterByAsset = Object.fromEntries(medias.map((m) => [m.assetId, dominantFaceCenter(m.faces)]));
    // Moving crops (Phase 6.1) follow each source's own face track and re-centre on its scene cuts.
    const faceSamplesByAsset = Object.fromEntries(medias.map((m) => [m.assetId, m.faces]));
    const scenesByAsset = Object.fromEntries(medias.map((m) => [m.assetId, m.scenesMs]));
    const allWordCount = Object.values(wordsByAsset).reduce((n, ws) => n + ws.length, 0);
    const prompt = (request.prompt || "").trim();
    const intent: "edit" | "greet" = request.intent === "greet" || !prompt ? "greet" : "edit";
    const stockBudgetMs = opts.stockTimeoutMs ?? 8000;
    // The budget starts at the first stock lookup, not at the request: planning (LLM calls) used to eat all of it,
    // so every B-roll / music lookup was skipped and left to the phone.
    let stockDeadline = 0;
    const remaining = () => {
      if (!stockDeadline) stockDeadline = Date.now() + stockBudgetMs;
      return Math.max(0, stockDeadline - Date.now());
    };

    const warnings: string[] = [...ctx.warnings];
    // Sources on the timeline that have no words: either still being analysed, or not sent (never guessed).
    const usedAssets = [...new Set((request.currentEditIR?.clips ?? []).map((c) => c.assetId).filter((id) => !id.startsWith("freeze:")))];
    const pending = new Set(request.analysisPending || []);
    if (!allWordCount) {
      warnings.push("no transcript supplied: captions, filler removal and transcript-aware edits are unavailable");
    } else {
      for (const id of usedAssets) {
        if (wordsByAsset[id]?.length) continue;
        warnings.push(pending.has(id)
          ? `clip source ${id} is still being transcribed: captions and cuts there will follow once it is ready`
          : `clip source ${id} has no transcript: no captions, filler or pause cuts are made in its clips`);
      }
    }
    if (allWordCount && looksLikePromptInjection(Object.values(wordsByAsset).flat().map((w) => w.text).join(" "))) {
      warnings.push("the transcript contains instruction-like text; it was treated as data only");
    }
    events.emit("ContextLoaded", {
      brand: !!ctx.brand, piece: !!ctx.piece, memoryLines: opts.memoryContext?.length || 0,
      autonomy: normalizeAutonomy(opts.autonomy || ctx.brand?.autonomy).editing,
    });
    events.emit("MediaAnalyzed", {
      durationMs: media.durationMs, words: allWordCount, sources: medias.length, pending: pending.size, silences: media.silences?.length || 0, faces: media.faces?.length || 0,
      beats: media.beatsMs?.length || 0, scenes: media.scenesMs?.length || 0, ocr: media.ocr?.length || 0,
      loudnessLufs: media.loudness?.integratedLufs ?? null, lastExportQa: !!request.lastExportQa,
    });

    // Preservation constraints: request + the creator's own words (deterministic). The model can only add more.
    const baseDurationMs = Math.round(RationalTimeMath.toSeconds(baseIR.meta.totalDuration) * 1000);
    const fromWords = intent === "edit" ? extractConstraintsFromPrompt(prompt, baseDurationMs) : { lockedRanges: [], lockedTracks: [], notes: [] as string[] };
    let constraints: ResolvedDirectorConstraints = mergeDirectorConstraints(baseDurationMs, request.constraints, fromWords);
    const toUserConstraints = (c: ResolvedDirectorConstraints, ranges = c.lockedRanges) => ({
      protectedTimeRanges: ranges.map(([a, b]) => ({ startSec: a / 1000, durationSec: (b - a) / 1000 })),
      lockedTracks: c.lockedTracks,
    });

    // Style agent + script alignment (deterministic, from the server-loaded context).
    const style = styleAgent(ctx);
    if (ctx.brand) warnings.push(...style.warnings);
    const alignment: ScriptAlignment | null =
      ctx.piece?.sections.length && words.length ? alignScriptToTranscript(ctx.piece.sections, words) : null;

    let graph = graphFromMobileMediaList(medias, baseIR);
    let timelineContext = ContextResolver.resolveTimelineContext({ editIR: baseIR, userConstraints: toUserConstraints(constraints) });
    // The timeline the enhancement planner works on: the creator's, or the story-cut one (Phase 3).
    let planBase: EditIR = baseIR;
    let storyResult: { outcome: StoryOutcome; applied: string[]; ops: CreativeOperation[]; hookMoved: boolean } | null = null;
    let storyNote: string | null = null;
    // Phase 6 style playbook (whole edits only).
    let playbook: StylePlaybook | null = null;
    let playbookReason = "";
    // Phase 4 agent loop result (null = the one-shot planner ran, or nothing to edit).
    let agentRun: DirectorAgentOutcome<EditIR> | null = null;
    let agentHandled = false;
    const agentViolations: string[] = [];

    // LLM budget: every planner call (first plan, validation repair, critic repairs) goes through this counter.
    const budget = opts.llmCallBudget ?? 6;
    let llmCalls = 0;
    const countedClient = (c: AIClient | null | undefined): AIClient | null | undefined => {
      if (!c || typeof c.generateWithTools !== "function") return c;
      const inner = c.generateWithTools.bind(c);
      return {
        ...c,
        generateWithTools: async (p: any, tools: any, options: any) => {
          if (llmCalls >= budget) throw new Error(`LLM call budget (${budget}) for this turn is used up`);
          llmCalls++;
          return inner(p, tools, options);
        },
      } as AIClient;
    };

    let outcome!: { plan: any; plannerSource: PlannerSource; plannerReason: string; brandWatermark?: "add" | "remove" | "keep"; preserve?: any; conversation?: DirectorConversation };
    let agreedToPlan = false;
    let plannerPrompt = prompt;
    let plannerContextSections: string[] = [];
    let proposal: ReturnType<typeof buildGreetingProposal> | null = null;
    // Phase 3: the request's scope, decided before planning (null = the opening greeting, which has its own flow).
    let scope: ResolvedDirectorIntent | null = null;
    let scopeTools: Set<string> | null = null;
    let scopeLocks: string[] = [];
    let sfx: SfxSuggestion[] = [];
    let brandApplied: string[] = [];

    if (intent === "greet") {
      // Opening turn: the sub-agents build a proposal. No LLM call (fast, predictable, labelled).
      const broll = medias.flatMap((m) => (m.transcript?.words?.length ? brollResearchAgent({ words: m.transcript.words, baseIR, assetId: m.assetId }) : [])).slice(0, 2);
      const sound = await soundAgent({ ctx, resolveSfx: opts.resolveSfx, timeoutMs: Math.min(3000, remaining()), warnings });
      sfx = sound.sfx;
      proposal = buildGreetingProposal({
        ctx, style, alignment, baseIR, assetId: media.assetId, words,
        hasSilences: medias.some((m) => !!m.silences?.length), broll, music: sound.music,
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
    } else {
      const contextSections = describeDirectorContext(ctx, style, alignment);
      if (contextSections.length) contextSections.push(`(SOURCE times equal timeline times until cuts are made; map them through the main clips above.)`, ``);
      for (const m of medias) contextSections.push(...mediaContextSections(m, medias.length > 1 ? m.assetId : undefined));
      const waiting = usedAssets.filter((id) => pending.has(id) && !wordsByAsset[id]?.length);
      if (waiting.length) contextSections.push(`## Still being analysed`, `The phone is still transcribing clip source(s) ${waiting.join(", ")}: you do not know what is said in those clips yet. Do not invent it; say so if the request depends on it.`, ``);
      if (opts.memoryContext?.length) contextSections.push(`## Project memory (this project only)`, ...opts.memoryContext, ``);
      // "yes" / "do it" to the plan the director proposed last turn: the planner gets the plan itself.
      const lastPlan = planFromHistory(request.history);
      agreedToPlan = lastPlan.length > 0 && (isAffirmative(prompt) || startsWithAgreement(prompt));
      plannerPrompt = agreedToPlan ? agreedPlanPrompt(prompt, lastPlan) : prompt;
      // Understand first (Phase 3.1). The offline classifier settles clear requests at once ("make the music quieter");
      // only when it is unsure does a small LLM intent call decide. "Yes" to the Director's own plan runs that plan.
      const lastAssistant = [...(request.history || [])].reverse().find((t) => t.role === "assistant")?.content;
      if (request.visualCritique) {
        // Phase 5: a repair turn after the visual check. It fixes only the critic's issues, on the items named.
        plannerPrompt = visualRepairInstruction(prompt, request.visualCritique);
        scope = { mode: "modify_existing", targets: [], allowedTools: [], mustNotTouch: [], clarifyingQuestion: null, source: "offline", note: `visual check repair, round ${request.visualCritique.round}` } as ResolvedDirectorIntent;
      } else if (agreedToPlan || confirmsFullEdit(prompt, lastAssistant)) {
        scope = { mode: "full_edit", targets: [], allowedTools: [], mustNotTouch: [], clarifyingQuestion: null, source: "offline", note: agreedToPlan ? "the creator agreed to the proposed plan" : "the creator confirmed a full pass" };
      } else {
        const offline = classifyDirectorIntentOffline(prompt);
        let raw = offline;
        let source: "llm" | "offline" = "offline";
        if (offline.unknown && opts.llmClient !== null) {
          const llm = await CreativePlanner.classifyIntent({
            prompt, history: request.history, currentEditIR: baseIR, itemMeta: request.currentEditIR?.itemMeta,
            llmClient: countedClient(opts.llmClient), llmModel: opts.llmModel, companyId: opts.companyId, llmTimeoutMs: opts.llmTimeoutMs,
          });
          if (llm) {
            raw = llm.intent;
            source = "llm";
          }
        }
        scope = finalizeIntent(raw, { prompt, timeline: request.currentEditIR, source });
      }
      const scoped = scopedTools(scope, DIRECTOR_TOOL_SPECS.map((sp) => sp.name as string));
      scopeTools = scoped ? new Set(scoped) : null;
      scopeLocks = scopedLockedTracks(scope);
      // A visual repair may touch whatever the critic named (captions, zooms, overlays ...): every tool, no track locks.
      if (request.visualCritique) {
        scopeTools = null;
        scopeLocks = [];
      }
      events.emit("ToolCalled", { tool: "intent", mode: scope.mode, source: scope.source, targets: scope.targets.map((t) => t.kind) });

      if (scope.mode === "ambiguous") {
        // Not sure what to change: ask, change nothing (F-22).
        const question = scope.clarifyingQuestion || "What should I change?";
        const quickReplies = question === FULL_EDIT_QUESTION ? ["Full pass", "Only the cuts", "Only the captions"] : ["The cuts and pauses", "The captions", "The music"];
        outcome = {
          plan: {
            version: "1.0.0",
            intent: {
              platform: "general", aspectRatio: baseIR.meta.targetAspect, resolution: baseIR.meta.resolution, stylePreset: "CUSTOM",
              energy: "medium", pacing: "dynamic", captionStyle: "HORMOZI_BOUNCE", audioStyle: "VOICE_PRIORITY_DUCKED", visualStyle: "CLEAN_ATTENTION",
            },
            constraints: timelineContext.userConstraints,
            selectedSegments: [], removedSegments: [], reorderedSegments: [], brollPlan: [], captionPlan: [],
            operations: [], confidence: 0.5, explanation: question, requiresConfirmation: true,
          },
          plannerSource: scope.source === "llm" ? "llm" : "deterministic",
          plannerReason: `clarifying question before editing (${scope.note || "the request is ambiguous"})`,
          conversation: { reply: question, phase: "gather", quickReplies, proposedPlan: [] },
        };
        plannerContextSections = contextSections;
      } else {
        // Phase 6: one style playbook for a whole edit (the creator's words, the clip, the brand, the canvas).
        if (scope?.mode === "full_edit") {
          const recentAsks = [...(request.history || []).filter((t) => t.role === "user").slice(-3).map((t) => t.content), prompt].join(" \n ");
          const speakers = new Set(medias.flatMap((m) => (m.transcript?.words || []).map((w: any) => w.speaker).filter(Boolean))).size;
          const shots = medias.flatMap((m) => m.shotLog?.shots ?? []);
          const screenRecording = shots.length > 0 && shots.filter((s) => s.framing === "screen").length / shots.length >= 0.6;
          const chosen = choosePlaybook({ prompt: recentAsks, brandPacing: ctx.brand ? style.pacing : undefined, speakers, screenRecording, aspect: baseIR.meta.targetAspect });
          playbook = chosen.playbook;
          playbookReason = chosen.reason;
          events.emit("ToolCalled", { tool: "style", playbook: playbook.id, reason: playbookReason });
        }
        // Story pass first (whole edits only): select the hook, keepers and cuts, then decorate the cut timeline.
        if (scope?.mode === "full_edit" && !request.visualCritique && opts.llmClient !== null && allWordCount >= STORY_MIN_WORDS) {
          const story = await this.runStoryPass({
            request, prompt, medias, baseIR, constraints, ctx, sources: [
              ...(request.currentEditIR?.sources || []).filter((s) => s.assetId !== media.assetId),
              { assetId: media.assetId, durationMs: media.durationMs, width: media.width, height: media.height },
            ],
            client: countedClient(opts.llmClient), llmModel: opts.llmModel, companyId: opts.companyId,
          });
          if (!("reason" in story)) {
            storyResult = story.result;
            planBase = story.ir;
            const lockedNow = mapLockedRanges(baseIR, planBase, constraints.lockedRanges);
            graph = graphFromMobileMediaList(medias, planBase);
            timelineContext = ContextResolver.resolveTimelineContext({ editIR: planBase, userConstraints: toUserConstraints(constraints, lockedNow) });
            contextSections.push(...storyContextSection(story.result.outcome, story.result.hookMoved));
            events.emit("ToolCompleted", { tool: "story", removed: story.result.outcome.plan.remove.length, removedSec: story.result.outcome.removedSec, hookMoved: story.result.hookMoved });
          } else {
            storyNote = story.reason;
            warnings.push(`story pass skipped: ${story.reason}`);
          }
        }
        // Phase 4: a multi-turn loop with real tool feedback when the provider supports it; else the one-shot planner.
        const plannerScope = scope ? { mode: (scope.unscoped ? "open" : scope.mode) as any, targets: scope.targets, mustNotTouch: scope.mustNotTouch, tools: scopeTools ? [...scopeTools] : null } : undefined;
        if (process.env.AI_DIRECTOR_AGENT !== "0" && opts.llmClient !== null) {
          const resolved = await CreativePlanner.resolveDirectorClient({ llmClient: countedClient(opts.llmClient), llmModel: opts.llmModel, companyId: opts.companyId });
          if (resolved.client && typeof resolved.client.generateAgentTurn === "function") {
            try {
              agentRun = await this.runAgentLoop({
                client: resolved.client, model: resolved.model, request, plannerPrompt, prompt, medias, baseIR, planBase, graph, timelineContext,
                contextSections, scope: scope!, plannerScope, scopeTools, scopeLocks, constraints, agreedToPlan, hasVision, allWordCount, playbook,
                drops, violations: agentViolations, opts, events,
              });
              llmCalls += agentRun.turns;
              plannerContextSections = contextSections;
              const label = `${resolved.client.provider}${resolved.model ? `/${resolved.model}` : ""}`;
              const summary = agentRun.conversation?.reply || agentRun.finish?.summary || CreativePlanner.summarizeOperations(agentRun.operations);
              const edited = agentRun.kind === "edited";
              outcome = {
                plan: CreativePlanner.buildPlan({ timelineContext } as any, edited ? agentRun.operations : [], summary, agentRun.finish?.requiresConfirmation ?? false),
                plannerSource: "llm",
                plannerReason: `${label} agent loop (${agentRun.turns} turn${agentRun.turns === 1 ? "" : "s"}, stages ${agentRun.stagesDone.join(" > ") || "none"}, ${agentRun.stopped}${agentRun.coverageRetry ? ", coverage stage" : ""}${agentRun.feedback ? `, ${agentRun.feedback} rejection(s) fed back` : ""})`,
                brandWatermark: agentRun.finish?.brandWatermark,
                preserve: agentRun.finish?.preserve,
                ...(agentRun.conversation
                  ? { conversation: edited && agentRun.operations.length ? { ...agentRun.conversation, phase: "done" as const, proposedPlan: [] } : agentRun.conversation }
                  : {}),
              };
              plannedCount = agentRun.operations.length;
              if (agentRun.stopped === "budget" || agentRun.stopped === "turns" || agentRun.stopped === "error") {
                warnings.push(`the editor stopped early (${agentRun.stopped}${agentRun.error ? `: ${agentRun.error}` : ""}); everything applied so far is kept`);
              }
              agentHandled = true;
              if (!edited) {
                // A recommendation or a question: nothing is edited, the story cut included.
                agentRun = null;
                if (storyResult) {
                  storyResult = null;
                  storyNote = "the editor replied without editing";
                  planBase = baseIR;
                  graph = graphFromMobileMediaList(medias, baseIR);
                  timelineContext = ContextResolver.resolveTimelineContext({ editIR: baseIR, userConstraints: toUserConstraints(constraints) });
                }
              } else if (ctx.brand) {
                brandApplied = applyBrandDefaults(outcome.plan.operations, prompt, style);
              }
            } catch (err: any) {
              agentRun = null;
              const reason = String(err?.message || err).slice(0, 240);
              console.warn(`[VideoAIDirector] agent loop failed on its first turn (${resolved.client.provider}/${resolved.model}): ${reason}`);
              warnings.push(`step-by-step editing unavailable (${reason}); planned in one pass`);
            }
          }
        }
        if (!agentHandled) {
        const planned = await CreativePlanner.planWithSource({
          prompt: plannerPrompt,
          timelineContext,
          mediaGraph: graph,
          companyId: opts.companyId,
          history: request.history,
          currentEditIR: planBase,
          llmClient: countedClient(opts.llmClient),
          llmModel: opts.llmModel,
          llmTimeoutMs: opts.llmTimeoutMs,
          contextSections: contextSections.length ? contextSections : undefined,
          itemMeta: request.currentEditIR?.itemMeta,
          scope: scope ? { mode: scope.unscoped ? "open" : scope.mode, targets: scope.targets, mustNotTouch: scope.mustNotTouch, tools: scopeTools ? [...scopeTools] : null } : undefined,
          hasVision,
          ...(playbook ? { playbook } : {}),
        });
        outcome = planned;
        plannedCount = planned.plan.operations.length;
        // A reply without edits (a recommendation, a question) edits nothing: the story cut is not applied either.
        if (storyResult && planned.plan.operations.length === 0 && planned.conversation && planned.conversation.phase !== "done") {
          storyResult = null;
          storyNote = "the editor replied without editing";
          planBase = baseIR;
          graph = graphFromMobileMediaList(medias, baseIR);
          timelineContext = ContextResolver.resolveTimelineContext({ editIR: baseIR, userConstraints: toUserConstraints(constraints) });
        }
        plannerContextSections = contextSections;
        if (planned.plannerSource === "deterministic" && !agreedToPlan) {
          // No LLM (or it failed): keep the recommend -> confirm -> execute flow with rule-based replies.
          const talk = deterministicConversation(prompt, lastPlan, gistOf(media), planned.plan.operations.length > 0);
          if (talk) outcome = { ...planned, plan: { ...planned.plan, operations: [], explanation: talk.reply }, conversation: talk };
        }
        if (planned.preserve) {
          const extra = {
            lockedRanges: (planned.preserve.lockedRanges || []).map((r) => [Math.round(r.startSec * 1000), Math.round(r.endSec * 1000)] as [number, number]),
            lockedTracks: (planned.preserve.lockedTracks || []) as any,
          };
          constraints = mergeDirectorConstraints(baseDurationMs, constraints, extra);
        }
        if (planned.plannerReason.startsWith("LLM_TIMEOUT")) {
          warnings.push("the AI planner timed out: this edit was made by the offline rule-based director");
        }
        if (ctx.brand) brandApplied = applyBrandDefaults(planned.plan.operations, prompt, style);

        // Whole edits put new zooms, B-roll, effects and stickers on the music's beat (Phase 6.4).
        if (scope?.mode === "full_edit" && request.musicBeatsMs?.length) {
          const snapped = snapToBeats(outcome.plan.operations as any[], request.musicBeatsMs);
          if (snapped.moved) {
            warnings.push(`placed ${snapped.moved} edit(s) on the music's beat`);
            outcome = { ...outcome, plan: { ...outcome.plan, operations: snapped.ops as any } };
          }
        }
        // Only what this phone can render (Phase 6): newer features are downgraded or refused for older apps.
        {
          const gated = gateRendererFeatures(outcome.plan.operations as any[], request.rendererCapabilities);
          drops.record("renderer_gate", outcome.plan.operations as any[], gated.ops as any[], gated.notes);
          if (gated.notes.length) {
            warnings.push(...gated.notes);
            outcome = { ...outcome, plan: { ...outcome.plan, operations: gated.ops as any } };
          }
        }
        // Replacing music, regenerating captions and overwriting transitions need the request to ask for it.
        if (!agreedToPlan) {
          const guarded = guardDestructiveVariants(outcome.plan.operations as any[], prompt);
          drops.record("destructive_guard", outcome.plan.operations as any[], guarded.ops as any[], guarded.notes);
          if (guarded.notes.length) {
            warnings.push(...guarded.notes);
            outcome = { ...outcome, plan: { ...outcome.plan, operations: guarded.ops as any } };
          }
        }
        // Defence in depth: whatever the planner returned (an offline guess, an over-eager model), only the request's
        // scope reaches the timeline.
        if (scopeTools) {
          const out = outcome.plan.operations.filter((o: any) => !scopeTools!.has(o.type));
          if (out.length) {
            warnings.push(`left out ${[...new Set(out.map((o: any) => o.type))].join(", ")}: not part of what you asked`);
            const kept = outcome.plan.operations.filter((o: any) => scopeTools!.has(o.type));
            drops.record("scope", outcome.plan.operations as any[], kept as any[], `not part of the request's scope (${scope?.mode ?? "unknown"})`);
            // The plan's canvas follows the operations that remain (a dropped reframe must not change the aspect).
            const reframe = [...kept].reverse().find((o: any) => o.type === "reframeSubject" || o.type === "changeAspectRatio") as any;
            outcome = {
              ...outcome,
              plan: { ...outcome.plan, operations: kept, intent: { ...outcome.plan.intent, aspectRatio: reframe?.targetAspect ?? baseIR.meta.targetAspect } },
            };
          }
        }
        }
      }
    }

    if (plannedCount === null) plannedCount = outcome.plan.operations.length;
    // FACE zooms centre on the on-device face track, in the canvas the plan renders at.
    const aspectOp = [...outcome.plan.operations].reverse().find((o: any) => o.type === "reframeSubject" || o.type === "changeAspectRatio") as any;
    const canvas = aspectOp
      ? (aspectOp.width && aspectOp.height ? { width: aspectOp.width, height: aspectOp.height } : EditIRCompiler.resolutionFor(aspectOp.targetAspect))
      : planBase.meta.resolution;
    events.emit("PlanCreated", { plannerSource: outcome.plannerSource, plannerReason: outcome.plannerReason, operations: outcome.plan.operations.map((o: any) => o.type) });
    for (const op of outcome.plan.operations.slice(0, 25)) events.emit("ToolCalled", { tool: op.type });
    const speechCaptions = (ir: EditIR) => ir.tracks.captionTrack.filter((c) => c.role !== "title").length;
    const expandedRaw = agentRun ? { ...outcome.plan, operations: agentRun.compiled } : PlanExpander.expand(outcome.plan, graph, warnings, { canvas, existingCaptions: speechCaptions(planBase) });
    // Tracks outside the request's scope are locked for this turn only (not echoed as the creator's constraints).
    const turnConstraints = scopeLocks.length ? mergeDirectorConstraints(baseDurationMs, constraints, { lockedRanges: [], lockedTracks: scopeLocks as any }) : constraints;
    const expanded = { ...expandedRaw, constraints: { ...expandedRaw.constraints, ...toUserConstraints(turnConstraints, mapLockedRanges(baseIR, planBase, turnConstraints.lockedRanges)) } };
    const violations: string[] = [...agentViolations];
    const dropInvalid = (plan: any, base: EditIR) => {
      const v = CreativePlanValidator.validate(plan, base, []);
      if (v.valid) return plan;
      // Drop only the offending operations, and say so (constraint violations are reported separately).
      const bad = new Set<number>();
      for (const e of v.errors) {
        const m = e.match(/^Operation #(\d+)/);
        if (m) bad.add(parseInt(m[1], 10));
        if (!/ violates constraint: /.test(e)) warnings.push(e);
      }
      violations.push(...v.violations);
      const kept = plan.operations.filter((_: any, i: number) => !bad.has(i));
      drops.record("validator", plan.operations, kept, [...v.errors, ...v.violations]);
      return { ...plan, operations: kept };
    };
    // Per-item locks and the creator's own items (Phase 2.2): refused before anything is compiled.
    const itemCtx = { meta: request.currentEditIR?.itemMeta ?? {}, allowManualSweep: asksForAll(prompt) };
    const withItemLocks = (plan: any) => {
      if (!request.currentEditIR) return plan;
      const r = applyItemLocks(plan.operations, request.currentEditIR, itemCtx);
      drops.record("item_locks", plan.operations, r.ops as any[], r.violations);
      violations.push(...r.violations);
      return { ...plan, operations: r.ops };
    };
    const planToCompile = agentRun ? expanded : dropInvalid(withItemLocks(expanded), planBase);
    events.emit("PlanValidated", { operations: expanded.operations.length, kept: planToCompile.operations.length, violations: violations.length, constraints: { lockedRanges: constraints.lockedRanges, lockedTracks: constraints.lockedTracks } });
    if (fromWords.notes.length) warnings.push(`constraints from your request: ${fromWords.notes.join("; ")}`);

    // Caption translation needs the AI provider, so it runs after compiling (see below), not in the compiler.
    const translateOps = (agentRun ? agentRun.translateOps : planToCompile.operations.filter((o: CreativeOperation) => o.type === "translateCaptions")) as Array<Extract<CreativeOperation, { type: "translateCaptions" }>>;
    const compilePlan = translateOps.length
      ? { ...planToCompile, operations: planToCompile.operations.filter((o: CreativeOperation) => o.type !== "translateCaptions") }
      : planToCompile;
    // Keep every source the client already knows about (manual editor), refreshed by `media`.
    const sources = [
      ...(request.currentEditIR?.sources || []).filter((s) => s.assetId !== media.assetId),
      { assetId: media.assetId, durationMs: media.durationMs, width: media.width, height: media.height },
    ];
    // The agent loop already compiled every turn onto its working timeline.
    const compilation = agentRun
      ? { updatedEditIR: agentRun.ir, appliedOperations: agentRun.applied, rejectedOperations: agentRun.rejected }
      : EditIRCompiler.compile(planBase, compilePlan, [], { sources });
    let finalIR = compilation.updatedEditIR;
    const appliedOperations = [...(storyResult?.applied ?? []), ...compilation.appliedOperations];
    const rejectedOperations = [...compilation.rejectedOperations];
    const allOperations: CreativeOperation[] = [...(storyResult?.ops ?? []), ...outcome.plan.operations];
    events.emit("ToolCompleted", { tool: "compile", applied: compilation.appliedOperations.length, rejected: compilation.rejectedOperations.length });
    const sourceWords = words.map((w) => ({ startSec: w.startMs / 1000, endSec: w.endMs / 1000 }));
    const faceCenter = dominantFaceCenter(media.faces);
    const critiqueOf = (ir: EditIR) => {
      const mobile = toMobileEditIR({ editIR: ir, sources, sourceWords, primaryAssetId: media.assetId, faceCenter, sfxCredits: {}, sourceWordsByAsset, faceCenterByAsset, faceSamplesByAsset, scenesByAsset }).editIR;
      const locked = constraints.lockedRanges.length ? verifyLockedRangesPreserved(baseIR, ir, constraints.lockedRanges) : { ok: true, problems: [] };
      return critiqueDirectorEdit({
        ...(playbook ? { playbookReport: measurePlaybook(ir, playbook) } : {}),
        editIR: mobile, sourceWords: words, sourceWordsByAsset: wordsByAsset, primaryAssetId: media.assetId, loudness: media.loudness,
        lastExportQa: request.lastExportQa, exportedEditIR: request.currentEditIR || null, lockedRangeProblems: locked.problems,
      });
    };

    // Observe -> critique -> bounded repair (max 3 rounds). Only CRITICAL issues with a known fix are repaired.
    // A precise change to existing items is not "repaired" into something else ("stop ducking the music" must not be
    // re-ducked): the critic reports, it does not undo the request.
    const maxRounds = scope?.mode === "modify_existing" ? 0 : Math.max(0, Math.min(3, opts.maxRepairRounds ?? 3));
    events.emit("CriticStarted", { round: 0 });
    let crit = critiqueOf(finalIR);
    events.emit("CriticCompleted", { round: 0, score: crit.score, issues: crit.issues.length, critical: crit.issues.filter((i) => i.severity === "CRITICAL").length });
    // Repairs fix only problems THIS turn introduced: issues already present on the timeline the creator sent
    // (e.g. music they un-ducked by hand) are reported, never silently "fixed".
    const preexisting = new Set(critiqueOf(baseIR).issues.map((i) => i.id));
    const repairableOf = (c: typeof crit) => c.repairable.filter((id) => !preexisting.has(id));
    let repairRounds = 0;
    while (repairRounds < maxRounds && repairableOf(crit).length > 0) {
      const issues = crit.issues.filter((i) => repairableOf(crit).includes(i.id));
      let repairOps: CreativeOperation[] = [];
      let repairSource = "deterministic";
      const canUseLlm = intent === "edit" && outcome.plannerSource === "llm" && opts.llmClient !== null && llmCalls < budget;
      if (canUseLlm) {
        const lockedNow = mapLockedRanges(baseIR, finalIR, constraints.lockedRanges);
        const repair = await CreativePlanner.planWithSource({
          prompt: buildRepairInstruction(plannerPrompt, issues),
          checkCoverage: false,
          timelineContext: ContextResolver.resolveTimelineContext({ editIR: finalIR, userConstraints: toUserConstraints(constraints, lockedNow) }),
          mediaGraph: graphFromMobileMediaList(medias, finalIR),
          companyId: opts.companyId,
          currentEditIR: finalIR,
          llmClient: countedClient(opts.llmClient),
          llmModel: opts.llmModel,
          llmTimeoutMs: opts.llmTimeoutMs,
          contextSections: plannerContextSections.length ? plannerContextSections : undefined,
          itemMeta: request.currentEditIR?.itemMeta,
          hasVision,
        });
        // A deterministic fallback of a repair prompt is not a repair: only real model output is used here.
        if (repair.plannerSource === "llm") {
          repairOps = repair.plan.operations;
          repairSource = "llm";
        }
      }
      if (!repairOps.length) repairOps = deterministicRepairOps(issues);
      // A repair stays inside the request's scope too.
      if (scopeTools) repairOps = repairOps.filter((o) => scopeTools!.has(o.type));
      if (!repairOps.length) break;
      repairRounds++;
      events.emit("RepairCreated", { round: repairRounds, source: repairSource, issues: issues.map((i) => i.id), operations: repairOps.map((o) => o.type) });
      const lockedNow = mapLockedRanges(baseIR, finalIR, constraints.lockedRanges);
      const repairGraph = graphFromMobileMediaList(medias, finalIR);
      const repairPlanRaw = PlanExpander.expand({ ...outcome.plan, operations: repairOps }, repairGraph, warnings, { canvas: finalIR.meta.resolution, existingCaptions: speechCaptions(finalIR) });
      const repairPlan = dropInvalid(withItemLocks({ ...repairPlanRaw, constraints: { ...repairPlanRaw.constraints, ...toUserConstraints(constraints, lockedNow) } }), finalIR);
      const repaired = EditIRCompiler.compile(finalIR, repairPlan, [], { sources });
      // A repair must not take away what the creator asked for (a real run deleted the requested title).
      const lost = requestedFeatures(plannerPrompt, allWordCount > 0).filter((f) => featureCount(finalIR, f) > 0 && featureCount(repaired.updatedEditIR, f) === 0);
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
      const language = CAPTION_TARGET_LANGUAGES[op.targetLanguage];
      const caps = finalIR.tracks.captionTrack.filter((c) => c.role !== "title" && c.text.trim().length > 0);
      const translate = opts.translateCaptionLines ?? (await this.defaultCaptionTranslator(opts));
      if (!language) {
        rejectedOperations.push(`translateCaptions: "${op.targetLanguage}" is not a supported caption language`);
      } else if (caps.length === 0) {
        rejectedOperations.push("translateCaptions: there are no captions to convert");
      } else if (!translate) {
        rejectedOperations.push("translateCaptions: no AI provider is configured, so the captions were not converted");
      } else {
        try {
          const lines = await translate(caps.map((c) => c.text), op.targetLanguage, op.script);
          if (lines.length !== caps.length) throw new Error("translation does not line up with the captions");
          caps.forEach((c, i) => retextCaptionSegment(c, lines[i]));
          appliedOperations.push(`Converted ${caps.length} caption(s) to ${language}${op.script === "roman" ? " in Roman letters" : ""}`);
        } catch (err: any) {
          console.warn("[VideoAIDirector] caption translation failed:", err?.message || err);
          rejectedOperations.push("translateCaptions: the translation failed, so the captions are unchanged");
        }
      }
    }

    // A visual repair never takes away what the creator asked for (a caption fix must not delete the captions).
    if (request.visualCritique && finalIR !== baseIR) {
      const lost = requestedFeatures(prompt, allWordCount > 0).filter((f) => featureCount(baseIR, f) > 0 && featureCount(finalIR, f) === 0);
      if (lost.length) {
        finalIR = baseIR;
        appliedOperations.length = 0;
        warnings.push(`the visual repair would have removed the requested ${lost.join(", ")} and was discarded`);
      }
    }
    const remainingCritical = crit.issues.filter((i) => i.severity === "CRITICAL");
    if (remainingCritical.length) warnings.push(`critic: ${remainingCritical.length} critical issue(s) remain: ${remainingCritical.slice(0, 3).map((i) => i.title).join("; ")}`);
    const critique: DirectorCritique = { score: crit.score, issues: crit.issues, repairRounds };

    // Credits of every stock item placed this turn (by URL): shown on export, required for CC BY / BY-SA.
    const credits: MediaCredit[] = [];
    const addCredit = (kind: MediaCredit["kind"], query: string, m: ResolvedStockMedia) => {
      if (!m.attribution || credits.some((c) => c.url === m.url)) return;
      credits.push({ kind, url: m.url, query, attribution: m.attribution, ...(m.title ? { title: m.title } : {}), ...(m.license ? { license: m.license } : {}), ...(m.sourcePage ? { sourcePage: m.sourcePage } : {}), ...(m.provider ? { provider: m.provider } : {}) });
    };

    // B-roll research: resolve stock queries (the server resolver tries Pexels, then Pixabay) under the turn deadline.
    const picked: Map<string, any> = (agentRun as any)?.brollFound ?? new Map();
    for (const track of finalIR.tracks.videoTracks) {
      if (track.type !== "B_ROLL_OVERLAY") continue;
      for (const clip of track.clips) {
        // A clip the agent picked from search_broll by URL: its credit line comes from that search.
        const hit = picked.get(clip.sourcePath);
        if (hit) {
          addCredit("broll", hit.query, hit);
          if (hit.attribution && hit.creditRequired !== false) warnings.push(`b-roll "${hit.query}": using ${hit.title ? `"${hit.title}"` : hit.url}. Credit required when publishing: ${hit.attribution}.`);
          continue;
        }
        if (!clip.sourcePath.startsWith("stock-query://")) continue;
        const query = decodeURIComponent(clip.sourcePath.slice("stock-query://".length));
        let found: ResolvedStockMedia | null = null;
        if (opts.resolveStockVideo) {
          if (remaining() <= 0) {
            warnings.push(`b-roll "${query}": stock lookup skipped (the ${stockBudgetMs} ms stock budget for this turn is used up)`);
          } else {
            try {
              const r = await withTimeout(opts.resolveStockVideo(query, finalIR.meta.targetAspect), remaining(), `b-roll "${query}" stock lookup`);
              found = typeof r === "string" ? { url: r } : r;
            } catch (err: any) {
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
        } else warnings.push(`b-roll "${query}" needs a stock URL: resolve it on the client via /stock/search`);
      }
    }

    // Resolve music mood queries to real tracks the same way (catalogue by default).
    const resolveMusic = opts.resolveStockMusic || (async (q: string, durSec: number) => resolveMusicFromCatalog(q, durSec));
    const timelineSec = RationalTimeMath.toSeconds(finalIR.meta.totalDuration);
    for (const track of finalIR.tracks.audioTracks) {
      if (track.type !== "BGM") continue;
      for (const clip of track.clips) {
        if (!clip.sourcePath.startsWith("stock-music://")) continue;
        const query = clip.sourceQuery || decodeURIComponent(clip.sourcePath.slice("stock-music://".length)) || "background music";
        clip.sourceQuery = query;
        let found: ResolvedMusicTrack | null = null;
        try {
          // The local catalogue is instant; the budget only bites for injected network resolvers.
          const r = await withTimeout(Promise.resolve(resolveMusic(query, timelineSec)), Math.max(remaining(), 250), `music "${query}" lookup`);
          found = typeof r === "string" ? { url: r } : r;
        } catch (err: any) {
          warnings.push(`music "${query}": music lookup failed (${err?.message || err})`);
        }
        if (found && /^https:\/\//i.test(found.url)) {
          clip.sourcePath = found.url;
          addCredit("music", query, found);
          const credit = found.attribution ? ` Credit required when publishing: ${found.attribution}.` : found.license ? ` Licence: ${found.license}.` : "";
          warnings.push(`music "${query}": using ${found.title ? `"${found.title}"` : found.url}.${credit}`);
        } else {
          warnings.push(`music "${query}" needs a track URL: no royalty-free track matched this mood; resolve it on the client via /stock/music`);
        }
      }
    }

    // SFX lane: the sound agent's effects placed at the proposal's transitions (greet turn only).
    // Credits of effects the client already has are carried by clip id.
    const sfxCredits: Record<string, string> = {};
    for (const fx of request.currentEditIR?.audio?.sfx || []) if (fx.credit) sfxCredits[fx.id] = fx.credit;
    if (sfx.length) {
      const placed = placeSfxOnTimeline(finalIR, sfx);
      Object.assign(sfxCredits, placed.credits);
      for (const fx of placed.used) {
        if (fx.attribution) addCredit("sfx", fx.query, { url: fx.url, attribution: fx.attribution, ...(fx.title ? { title: fx.title } : {}), ...(fx.license ? { license: fx.license } : {}) });
      }
      if (placed.placed && proposal) proposal.steps.push(`add ${placed.placed} sound effect${placed.placed === 1 ? "" : "s"} on the transitions`);
    }

    // Items the creator already had are never trimmed or dropped by the projection (audit F-05).
    const preexistingIds = new Set<string>();
    if (request.currentEditIR) {
      const c = request.currentEditIR;
      for (const x of [...c.overlays, ...c.captions, ...c.zooms, ...(c.effects ?? []), ...c.audio.music, ...(c.audio.sfx ?? []), ...(c.audio.voiceovers ?? [])]) preexistingIds.add(x.id);
    }
    // Freeze frames are stills the phone captures: each needs a source entry (the size of the footage it holds).
    for (const c of finalIR.tracks.videoTracks.find((t) => t.type === "MAIN_VIDEO")?.clips ?? []) {
      if (!c.assetId.startsWith(FREEZE_ASSET_PREFIX) || sources.some((s) => s.assetId === c.assetId)) continue;
      const of = sources.find((s) => s.assetId === c.assetId.slice(FREEZE_ASSET_PREFIX.length).replace(/@\d+$/, ""));
      sources.push({ assetId: c.assetId, durationMs: STILL_SOURCE_MS, width: of?.width ?? media.width, height: of?.height ?? media.height });
    }
    const projected = toMobileEditIR({ editIR: finalIR, sources, sourceWords, primaryAssetId: media.assetId, faceCenter, sfxCredits, preexistingIds, sourceWordsByAsset, faceCenterByAsset, faceSamplesByAsset, scenesByAsset });
    warnings.push(...projected.warnings);

    // Brand font on captions created this turn (the client's own font choices and a caption template's font are kept).
    const oldCaptionIds = new Set((request.currentEditIR?.captions || []).map((c) => c.id));
    const templatedIds = new Set(finalIR.tracks.captionTrack.filter((c) => c.style.presetLabel).map((c) => c.id));
    if (ctx.brand) {
      for (const cap of projected.editIR.captions) {
        // Text in a script the brand font does not cover keeps a font that can draw it.
        if (!oldCaptionIds.has(cap.id) && !templatedIds.has(cap.id)) cap.style.fontFamily = captionFontFor(cap.text, style.fontFamily);
      }
    }

    // Watermark: keep the client's, add/remove on request, never invent one without a brand logo.
    let watermark: MobileWatermark | undefined = request.currentEditIR?.watermark;
    const wantWm = intent === "greet" ? outcome.brandWatermark || "keep" : watermarkIntent(prompt, outcome.brandWatermark);
    if (wantWm === "add") {
      const wm = brandWatermark(ctx.brand);
      if (wm) {
        watermark = watermark ? { ...watermark, imageUrl: wm.imageUrl } : wm;
        if (intent === "edit") brandApplied.push("brand logo watermark");
      } else if (intent === "edit") {
        warnings.push("watermark: this project has no brand logo (HTTPS image) to use");
      }
    } else if (wantWm === "remove") {
      watermark = undefined;
    }
    // What this turn did not touch comes back exactly as the phone sent it (compared on a fresh, unedited canonical copy).
    let editIR: MobileEditIR = request.currentEditIR
      ? preserveUntouched(request.currentEditIR, editIRFromMobile({ ...request.currentEditIR, projectId }), finalIR, projected.editIR)
      : { ...projected.editIR };
    if (request.currentEditIR) {
      // Backstop: a locked item a sweep still changed comes back as the creator's version.
      const locked = enforceItemLocks(request.currentEditIR, editIR);
      editIR = locked.editIR;
      if (locked.restored.length) violations.push(`kept ${locked.restored.length} locked item(s) exactly as you left them`);
    }
    delete (editIR as any).watermark;
    if (watermark) editIR.watermark = watermark;

    // The chat reply: short, friendly, no jargon. Technical detail stays in appliedOperations / warnings.
    let summary: string;
    let phase: DirectorPhase;
    let quickReplies: string[] = [];
    let proposedPlan: string[] = [];
    const talk = outcome.conversation;
    const plannedOps = planToCompile.operations.length ? (outcome.plan.operations as CreativeOperation[]) : [];
    if (intent === "greet" && proposal) {
      // Plain-language steps for the plan card (no hex codes); the full wording stays in the details.
      const steps = proposal.steps.slice(0, 8).map((st) => tidyReply(st.charAt(0).toUpperCase() + st.slice(1)).replace(/\s*#[0-9a-f]{6}\b/gi, ""));
      proposedPlan = steps;
      phase = steps.length ? "confirm" : "chat";
      const detail = greetingReply(proposal, editIR.durationMs / 1000);
      const who = ctx.piece?.headline ? `"${tidyReply(ctx.piece.headline).slice(0, 60)}"` : "this one";
      summary = steps.length
        ? `Hey! I had a look at ${who}. Here's what I'd do. Want me to go ahead?`
        : `Hey! I had a look at ${who}. What would you like to change?`;
      quickReplies = steps.length ? [] : ["Cut the pauses", "Add captions", "Make it punchy"];
      // The full proposal (brand colours, script notes) stays available as details.
      warnings.unshift(detail);
    } else if (appliedOperations.length > 0) {
      phase = "done";
      summary = outcome.plannerSource === "llm" ? tidyReply(talk?.reply || outcome.plan.explanation || "") || doneReply(plannedOps) : doneReply(plannedOps);
      const t = finalIR.tracks;
      quickReplies = talk?.quickReplies.length
        ? talk.quickReplies
        : followUpChips({
            captions: t.captionTrack.filter((c) => c.role !== "title").length,
            titles: t.captionTrack.filter((c) => c.role === "title").length,
            music: t.audioTracks.some((a) => a.type === "BGM" && a.clips.length > 0),
            zooms: t.cameraTrack.length,
          });
      if (brandApplied.length) warnings.push(`brand: ${brandApplied.join(", ")}`);
    } else if (talk) {
      summary = talk.reply;
      phase = talk.phase === "done" ? "chat" : talk.phase;
      quickReplies = talk.quickReplies;
      proposedPlan = talk.proposedPlan;
    } else if (plannedOps.length > 0 || rejectedOperations.length > 0) {
      phase = "gather";
      summary = "I tried, but couldn't make that change work on this video. Want to try it a different way?";
      quickReplies = ["Show me options", "Never mind"];
    } else {
      const fallback = didNotUnderstandReply(allWordCount > 0);
      phase = fallback.phase;
      summary = outcome.plannerSource === "llm" ? tidyReply(outcome.plan.explanation || "") || fallback.reply : fallback.reply;
      quickReplies = fallback.quickReplies;
    }
    if (request.visualCritique) summary = visualRepairReply(request.visualCritique, appliedOperations.length > 0, summary);
    if (appliedOperations.length > 0 && rejectedOperations.length > 0) {
      summary += rejectedOperations.length === 1 ? " One part didn't work out, it's in the details." : ` ${rejectedOperations.length} parts didn't work out, they're in the details.`;
    }
    if (violations.length > 0) {
      summary += " I left alone the parts you asked me to keep.";
    }
    if (outcome.plannerSource === "deterministic" && intent === "edit" && !outcome.plannerReason.startsWith("LLM_TIMEOUT")) {
      warnings.push(`planned by the offline rule-based director: ${outcome.plannerReason}`);
    }

    const autonomy: AutonomyPolicy = normalizeAutonomy(opts.autonomy || ctx.brand?.autonomy);
    const decision = decideAutoApply({
      editing: autonomy.editing,
      operationTypes: outcome.plan.operations.map((o: any) => o.type),
      operations: outcome.plan.operations as any,
      plannerSource: outcome.plannerSource,
      confirmedByCreator: agreedToPlan,
      // The creator already said yes to this plan in the chat: that is the confirmation.
      plannerRequiresConfirmation: outcome.plannerSource === "llm" && !agreedToPlan ? !!outcome.plan.requiresConfirmation : false,
      violations: violations.length,
      isGreeting: intent === "greet",
    });

    drops.recordRejected(rejectedOperations);
    const styleReport = playbook && intent === "edit" && appliedOperations.length > 0 ? measurePlaybook(finalIR, playbook) : null;
    const agentRunInfo = agentRun ? { turns: agentRun.turns, stages: agentRun.stagesDone, stopped: agentRun.stopped, coverageRetry: agentRun.coverageRetry, feedback: agentRun.feedback } : null;
    const fallback = classifyPlannerFallback(outcome.plannerSource, outcome.plannerReason, intent);
    const parsedLabel = providerModelFromReason(outcome.plannerReason);
    const turnLog: DirectorTurnLog = {
      runId: events.runId,
      intent,
      scopeMode: scope?.mode ?? null,
      provider: (outcome as any).provider ?? parsedLabel.provider,
      model: (outcome as any).model ?? parsedLabel.model,
      plannerSource: outcome.plannerSource,
      plannerReason: outcome.plannerReason,
      fallback,
      llmCalls,
      ops: { planned: plannedCount ?? 0, afterFilters: planToCompile.operations.length, applied: appliedOperations.length, rejected: rejectedOperations.length, dropped: drops.total },
      drops: drops.drops,
      repairRounds,
      criticScore: typeof crit.score === "number" ? crit.score : null,
      latencyMs: Date.now() - startedAt,
      vision: hasVision,
      agent: agentRunInfo,
      style: styleReport ? { playbookId: styleReport.playbookId, version: styleReport.version, met: styleReport.met, total: styleReport.total } : null,
      story: storyResult
        ? { applied: true, removedLines: storyResult.outcome.plan.remove.length, removedSec: storyResult.outcome.removedSec, hookLineId: storyResult.outcome.plan.hookLineId, hookMoved: storyResult.hookMoved }
        : storyNote ? { applied: false, reason: storyNote } : null,
    };

    return {
      intent,
      plannerSource: outcome.plannerSource,
      plannerReason: outcome.plannerReason,
      ...(fallback ? { plannerFallback: fallback } : {}),
      turnLog,
      summary,
      reply: summary,
      phase,
      quickReplies,
      proposedPlan,
      operations: allOperations,
      appliedOperations,
      rejectedOperations: rejectedOperations,
      warnings: Array.from(new Set(warnings)),
      requiresConfirmation: decision.requiresConfirmation,
      autoApplied: decision.autoApplied,
      critique,
      runId: events.runId,
      ...(violations.length ? { violations } : {}),
      ...(hasConstraints(constraints) ? { constraints: { lockedRanges: constraints.lockedRanges, lockedTracks: constraints.lockedTracks } } : {}),
      editIR,
      ast: finalIR,
      llmCalls,
      ...(proposal ? { proposal: { steps: proposal.steps } } : {}),
      ...(alignment ? { scriptAlignment: alignment } : {}),
      ...(sfx.length ? { sfxSuggestions: sfx } : {}),
      ...(credits.length ? { credits } : {}),
      ...(ctx.brand || ctx.piece ? { context: summarizeContext(ctx, style) } : {}),
      ...(request.baseRevision !== undefined ? { baseRevision: request.baseRevision } : {}),
      ...(scope ? { scope: { mode: scope.mode, targets: scope.targets, source: scope.source, ...(scope.note ? { note: scope.note } : {}) } } : {}),
      diffSummary: summarizeTimelineDiff(
        request.currentEditIR ?? toMobileEditIR({ editIR: baseIR, sources, sourceWords, primaryAssetId: media.assetId, faceCenter, sfxCredits, sourceWordsByAsset, faceCenterByAsset, faceSamplesByAsset, scenesByAsset }).editIR,
        editIR
      ),
      // Phase 5: where the phone should look at this result (only when it changed something).
      ...(intent === "edit" && appliedOperations.length > 0 ? { checkpoints: critiqueCheckpoints(editIR) } : {}),
      visualRound: request.visualCritique?.round ?? 0,
      ...(styleReport ? { style: { ...styleReport, label: playbook!.label, reason: playbookReason } } : {}),
    };
  }

  /**
   * Conversational AI Director Copilot: modifies existing EditIR based on natural language instructions.
   */
  async patchAST(
    entityId: string,
    instruction: string,
    params: BuilderGenerationParams
  ): Promise<BuilderResult<EditIR>> {
    return this.compileAST({
      ...params,
      prompt: instruction,
    });
  }

  async deleteEntity(entityId: string, _companyId: string): Promise<{ success: boolean; message: string }> {
    return { success: true, message: `Video project ${entityId} deleted.` };
  }

  /**
   * Deterministic local synthesis guaranteeing 100% testability and reliability.
   */
  public synthesizeDeterministicEditIR(
    telemetry: MediaTelemetryManifest,
    stylePreset: DirectorStylePreset = "MRBEAST_FAST"
  ): EditIR {
    const totalDurationSec = RationalTimeMath.toSeconds(telemetry.duration);
    const projectId = crypto.randomUUID();
    const style = DirectorStyleResolver.resolve(stylePreset);

    // 1. Camera Zoom Events
    const cameraTrack: CameraEvent[] = [];
    if (totalDurationSec >= 3.0) {
      cameraTrack.push({
        id: crypto.randomUUID(),
        timeRange: {
          start: RationalTimeMath.fromSeconds(1.5),
          duration: RationalTimeMath.fromSeconds(Math.min(2.5, totalDurationSec - 1.5)),
        },
        targetType: "FACE",
        targetCoords: { x: 0.5, y: 0.38 },
        scale: style.zoomScale,
        spring: { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
        motionBlur: true,
      });
    }

    // 2. Kinetic Captions
    const captionTrack: CaptionSegment[] = [];
    if (telemetry.transcript && telemetry.transcript.length > 0) {
      captionTrack.push({
        id: crypto.randomUUID(),
        timeRange: {
          start: RationalTimeMath.fromSeconds(0.5),
          duration: RationalTimeMath.fromSeconds(Math.min(4.0, totalDurationSec)),
        },
        text: "Turn ideas into production videos",
        words: [
          { word: "Turn", start: RationalTimeMath.fromSeconds(0.5), end: RationalTimeMath.fromSeconds(0.9), highlight: false, scaleMultiplier: 1.0 },
          { word: "Ideas", start: RationalTimeMath.fromSeconds(0.9), end: RationalTimeMath.fromSeconds(1.4), highlight: true, color: style.captionColors.highlight, scaleMultiplier: 1.15 },
          { word: "Instantly", start: RationalTimeMath.fromSeconds(1.4), end: RationalTimeMath.fromSeconds(2.2), highlight: true, color: style.captionColors.highlight, scaleMultiplier: 1.2 },
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
    const mainClip: VideoClip = {
      id: crypto.randomUUID(),
      assetId: telemetry.mediaId,
      sourcePath: telemetry.sourcePath,
      sourceRange: {
        start: RationalTimeMath.fromSeconds(0),
        duration: telemetry.duration,
      },
      timelineRange: {
        start: RationalTimeMath.fromSeconds(0),
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
            id: crypto.randomUUID(),
            type: "MAIN_VIDEO",
            zIndex: 0,
            clips: [mainClip],
          },
        ],
        cameraTrack,
        captionTrack,
        audioTracks: [
          {
            id: crypto.randomUUID(),
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

export interface ResolvedStockMedia {
  /** HTTPS media URL. */
  url: string;
  title?: string;
  license?: string;
  /** Credit line (kept for every free/stock item, even when the licence does not require it). */
  attribution?: string;
  /** false for licences without a credit requirement (CC0, PD, Pexels, Pixabay). */
  creditRequired?: boolean;
  sourcePage?: string;
  provider?: string;
}

/** A stock item placed on the timeline this turn, with the credit line to publish with the post. */
export interface MediaCredit {
  kind: "broll" | "music" | "sfx";
  url: string;
  query: string;
  attribution: string;
  title?: string;
  license?: string;
  sourcePage?: string;
  provider?: string;
}

export interface ResolvedMusicTrack {
  /** HTTPS audio URL. */
  url: string;
  title?: string;
  license?: string;
  /** Credit line the licence requires (e.g. CC BY). */
  attribution?: string;
  durationSec?: number;
}

export interface MobileDirectResult {
  /** "greet" for the opening turn (a proposal with requiresConfirmation:true), else "edit". */
  intent: "edit" | "greet";
  plannerSource: PlannerSource;
  plannerReason: string;
  /**
   * Set when an edit turn was planned by the offline rules because the model could not be used (no key, error,
   * timeout, invalid output). The phone shows it as a banner. Absent for LLM turns and for deterministic-by-design
   * turns (the opening proposal, an offline clarifying question).
   */
  plannerFallback?: { code: DirectorFallbackCode; reason: string };
  /** Structured record of this turn (provider, model, ops planned / applied / dropped by filter, latency). */
  turnLog: DirectorTurnLog;
  summary: string;
  /** The chat message: short and friendly (1-4 sentences). */
  reply: string;
  /** Where the conversation is: recommend -> gather -> confirm -> done (edits applied) | chat. */
  phase: DirectorPhase;
  /** 0-3 one-tap answers for the creator. */
  quickReplies: string[];
  /** confirm / recommend: the steps the director will do once the creator agrees (nothing applied yet). */
  proposedPlan: string[];
  operations: CreativeOperation[];
  appliedOperations: string[];
  rejectedOperations: string[];
  warnings: string[];
  requiresConfirmation: boolean;
  editIR: MobileEditIR;
  ast: EditIR;
  /** LLM calls made in this turn (never more than llmCallBudget, default 3). */
  llmCalls: number;
  /** Greeting turn: the proposal steps, in order. */
  proposal?: { steps: string[] };
  /** Transcript vs calendar script (when the piece has a script and a transcript was sent). */
  scriptAlignment?: ScriptAlignment;
  /** Informational SFX previews (not placed on the timeline in mobile-editir/1). */
  sfxSuggestions?: SfxSuggestion[];
  /** Credit lines of the stock B-roll and music placed this turn (by URL). */
  credits?: MediaCredit[];
  /** What the director knew about the brand and the piece. */
  context?: DirectorContextSummary;
  /** True only when the project's editing autonomy is AUTO and every operation is in SAFE_OPS. */
  autoApplied: boolean;
  /** Critic result after the bounded repair loop (remaining issues are reported, never hidden). */
  critique: DirectorCritique;
  /** Id of this run in the agent event log (GET /social-media/projects/:id/agent-runs/:runId). */
  runId: string;
  /** Operations dropped because they would break the creator's constraints. */
  violations?: string[];
  /** The constraints that were enforced this turn (ms on the timeline before this turn). */
  constraints?: { lockedRanges: Array<[number, number]>; lockedTracks: string[] };
  /** The request's `baseRevision`, echoed: the phone merges a response computed on an older timeline. */
  baseRevision?: number;
  /** Phase 5: stills to take of the applied timeline for the visual check (absent when nothing changed). */
  checkpoints?: VisualCheckpoint[];
  /** 0 = a normal turn; 1 / 2 = this turn repaired what the visual check found. */
  visualRound: number;
  /** Phase 6: the style playbook of a whole edit and how the result measures against it. */
  style?: PlaybookReport & { label: string; reason: string };
  /** What the request was understood to be about (Phase 3): mode, targets, and whether an LLM or the rules decided. */
  scope?: { mode: string; targets: Array<{ kind: string; ids?: string[]; timeSec?: number }>; source: "llm" | "offline"; note?: string };
  /** What this turn changes, in plain words, for the proposal card (Phase 3.3). */
  diffSummary: TimelineDiffSummary;
}

export interface MobileDirectOptions {
  /** Agent event emitter (the server passes a project-scoped one); default: in-memory only. */
  events?: AgentRunEmitter;
  /** Compact per-project memory lines (preferences, feedback, performance) for the planner prompt. */
  memoryContext?: string[];
  /** Project autonomy policy; defaults to `context.brand.autonomy`, then ASSISTED/MANUAL. */
  autonomy?: Partial<AutonomyPolicy>;
  /** Critic repair rounds (0..3, default 3). */
  maxRepairRounds?: number;
  /**
   * Stock B-roll search for the agent loop's search_broll tool (top results with thumbnails). Without it the tool
   * falls back to resolveStockVideo (one result, no thumbnail).
   */
  searchBroll?: (query: string, aspect: string) => Promise<Array<{ url: string; title?: string; thumbnailUrl?: string; license?: string; provider?: string; durationSec?: number; attribution?: string; creditRequired?: boolean; sourcePage?: string }>>;
  /** Fetches a thumbnail for the model (tests inject it). Default: HTTPS only, JPEG/PNG/WebP, at most 300 KB, 3 s. */
  fetchImage?: (url: string) => Promise<{ mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string } | null>;
}

/** A stock thumbnail for the model: HTTPS only, an image type the providers accept, small, quick. */
async function defaultFetchImage(url: string): Promise<{ mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string } | null> {
  if (!/^https:\/\//i.test(url)) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3000);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: "follow" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (type !== "image/jpeg" && type !== "image/png" && type !== "image/webp") return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 300 * 1024) return null;
    return { mediaType: type, data: buf.toString("base64") };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Repair prompt: the creator's request plus the critic's structured issues. */
function buildRepairInstruction(prompt: string, issues: DirectorCritiqueIssue[]): string {
  return [
    `The automatic critic checked the edit you just made for this request: ${JSON.stringify(prompt).slice(0, 600)}`,
    `It found these problems (JSON). Fix ONLY these with the fewest operations. Times are seconds on the CURRENT timeline described above, which already includes your edit. Do not undo what the creator asked for.`,
    JSON.stringify(issues.map((i) => ({ id: i.id, severity: i.severity, category: i.category, problem: i.title, ...(i.timeRangeMs ? { atSec: [i.timeRangeMs[0] / 1000, i.timeRangeMs[1] / 1000] } : {}) }))),
  ].join("\n");
}

/** Known deterministic fixes for critic issues (used without an LLM). */
function deterministicRepairOps(issues: DirectorCritiqueIssue[]): CreativeOperation[] {
  const ops: CreativeOperation[] = [];
  if (issues.some((i) => i.id.startsWith("music_over_speech:"))) ops.push({ type: "duckAudio", duckDb: -18, attackMs: 120, releaseMs: 350 } as CreativeOperation);
  return ops;
}

/**
 * Web/desktop path: the desktop app sends its on-device scene cuts and loudness as `telemetry.scenesMs` /
 * `telemetry.loudness` (a top-level `media` key would select the mobile director). Validated loosely here and added
 * to the planner prompt the same way as the mobile path.
 */
function webContextSections(sections: unknown, telemetry: any): string[] | undefined {
  const base = Array.isArray(sections) ? sections.filter((x) => typeof x === "string") : [];
  const ms = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 4 * 3600 * 1000;
  const scenesMs = Array.isArray(telemetry?.scenesMs) ? telemetry.scenesMs.filter(ms).slice(0, 2000) : undefined;
  const l = telemetry?.loudness;
  const num = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  const loudness = l && num(l.integratedLufs, -100, 10)
    ? { integratedLufs: l.integratedLufs, ...(num(l.truePeakDb, -100, 20) ? { truePeakDb: l.truePeakDb } : {}), ...(num(l.clippingPct, 0, 100) ? { clippingPct: l.clippingPct } : {}) }
    : undefined;
  const ocr = Array.isArray(telemetry?.ocr)
    ? telemetry.ocr.filter((o: any) => o && ms(o.startMs) && ms(o.endMs) && typeof o.text === "string").slice(0, 200).map((o: any) => ({ startMs: o.startMs, endMs: o.endMs, text: o.text.slice(0, 500) }))
    : undefined;
  const extra = mediaContextSections({ scenesMs, loudness, ocr } as any);
  const out = [...base, ...extra];
  return out.length ? out : undefined;
}

/** Scene cuts and on-screen text (OCR, fenced as untrusted data) for the planner prompt. */
/** Start times of new zooms, B-roll, effects and stickers moved onto the nearest music beat within 150 ms. */
export function snapToBeats<T extends { type: string; [k: string]: any }>(ops: T[], beatsMs: number[], toleranceMs = 150): { ops: T[]; moved: number } {
  const beats = [...beatsMs].sort((a, b) => a - b);
  const nearest = (ms: number) => {
    let lo = 0;
    let hi = beats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid] < ms) lo = mid + 1;
      else hi = mid;
    }
    const cands = [beats[lo], beats[lo - 1]].filter((b) => b !== undefined) as number[];
    return cands.reduce((best, b) => (Math.abs(b - ms) < Math.abs(best - ms) ? b : best), cands[0]);
  };
  const KEY: Record<string, string> = { addZoom: "startSec", addEffect: "startSec", insertBroll: "timelineStartSec", addSticker: "timelineStartSec" };
  let moved = 0;
  const out = ops.map((op) => {
    const key = KEY[op.type];
    if (!key || typeof op[key] !== "number" || !beats.length) return op;
    const ms = op[key] * 1000;
    const b = nearest(ms);
    if (b === undefined || Math.abs(b - ms) > toleranceMs || Math.abs(b - ms) < 1) return op;
    moved++;
    return { ...op, [key]: Math.round(b) / 1000 };
  });
  return { ops: out, moved };
}

const VISUAL_FIX_WORDS: Record<string, string> = {
  weak_hook: "a stronger opening",
  caption_over_face: "captions off your face",
  caption_unreadable: "easier-to-read captions",
  caption_in_ui_zone: "captions out of the app's buttons",
  zoom_crops_head: "a zoom that cut off your head",
  subject_out_of_frame: "framing",
  broll_irrelevant: "B-roll that didn't fit",
  broll_jarring: "jarring B-roll",
  jump_cut: "a jumpy cut",
  color_inconsistent: "colour",
  pacing: "pacing",
  title_unreadable: "a hard-to-read title",
  other: "a few details",
};

/** The creator-facing reply of a visual repair turn: the score and what was fixed, in plain words. */
function visualRepairReply(r: VisualRepairRequest, changed: boolean, modelReply: string): string {
  const fixed = [...new Set(r.critique.issues.filter(isRepairable).map((i) => VISUAL_FIX_WORDS[i.kind] ?? "a few details"))];
  const score = `${r.critique.score.toFixed(1).replace(/\.0$/, "")}/10`;
  if (!changed) return `I checked the result (${score}). ${fixed.length ? "I couldn't fix everything I spotted, it's in the details." : "Looks good to me."}`;
  const list = fixed.length > 1 ? `${fixed.slice(0, -1).join(", ")} and ${fixed[fixed.length - 1]}` : fixed[0] ?? "a few details";
  return `I checked how it looks (${score}) and fixed ${list}.${modelReply && !/^I (checked|fixed)/i.test(modelReply) ? ` ${modelReply}` : ""}`.trim();
}

/** What the story pass did, for the enhancement planner (it edits the cut timeline that follows). */
function storyContextSection(o: StoryOutcome, hookMoved: boolean): string[] {
  const byId = new Map(o.lines.map((l) => [l.id, l]));
  const quote = (id: string) => sanitizeInlineUntrusted(byId.get(id)?.text ?? "", 90);
  const removed = o.plan.remove.filter((r) => byId.has(r.lineId) && r.lineId !== o.plan.hookLineId);
  const roles = new Map<string, string[]>();
  for (const r of o.plan.roles) if (byId.has(r.lineId)) roles.set(r.role, [...(roles.get(r.role) ?? []), quote(r.lineId).split(" ").slice(0, 6).join(" ")]);
  const lines = [
    hookMoved ? `- the video now opens on the hook (moved to the start): "${quote(o.plan.hookLineId)}"` : byId.has(o.plan.hookLineId) ? `- hook (keep it strong in the first 1.5 s): "${quote(o.plan.hookLineId)}"` : `- hook: the first line kept`,
    removed.length ? `- cut ${removed.length} line(s), ${o.removedSec.toFixed(1)} s: ${removed.slice(0, 12).map((r) => `${r.reason} "${quote(r.lineId)}"`).join("; ")}` : `- nothing was cut: every line carries the story`,
    ...(roles.size ? [`- story beats kept: ${[...roles].map(([role, xs]) => `${role}: ${xs.slice(0, 3).map((x) => `"${x}…"`).join(", ")}`).join(" | ")}`] : []),
    ...(o.plan.targetDurationSec ? [`- target length: about ${Math.round(o.plan.targetDurationSec)} s`] : []),
  ];
  return [
    `## Story edit already made this turn (by the story editor)`,
    fenceUntrusted("transcript", lines.join("\n"), { maxChars: 4000 }).block,
    `The timeline and transcript you see are ALREADY cut to this story. Do not cut more speech (no removeRange on spoken lines, no reorder) unless the creator asked for it; removeSilences and cleanFillers are still right. Put captions, zooms, B-roll, music and effects on this cut timeline, and land a pattern interrupt on the hook.`,
    ``,
  ];
}

function mediaContextSections(media: MobileAIDirectRequest["media"], label?: string): string[] {
  const out: string[] = [];
  // Several sources: each one's analysis is in its own SOURCE seconds.
  if (label) out.push(`### Clip source ${label} (SOURCE s of this file; map through the clips that use it)`);
  if (media.scenesMs?.length) out.push(`Scene cuts in the source (SOURCE s): ${media.scenesMs.slice(0, 100).map((t) => (t / 1000).toFixed(2)).join(", ")}`);
  if (media.ocr?.length) {
    out.push(`On-screen text detected in the source (SOURCE s):`);
    out.push(fenceUntrusted("ocr", media.ocr.slice(0, 60).map((o) => `${(o.startMs / 1000).toFixed(1)}-${(o.endMs / 1000).toFixed(1)}: ${o.text}`).join(" | "), { maxChars: 4000 }).block);
  }
  if (media.shotLog?.shots.length) {
    // What a vision model saw replaces the on-device label words (it covers them and much more).
    out.push(...shotLogPromptLines(media.shotLog));
  } else if (media.labels?.length) {
    // ML Kit's label vocabulary is plain words; anything else is dropped so client data cannot carry instructions.
    const clean = (l: string) => (/^[a-z][a-z &'-]{0,38}$/i.test(l) ? l.toLowerCase() : null);
    const spans = media.labels
      .slice(0, 80)
      .map((s) => ({ s, words: s.labels.map(clean).filter((w): w is string => !!w) }))
      .filter((x) => x.words.length > 0);
    if (spans.length) {
      out.push(`What the picture shows (on-device scene labels, SOURCE s; use them to pick B-roll, emoji stickers and titles that match the footage):`);
      out.push(spans.map(({ s, words }) => `${(s.startMs / 1000).toFixed(1)}-${(s.endMs / 1000).toFixed(1)}: ${words.join(", ")}`).join(" | "));
    }
  }
  if (media.loudness) out.push(`Source loudness: ${media.loudness.integratedLufs} LUFS${media.loudness.clippingPct != null ? `, ${media.loudness.clippingPct}% clipped samples` : ""}`);
  if (label && out.length === 1) return [];
  if (out.length) out.push(``);
  return out;
}

export interface DirectorContextSummary {
  brand?: { projectId: string; name?: string; highlightColor: string; textColor: string; captionPreset: string; font: string; hasLogo: boolean; pacing: string };
  piece?: { calendarPieceId?: string; postId?: string; headline?: string; platform?: string; targetDurationSec?: number; hasScript: boolean };
}

function summarizeContext(ctx: DirectorContext, style: ReturnType<typeof styleAgent>): DirectorContextSummary {
  return {
    ...(ctx.brand ? { brand: { projectId: ctx.brand.projectId, name: ctx.brand.name, highlightColor: style.highlightColor, textColor: style.textColor, captionPreset: style.captionPreset, font: style.fontFamily, hasLogo: !!ctx.brand.logoUrl, pacing: style.pacing } } : {}),
    ...(ctx.piece ? { piece: { calendarPieceId: ctx.piece.calendarPieceId, postId: ctx.piece.postId, headline: ctx.piece.headline, platform: ctx.piece.platform, targetDurationSec: ctx.piece.targetDurationSec, hasScript: ctx.piece.sections.length > 0 } } : {}),
  };
}

function normalizeHistory(history: BuilderGenerationParams["history"]) {
  if (!Array.isArray(history)) return undefined;
  return history
    .map((h) => ({
      role: (h.role === "assistant" || h.sender === "assistant" || h.sender === "ai" ? "assistant" : "user") as "user" | "assistant",
      content: String(h.content ?? h.text ?? ""),
    }))
    .filter((h) => h.content.trim().length > 0);
}

export const videoAIDirectorService = VideoAIDirectorService.getInstance();

/** How many items of a requested feature (label from requestedFeatures) the timeline has; -1 = not countable. */
function featureCount(ir: EditIR, feature: string): number {
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
      return overlays.filter((c: any) => c.mediaType !== "image").length;
    case "sticker":
      return overlays.filter((c: any) => c.mediaType === "image").length;
    case "background music":
      return t.audioTracks.filter((a) => a.type === "BGM").flatMap((a) => a.clips).length;
    default:
      return -1;
  }
}

/** What the director "sees" for rule-based replies. */
function gistOf(media: MobileAIDirectRequest["media"]): MediaGist {
  const clean = (l: string) => (/^[a-z][a-z &'-]{0,38}$/i.test(l) ? l.toLowerCase() : null);
  const counts = new Map<string, number>();
  for (const span of media.labels || []) for (const l of span.labels) {
    const c = clean(l);
    if (c) counts.set(c, (counts.get(c) || 0) + 1);
  }
  return {
    durationMs: media.durationMs,
    width: media.width,
    height: media.height,
    words: media.transcript?.words?.length || 0,
    silences: media.silences?.length || 0,
    faces: media.faces?.length || 0,
    labels: Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).map(([l]) => l).filter((l) => !/^(person|people|human)$/.test(l)),
  };
}

/**
 * Rule-based conversation when there is no LLM: open requests get a recommendation (with a plan to say yes to),
 * "calmer" swaps the plan, a bare "thanks / looks good" is answered, and a request with no edit is asked again.
 * Null = let the rule-based edit through.
 */
function deterministicConversation(prompt: string, lastPlan: string[], gist: MediaGist, hasOps: boolean): DirectorConversation | null {
  if (isOpenEnded(prompt)) return deterministicRecommendation(gist);
  if (lastPlan.length && prompt.length <= 60 && /\b(calm|calmer|chill|subtle|simple|clean|slower|softer|less)\b/i.test(prompt)) return deterministicCalmPlan(gist);
  if (isAffirmative(prompt) || /^(thanks|thank you|thx|ty|nice|cool|love it|looks great|great job)\b/i.test(prompt.trim())) {
    return { reply: "Glad you like it! Anything else you'd like to tweak?", phase: "chat", quickReplies: ["Add music", "Bigger captions", "All good"], proposedPlan: [] };
  }
  if (!hasOps) return didNotUnderstandReply(gist.words > 0);
  return null;
}
