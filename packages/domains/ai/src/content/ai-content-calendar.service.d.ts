export declare class AIContentCalendarService {
    /**
     * Instance method for backwards compatibility
     */
    generateContentCalendar(config: any, userId?: string, companyIdParam?: string): Promise<{
        success: boolean;
        code: string;
        statusCode: number;
        error: string;
        meta: {
            provider: any;
            durationMs: number;
        };
        data?: undefined;
    } | {
        success: boolean;
        code: string;
        statusCode: number;
        error: string;
        meta?: undefined;
        data?: undefined;
    } | {
        success: boolean;
        data: {
            platform: any;
            contentType: any;
            pillar: any;
            dateScheduled: Date;
            headline: any;
            adCopyFull: any;
            videoScriptOrHooks: any;
            visualAssetsBrief: any;
            hashtagsResearched: any;
            callToAction: any;
            status: string;
            engagementTarget: {
                estimatedImpressions: any;
                estimatedEngagementPercent: any;
                estimatedShares: any;
            };
        }[];
        meta: {
            provider: any;
            durationMs: number;
        };
        code?: undefined;
        statusCode?: undefined;
        error?: undefined;
    }>;
    /**
     * Get the company-specific AI settings
     */
    static getAiSettings(companyIdParam?: string): Promise<import("..").AISettings>;
    /**
     * Generates the master prompt for social media content calendar creation
     */
    static buildMasterPrompt(config: any): string;
    /**
     * Generate a content calendar (single-shot legacy flow behind POST /content-calendar/create) with the
     * company's configured AI provider. There is no canned fallback: a missing key returns
     * { success:false, code:'AI_NOT_CONFIGURED' } and a provider/parse failure returns a typed error.
     * The multi-agent autopilot lives in ./autopilot.
     */
    static generateContentCalendar(config: any, userId: string, companyIdParam?: string): Promise<{
        success: boolean;
        code: string;
        statusCode: number;
        error: string;
        meta: {
            provider: any;
            durationMs: number;
        };
        data?: undefined;
    } | {
        success: boolean;
        code: string;
        statusCode: number;
        error: string;
        meta?: undefined;
        data?: undefined;
    } | {
        success: boolean;
        data: {
            platform: any;
            contentType: any;
            pillar: any;
            dateScheduled: Date;
            headline: any;
            adCopyFull: any;
            videoScriptOrHooks: any;
            visualAssetsBrief: any;
            hashtagsResearched: any;
            callToAction: any;
            status: string;
            engagementTarget: {
                estimatedImpressions: any;
                estimatedEngagementPercent: any;
                estimatedShares: any;
            };
        }[];
        meta: {
            provider: any;
            durationMs: number;
        };
        code?: undefined;
        statusCode?: undefined;
        error?: undefined;
    }>;
    /**
     * Log an AI request to the database
     */
    static logAiRequest(data: any): Promise<void>;
}
export declare const aiContentCalendarService: AIContentCalendarService;
export declare const AiContentService: typeof AIContentCalendarService;
export declare const aiContentService: AIContentCalendarService;
