/**
 * LLM access for the AI DM agent and AI Reply All. The provider is the company's configured AI (same resolution as
 * every other AI feature). No canned output: no provider → 503 AI_NOT_CONFIGURED; slow provider → 504 AI_TIMEOUT.
 */
import { AICompanyConfigService, aiProviderService } from '@workspace/ai';
import { getProjectBrandConsciousness } from '../brand-consciousness';
import { getDb } from '../publishing/http';
import { intEnv } from '../publishing/config';
import { SocialDomainError } from '../tenant-scope';

export interface EngagementLlm {
    generate(prompt: string, options?: any): Promise<string>;
}

type Resolver = (companyId: string) => Promise<EngagementLlm | null>;

const defaultResolver: Resolver = async (companyId) => {
    const { settings } = await AICompanyConfigService.getCompanyAISettings(companyId);
    return ((await aiProviderService.getClient(settings)) as unknown) as EngagementLlm | null;
};
let resolver: Resolver = defaultResolver;

/** Test hook: replace the LLM resolver (null restores the company AI settings). */
export function setEngagementLlmResolver(fn: Resolver | null) {
    resolver = fn || defaultResolver;
}

export async function requireEngagementLlm(companyId: string): Promise<EngagementLlm> {
    let llm: EngagementLlm | null = null;
    try {
        llm = await resolver(companyId);
    } catch (err: any) {
        console.error('[EngagementAI] AI settings could not be resolved:', err?.message);
    }
    if (!llm) throw new SocialDomainError('AI_NOT_CONFIGURED', 503, 'No AI provider is configured for this workspace. Add one in Settings > AI.');
    return llm;
}

export async function generateWithTimeout(llm: EngagementLlm, prompt: string, maxTokens: number): Promise<string> {
    const timeoutMs = intEnv('SOCIAL_ENGAGEMENT_AI_TIMEOUT_MS', 25_000);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SocialDomainError('AI_TIMEOUT', 504, `The AI provider did not answer within ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs);
    });
    try {
        return String((await Promise.race([llm.generate(prompt, { max_tokens: maxTokens, temperature: 0.5 }), timeout])) || '');
    } catch (err: any) {
        if (err instanceof SocialDomainError) throw err;
        throw new SocialDomainError('AI_PROVIDER_ERROR', 502, `The AI provider failed: ${String(err?.message || err).slice(0, 200)}`);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** First JSON object/array in an LLM answer (tolerates code fences), or null. */
export function parseLlmJson(raw: string): any {
    const text = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const starts = [text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0);
    if (!starts.length) return null;
    const start = Math.min(...starts);
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

export function findForbiddenWords(text: string, forbidden: string[]): string[] {
    const lower = String(text || '').toLowerCase();
    return forbidden.map((w) => String(w || '').trim()).filter((w) => w && lower.includes(w.toLowerCase()));
}

export interface BrandForReplies {
    context: string;
    forbiddenWords: string[];
}

/** The project's brand profile as prompt context (tenant-scoped). No project → empty context, no rules invented. */
export async function loadBrandForReplies(projectId: string | null | undefined, companyId: string, cache = new Map<string, BrandForReplies>()): Promise<BrandForReplies> {
    if (!projectId) return { context: '', forbiddenWords: [] };
    const hit = cache.get(projectId);
    if (hit) return hit;
    let out: BrandForReplies = { context: '', forbiddenWords: [] };
    try {
        const brand = await getProjectBrandConsciousness(projectId, companyId, getDb());
        out = { context: brand.toPromptContext({ includeVisual: false, includeMissing: false }), forbiddenWords: brand.forbiddenWords || [] };
    } catch (err: any) {
        if (err?.status !== 404) console.warn(`[EngagementAI] brand profile unavailable: ${err?.message}`);
    }
    cache.set(projectId, out);
    return out;
}
