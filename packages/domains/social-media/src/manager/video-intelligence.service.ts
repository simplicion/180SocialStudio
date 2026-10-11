import { getDb } from '../publishing/http';
import { fenceUntrusted, UNTRUSTED_DATA_POLICY } from '@workspace/ai/agent-runs';
import { VideoTraitAnalysis } from './types';
import { requireCompanyId, SocialDomainError, notFound } from '../tenant-scope';
import { requireEngagementLlm, generateWithTimeout, parseLlmJson } from '../engagement/engagement-ai';

const ENERGY = ['high', 'medium', 'calm'] as const;
const FORMATS = ['talking_head', 'tutorial', 'breakdown', 'meme', 'pov', 'lifestyle'] as const;

const score = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n) : null;
};
const text = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * Validates the critic's JSON. Every field must come from the model; nothing is defaulted to a made-up value.
 * Returns the list of problems so the caller can fail with AI_INVALID_OUTPUT.
 */
export function validateVideoTraits(raw: any): { traits?: Omit<VideoTraitAnalysis, 'postId' | 'assetUrl' | 'durationSec' | 'speechTranscript' | 'basis'>; problems: string[] } {
    const problems: string[] = [];
    if (!raw || typeof raw !== 'object') return { problems: ['not a JSON object'] };
    const hookScore = score(raw.hookScore);
    const pacingScore = score(raw.pacingScore);
    const visualHookAnalysis = text(raw.visualHookAnalysis);
    const audioHookTranscript = text(raw.audioHookTranscript);
    const viralityHypothesis = text(raw.viralityHypothesis);
    const cpm = raw.cutsPerMinute == null ? undefined : Number(raw.cutsPerMinute);
    if (hookScore == null) problems.push('hookScore must be 0-100');
    if (pacingScore == null) problems.push('pacingScore must be 0-100');
    if (!ENERGY.includes(raw.energyLevel)) problems.push(`energyLevel must be one of ${ENERGY.join('|')}`);
    if (!FORMATS.includes(raw.detectedFormat)) problems.push(`detectedFormat must be one of ${FORMATS.join('|')}`);
    if (!visualHookAnalysis) problems.push('visualHookAnalysis is required');
    if (!audioHookTranscript) problems.push('audioHookTranscript is required');
    if (!viralityHypothesis) problems.push('viralityHypothesis is required');
    if (cpm !== undefined && !(Number.isFinite(cpm) && cpm >= 0 && cpm <= 600)) problems.push('cutsPerMinute must be a number');
    if (problems.length) return { problems };
    return {
        problems,
        traits: {
            hookScore: hookScore!,
            pacingScore: pacingScore!,
            energyLevel: raw.energyLevel,
            detectedFormat: raw.detectedFormat,
            visualHookAnalysis: visualHookAnalysis!,
            audioHookTranscript: audioHookTranscript!,
            viralityHypothesis: viralityHypothesis!,
            ...(cpm !== undefined ? { cutsPerMinute: cpm } : {}),
        },
    };
}

export class VideoIntelligenceService {
    /**
     * Scores a video from the text the device already extracted (transcript, caption, cut count). Media never
     * reaches the server (desktop/device-only processing rule), so the analysis is labelled with its `basis`.
     */
    static async analyzeVideoTraits(
        companyId: string,
        projectId: string,
        input: {
            postId?: string;
            assetUrl?: string;
            captionOrTitle?: string;
            speechTranscript?: string;
            durationSec?: number;
            cutsPerMinute?: number;
        }
    ): Promise<VideoTraitAnalysis> {
        requireCompanyId(companyId);
        const db = getDb() as any;
        const project = await db.project.findFirst({ where: { id: projectId, companyId }, select: { id: true } });
        if (!project) throw notFound('Project');
        if (input.postId) {
            const post = await db.socialPost.findFirst({ where: { id: input.postId, companyId }, select: { id: true } });
            if (!post) throw notFound('Post');
        }
        const transcript = text(input.speechTranscript, 12_000);
        const caption = text(input.captionOrTitle, 2_200);
        if (!transcript && !caption) {
            throw new SocialDomainError('VIDEO_TEXT_REQUIRED', 422, 'Send the on-device transcript or the caption to analyse this video.');
        }
        const duration = Number(input.durationSec);
        const durationSec = Number.isFinite(duration) && duration > 0 ? duration : undefined;

        const prompt = `You are a short-form video retention critic. Judge ONLY from the data below; if something cannot be known from it, say so in the text fields rather than guessing.
${UNTRUSTED_DATA_POLICY}
${fenceUntrusted('caption', caption || '(none)').block}
${fenceUntrusted('transcript', transcript || '(none)', { maxChars: 12000 }).block}
DURATION_SEC: ${durationSec ?? 'unknown'}${input.cutsPerMinute != null ? `\nMEASURED_CUTS_PER_MINUTE: ${Number(input.cutsPerMinute)}` : ''}

Return ONLY JSON:
{"hookScore": 0-100, "visualHookAnalysis": "...", "audioHookTranscript": "first spoken line", "pacingScore": 0-100, "cutsPerMinute": number|null, "energyLevel": "high|medium|calm", "detectedFormat": "${FORMATS.join('|')}", "viralityHypothesis": "..."}`;

        const llm = await requireEngagementLlm(companyId);
        const { traits, problems } = validateVideoTraits(parseLlmJson(await generateWithTimeout(llm, prompt, 600)));
        if (!traits) throw new SocialDomainError('AI_INVALID_OUTPUT', 502, 'The AI returned an incomplete video analysis. Try again.', { problems });

        const analysis: VideoTraitAnalysis = {
            ...traits,
            ...(input.cutsPerMinute != null ? { cutsPerMinute: Number(input.cutsPerMinute) } : {}),
            postId: input.postId,
            assetUrl: input.assetUrl,
            durationSec,
            speechTranscript: transcript || '',
            basis: transcript ? 'transcript' : 'caption',
        };

        const data = {
            assetUrl: input.assetUrl ?? null,
            durationSec: durationSec ?? null,
            hookScore: analysis.hookScore,
            visualHookAnalysis: analysis.visualHookAnalysis,
            audioHookTranscript: analysis.audioHookTranscript,
            pacingScore: analysis.pacingScore,
            cutsPerMinute: analysis.cutsPerMinute ?? null,
            energyLevel: analysis.energyLevel,
            detectedFormat: analysis.detectedFormat,
            speechTranscript: analysis.speechTranscript || null,
            viralityHypothesis: analysis.viralityHypothesis,
        };
        // Tenant-scoped write: a post's analysis is replaced in place; standalone analyses always get their own row.
        const existing = input.postId
            ? await db.postVideoIntelligence.findFirst({ where: { postId: input.postId, companyId }, select: { id: true } })
            : null;
        if (existing) {
            await db.postVideoIntelligence.updateMany({ where: { id: existing.id, companyId }, data });
        } else {
            await db.postVideoIntelligence.create({ data: { ...data, companyId, projectId, postId: input.postId ?? null } });
        }
        return analysis;
    }
}
