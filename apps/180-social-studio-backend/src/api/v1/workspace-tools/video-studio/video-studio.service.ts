import { EditIR, RationalTimeMath, MobileAIDirectRequest, DirectorContext } from "@workspace/video-contracts";
import { videoAIDirectorService } from "@workspace/ai";
import { prisma } from "@workspace/db";
import * as crypto from "crypto";

export interface VideoStudioProjectRecord {
  id: string;
  companyId: string;
  name: string;
  templatePreset?: string;
  aspectRatio: string;
  durationSeconds: number;
  editIR: EditIR;
  metadata?: any;
  createdAt: string;
  updatedAt: string;
}

// In-memory / tenant-scoped fallback cache
const projectStore: Map<string, VideoStudioProjectRecord> = new Map();

export class VideoStudioService {
  /**
   * Lists all video projects for the authenticated company tenant.
   * Queries PostgreSQL via Prisma with transparent fallback to in-memory store.
   */
  static async listProjects(companyId: string): Promise<VideoStudioProjectRecord[]> {
    try {
      if ((prisma as any)?.videoStudioProject) {
        const rows = await (prisma as any).videoStudioProject.findMany({
          where: { companyId },
          orderBy: { updatedAt: "desc" },
        });

        if (Array.isArray(rows) && rows.length > 0) {
          return rows.map((r: any) => ({
            id: r.id,
            companyId: r.companyId,
            name: r.name,
            templatePreset: r.templatePreset || "MRBEAST_FAST",
            aspectRatio: r.aspectRatio || "16:9",
            durationSeconds: Number(r.durationSeconds) || 0,
            editIR: r.editIR as EditIR,
            metadata: r.metadata,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          }));
        }
      }
    } catch (err) {
      console.warn("[VideoStudioService] DB query failed, falling back to cache:", (err as any).message);
    }

    // Fallback to in-memory store
    const list: VideoStudioProjectRecord[] = [];
    for (const proj of projectStore.values()) {
      if (proj.companyId === companyId) {
        list.push(proj);
      }
    }
    return list;
  }

  /**
   * Retrieves a single video project by ID.
   */
  static async getProject(id: string, companyId: string): Promise<VideoStudioProjectRecord | null> {
    try {
      if ((prisma as any)?.videoStudioProject) {
        const row = await (prisma as any).videoStudioProject.findFirst({
          where: { id, companyId },
        });
        if (row) {
          return {
            id: row.id,
            companyId: row.companyId,
            name: row.name,
            templatePreset: row.templatePreset || "MRBEAST_FAST",
            aspectRatio: row.aspectRatio || "16:9",
            durationSeconds: Number(row.durationSeconds) || 0,
            editIR: row.editIR as EditIR,
            metadata: row.metadata,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          };
        }
      }
    } catch (err) {
      console.warn("[VideoStudioService] DB getProject failed, checking cache:", (err as any).message);
    }

    const proj = projectStore.get(id);
    if (!proj || proj.companyId !== companyId) return null;
    return proj;
  }

