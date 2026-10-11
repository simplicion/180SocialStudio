import type { AutopilotPlatform, CarouselBrief, ContentFormat, ContentMixConfig, DesignSystem, HookType, PsychologicalJob, Script, Strategy } from './schemas';

/** What every agent knows about the brand. Built from WS1's brand consciousness profile. */
export interface AutopilotBrandContext {
    brandName: string;
    industry: string;
    positioning: string;
    tone: string;
    audience: string;
    forbiddenWords: string[];
    defaultHashtags: string[];
    standardCtas: string[];
    /** Full prompt block describing the brand (WS1 toPromptContext() output when available). */
    promptContext: string;
}

export interface AutopilotRunInput {
    days: 7 | 14 | 30;
    /** YYYY-MM-DD, interpreted in `timezone`. */
    startDate: string;
    timezone: string;
    platforms: AutopilotPlatform[];
    goals: string[];
    brand: AutopilotBrandContext;
    /** Compact, project-scoped memory lines (creator preferences, feedback, performance history). */
    memoryContext?: string[];
    campaignName?: string;
    structureDirectives?: string;
    referenceInspirations?: string;
    contentMix?: ContentMixConfig;
    targetReelDurationSec?: number;
    carouselSlideCount?: number;
}

export interface PieceCopy {
    caption: string;
    cta: string;
    hashtags: string[];
    /** HH:mm local time in the project timezone. */
    postingTime: string;
}

export interface AutopilotPiece {
    slotId: string;
    day: number;
    /** YYYY-MM-DD in the project timezone. */
    date: string;
    weekNumber: number;
    platforms: AutopilotPlatform[];
    primaryPlatform: AutopilotPlatform;
    format: ContentFormat;
    pillar: string;
    topic: string;
    angle: string;
    headline: string;
    hookType: HookType;
    psychologicalJob?: PsychologicalJob;
    designSystem?: DesignSystem;
    visualDirection?: string;
    whatContentDelivers?: string;
    spokenHook: string;
    onScreenHook: string;
    script?: Script;
    shotNotes?: string[];
    carouselBrief?: CarouselBrief;
    visualBrief?: string;
    captions: Partial<Record<AutopilotPlatform, PieceCopy>>;
    timezone: string;
    sources: string[];
    critic: { verdict: 'ok' | 'fixed' | 'flag'; issues: string[] };
    status: 'ready' | 'needs_review';
    hookScore?: number;
    hookFormula?: string;
    teleprompterScript?: string;
    timedBeats?: import('../craft/craft-review').TimedBeat[];
    humanScore?: number;
    /** Deterministic craft report computed from the final text (see craft/craft-review). */
    craft?: { score: number; blocking: string[]; advice: string[] };
    /** Scene-by-scene shooting script, generated on demand for video pieces. */
    productionScript?: import('./agents/production-script.agent').ProductionScript;
}

export interface AutopilotRunResult {
    strategy: Strategy;
    pieces: AutopilotPiece[];
    research: { researchUsed: boolean; provider?: string; error?: string; trends?: { topic: string; whyNow: string; sourceUrls: string[] }[] };
    usage: ReturnType<import('./llm').UsageMeter['totals']>;
    provider: string;
}

export type AutopilotStage = 'queued' | 'research' | 'strategy' | 'hooks_scripts' | 'hook_lab' | 'copy' | 'craft' | 'critic' | 'saving' | 'done';

export type ProgressFn = (stage: AutopilotStage, progress: number, detail?: string) => void | Promise<void>;
