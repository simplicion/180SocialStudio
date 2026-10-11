import { CopyLintResult, PlatformCopyLinter } from '../../craft/copy-linter';
import { TimedBeat } from '../../craft/craft-review';
import { HookEvaluation } from '../../craft/hook-scorer';
import { CraftPlatform } from '../../craft/platform-specs';
import { AiDetectionReport } from '../../craft/text-humanizer';
import { AutopilotLLM, UsageMeter } from '../llm';
export declare const DRAFT_FORMATS: readonly ["video", "carousel", "text"];
export type DraftFormat = (typeof DRAFT_FORMATS)[number];
export interface PlatformDraft {
    platform: CraftPlatform;
    format: DraftFormat;
    hooks: HookEvaluation[];
    winningHook: string;
    onScreenHook: string;
    title?: string;
    titleLint?: ReturnType<typeof PlatformCopyLinter.lintYoutubeTitle>;
    script?: {
        beats: TimedBeat[];
        totalSeconds: number;
        wpm: number;
        teleprompterText: string;
    };
    slides: {
        headline: string;
        body: string;
    }[];
    caption: string;
    cta: string;
    hashtags: string[];
    copyLint: CopyLintResult;
    voice: AiDetectionReport;
    thread?: string[];
    /** Figures in the output that are not in the idea or brand context; shown to the user to verify before posting. */
    unverifiedFigures: string[];
}
export declare function runPlatformDraftAgent(params: {
    llm: AutopilotLLM;
    platform: CraftPlatform;
    format: DraftFormat;
    idea: string;
    brandContext: string;
    forbiddenWords?: string[];
    targetSeconds?: number;
    keywords?: string[];
    meter?: UsageMeter;
}): Promise<PlatformDraft>;
export declare const ASSET_TYPES: readonly ["claim", "number", "story", "mechanism", "mistake", "quotable_line"];
export interface RepurposedAsset {
    type: (typeof ASSET_TYPES)[number];
    sourceQuote: string;
    angle: string;
    format: DraftFormat;
    hook: HookEvaluation;
}
export declare function runRepurposeAgent(params: {
    llm: AutopilotLLM;
    platform: CraftPlatform;
    sourceText: string;
    brandContext: string;
    meter?: UsageMeter;
}): Promise<{
    assets: RepurposedAsset[];
    dropped: number;
}>;
