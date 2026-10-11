/**
 * Typed contracts for every agent in the autopilot calendar pipeline.
 * Each agent must return JSON that validates against one of these schemas; the runner gives it one
 * repair attempt with the validation errors before the stage fails.
 */
import { z } from 'zod';
export declare const HOOK_TYPES: readonly ["pattern_interrupt", "curiosity_gap", "contrarian", "relatable_pain", "story"];
export type HookType = (typeof HOOK_TYPES)[number];
export declare const CONTENT_FORMATS: readonly ["reel", "carousel", "static", "text"];
export type ContentFormat = (typeof CONTENT_FORMATS)[number];
export declare const AUTOPILOT_PLATFORMS: readonly ["instagram", "facebook", "tiktok", "youtube", "linkedin", "x"];
export type AutopilotPlatform = (typeof AUTOPILOT_PLATFORMS)[number];
export declare const PSYCHOLOGICAL_JOBS: readonly ["curiosity", "belief_reversal", "fear_reduction", "insider_knowledge", "saveability", "relatability", "urgency", "authority_trust", "identity", "aspiration"];
export type PsychologicalJob = (typeof PSYCHOLOGICAL_JOBS)[number];
export declare const DESIGN_SYSTEMS: readonly ["minimalistic", "brand_iterative", "editorial", "proof_led"];
export type DesignSystem = (typeof DESIGN_SYSTEMS)[number];
export declare const ContentMixConfigSchema: any;
export type ContentMixConfig = z.infer<typeof ContentMixConfigSchema>;
export declare const StrategySlotSchema: any;
export type StrategySlot = z.infer<typeof StrategySlotSchema>;
export declare const StrategySchema: any;
export type Strategy = z.infer<typeof StrategySchema>;
export declare const ScriptSchema: any;
export type Script = z.infer<typeof ScriptSchema>;
export declare const CarouselBriefSchema: any;
export type CarouselBrief = z.infer<typeof CarouselBriefSchema>;
export declare const HookScriptItemSchema: any;
export type HookScriptItem = z.infer<typeof HookScriptItemSchema>;
export declare const HookScriptBatchSchema: any;
export declare const PlatformCopySchema: any;
export type PlatformCopy = z.infer<typeof PlatformCopySchema>;
export declare const CopyItemSchema: any;
export type CopyItem = z.infer<typeof CopyItemSchema>;
export declare const CopyBatchSchema: any;
export declare const CriticReviewSchema: any;
export type CriticReview = z.infer<typeof CriticReviewSchema>;
export declare const ResearchDigestSchema: any;
export type ResearchDigest = z.infer<typeof ResearchDigestSchema>;
