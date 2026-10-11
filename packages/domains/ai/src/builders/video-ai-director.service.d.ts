import { IUniversalBuilder, BuilderGenerationParams, BuilderResult } from "./universal-builder.interface";
import { EditIR, MediaTelemetryManifest, DirectorStylePreset, MobileAIDirectRequest, MobileEditIR, CreativeOperation, PlannerSource, ScriptAlignment, DirectorCritique, AutonomyPolicy } from "@workspace/video-contracts";
import { AgentRunEmitter } from "../agent-runs/agent-events";
import { SfxSuggestion } from "./director-sub-agents";
export declare class VideoAIDirectorService implements IUniversalBuilder<EditIR> {
    readonly builderType: any;
    private static instance;
    static getInstance(): VideoAIDirectorService;
    /**
     * Compiles an autonomous edit plan into concrete EditIR AST mutations.
     * Follows the production pipeline:
     * USER INTENT -> CONTEXT RESOLVER -> CREATIVE PLANNER -> VALIDATION -> EDITIR COMPILATION
     */
    compileAST(params: BuilderGenerationParams): Promise<BuilderResult<EditIR>>;
    /**
     * Mobile AI Director: the client keeps the media on device and supplies its own analysis
     * (duration/size/transcript/silences). Returns the new timeline as MobileEditIR (ms).
     */
    directMobile(request: MobileAIDirectRequest, opts?: MobileDirectOptions): Promise<MobileDirectResult>;
    /** Caption translator backed by the turn's LLM client, or the workspace's AI provider; null when there is none. */
    private defaultCaptionTranslator;
    private runMobileDirector;
    /**
     * Conversational AI Director Copilot: modifies existing EditIR based on natural language instructions.
     */
    patchAST(entityId: string, instruction: string, params: BuilderGenerationParams): Promise<BuilderResult<EditIR>>;
    deleteEntity(entityId: string, _companyId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * Deterministic local synthesis guaranteeing 100% testability and reliability.
     */
    synthesizeDeterministicEditIR(telemetry: MediaTelemetryManifest, stylePreset?: DirectorStylePreset): EditIR;
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
    summary: string;
    reply: string;
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
    proposal?: {
        steps: string[];
    };
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
    constraints?: {
        lockedRanges: Array<[number, number]>;
        lockedTracks: string[];
    };
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
}
export interface DirectorContextSummary {
    brand?: {
        projectId: string;
        name?: string;
        highlightColor: string;
        textColor: string;
        captionPreset: string;
        font: string;
        hasLogo: boolean;
        pacing: string;
    };
    piece?: {
        calendarPieceId?: string;
        postId?: string;
        headline?: string;
        platform?: string;
        targetDurationSec?: number;
        hasScript: boolean;
    };
}
export declare const videoAIDirectorService: VideoAIDirectorService;
