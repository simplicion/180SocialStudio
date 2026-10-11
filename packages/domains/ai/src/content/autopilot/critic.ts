/**
 * Critic agent.
 *
 * 1. An LLM pass reviews each piece for brand tone and forbidden words and may rewrite captions/hooks.
 * 2. A deterministic pass then enforces the hard rules no matter what the LLM returned: forbidden words are
 *    removed, hashtags are normalised/deduplicated/capped per platform, captions are fitted to platform
 *    limits, and duplicate pieces are flagged. Anything changed or unresolved is recorded on the piece.
 */
import { AutopilotLLM, UsageMeter } from './llm';
import { runJsonAgent } from './json-agent';
import { AGENT_TOKEN_CAPS } from './budget';
import { CriticReviewSchema } from './schemas';
import { PLATFORM_RULES, composeCaption } from './platform-rules';
import type { AutopilotBrandContext, AutopilotPiece, PieceCopy } from './types';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function forbiddenRegex(words: string[]): RegExp | null {
    const clean = words.map((w) => String(w || '').trim()).filter(Boolean);
    if (!clean.length) return null;
    return new RegExp(`(?<![\\p{L}\\p{N}])(?:${clean.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

export function findForbidden(text: string, re: RegExp | null): string[] {
    if (!re || !text) return [];
    re.lastIndex = 0;
    return Array.from(new Set((text.match(re) || []).map((m) => m.toLowerCase())));
}

export function stripForbidden(text: string, re: RegExp | null): string {
    if (!re || !text) return text;
    re.lastIndex = 0;
    return text
        .replace(re, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/ +([,.!?;:])/g, '$1')
        .replace(/^[ \t]+|[ \t]+$/gm, '')
        .trim();
}

export function normalizeHashtag(tag: string): string | null {
    const body = String(tag || '').trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '');
    return body.length >= 2 ? `#${body}` : null;
}

function fitCaption(caption: string, hashtags: string[], max: number): { caption: string; truncated: boolean } {
    if (composeCaption(caption, hashtags).length <= max) return { caption, truncated: false };
    const budget = Math.max(20, max - (hashtags.length ? hashtags.join(' ').length + 2 : 0));
    const slice = caption.slice(0, budget);
    const cut = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('\n'));
    const out = (cut > budget * 0.5 ? slice.slice(0, cut + 1) : slice.slice(0, budget - 1).replace(/\s+\S*$/, '') + '…').trim();
    return { caption: out, truncated: true };
}

/** Deterministic enforcement. Mutates and returns the pieces. */
export function enforceBrandRules(pieces: AutopilotPiece[], brand: AutopilotBrandContext): AutopilotPiece[] {
    const re = forbiddenRegex(brand.forbiddenWords);
    const forbiddenTags = new Set(brand.forbiddenWords.map((w) => normalizeHashtag(w)?.toLowerCase()).filter(Boolean) as string[]);
    const brandTags = brand.defaultHashtags.map(normalizeHashtag).filter(Boolean) as string[];

    for (const p of pieces) {
        const issues = p.critic.issues;
        const scrub = (label: string, text: string): string => {
            if (!text) return text;
            const hits = findForbidden(text, re);
            if (!hits.length) return text;
            issues.push(`removed forbidden word(s) ${hits.join(', ')} from ${label}`);
            const cleaned = stripForbidden(text, re);
            if (!cleaned) issues.push(`empty ${label} after removing forbidden words`);
            return cleaned;
        };
        p.headline = scrub('headline', p.headline);
        p.spokenHook = scrub('spoken hook', p.spokenHook);
        p.onScreenHook = scrub('on-screen hook', p.onScreenHook);
        if (p.script) {
            p.script.hook = scrub('script hook', p.script.hook);
            p.script.retentionLoop = scrub('retention loop', p.script.retentionLoop);
            p.script.cta = scrub('script CTA', p.script.cta);
            p.script.body = p.script.body.map((b) => ({ ...b, beat: scrub('script body', b.beat) }));
        }
        if (p.shotNotes) p.shotNotes = p.shotNotes.map((n) => scrub('shot notes', n));
        if (p.carouselBrief) {
            p.carouselBrief.title = scrub('carousel title', p.carouselBrief.title);
            p.carouselBrief.slides = p.carouselBrief.slides.map((s) => ({
                ...s,
                headline: scrub('carousel slide', s.headline),
                body: scrub('carousel slide', s.body) || '',
            }));
        }

        for (const platform of p.platforms) {
            const copy = p.captions[platform];
            if (!copy) {
                issues.push(`missing copy for ${platform}`);
                continue;
            }
            const rules = PLATFORM_RULES[platform];
            copy.caption = scrub(`${platform} caption`, copy.caption);
            copy.cta = scrub(`${platform} CTA`, copy.cta);

            // Hashtags: normalise, drop forbidden, dedupe, brand defaults first, cap per platform.
            const seen = new Set<string>();
            const tags: string[] = [];
            for (const t of [...brandTags, ...copy.hashtags]) {
                const n = normalizeHashtag(t);
                if (!n) continue;
                const k = n.toLowerCase();
                if (seen.has(k)) continue;
                if (forbiddenTags.has(k) || findForbidden(n.slice(1), re).length) {
                    issues.push(`removed forbidden hashtag ${n} (${platform})`);
                    continue;
                }
                seen.add(k);
                tags.push(n);
            }
            if (tags.length > rules.maxHashtags) issues.push(`trimmed hashtags to ${rules.maxHashtags} for ${platform}`);
            copy.hashtags = tags.slice(0, rules.maxHashtags);

            const fitted = fitCaption(copy.caption, copy.hashtags, rules.maxCaptionChars);
            if (fitted.truncated) issues.push(`shortened ${platform} caption to fit ${rules.maxCaptionChars} characters`);
            copy.caption = fitted.caption;
        }
    }

    // Duplicates: same headline or same primary caption opening across pieces.
    const seenKeys = new Map<string, string>();
    for (const p of pieces) {
        const primary = p.captions[p.primaryPlatform]?.caption || '';
        const keys = [
            `h:${p.headline.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`,
            `c:${primary.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 120)}`,
        ];
        for (const k of keys) {
            if (k.length <= 3) continue;
            const other = seenKeys.get(k);
            if (other && other !== p.slotId) {
                p.critic.issues.push(`duplicate of ${other}`);
                p.critic.verdict = 'flag';
            } else {
                seenKeys.set(k, p.slotId);
            }
        }
    }

    for (const p of pieces) {
        const unresolved = p.critic.issues.some((i) => i.startsWith('missing copy') || i.startsWith('duplicate of') || i.startsWith('empty '));
        if (unresolved) p.critic.verdict = 'flag';
        else if (p.critic.issues.length && p.critic.verdict === 'ok') p.critic.verdict = 'fixed';
        p.status = p.critic.verdict === 'flag' ? 'needs_review' : 'ready';
    }
    return pieces;
}

