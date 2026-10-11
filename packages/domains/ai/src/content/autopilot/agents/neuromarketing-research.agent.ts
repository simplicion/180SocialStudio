/**
 * Agent 1: Neuromarketing & Audience Psychology Agent
 *
 * Implements Master SOP Stage 01 & Stage 02:
 * - Evaluates client brand consciousness & target audience psychology.
 * - Reference Neutralizer: Analyzes user reference inspirations, neutralizes dry/boring corporate
 *   statements into high-tension emotional triggers, and maps them to the Psychological Job Library.
 */
import { z } from 'zod';
import { runJsonAgent } from '../json-agent';
import { AutopilotLLM, UsageMeter } from '../llm';
import { PSYCHOLOGICAL_JOBS, PsychologicalJob } from '../schemas';
import type { AutopilotBrandContext } from '../types';

export const PSYCHOLOGICAL_JOB_GUIDE: Record<PsychologicalJob, { when: string; angle: string }> = {
    curiosity: {
        when: 'The audience knows the topic but not the hidden explanation.',
        angle: 'You think X. Here is what is actually happening.',
    },
    belief_reversal: {
        when: 'A common assumption is incomplete or wrong.',
        angle: 'The thing you were told about X isn\'t the whole story.',
    },
    fear_reduction: {
        when: 'The topic creates anxiety or uncertainty.',
        angle: 'This sounds scary, but here is what actually happens.',
    },
    insider_knowledge: {
        when: 'Show what professionals notice that patients/customers don\'t.',
        angle: 'Here is what I look for before making this decision.',
    },
    saveability: {
        when: 'The audience may need the information later (checklist, warning signs, steps).',
        angle: 'Save this checklist before doing X.',
    },
    relatability: {
        when: 'The audience has experienced the problem but feels alone.',
        angle: 'If you do this every time, you\'re not the only one.',
    },
    urgency: {
        when: 'Delay can create a meaningful consequence.',
        angle: 'Don\'t wait until X happens to check this.',
    },
    authority_trust: {
        when: 'Build expert credibility without bragging by explaining professional decisions.',
        angle: 'The exact framework we use when evaluating X.',
    },
    identity: {
        when: 'Connect behavior with how the audience sees itself.',
        angle: 'If you\'re someone who takes X seriously…',
    },
    aspiration: {
        when: 'Show a better future state and emotional payoff.',
        angle: 'What changes when you finally understand/do X.',
    },
};

export const NeuromarketingOutcomeSchema = z.object({
    audiencePsychology: z.object({
        coreDesires: z.array(z.string().min(1).max(200)).min(1).max(6),
        corePains: z.array(z.string().min(1).max(200)).min(1).max(6),
        objections: z.array(z.string().min(1).max(200)).max(6).default([]),
        triggers: z.array(z.string().min(1).max(200)).max(6).default([]),
    }),
    positioningAngle: z.string().min(1).max(500),
    neutralizedThemes: z.array(z.object({
        topic: z.string().min(1).max(200),
        audienceTension: z.string().min(1).max(300),
        angle: z.string().min(1).max(400),
        psychologicalJob: z.enum(PSYCHOLOGICAL_JOBS),
        desiredTakeaway: z.string().min(1).max(300),
    })).min(1).max(12),
});
export type NeuromarketingOutcome = z.infer<typeof NeuromarketingOutcomeSchema>;

export interface RunNeuromarketingParams {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    goals: string[];
    referenceInspirations?: string;
    structureDirectives?: string;
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}

export async function runNeuromarketingResearchAgent(params: RunNeuromarketingParams): Promise<NeuromarketingOutcome> {
    const { llm, brand, goals, referenceInspirations, structureDirectives, meter, log } = params;

    const hasRef = Boolean(referenceInspirations && referenceInspirations.trim().length > 0);
    const hasDirectives = Boolean(structureDirectives && structureDirectives.trim().length > 0);

    const systemPrompt = [
        'You are a senior neuromarketing and audience psychology director.',
        'You specialize in turning topics and references into high-retention content angles using the Master SOP Psychological Job Library.',
        'Your goal is to identify genuine audience tension, fears, desires, and psychological jobs that command attention.',
    ].join(' ');

    const prompt = [
        brand.promptContext,
        '',
        goals.length ? `Campaign Goals:\n${goals.map((g) => `- ${g}`).join('\n')}\n` : '',
        hasDirectives ? `User Structure Directives:\n${structureDirectives}\n` : '',
        hasRef
            ? `User Reference / Inspiration Box:\n${referenceInspirations}\n\nINSTRUCTION: The user provided the reference notes above. Some may be dry, technical, or unstructured. You MUST neutralize boring corporate speak into compelling audience tension and assign a deliberate Psychological Job from the library below.`
            : 'INSTRUCTION: No reference notes provided. Ground your psychological angles strictly in the brand consciousness profile, target audience pain points, and natural category tensions.',
        '',
        'Psychological Job Library:',
        ...PSYCHOLOGICAL_JOBS.map((j) => `- ${j}: ${PSYCHOLOGICAL_JOB_GUIDE[j].when} (e.g. "${PSYCHOLOGICAL_JOB_GUIDE[j].angle}")`),
        '',
        'Output JSON matching schema:',
        '{"audiencePsychology":{"coreDesires":[],"corePains":[],"objections":[],"triggers":[]},"positioningAngle":"","neutralizedThemes":[{"topic":"","audienceTension":"","angle":"","psychologicalJob":"curiosity","desiredTakeaway":""}]}',
    ].join('\n');

    const res = await runJsonAgent({
        llm,
        role: 'research',
        system: systemPrompt,
        prompt,
        schema: NeuromarketingOutcomeSchema,
        maxTokens: 3500,
        meter,
        log,
    });

    return res.value;
}
