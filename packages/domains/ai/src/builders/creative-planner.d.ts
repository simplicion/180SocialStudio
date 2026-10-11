import { CreativeEditPlan, CreativeOperation, TimelineContext, DirectorState, MediaIntelligenceGraph, MediaAssetDescriptor, EditIR, PlannerSource, DirectorHistoryTurn } from "@workspace/video-contracts";
import { AIClient } from "../kernel/ai-provider.service";
export interface PlanGenerationParams {
    prompt: string;
    /**
     * Check that the plan covers every feature the creator asked for (and ask once more if not). Off for critic
     * repair calls: their prompt quotes the original request, but a repair must stay minimal.
     */
    checkCoverage?: boolean;
    timelineContext: TimelineContext;
    mediaGraph: MediaIntelligenceGraph;
    directorState?: DirectorState;
    availableAssets?: MediaAssetDescriptor[];
    companyId?: string;
    /** Earlier chat turns, oldest first. */
    history?: DirectorHistoryTurn[];
    /** Per-call LLM timeout in ms (default `AI_DIRECTOR_LLM_TIMEOUT_MS` or 60000). */
    llmTimeoutMs?: number;
    /** Current timeline, used to describe the edit state to the LLM. */
    currentEditIR?: EditIR;
    /**
     * Inject an LLM client (tests, or callers that already resolved one).
     * `null` = explicitly no LLM; `undefined` = resolve from the company's AI settings.
     */
    llmClient?: AIClient | null;
    /** Model id override for the injected/resolved client. */
    llmModel?: string;
    /** Extra prompt sections (brand, calendar piece, script alignment), inserted before the request. */
    contextSections?: string[];
}
export interface PlannerOutcome {
    plan: CreativeEditPlan;
    plannerSource: PlannerSource;
    /** Human-readable reason: model used, or exactly why we fell back. */
    plannerReason: string;
    /** Number of LLM calls made (0, 1, or 2 with the repair retry). */
    llmAttempts: number;
    /** Validation errors from the first LLM attempt that triggered a repair (for telemetry). */
    repairedErrors?: string[];
    /** finish_edit `brandWatermark` from the LLM (undefined = keep). */
    brandWatermark?: "add" | "remove" | "keep";
    /** finish_edit `preserve`: locks the model derived from the creator's words (can only add locks). */
    preserve?: {
        lockedRanges?: Array<{
            startSec: number;
            endSec: number;
        }>;
        lockedTracks?: string[];
    };
    /** Untrusted inputs in this prompt that contained instruction-like text (neutralised). */
    injectionFlags?: string[];
}
/** Feature labels the creator explicitly asked for (see COVERAGE_RULES). */
export declare function requestedFeatures(prompt: string, hasTranscript: boolean): string[];
/** Requested tool families the plan does not contain. */
export declare function missingRequestedOperations(prompt: string, operationTypes: string[], hasTranscript: boolean): string[];
/** Per-call LLM timeout: `AI_DIRECTOR_LLM_TIMEOUT_MS` (default 60 s). A timeout is a DirectorTimeoutError. */
export declare function directorLlmTimeoutMs(override?: number): number;
export declare class CreativePlanner {
    /**
     * Backwards-compatible entry point: returns only the plan.
     * Prefer `planWithSource`, which also reports whether an LLM or the deterministic engine planned.
     */
    static plan(params: PlanGenerationParams): Promise<CreativeEditPlan>;
    /**
     * LLM-first planning via structured tool calling:
     *   1. resolve an LLM client (company key or platform env key)
     *   2. model calls one tool per CreativeOperation (schemas derived from the Zod union)
     *   3. every call is Zod-validated; on failure ONE repair retry is made with the errors
     *   4. no key / call failure / still-invalid output => deterministic planner, and the
     *      outcome says so explicitly (plannerSource + plannerReason). Never silent.
     */
    static planWithSource(params: PlanGenerationParams): Promise<PlannerOutcome>;
    private static resolveClient;
    private static deterministicOutcome;
    private static buildPlan;
    static summarizeOperations(ops: CreativeOperation[]): string;
    /** Builds the full director prompt. Exported for tests / prompt inspection. */
    static buildPrompt(params: PlanGenerationParams): string;
    private static describeEditIR;
    private static buildCoveragePrompt;
    private static buildRepairPrompt;
    /**
     * Deterministic local planner (keyword + telemetry heuristics). Used only as a labelled
     * fallback when no LLM is available or the LLM output could not be validated.
     */
    static planDeterministically(prompt: string, context: TimelineContext, graph: MediaIntelligenceGraph, directorState?: DirectorState, availableAssets?: MediaAssetDescriptor[]): CreativeEditPlan;
}