/** LLM tone review for one batch of pieces; applies the returned fixes in place. */
export async function runCriticAgent(params: {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    pieces: AutopilotPiece[];
    meter?: UsageMeter;
}): Promise<void> {
    const { pieces, brand } = params;
    if (!pieces.length) return;
    const ids = new Set(pieces.map((p) => p.slotId));
    const { value } = await runJsonAgent({
        llm: params.llm,
        role: 'critic',
        meter: params.meter,
        maxTokens: Math.min(AGENT_TOKEN_CAPS.criticMax, AGENT_TOKEN_CAPS.criticBase + pieces.length * AGENT_TOKEN_CAPS.criticPerPiece),
        schema: CriticReviewSchema,
        system: 'You are a strict brand editor. You check social posts against the brand rules and fix what breaks them. You change as little as possible.',
        prompt: [
            brand.promptContext,
            '',
            `Forbidden words (must never appear): ${brand.forbiddenWords.join(', ') || '(none)'}`,
            `Tone: ${brand.tone}`,
            '',
            'Review each piece. verdict "ok" = on brand. "fixed" = you rewrote a caption or the spoken hook (return the full new text). "flag" = a human must look (say why in issues).',
            'Only include fixes for platforms whose caption you changed.',
            '',
            'Pieces:',
            JSON.stringify(pieces.map((p) => ({
                slotId: p.slotId,
                spokenHook: p.spokenHook,
                captions: Object.fromEntries(Object.entries(p.captions).map(([k, v]) => [k, v?.caption])),
            }))),
            '',
            'Return JSON: {"items":[{"slotId":"...","verdict":"ok|fixed|flag","issues":["..."],"fixes":[{"platform":"instagram","caption":"..."}],"fixedSpokenHook":"optional"}]}',
        ].join('\n'),
        check: (r) => {
            const got = new Set(r.items.map((i) => i.slotId));
            const problems: string[] = [];
            for (const id of ids) if (!got.has(id)) problems.push(`missing review for slotId ${id}`);
            for (const id of got) if (!ids.has(id)) problems.push(`unknown slotId ${id}`);
            return problems;
        },
    });

    const byId = new Map(pieces.map((p) => [p.slotId, p]));
    for (const item of value.items) {
        const p = byId.get(item.slotId);
        if (!p) continue;
        p.critic.verdict = item.verdict;
        p.critic.issues.push(...item.issues);
        for (const fix of item.fixes) {
            const copy: PieceCopy | undefined = p.captions[fix.platform];
            if (copy && p.platforms.includes(fix.platform)) copy.caption = fix.caption;
        }
        if (item.fixedSpokenHook && item.fixedSpokenHook.trim()) {
            p.spokenHook = item.fixedSpokenHook.trim();
            if (p.script) p.script.hook = p.spokenHook;
        }
    }
}
