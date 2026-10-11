import type { AutopilotBrandContext } from './types';

/**
 * Builds the agents' brand block from a brand consciousness profile (WS1 BrandConsciousnessProfile shape).
 * When WS1 provides `toPromptContext()`, the caller passes its output as `promptContext` and it is used as-is;
 * otherwise this formats the profile fields itself.
 */
export function buildBrandContext(profile: any, extra: { brandName?: string; industry?: string; promptContext?: string } = {}): AutopilotBrandContext {
    const p = profile || {};
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : []);
    const ctx: AutopilotBrandContext = {
        brandName: extra.brandName || p.brandName || 'the brand',
        industry: extra.industry || p.industry || p.brandPositioning || 'general business',
        positioning: p.brandPositioning || '',
        tone: p.tone || '',
        audience: p.targetAudience || '',
        forbiddenWords: list(p.forbiddenWords),
        defaultHashtags: list(p.defaultHashtags),
        standardCtas: list(p.standardCtas),
        promptContext: '',
    };
    if (extra.promptContext && extra.promptContext.trim()) {
        ctx.promptContext = extra.promptContext.trim();
        return ctx;
    }
    const lines = [
        'BRAND CONSCIOUSNESS',
        `- Brand: ${ctx.brandName} (${p.brandType || 'company'})`,
        ctx.industry ? `- Industry: ${ctx.industry}` : '',
        ctx.positioning ? `- Positioning: ${ctx.positioning}` : '',
        p.brandTagline ? `- Tagline: ${p.brandTagline}` : '',
        p.brandIdeology ? `- Ideology: ${p.brandIdeology}` : '',
        p.brandIdeation ? `- Ideation: ${p.brandIdeation}` : '',
        ctx.tone ? `- Tone of voice: ${ctx.tone}` : '',
        ctx.audience ? `- Target audience: ${ctx.audience}` : '',
        ctx.forbiddenWords.length ? `- Never use these words: ${ctx.forbiddenWords.join(', ')}` : '',
        ctx.standardCtas.length ? `- Preferred CTAs: ${ctx.standardCtas.join(' | ')}` : '',
        ctx.defaultHashtags.length ? `- Brand hashtags: ${ctx.defaultHashtags.join(' ')}` : '',
        p.customGuidelines ? `- Guidelines: ${p.customGuidelines}` : '',
        list(p.sampleViralPosts).length ? `- Posts that worked before: ${list(p.sampleViralPosts).slice(0, 3).join(' || ')}` : '',
    ];
    ctx.promptContext = lines.filter(Boolean).join('\n');
    return ctx;
}