  /**
   * Creates or updates a video studio project with transactional multi-tenant isolation.
   */
  static async saveProject(
    companyId: string,
    data: { id?: string; name: string; editIR: EditIR; templatePreset?: string; metadata?: any }
  ): Promise<VideoStudioProjectRecord> {
    const id = data.id || crypto.randomUUID();
    const existing = projectStore.get(id);

    const record: VideoStudioProjectRecord = {
      id,
      companyId,
      name: data.name,
      templatePreset: data.templatePreset || "MRBEAST_FAST",
      aspectRatio: data.editIR.meta.targetAspect || "16:9",
      durationSeconds: RationalTimeMath.toSeconds(data.editIR.meta.totalDuration),
      editIR: data.editIR,
      metadata: data.metadata || {},
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    projectStore.set(id, record);

    try {
      if ((prisma as any)?.videoStudioProject) {
        await (prisma as any).videoStudioProject.upsert({
          where: { id },
          create: {
            id,
            companyId,
            name: record.name,
            templatePreset: record.templatePreset,
            aspectRatio: record.aspectRatio,
            durationSeconds: record.durationSeconds,
            editIR: record.editIR as any,
            metadata: record.metadata,
          },
          update: {
            name: record.name,
            templatePreset: record.templatePreset,
            aspectRatio: record.aspectRatio,
            durationSeconds: record.durationSeconds,
            editIR: record.editIR as any,
            metadata: record.metadata,
          },
        });
      }
    } catch (err) {
      console.warn("[VideoStudioService] DB upsert failed, preserved in cache:", (err as any).message);
    }

    return record;
  }

  /**
   * Runs AI Creative Director compilation via cloud service.
   */
  static async executeAIDirector(params: {
    prompt: string;
    companyId: string;
    stylePreset?: string;
    telemetry?: any;
    currentEditIR?: any;
    availableAssets?: any[];
    selectedClipId?: string | null;
    playheadSec?: number;
    /** Brand + calendar piece prompt sections (web Media Studio opened from a calendar piece). */
    contextSections?: string[];
    /** Earlier chat turns, oldest first ({role, content}). */
    history?: Array<{ role?: string; content?: string }>;
  }) {
    return await (videoAIDirectorService as any).compileAST({
      prompt: params.prompt,
      history: params.history,
      companyId: params.companyId,
      userId: "user_api",
      existingAST: params.currentEditIR,
      meta: {
        stylePreset: params.stylePreset || "MRBEAST_FAST",
        telemetry: params.telemetry,
        availableAssets: params.availableAssets,
        selectedClipId: params.selectedClipId,
        playheadSec: params.playheadSec,
        contextSections: params.contextSections,
      },
    });
  }

  /**
   * Mobile AI Director (client-supplied media analysis). Returns MobileEditIR + planner provenance.
   */
  static async executeMobileAIDirector(
    request: MobileAIDirectRequest,
    companyId: string | undefined,
    context?: DirectorContext,
    agentOs: { events?: any; memoryContext?: string[] } = {}
  ) {
    return await (videoAIDirectorService as any).directMobile(request, {
      companyId,
      context,
      events: agentOs.events,
      memoryContext: agentOs.memoryContext,
      resolveStockVideo: VideoStudioService.resolveStockVideo,
      resolveStockMusic: VideoStudioService.resolveStockMusic,
      // Freesound when FREESOUND_API_KEY is set, else Openverse sound effects (CC0 / CC BY only).
      resolveSfx: process.env.FREESOUND_API_KEY ? VideoStudioService.searchFreesoundSfx : VideoStudioService.searchFreeSfx,
      stockTimeoutMs: Number(process.env.AI_DIRECTOR_STOCK_TIMEOUT_MS) > 0 ? Number(process.env.AI_DIRECTOR_STOCK_TIMEOUT_MS) : 8000,
    });
  }

  /**
   * B-roll research resolver: first HTTPS Pexels video, then Pixabay, then the free licence-filtered providers
   * (Wikimedia Commons, Internet Archive; ranked portrait-first for 9:16, CC0 > PD > CC BY > CC BY-SA).
   * Keys come from env only (PEXELS_API_KEY / PIXABAY_API_KEY); a provider without a key is skipped.
   * Returns the URL with its licence and credit line, or null when nothing matched.
   */
  static async resolveStockVideo(query: string, aspect: string): Promise<{ url: string; title?: string; license?: string; attribution?: string; creditRequired?: boolean; sourcePage?: string; provider?: string } | null> {
    const runtime = require("@workspace/video-engine-runtime");
    const errors: string[] = [];
    const portrait = aspect === "9:16" || aspect === "4:5";
    try {
      runtime.PexelsClient.getApiKey(); // throws when the key is not configured
      const orientation = portrait ? "portrait" : aspect === "1:1" ? "square" : "landscape";
      const { videos } = await runtime.PexelsClient.searchVideos({ query, orientation, perPage: 5 });
      const hit = (videos || []).find((v: any) => typeof v?.downloadUrl === "string" && v.downloadUrl.startsWith("https://"));
      if (hit) return { url: hit.downloadUrl, title: hit.title, license: "Pexels License", attribution: `Video by ${hit.photographer || "a Pexels creator"} on Pexels`, creditRequired: false, sourcePage: hit.url, provider: "pexels" };
    } catch (err: any) {
      if (!/not (set|configured)/i.test(err?.message || "")) errors.push(`Pexels: ${err?.message || err}`);
    }
    try {
      runtime.PixabayClient.getApiKey();
      const { videos } = await runtime.PixabayClient.searchVideos({ query, orientation: portrait ? "vertical" : "horizontal", perPage: 5 });
      const hit = (videos || []).find((v: any) => typeof v?.downloadUrl === "string" && v.downloadUrl.startsWith("https://"));
      if (hit) return { url: hit.downloadUrl, title: hit.title, license: "Pixabay Content License", attribution: `Video by ${hit.user || "a Pixabay creator"} on Pixabay`, creditRequired: false, provider: "pixabay" };
    } catch (err: any) {
      if (!/not (set|configured)/i.test(err?.message || "")) errors.push(`Pixabay: ${err?.message || err}`);
    }
    try {
      const free = await runtime.searchFreeMedia({ query, kind: "video", targetAspect: aspect, minDurationSec: 2, limit: 3, timeoutMs: 5000 });
      const hit = free.items[0];
      if (hit) return { url: hit.url, title: hit.title, license: hit.license, attribution: hit.attribution, creditRequired: hit.creditRequired, sourcePage: hit.sourcePage, provider: hit.provider };
    } catch (err: any) {
      errors.push(`free providers: ${err?.message || err}`);
    }
    if (errors.length) throw new Error(errors.join("; "));
    return null;
  }

  /** Music: curated catalogue first, then the free licence-filtered providers (credit line kept). */
  static async resolveStockMusic(query: string, durationSec: number) {
    const { BgmSearchTool } = require("@workspace/video-engine-runtime");
    const r = await BgmSearchTool.searchTracks({ query, limit: 5, minDurationSec: Math.min(Math.max(durationSec, 20), 120) });
    const t = r.tracks[0];
    return t ? { url: t.url, title: t.title, license: t.license, attribution: t.attribution || undefined, durationSec: t.durationSec } : null;
  }

  /** Keyless SFX search (Openverse sound effects, CC0 / CC BY only; HTTPS previews, nothing downloaded). */
  static async searchFreeSfx(query: string): Promise<Array<{ title: string; url: string; durationSec?: number; license?: string | null; attribution?: string; query: string }>> {
    const { searchFreeMedia } = require("@workspace/video-engine-runtime");
    const r = await searchFreeMedia({ query, kind: "sfx", maxDurationSec: 5, limit: 3, timeoutMs: 3000 });
    return r.items.map((i: any) => ({ title: i.title, url: i.url, durationSec: i.durationSec, license: i.license, attribution: i.attribution, query }));
  }

  /** Freesound SFX search: metadata + HTTPS MP3 previews only (nothing is downloaded). Needs FREESOUND_API_KEY. */
  static async searchFreesoundSfx(query: string): Promise<Array<{ title: string; url: string; durationSec?: number; license?: string | null; query: string }>> {
    const key = process.env.FREESOUND_API_KEY;
    if (!key) throw new Error("FREESOUND_API_KEY is not set");
    const url = `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(query)}&fields=id,name,previews,duration,license&filter=duration:[0 TO 4]&page_size=5`;
    const res = await fetch(url, { headers: { Authorization: `Token ${key}` } });
    if (!res.ok) throw new Error(`Freesound ${res.status}`);
    const data: any = await res.json();
    return (data?.results || [])
      .map((r: any) => ({ title: r.name, url: r.previews?.["preview-hq-mp3"] || r.previews?.["preview-lq-mp3"], durationSec: r.duration, license: r.license || null, query }))
      .filter((r: any) => typeof r.url === "string" && r.url.startsWith("https://"));
  }

  /**
   * Autonomous Zero-Footage Video Creation:
   * Generates a complete broadcast video project directly from a creative text prompt.
   * Leverages Cartesia Sonic-3.6 for neural voiceover, Pexels/Pixabay for HD B-roll,
   * Whisper STT for cadence timestamps, and multi-track EditIR assembly.
   */
  static async generateFromPrompt(params: {
    prompt: string;
    companyId: string;
    userId?: string;
    targetAspect?: "16:9" | "9:16" | "1:1";
    customStyleKey?: string;
    skillId?: string;
  }) {
    const { ProductionPlanner, PlanExecutor } = require("@workspace/video-engine-runtime");
    const { AICreditMeterService } = require("@workspace/ai");
    const os = require("os");
    const path = require("path");

    // 1. Verify and reserve AI credits (50 credits = $0.05 for autonomous pipeline)
    const creditCost = 50;
    const hasSufficient = await AICreditMeterService.checkBalance(params.companyId, creditCost);
    if (!hasSufficient || !hasSufficient.sufficient) {
      throw new Error("INSUFFICIENT_AI_CREDITS: Your AI credit balance is too low for autonomous video generation. Please recharge.");
    }

    const reservation = await AICreditMeterService.reserveCredits({
      companyId: params.companyId,
      estimatedCreditCost: creditCost,
      operation: "AUTONOMOUS_PROMPT_TO_VIDEO",
    });

    try {
      const tempDir = path.join(os.tmpdir(), `director_zero_${Date.now()}`);
      const outputPath = path.join(tempDir, `master_${Date.now()}.mp4`);

      // 2. Formulate zero-footage DAG production plan
      const plan = ProductionPlanner.createPlan({
        userPrompt: params.prompt,
        inputFiles: [], // Zero footage triggers autonomous speech synthesis & B-roll sourcing
        outputPath,
        targetAspect: params.targetAspect || "9:16",
        customStyleKey: params.customStyleKey,
        skillId: params.skillId,
        companyId: params.companyId,
        userId: params.userId,
      });

      // 3. Execute the DAG
      const completedPlan = await PlanExecutor.executePlan(plan, {
        tempDir,
        log: (msg: string) => console.log(`[ZeroFootageDirector] ${msg}`),
      });

      // 4. Extract compiled EditIR from assembler task or context
      const assembleTask = completedPlan.tasks.find((t: any) => t.toolName === "timeline_assembler");
      const editIR = assembleTask?.resultArtifact;

      if (!editIR) {
        throw new Error("Production pipeline completed but failed to generate a valid EditIR timeline.");
      }

      // 5. Persist the generated project
      const projectName = `AI Directed: ${params.prompt.slice(0, 35)}...`;
      const project = await this.saveProject(params.companyId, {
        name: projectName,
        editIR,
        templatePreset: params.customStyleKey || "HORMOZI_VIRAL",
        metadata: {
          generationPrompt: params.prompt,
          generatedBy: "AUTONOMOUS_DIRECTOR",
          planId: completedPlan.id,
        },
      });

      // 6. Settle credit deduction
      await AICreditMeterService.settleCredits({
        companyId: params.companyId,
        reservationId: reservation.reservationId,
        finalCreditCost: creditCost,
        operation: "AUTONOMOUS_PROMPT_TO_VIDEO",
        metadata: {
          projectId: project.id,
          planId: completedPlan.id,
          prompt: params.prompt,
        },
      });

      return {
        project,
        plan: completedPlan,
        editIR,
      };
    } catch (err: any) {
      if (reservation?.reservationId) {
        try {
          AICreditMeterService.releaseReservation(reservation.reservationId);
        } catch {}
      }
      console.error("[VideoStudioService.generateFromPrompt] Pipeline error:", err);
      throw err;
    }
  }
}
