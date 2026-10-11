"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiContentService = exports.AiContentService = exports.aiContentCalendarService = exports.AIContentCalendarService = void 0;
// @ts-nocheck
const db_1 = require("@workspace/db");
const ai_company_config_service_1 = require("../kernel/ai-company-config.service");
const llm_1 = require("./autopilot/llm");
const json_agent_1 = require("./autopilot/json-agent");
class AIContentCalendarService {
    /**
     * Instance method for backwards compatibility
     */
    async generateContentCalendar(config, userId, companyIdParam) {
        return AIContentCalendarService.generateContentCalendar(config, userId || '', companyIdParam);
    }
    /**
     * Get the company-specific AI settings
     */
    static async getAiSettings(companyIdParam) {
        const companyId = companyIdParam || db_1.requestContext.getStore()?.companyId;
        if (!companyId)
            return null;
        const { settings } = await ai_company_config_service_1.AICompanyConfigService.getCompanyAISettings(companyId);
        if (!settings || !settings.aiProvider || settings.aiProvider === 'none') {
            return null;
        }
        return settings;
    }
    /**
     * Generates the master prompt for social media content calendar creation
     */
    static buildMasterPrompt(config) {
        const { durationWords = '1 month', startDate, endDate, frequency = 'Weekly', industry = config.industry || config.brand_industry, brandVoice = config.brandVoice || config.brand_voice, targetAudience = config.targetAudience || config.target_audience, platforms = config.platforms || [], contentTypeMix = config.contentTypeMix || config.content_type_mix || {}, engagementGoal = config.engagementGoal || config.engagement_goal || 'Growth', brandConsciousness = config.brandConsciousness || {} } = config;
        // Calculate expected number of pieces
        let weeks = 4;
        if (durationWords.includes('1 week'))
            weeks = 1;
        if (durationWords.includes('2 weeks'))
            weeks = 2;
        if (durationWords.includes('month'))
            weeks = 4.3;
        let postsPerWeek = 3;
        if (frequency.toLowerCase() === 'daily')
            postsPerWeek = 7;
        else if (frequency.includes('1x'))
            postsPerWeek = 1;
        else if (frequency.includes('3x'))
            postsPerWeek = 3;
        else if (frequency.includes('5x'))
            postsPerWeek = 5;
        const targetCount = Math.floor(weeks * postsPerWeek) || 6;
        // Brand block: WS1's toPromptContext() output when the caller has it, otherwise the canonical fields
        // that are actually set. Missing fields are named, never filled with invented values.
        const bc = brandConsciousness || {};
        const brandBlock = (typeof config.brandPromptContext === 'string' && config.brandPromptContext.trim())
            ? config.brandPromptContext.trim()
            : [
                bc.brandName || config.brandName || config.brand_name ? `Brand: ${bc.brandName || config.brandName || config.brand_name}${bc.brandType ? ` (${bc.brandType})` : ''}` : '',
                bc.positioning ? `Positioning: ${bc.positioning}` : '',
                bc.tagline ? `Tagline: "${bc.tagline}"` : '',
                bc.description ? `Description: ${bc.description}` : '',
                bc.ideology ? `Ideology / values: ${bc.ideology}` : '',
                industry ? `Industry: ${industry}` : '',
                (bc.tone || brandVoice) ? `Tone: ${bc.tone || brandVoice}` : '',
                (bc.audience || targetAudience) ? `Audience: ${bc.audience || targetAudience}` : '',
                Array.isArray(bc.forbiddenWords) && bc.forbiddenWords.length ? `Never use these words: ${bc.forbiddenWords.join(', ')}` : '',
                Array.isArray(bc.completeness?.missingRequired) && bc.completeness.missingRequired.length
                    ? `Not provided by the brand (do not invent these): ${bc.completeness.missingRequired.join(', ')}` : '',
            ].filter(Boolean).join('\n') || 'No brand profile was provided. Do not invent brand facts; keep claims generic and verifiable.';
        const platformList = platforms.length > 0 ? platforms.join(', ') : (Array.isArray(bc.targetPlatforms) ? bc.targetPlatforms.join(', ') : '');
        return `
SYSTEM ROLE: Senior Social Growth Director & Psychological Scriptwriting Engine for 180 Workspace
YOU ARE: A world-class viral media strategist with deep mastery of human psychology, scroll-stopping hooks, high retention pacing, and brand positioning.
YOUR GOAL: Generate a high-performing ${targetCount}-piece social media calendar strictly embodying the project's Brand Consciousness.

BRAND CONSCIOUSNESS:
${brandBlock}

PLAN:
- Duration: ${durationWords}${startDate ? ` starting ${startDate}` : ''}${endDate ? ` until ${endDate}` : ''}
- Target Platforms: ${platformList || 'not specified: choose platforms that fit the brand and say which'}
- Primary Campaign Goal: ${engagementGoal}

PSYCHOLOGICAL HOOK REQUIREMENTS (MANDATORY FOR VIDEO / REEL / SHORT PIECES):
Every short-form video piece must generate a "videoScriptOrHooks" object with:
1. "hookVariations": Containing 5 distinct psychological angle alternatives:
   - "patternInterrupt": Visceral scroll-stop shock in 0.8 seconds
   - "curiosityGap": Irresistible open loop that demands resolution
   - "boldContrarian": Challenging accepted industry orthodoxy
   - "relatablePain": Addressing acute daily frustration
   - "storyLead": High-stakes character or conflict narrative
2. "teleprompterScript":
   - "hook": Exact 0-3s opening line
   - "problem": 3-15s pacing retainer
   - "solution": 15-45s actionable value drop
   - "actionSteps": Array of 2-3 specific implementation steps
   - "retentionLoop": 45-55s re-hook preventing drop-off
   - "callToAction": 55-60s engagement/conversion directive

CAROUSEL POST REQUIREMENTS:
Every carousel piece must include "carouselSlides" with 5-7 slides (Hook slide, 3-5 high-density value slides, CTA slide) (visual styling is applied later from the brand profile).

OUTPUT REQUIREMENT:
Return ONLY a valid JSON array of ${targetCount} objects with no markdown code blocks or wrapper text.

JSON SCHEMA PER ITEM:
[
  {
    "dateScheduled": "2026-10-01T10:00:00Z",
    "platform": "Instagram",
    "contentType": "Reel",
    "pillar": "Actionable Frameworks",
    "headline": "Punchy title",
    "adCopyFull": "Full engaging caption with emojis and formatted lines",
    "videoScriptOrHooks": {
      "hookVariations": {
        "patternInterrupt": "Stop scrolling...",
        "curiosityGap": "The silent metric...",
        "boldContrarian": "Why posting daily hurts...",
        "relatablePain": "Tired of 4 hours editing...",
        "storyLead": "Last week a client..."
      },
      "teleprompterScript": {
        "hook": "Stop scrolling...",
        "problem": "...",
        "solution": "...",
        "actionSteps": ["...", "..."],
        "retentionLoop": "...",
        "callToAction": "..."
      }
    },
    "visualAssetsBrief": "Vertical 9:16 framing, what the viewer sees",
    "hashtags": ["#marketing", "#videogrowth"],
    "callToAction": "Save this video",
    "engagementTarget": {
      "estimatedImpressions": 2500,
      "estimatedEngagementPercent": 5.2
    }
  }
]
`;
    }
    /**
     * Generate a content calendar (single-shot legacy flow behind POST /content-calendar/create) with the
     * company's configured AI provider. There is no canned fallback: a missing key returns
     * { success:false, code:'AI_NOT_CONFIGURED' } and a provider/parse failure returns a typed error.
     * The multi-agent autopilot lives in ./autopilot.
     */
    static async generateContentCalendar(config, userId, companyIdParam) {
        const startTime = Date.now();
        const companyId = companyIdParam || db_1.requestContext.getStore()?.companyId;
        const promptContent = this.buildMasterPrompt(config);
        let llm;
        try {
            llm = await (0, llm_1.createCompanyAutopilotLLM)(companyId);
        }
        catch (err) {
            if (err instanceof llm_1.AutopilotError)
                return { success: false, code: err.code, statusCode: err.statusCode, error: err.message };
            throw err;
        }
        const providerUsed = llm.provider;
        let rawAiResponse = '';
        try {
            const res = await llm.complete({
                role: 'strategist',
                system: 'You output strict JSON only. No markdown fences, no prose.',
                prompt: promptContent,
                maxTokens: 12000,
            });
            rawAiResponse = res.text;
        }
        catch (err) {
            console.error(`[AIContentCalendarService] provider ${providerUsed} failed:`, err?.message);
            await this.logAiRequest({ provider: providerUsed, endpoint: 'generateContentCalendar', durationMs: Date.now() - startTime, status: 'failed', errorMessage: err?.message, requestedBy: userId, companyId });
            return { success: false, code: 'AI_PROVIDER_ERROR', statusCode: 502, error: 'The AI provider request failed. Check the API key and try again.', meta: { provider: providerUsed, durationMs: Date.now() - startTime } };
        }
        let parsedData;
        try {
            parsedData = (0, json_agent_1.extractJson)(rawAiResponse);
            if (!Array.isArray(parsedData)) {
                parsedData = Array.isArray(parsedData?.data) ? parsedData.data : Object.values(parsedData || {}).find((v) => Array.isArray(v));
            }
            if (!Array.isArray(parsedData) || parsedData.length === 0)
                throw new Error('response has no array of pieces');
        }
        catch (parseError) {
            console.error('[AIContentCalendarService] Failed to parse AI response:', parseError?.message);
            await this.logAiRequest({ provider: providerUsed, endpoint: 'generateContentCalendar', durationMs: Date.now() - startTime, status: 'failed', errorMessage: 'Failed to parse JSON response from AI', requestedBy: userId, companyId });
            return { success: false, code: 'AI_INVALID_OUTPUT', statusCode: 502, error: 'AI generated invalid data format. Please try again.' };
        }
        const contentPieces = parsedData.map((item) => ({
            platform: item.platform || 'General',
            contentType: item.contentType || 'Post',
            pillar: item.pillar || item.category || 'General',
            dateScheduled: item.dateScheduled ? new Date(item.dateScheduled) : (item.scheduledDate ? new Date(item.scheduledDate) : new Date()),
            headline: item.headline || '',
            adCopyFull: item.adCopyFull || item.copy || '',
            videoScriptOrHooks: typeof item.videoScriptOrHooks === 'object' ? JSON.stringify(item.videoScriptOrHooks) : (item.videoScriptOrHooks || item.script || ''),
            visualAssetsBrief: typeof item.visualAssetsBrief === 'object' ? JSON.stringify(item.visualAssetsBrief) : (item.visualAssetsBrief || item.visualDescription || ''),
            hashtagsResearched: Array.isArray(item.hashtags) ? item.hashtags.join(' ') : (item.hashtags || ''),
            callToAction: item.callToAction || '',
            status: 'ready',
            // Only what the model estimated; no invented numbers.
            engagementTarget: {
                estimatedImpressions: item.engagementTarget?.estimatedImpressions?.toString() || '',
                estimatedEngagementPercent: item.engagementTarget?.estimatedEngagementPercent || 0,
                estimatedShares: item.engagementTarget?.estimatedShares?.toString() || ''
            }
        }));
        return {
            success: true,
            data: contentPieces,
            meta: { provider: providerUsed, durationMs: Date.now() - startTime }
        };
    }
    /**
     * Log an AI request to the database
     */
    static async logAiRequest(data) {
        try {
            const companyId = data.companyId || db_1.requestContext.getStore()?.companyId;
            if (!companyId || !db_1.prisma.aiRequestLog)
                return;
            await db_1.prisma.aiRequestLog.create({
                data: {
                    ...data,
                    companyId
                }
            });
        }
        catch (err) {
            console.error('[AIContentCalendarService] Failed to log AI request:', err.message);
        }
    }
}
exports.AIContentCalendarService = AIContentCalendarService;
exports.aiContentCalendarService = new AIContentCalendarService();
exports.AiContentService = AIContentCalendarService;
exports.aiContentService = exports.aiContentCalendarService;
