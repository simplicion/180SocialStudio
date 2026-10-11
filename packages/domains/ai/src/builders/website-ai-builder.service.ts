// @ts-nocheck
import { prisma, basePrisma } from '@workspace/db';
import crypto from 'crypto';
import { aiProviderService } from '../kernel/ai-provider.service';
import { AICompanyConfigService } from '../kernel/ai-company-config.service';
import { IUniversalBuilder, BuilderGenerationParams, BuilderResult } from './universal-builder.interface';

export interface ElementNode {
    id: string;
    type: 'section' | 'box' | 'row' | 'column' | 'text' | 'media' | 'button' | 'line' | 'floating' | 'code';
    data?: any;
    style?: any;
    /** Per-device style overrides merged over `style` (desktop = base). See docs/website-builder/AUDIT_AND_PLAN.md §2. */
    responsive?: { tablet?: Record<string, any>; mobile?: Record<string, any> };
    hiddenOn?: { desktop?: boolean; tablet?: boolean; mobile?: boolean };
    children?: ElementNode[];
    animation?: any;
    name?: string;
}

const genId = (prefix: string = 'el') => `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

// ---------------------------------------------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------------------------------------------

export type WebsiteBuilderErrorCode =
    | 'AI_NOT_CONFIGURED'
    | 'AI_PROVIDER_ERROR'
    | 'AI_INVALID_OUTPUT'
    | 'INVALID_INPUT'
    | 'COMPANY_REQUIRED'
    | 'WEBSITE_NOT_FOUND'
    | 'SAVE_FAILED';

const WEBSITE_BUILDER_STATUS: Record<WebsiteBuilderErrorCode, number> = {
    AI_NOT_CONFIGURED: 503,
    AI_PROVIDER_ERROR: 502,
    AI_INVALID_OUTPUT: 502,
    INVALID_INPUT: 400,
    COMPANY_REQUIRED: 403,
    WEBSITE_NOT_FOUND: 404,
    SAVE_FAILED: 500,
};

export class WebsiteBuilderError extends Error {
    readonly code: WebsiteBuilderErrorCode;
    readonly statusCode: number;
    constructor(code: WebsiteBuilderErrorCode, message: string) {
        super(message);
        this.name = 'WebsiteBuilderError';
        this.code = code;
        this.statusCode = WEBSITE_BUILDER_STATUS[code];
    }
}

// ---------------------------------------------------------------------------------------------------------------
// AI output validation / sanitization (pure; exported for tests)
// ---------------------------------------------------------------------------------------------------------------

export const WEBSITE_ELEMENT_TYPES = ['section', 'box', 'row', 'column', 'text', 'media', 'button', 'line', 'code', 'floating'] as const;
const ALLOWED_TYPES = new Set<string>(WEBSITE_ELEMENT_TYPES);
const CONTAINER_TYPES = new Set<string>(['section', 'box', 'row', 'column', 'floating']);
const TEXT_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'div', 'blockquote']);
const FLOATING_POSITIONS = new Set(['bottom-right', 'bottom-left', 'top-right', 'top-left']);

export const WEBSITE_SANITIZE_LIMITS = {
    maxDepth: 8,
    maxNodes: 600,
    maxChildren: 40,
    maxSections: 20,
    maxTextLength: 5000,
    maxStyleKeys: 60,
    maxStyleValueLength: 300,
};

/** Removes executable markup from rich text / HTML (scripts, event handlers, javascript: URLs). */
export function sanitizeRichText(input: unknown, maxLength = WEBSITE_SANITIZE_LIMITS.maxTextLength): string {
    if (input === null || input === undefined) return '';
    let s = String(input);
    s = s.replace(/<\s*(script|style|iframe|object|embed|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
    s = s.replace(/<\s*\/?\s*(script|style|iframe|object|embed|noscript|template|meta|link|base|form)\b[^>]*>/gi, '');
    s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/(href|src|action|formaction|xlink:href)\s*=\s*(["']?)\s*(?:javascript|vbscript|data)\s*:[^"'\s>]*\2/gi, '$1="#"');
    return s.slice(0, maxLength);
}

/** Plain text: strips all tags. */
export function sanitizePlainText(input: unknown, maxLength = 500): string {
    if (input === null || input === undefined) return '';
    return sanitizeRichText(input, maxLength * 4).replace(/<[^>]*>/g, '').slice(0, maxLength);
}

/** Absolute http(s) URL or ''. Used for media sources. */
export function sanitizeHttpUrl(input: unknown): string {
    if (typeof input !== 'string') return '';
    const s = input.trim();
    if (!/^https?:\/\//i.test(s)) return '';
    try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
    } catch {
        return '';
    }
}

/** Link target: in-page anchor, site-relative path, http(s), mailto: or tel:. Anything else becomes '#'. */
export function sanitizeLink(input: unknown): string {
    if (typeof input !== 'string') return '#';
    const s = input.trim();
    if (!s) return '#';
    if (/^#[A-Za-z0-9_\-:.]*$/.test(s)) return s;
    if (/^\/(?!\/)[^\s<>"']*$/.test(s)) return s;
    if (/^(mailto|tel):[^\s<>"']+$/i.test(s)) return s;
    return sanitizeHttpUrl(s) || '#';
}

function isPlainObject(v: unknown): v is Record<string, any> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** CSS-in-JS style object: camelCase keys, string/number values, no `;{}<>`, no script URLs or expressions. */
export function sanitizeStyle(input: unknown): Record<string, any> {
    if (!isPlainObject(input)) return {};
    const out: Record<string, any> = {};
    let n = 0;
    for (const [key, raw] of Object.entries(input)) {
        if (n >= WEBSITE_SANITIZE_LIMITS.maxStyleKeys) break;
        if (!/^[a-zA-Z][a-zA-Z0-9]{0,40}$/.test(key)) continue;
        if (key === 'tagName') {
            const tag = String(raw || '').toLowerCase();
            if (TEXT_TAGS.has(tag)) { out.tagName = tag; n++; }
            continue;
        }
        if (typeof raw === 'number') {
            if (Number.isFinite(raw)) { out[key] = raw; n++; }
            continue;
        }
        if (typeof raw !== 'string') continue;
        let v = raw.replace(/[;{}<>]/g, '').trim().slice(0, WEBSITE_SANITIZE_LIMITS.maxStyleValueLength);
        if (/expression\s*\(|javascript:|vbscript:|@import|behavior\s*:/i.test(v)) continue;
        if (/url\s*\(/i.test(v)) {
            const urls = v.match(/url\s*\(\s*(['"]?)(.*?)\1\s*\)/gi) || [];
            const allSafe = urls.length > 0 && urls.every((u) => /url\s*\(\s*(['"]?)https?:\/\//i.test(u));
            if (!allSafe) continue;
        }
        if (!v) continue;
        out[key] = v;
        n++;
    }
    return out;
}

function sanitizeData(type: string, data: unknown): Record<string, any> {
    const d = isPlainObject(data) ? data : {};
    switch (type) {
        case 'text':
            return { content: sanitizeRichText(d.content ?? d.text ?? '') };
        case 'button': {
            const out: Record<string, any> = { content: sanitizePlainText(d.content ?? d.text ?? '', 120), link: sanitizeLink(d.link ?? d.href) };
            if (typeof d.openInNewTab === 'boolean') out.openInNewTab = d.openInNewTab;
            return out;
        }
        case 'media': {
            const out: Record<string, any> = { imageUrl: sanitizeHttpUrl(d.imageUrl ?? d.src ?? '') };
            const video = sanitizeHttpUrl(d.videoUrl);
            if (video) out.videoUrl = video;
            if (d.alt !== undefined) out.alt = sanitizePlainText(d.alt, 200);
            return out;
        }
        case 'code':
            return { html: sanitizeRichText(d.html ?? '', 20000) };
        case 'floating': {
            const out: Record<string, any> = { position: FLOATING_POSITIONS.has(d.position) ? d.position : 'bottom-right' };
            if (d.link !== undefined) out.link = sanitizeLink(d.link);
            return out;
        }
        default:
            return {};
    }
}

function sanitizeResponsive(input: unknown): ElementNode['responsive'] | undefined {
    if (!isPlainObject(input)) return undefined;
    const out: any = {};
    for (const bp of ['tablet', 'mobile']) {
        const s = sanitizeStyle(input[bp]);
        if (Object.keys(s).length) out[bp] = s;
    }
    return Object.keys(out).length ? out : undefined;
}

function sanitizeHiddenOn(input: unknown): ElementNode['hiddenOn'] | undefined {
    if (!isPlainObject(input)) return undefined;
    const out: any = {};
    for (const bp of ['desktop', 'tablet', 'mobile']) if (input[bp] === true) out[bp] = true;
    return Object.keys(out).length ? out : undefined;
}

/**
 * Validates one untrusted node (from an LLM). Only allowed element types survive; ids are regenerated;
 * depth, node count and children are capped; text is stripped of scripts; URLs must be http(s).
 */
export function sanitizeElementNode(raw: unknown, depth = 0, ctx: { count: number } = { count: 0 }): ElementNode | null {
    if (!isPlainObject(raw)) return null;
    if (depth > WEBSITE_SANITIZE_LIMITS.maxDepth) return null;
    if (ctx.count >= WEBSITE_SANITIZE_LIMITS.maxNodes) return null;

    let type = String(raw.type || '').toLowerCase();
    if (type === 'image' || type === 'video') type = 'media';
    if (!ALLOWED_TYPES.has(type)) {
        if (Array.isArray(raw.children) && raw.children.length) type = 'box';
        else return null;
    }
    if (type === 'section' && depth > 0) type = 'box';
    if (type === 'floating' && depth > 0) type = 'box';

    ctx.count++;
    const node: ElementNode = {
        id: genId(type),
        type: type as ElementNode['type'],
        data: sanitizeData(type, raw.data),
        style: sanitizeStyle(raw.style),
    };
    const responsive = sanitizeResponsive(raw.responsive);
    if (responsive) node.responsive = responsive;
    const hiddenOn = sanitizeHiddenOn(raw.hiddenOn);
    if (hiddenOn) node.hiddenOn = hiddenOn;
    if (typeof raw.name === 'string' && raw.name.trim()) node.name = sanitizePlainText(raw.name, 80);

    if (CONTAINER_TYPES.has(type)) {
        const kids = Array.isArray(raw.children) ? raw.children.slice(0, WEBSITE_SANITIZE_LIMITS.maxChildren) : [];
        node.children = kids
            .map((c: unknown) => sanitizeElementNode(c, depth + 1, ctx))
            .filter((c: ElementNode | null): c is ElementNode => !!c);
    }
    return node;
}

/** Validates a list of top-level sections. Non-section top-level nodes are wrapped in a section. */
export function sanitizeSections(raw: unknown, ctx: { count: number } = { count: 0 }): ElementNode[] {
    if (!Array.isArray(raw)) return [];
    const out: ElementNode[] = [];
    for (const item of raw.slice(0, WEBSITE_SANITIZE_LIMITS.maxSections)) {
        const node = sanitizeElementNode(item, 0, ctx);
        if (!node) continue;
        if (node.type === 'section' || node.type === 'floating') {
            out.push(node);
        } else {
            out.push({ id: genId('section'), type: 'section', data: {}, style: { paddingY: 4 }, children: [node] });
        }
    }
    return out;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FONT_NAME = /^[A-Za-z0-9 \-]{1,40}$/;

export function sanitizeBrand(raw: unknown): Record<string, string> {
    if (!isPlainObject(raw)) return {};
    const out: Record<string, string> = {};
    for (const k of ['primaryColor', 'secondaryColor', 'textColor']) {
        if (typeof raw[k] === 'string' && HEX_COLOR.test(raw[k].trim())) out[k] = raw[k].trim();
    }
    for (const k of ['headingFont', 'bodyFont']) {
        if (typeof raw[k] === 'string' && FONT_NAME.test(raw[k].trim())) out[k] = raw[k].trim();
    }
    return out;
}

/**
 * Validates a full LLM website response `{ title, brand, sections }`.
 * Throws AI_INVALID_OUTPUT when nothing renderable survives.
 */
export function sanitizeGeneratedWebsite(parsed: unknown): { title: string; brand: Record<string, string>; sections: ElementNode[] } {
    if (!isPlainObject(parsed)) {
        throw new WebsiteBuilderError('AI_INVALID_OUTPUT', 'The AI response was not valid website JSON.');
    }
    const sections = sanitizeSections(parsed.sections);
    if (!sections.some((s) => s.type === 'section' && (s.children || []).length > 0)) {
        throw new WebsiteBuilderError('AI_INVALID_OUTPUT', 'The AI response did not contain any renderable sections.');
    }
    return {
        title: sanitizePlainText(parsed.title, 80),
        brand: sanitizeBrand(parsed.brand),
        sections,
    };
}

/** Shared element-schema instructions for generation prompts. */
const ELEMENT_SCHEMA_PROMPT = `ELEMENT SCHEMA (JSON). Every node: { "type", "name"?, "data"?, "style"?, "responsive"?, "hiddenOn"?, "children"? }. Do not include ids.
Allowed "type" values ONLY: section | box | row | column | text | media | button | line | code | floating.
- section: top-level block. style: { "paddingY": number (rem, e.g. 5), "backgroundColor", "color" }. Put content in children.
- box: flex container (style.flexDirection "column" or "row", gap, alignItems, maxWidth, margin "0 auto", padding, backgroundColor, borderRadius).
  Grids: box with style { "display": "grid", "gridTemplateColumns": "repeat(auto-fit, minmax(260px, 1fr))", "gap": "2rem" }.
- row: horizontal flex container whose children are columns. column: style { "flex": "1 1 300px" }.
- text: data.content is plain text or simple inline HTML (<strong>, <em>, <br>, <a href>). style.tagName one of h1,h2,h3,h4,p,span. Use fontSize, fontWeight, lineHeight, textAlign, color, opacity, marginBottom.
- button: data { "content": label, "link": "#section-name" | "/path" | "https://..." }. style { backgroundColor, color, borderRadius, padding }.
- media: data.imageUrl MUST be "" unless the user gave an exact image URL (the user uploads real images). style { "width": "100%", "aspectRatio": "16/9", "borderRadius" }.
- line: divider. style { "backgroundColor", "thickness": "1px" }.
- responsive: per-device style overrides merged over style, e.g. { "mobile": { "fontSize": "2.25rem" } } on an h1, { "mobile": { "flexDirection": "column" } } on a row-direction box, { "mobile": { "paddingY": 3 } } on a section. Add mobile overrides for large headings, large paddings and side-by-side layouts.
- hiddenOn: { "mobile": true } to hide decorative elements on phones.
HONESTY RULES (mandatory): never invent statistics, customer counts, ratings, reviews, testimonials, awards, client logos, prices, phone numbers, email addresses or street addresses. When a section needs such facts, use clearly editable bracketed placeholders like "[Add a customer quote]" or "[Your email]". Only state facts given in the business context or the user's request.
No <script>, no inline event handlers, no external fonts or CSS.`;

// Section summary for prompts
function describeSections(sections: any[]): string {
    return sections
        .map((s, i) => {
            const label = s?.name || (() => {
                let found = '';
                const walk = (n: any) => {
                    if (found || !n) return;
                    if (n.type === 'text' && n.data?.content) { found = String(n.data.content).replace(/<[^>]*>/g, '').slice(0, 60); return; }
                    (n.children || []).forEach(walk);
                };
                walk(s);
                return found || s?.type || 'Section';
            })();
            return `  ${i + 1}. ${label}`;
        })
        .join('\n');
}

export class WebsiteAIBuilderService implements IUniversalBuilder {
    readonly builderType = 'website';

    // Helper node creators
    private createBox(children: ElementNode[] = [], style: any = {}): ElementNode {
        return {
            id: genId('box'),
            type: 'box',
            data: {},
            style: {
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box',
                maxWidth: '100%',
                ...style
            },
            children
        };
    }

    private createRow(children: ElementNode[] = [], style: any = {}): ElementNode {
        return {
            id: genId('row'),
            type: 'row',
            data: {},
            style: {
                display: 'flex',
                flexDirection: 'row',
                flexWrap: 'wrap',
                boxSizing: 'border-box',
                maxWidth: '100%',
                ...style
            },
            children
        };
    }

    private createText(content: string, style: any = {}): ElementNode {
        return {
            id: genId('text'),
            type: 'text',
            data: { content },
            style: {
                boxSizing: 'border-box',
                ...style
            }
        };
    }

    private createMedia(imageUrl: string, style: any = {}): ElementNode {
        return {
            id: genId('media'),
            type: 'media',
            data: { imageUrl },
            style: {
                boxSizing: 'border-box',
                ...style
            }
        };
    }

    private createButton(content: string, style: any = {}, link: string = '#'): ElementNode {
        return {
            id: genId('button'),
            type: 'button',
            data: { content, link },
            style: {
                padding: '0.85em 1.75em',
                borderRadius: '0.625rem',
                fontWeight: '600',
                cursor: 'pointer',
                boxSizing: 'border-box',
                ...style
            }
        };
    }

    private createGrid(children: ElementNode[] = [], columns: number = 3): ElementNode {
        return this.createBox(children, {
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${columns >= 3 ? 240 : 300}px, 1fr))`,
            gap: '1.5rem',
            width: '100%'
        });
    }

    private createCard(title: string, body: string): ElementNode {
        return this.createBox([
            this.createText(title, { tagName: 'h3', fontSize: '1.15rem', fontWeight: '700', marginBottom: '0.5rem' }),
            this.createText(body, { tagName: 'p', lineHeight: '1.6', opacity: 0.8 })
        ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.5rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' });
    }

    private createFloating(data: any = {}, style: any = {}): ElementNode {
        return {
            id: genId('floating'),
            type: 'floating',
            data: {
                position: 'bottom-right',
                ...data
            },
            style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '56px',
                height: '56px',
                borderRadius: '9999px',
                backgroundColor: '#25D366',
                color: '#ffffff',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.2)',
                offsetX: '1.5rem',
                offsetY: '1.5rem',
                zIndex: 50,
                ...style
            },
            children: []
        };
    }

    /** Resolves the company's AI client or throws AI_NOT_CONFIGURED. Never falls back to another company. */
    private async resolveCompanyClient(companyId: string) {
        if (!companyId) throw new WebsiteBuilderError('COMPANY_REQUIRED', 'A company context is required.');
        const { settings, companyName } = await AICompanyConfigService.getCompanyAISettings(companyId);
        const client = await aiProviderService.getClient(settings);
        if (!client) {
            throw new WebsiteBuilderError(
                'AI_NOT_CONFIGURED',
                `No usable AI provider key for this workspace (provider "${settings?.aiProvider || 'none'}"). Add a key in Settings > AI.`
            );
        }
        return { client, companyName };
    }

    /** Facts about the business the model may use (company profile only; nothing invented). */
    private async loadBusinessContext(companyId: string, companyName: string): Promise<string> {
        const company = await basePrisma.company.findUnique({
            where: { id: companyId },
            select: { name: true, tagline: true, oneLineDescription: true, industry: true, aboutUs: true, mission: true, headquarters: true, website: true },
        }).catch(() => null);
        const lines = [
            `- Business name: ${company?.name || companyName}`,
            company?.tagline ? `- Tagline: ${company.tagline}` : '',
            company?.oneLineDescription ? `- One-line description: ${company.oneLineDescription}` : '',
            company?.industry ? `- Industry: ${company.industry}` : '',
            company?.aboutUs ? `- About: ${String(company.aboutUs).slice(0, 800)}` : '',
            company?.mission ? `- Mission: ${String(company.mission).slice(0, 400)}` : '',
            company?.headquarters ? `- Location: ${company.headquarters}` : '',
        ].filter(Boolean);
        return lines.join('\n');
    }

    private async callModel(client: any, prompt: string): Promise<any> {
        let raw: string;
        try {
            raw = await client.generate(prompt, { max_tokens: 8000, temperature: 0.6 });
        } catch (err: any) {
            throw new WebsiteBuilderError('AI_PROVIDER_ERROR', `The AI provider request failed: ${err?.message || 'unknown error'}`);
        }
        const parsed = this.extractJSON(raw || '');
        if (!parsed) throw new WebsiteBuilderError('AI_INVALID_OUTPUT', 'The AI response was not valid JSON.');
        return parsed;
    }

    /**
     * Generates a new website with the company's LLM. The model outputs element trees (ElementNode schema),
     * which are validated/sanitized before saving. `mode: 'template'` builds a user-chosen starter template
     * instead (no model call, clearly labelled as a template).
     */
    async compileAST(params: BuilderGenerationParams): Promise<BuilderResult> {
        if (params.mode === 'template') return this.compileStarterTemplate(params);

        const { companyId, userId } = params;
        const textPrompt = (params.prompt || '').trim().slice(0, 4000);
        if (!companyId) throw new WebsiteBuilderError('COMPANY_REQUIRED', 'A company context is required.');
        if (!textPrompt) throw new WebsiteBuilderError('INVALID_INPUT', 'Describe the website you want to generate.');

        const { client, companyName } = await this.resolveCompanyClient(companyId);
        const businessContext = await this.loadBusinessContext(companyId, companyName);
        const rawTheme = (params as any).theme ?? params.meta?.theme;
        const themeHint = typeof rawTheme === 'string' ? rawTheme.slice(0, 200) : '';

        const prompt = `You are a senior web designer. Design a complete, responsive single-page website for a visual website builder.

BUSINESS CONTEXT (facts you may use):
${businessContext || '- (none provided)'}

USER REQUEST: "${textPrompt.replace(/"/g, '\\"')}"
${themeHint ? `STYLE PREFERENCE: "${themeHint.replace(/"/g, '\\"')}"\n` : ''}
${ELEMENT_SCHEMA_PROMPT}

Build 4 to 8 sections that fit the request (for example a hero, what we offer, how it works, about, FAQ, call to action, contact). Give each section a short "name".
Return ONLY one JSON object, no markdown:
{
  "title": "Short website title",
  "brand": { "primaryColor": "#hex", "secondaryColor": "#hex", "textColor": "#hex", "headingFont": "Inter", "bodyFont": "Inter" },
  "sections": [ /* section nodes */ ]
}`;

        const parsed = await this.callModel(client, prompt);
        const site = sanitizeGeneratedWebsite(parsed);

        const siteTitle = site.title || companyName || 'New Website';
        const brand = {
            primaryColor: '#4f46e5',
            secondaryColor: '#ffffff',
            textColor: '#111827',
            headingFont: 'Inter',
            bodyFont: 'Inter',
            fontFamily: site.brand.bodyFont || 'Inter',
            headerFooterTheme: 'light',
            bgType: 'color',
            bgValue: '#ffffff',
            ...site.brand,
        };

        const finalConfig = {
            version: 2,
            brand,
            header: { logo: '', showNavigation: true, navigation: [] },
            footer: { copyright: `© ${new Date().getFullYear()} ${siteTitle}. All rights reserved.`, links: [] },
            pages: [{ id: 'home', name: 'Home', slug: '/', isEnabled: true, sections: site.sections }],
        };

        const website = await this.persistNewWebsite(companyId, userId, siteTitle, finalConfig);
        const editUrl = `/advertising/${website.id}/edit`;
        const sectionNames = site.sections.filter((s) => s.type === 'section').map((s, i) => s.name || `Section ${i + 1}`);

        const reply = `🌐 **${siteTitle}** was generated from your description and saved with ${sectionNames.length} sections: ${sectionNames.join(', ')}.\n\n` +
            `• **Subdomain**: \`${website.slug}\`\n` +
            `• Image slots are left empty for your own photos, and anything in [brackets] is a placeholder to replace with your real details.\n\n` +
            `Open the **Website Builder** to review and edit before sharing.`;

        return {
            success: true,
            builderType: this.builderType,
            entityId: website.id,
            title: siteTitle,
            editUrl,
            reply,
            ast: finalConfig,
            actionCards: [{ type: 'edit', label: 'Open in Website Builder →', url: editUrl }],
        };
    }

    /** Creates the Website row + subdomain registry entry, scoped to the company. */
    private async persistNewWebsite(companyId: string, userId: string | undefined, siteTitle: string, finalConfig: any) {
        if (!companyId) throw new WebsiteBuilderError('COMPANY_REQUIRED', 'A company context is required.');
        if (!userId) throw new WebsiteBuilderError('INVALID_INPUT', 'A user context is required to own the website.');

        let baseSlug = (siteTitle || 'site')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'site';
        if (baseSlug.length > 30) baseSlug = baseSlug.slice(0, 30);

        let slug = baseSlug;
        const existingDomain = await basePrisma.domainRegistry.findFirst({ where: { domain: slug } }).catch(() => null);
        const existingSite = await basePrisma.website.findFirst({ where: { slug } }).catch(() => null);
        if (existingDomain || existingSite) {
            slug = `${baseSlug}-${Date.now().toString(36).slice(-5)}`;
        }

        const website = await basePrisma.website.create({
            data: {
                name: siteTitle,
                slug,
                companyId,
                template: 'default',
                config: finalConfig,
                publishedConfig: finalConfig,
                isPublished: true,
                owner: userId,
                status: 'active'
            }
        });

        await basePrisma.domainRegistry.create({
            data: { domain: slug, type: 'ADVERTISING_WEBSITE', targetId: website.id, companyId }
        }).catch((err: any) => {
            console.warn('[WebsiteAIBuilder] domain registry insert failed:', err?.message);
        });

        return website;
    }

    /**
     * Starter templates (festival / e-commerce / agency / general). User-chosen via `mode: 'template'`;
     * no model call, and the reply says the content is placeholder template copy.
     */
    private async compileStarterTemplate(params: BuilderGenerationParams): Promise<BuilderResult> {
        const { prompt, companyId, userId } = params;
        const textPrompt = (prompt || '').trim();

        if (!companyId) throw new WebsiteBuilderError('COMPANY_REQUIRED', 'A company context is required.');
        const effectiveCompanyId = companyId;

        const { companyName } = await AICompanyConfigService.getCompanyAISettings(effectiveCompanyId);

        // 1. Extract Name/Title if specified
        let extractedTitle = '';
        const nameMatch = textPrompt.match(/(?:website\s+name\s+(?:will\s+be|is)|name\s*:\s*|called\s+|titled\s+)(["']?[a-zA-Z0-9_\s-]+["']?)/i);
        if (nameMatch) {
            extractedTitle = nameMatch[1].replace(/["']/g, '').trim();
        }

        const lowerPrompt = textPrompt.toLowerCase();
        const isDiwaliOrFestival = lowerPrompt.includes('diwali') || lowerPrompt.includes('festival') || lowerPrompt.includes('holiday') || lowerPrompt.includes('offer') || lowerPrompt.includes('promo') || lowerPrompt.includes('black friday');
        const isEcommerce = (lowerPrompt.includes('ecommerce') || lowerPrompt.includes('e-commerce') || lowerPrompt.includes('store') || lowerPrompt.includes('shop') || lowerPrompt.includes('product')) && !isDiwaliOrFestival;
        const isAgency = lowerPrompt.includes('agency') || lowerPrompt.includes('portfolio') || lowerPrompt.includes('studio') || lowerPrompt.includes('freelance') || isDiwaliOrFestival;

        const siteTitle = extractedTitle || (
            isDiwaliOrFestival ? `${companyName || 'Apex'} Diwali Special Campaign` :
            isEcommerce ? `${companyName || 'Apex'} E-Commerce Store` :
            isAgency ? `${companyName || 'Studio'} Creative Agency` :
            `${companyName || 'Apex'} Landing Page`
        );

        const primaryColor = isDiwaliOrFestival ? '#f59e0b' : isEcommerce ? '#ec4899' : isAgency ? '#8b5cf6' : '#4f46e5';
        const brand = {
            primaryColor,
            secondaryColor: '#ffffff',
            textColor: '#111827',
            headingFont: 'Inter',
            bodyFont: 'Inter',
            fontFamily: 'Inter',
            headerFooterTheme: 'dark',
            bgType: 'color',
            bgValue: '#ffffff'
        };

        const sections: ElementNode[] = [];

        if (isDiwaliOrFestival) {
            // Section 1: Festive Hero
            sections.push({
                id: genId('sec-hero'),
                type: 'section',
                data: {},
                style: { paddingY: 6, backgroundColor: '#0f172a', color: '#ffffff' },
                children: [
                    this.createBox([
                        this.createText('🪔 SPECIAL DIWALI 2026 FESTIVAL OFFER • 40% OFF', {
                            fontSize: '0.85rem',
                            fontWeight: '700',
                            color: '#f59e0b',
                            backgroundColor: 'rgba(245, 158, 11, 0.15)',
                            padding: '0.4rem 1rem',
                            borderRadius: '9999px',
                            maxWidth: 'fit-content',
                            marginBottom: '1.25rem'
                        }),
                        this.createText(`Light Up Your Brand Growth with ${siteTitle}`, {
                            tagName: 'h1',
                            fontSize: 'clamp(2.5rem, 5vw, 3.75rem)',
                            fontWeight: '900',
                            lineHeight: '1.15',
                            marginBottom: '1rem',
                            color: '#ffffff'
                        }),
                        this.createText('Exclusive festive marketing & advertising packages to skyrocket your brand revenue, reach millions of buyers, and maximize your ROAS during the festival season.', {
                            tagName: 'p',
                            fontSize: 'clamp(1rem, 2vw, 1.25rem)',
                            opacity: 0.85,
                            marginBottom: '2rem',
                            lineHeight: '1.6',
                            color: '#cbd5e1'
                        }),
                        this.createRow([
                            this.createButton('Claim 40% Festive Discount →', { backgroundColor: '#f59e0b', color: '#000000', fontWeight: 'bold' }, '#offers'),
                            this.createButton('View Campaign Results', { backgroundColor: 'transparent', color: '#ffffff', borderWidth: '1px', borderColor: '#475569' }, '#features')
                        ], { gap: '1rem', alignItems: 'center' })
                    ], { maxWidth: '850px', margin: '0 auto', textAlign: 'center', alignItems: 'center' })
                ]
            });

            // Section 2: Diwali Offer Packages
            sections.push({
                id: genId('sec-offers'),
                type: 'section',
                data: {},
                style: { paddingY: 6, backgroundColor: '#ffffff' },
                children: [
                    this.createBox([
                        this.createText('Exclusive Diwali Campaign Packages', { tagName: 'h2', fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: '900', textAlign: 'center', marginBottom: '0.75rem', color: '#0f172a' }),
                        this.createText('Limited slots available for guaranteed festive ad placement and viral creative delivery.', { tagName: 'p', fontSize: '1.1rem', textAlign: 'center', opacity: 0.7, marginBottom: '3rem', color: '#64748b' }),
                        this.createBox([
                            this.createBox([
                                this.createText('Diwali Spark Starter', { fontWeight: 'bold', fontSize: '1.35rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('₹24,999', { fontWeight: '900', fontSize: '2rem', color: '#f59e0b', marginBottom: '1rem' }),
                                this.createText('• Meta & Instagram Ads Setup\n• 5 Festive Video Creatives\n• Dedicated Campaign Manager\n• Up to 50k Reach', { lineHeight: '1.8', opacity: 0.8, color: '#475569', marginBottom: '1.5rem' }),
                                this.createButton('Choose Spark Plan', { backgroundColor: '#0f172a', color: '#ffffff' })
                            ], { backgroundColor: '#f8fafc', borderRadius: '1.25rem', padding: '2rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0', flex: 1, minWidth: '260px' }),
                            this.createBox([
                                this.createText('⭐ MOST POPULAR', { fontSize: '0.75rem', fontWeight: 'bold', color: '#ffffff', backgroundColor: '#f59e0b', padding: '0.25rem 0.75rem', borderRadius: '9999px', maxWidth: 'fit-content', marginBottom: '0.5rem' }),
                                this.createText('Festive Growth Booster', { fontWeight: 'bold', fontSize: '1.35rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('₹59,999', { fontWeight: '900', fontSize: '2rem', color: '#f59e0b', marginBottom: '1rem' }),
                                this.createText('• Meta + Google PMax Ads\n• 15 Animated Motion Creatives\n• High-Converting Landing Page\n• 24/7 ROAS Optimization', { lineHeight: '1.8', opacity: 0.8, color: '#475569', marginBottom: '1.5rem' }),
                                this.createButton('Claim Booster Plan', { backgroundColor: '#f59e0b', color: '#000000', fontWeight: 'bold' })
                            ], { backgroundColor: '#fffbeb', borderRadius: '1.25rem', padding: '2rem', borderStyle: 'solid', borderWidth: '2px', borderColor: '#f59e0b', flex: 1, minWidth: '260px', transform: 'scale(1.03)', boxShadow: '0 20px 25px -5px rgba(245, 158, 11, 0.15)' }),
                            this.createBox([
                                this.createText('Grand Festive Dominance', { fontWeight: 'bold', fontSize: '1.35rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('₹1,29,999', { fontWeight: '900', fontSize: '2rem', color: '#f59e0b', marginBottom: '1rem' }),
                                this.createText('• Omnichannel Ad Takeover\n• Influencer Collab Strategy\n• Custom Funnel & Retargeting\n• Senior Media Buyer Support', { lineHeight: '1.8', opacity: 0.8, color: '#475569', marginBottom: '1.5rem' }),
                                this.createButton('Choose Grand Plan', { backgroundColor: '#0f172a', color: '#ffffff' })
                            ], { backgroundColor: '#f8fafc', borderRadius: '1.25rem', padding: '2rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0', flex: 1, minWidth: '260px' })
                        ], { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem', width: '100%' })
                    ], { maxWidth: '1100px', margin: '0 auto' })
                ]
            });

            // Section 3: Value Props
            sections.push({
                id: genId('sec-values'),
                type: 'section',
                data: {},
                style: { paddingY: 6, backgroundColor: '#f8fafc' },
                children: [
                    this.createBox([
                        this.createText('Why High-Growth Brands Partner With Us', { tagName: 'h2', fontSize: 'clamp(2rem, 4vw, 2.5rem)', fontWeight: '900', textAlign: 'center', marginBottom: '3rem', color: '#0f172a' }),
                        this.createBox([
                            this.createBox([
                                this.createText('🎯 Laser-Targeted Buyers', { fontWeight: 'bold', fontSize: '1.2rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('High-intent audience segments crafted specifically for festive conversion spikes.', { opacity: 0.75, color: '#475569', lineHeight: '1.6' })
                            ], { backgroundColor: '#ffffff', borderRadius: '1rem', padding: '1.5rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' }),
                            this.createBox([
                                this.createText('⚡ 48-Hour Live Launch', { fontWeight: 'bold', fontSize: '1.2rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('Campaigns reviewed, approved, and launched within 48 hours to capitalize on holiday traffic.', { opacity: 0.75, color: '#475569', lineHeight: '1.6' })
                            ], { backgroundColor: '#ffffff', borderRadius: '1rem', padding: '1.5rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' }),
                            this.createBox([
                                this.createText('📈 4.5x Average ROAS', { fontWeight: 'bold', fontSize: '1.2rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('Data-backed creative iterations designed to lower acquisition cost and boost checkout rate.', { opacity: 0.75, color: '#475569', lineHeight: '1.6' })
                            ], { backgroundColor: '#ffffff', borderRadius: '1rem', padding: '1.5rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' })
                        ], { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', width: '100%' })
                    ], { maxWidth: '1100px', margin: '0 auto' })
                ]
            });

            // Section 4: Festive CTA & Lead Capture
            sections.push({
                id: genId('sec-cta'),
                type: 'section',
                data: {},
                style: { paddingY: 6, backgroundColor: '#0f172a', color: '#ffffff' },
                children: [
                    this.createBox([
                        this.createText('Book Your Free Festive Growth Audit', { tagName: 'h2', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '900', textAlign: 'center', marginBottom: '1rem', color: '#ffffff' }),
                        this.createText('Lock in your 40% festival discount before slots fill up. We will review your funnel and deliver a 90-day scale blueprint.', { tagName: 'p', fontSize: '1.15rem', textAlign: 'center', opacity: 0.85, marginBottom: '2.5rem', maxWidth: '650px', color: '#cbd5e1' }),
                        this.createButton('Get My Free Growth Strategy →', { backgroundColor: '#f59e0b', color: '#000000', fontSize: '1.1rem', fontWeight: 'bold' })
                    ], { maxWidth: '800px', margin: '0 auto', textAlign: 'center', alignItems: 'center' })
                ]
            });
        } else {
            // Section 1: Universal SaaS / Tech Landing Page Hero
            sections.push({
                id: genId('sec-hero'),
                type: 'section',
                data: {},
                style: { paddingY: 6, backgroundColor: '#0b0f19', color: '#ffffff' },
                children: [
                    this.createBox([
                        this.createBox([
                            this.createText('🚀 AI-POWERED ENTERPRISE PLATFORM • VERSION 2.0', {
                                fontSize: '0.8rem',
                                fontWeight: '700',
                                color: primaryColor,
                                backgroundColor: 'rgba(79, 70, 229, 0.15)',
                                padding: '0.35rem 0.9rem',
                                borderRadius: '9999px',
                                maxWidth: 'fit-content',
                                marginBottom: '1.25rem'
                            }),
                            this.createText(`Supercharge High-Velocity Teams with ${siteTitle}`, {
                                tagName: 'h1',
                                fontSize: 'clamp(2.5rem, 5vw, 3.75rem)',
                                fontWeight: '900',
                                lineHeight: '1.15',
                                marginBottom: '1rem',
                                color: '#ffffff'
                            }),
                            this.createText('The unified workspace platform combining intelligent autonomous agents, AST document synthesis, real-time CRM pipelines, and effortless financial automation.', {
                                tagName: 'p',
                                fontSize: 'clamp(1rem, 2vw, 1.25rem)',
                                opacity: 0.85,
                                marginBottom: '2rem',
                                lineHeight: '1.6',
                                color: '#94a3b8'
                            }),
                            this.createRow([
                                this.createButton('Get Started Free →', { backgroundColor: primaryColor, color: '#ffffff' }, '#pricing'),
                                this.createButton('Book Live Walkthrough', { backgroundColor: 'rgba(255,255,255,0.08)', color: '#ffffff', borderWidth: '1px', borderColor: 'rgba(255,255,255,0.15)' }, '#features')
                            ], { gap: '1rem', alignItems: 'center' })
                        ], { flex: 1, minWidth: '320px' }),
                        this.createBox([
                            this.createMedia('https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&q=80&w=1200', {
                                width: '100%',
                                height: 'auto',
                                borderRadius: '1.25rem',
                                aspectRatio: '16/9',
                                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                            })
                        ], { flex: 1, minWidth: '320px', width: '100%' })
                    ], { flexDirection: 'row', alignItems: 'center', gap: '3rem', maxWidth: '1200px', margin: '0 auto', flexWrap: 'wrap' })
                ]
            });

            // Section 2: Core Capabilities & Features
            sections.push({
                id: genId('sec-features'),
                type: 'section',
                data: {},
                style: { paddingY: 6, backgroundColor: '#ffffff' },
                children: [
                    this.createBox([
                        this.createText('Engineered for Scalable Performance', { tagName: 'h2', fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: '900', textAlign: 'center', marginBottom: '0.75rem', color: '#0f172a' }),
                        this.createText('Everything high-velocity companies need to operate, automate, and dominate their industry.', { tagName: 'p', fontSize: '1.1rem', textAlign: 'center', opacity: 0.7, marginBottom: '3rem', color: '#64748b' }),
                        this.createBox([
                            this.createBox([
                                this.createText('⚡ AI Document Synthesizer', { fontWeight: 'bold', fontSize: '1.25rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('Draft legally vetted contracts, service agreements, and tax invoices in under 5 seconds with AST live rendering.', { color: '#475569', lineHeight: '1.6' })
                            ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.75rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' }),
                            this.createBox([
                                this.createText('📊 Autonomous CRM Pipeline', { fontWeight: 'bold', fontSize: '1.25rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('Track leads, manage deal stages, and auto-convert high-intent prospects into active customer projects.', { color: '#475569', lineHeight: '1.6' })
                            ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.75rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' }),
                            this.createBox([
                                this.createText('💰 Real-Time Financial Radar', { fontWeight: 'bold', fontSize: '1.25rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('Monitor 360° revenue streams, recurring payroll liabilities, and cash balances with precision ledgering.', { color: '#475569', lineHeight: '1.6' })
                            ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.75rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' })
                        ], { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', width: '100%' })
                    ], { maxWidth: '1150px', margin: '0 auto' })
                ]
            });

            // Section 3: Transparent Pricing
            sections.push({
                id: genId('sec-pricing'),
                type: 'section',
                data: {},
                style: { paddingY: 6, backgroundColor: '#f8fafc' },
                children: [
                    this.createBox([
                        this.createText('Simple, Predictable Pricing', { tagName: 'h2', fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: '900', textAlign: 'center', marginBottom: '0.75rem', color: '#0f172a' }),
                        this.createText('Choose the tier tailored to your organizational scale. No hidden fees.', { tagName: 'p', fontSize: '1.1rem', textAlign: 'center', opacity: 0.7, marginBottom: '3rem', color: '#64748b' }),
                        this.createBox([
                            this.createBox([
                                this.createText('Starter', { fontWeight: 'bold', fontSize: '1.35rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('$29', { fontWeight: '900', fontSize: '2.5rem', color: primaryColor }),
                                this.createText('per user / month billed annually', { fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.5rem' }),
                                this.createText('• Up to 5 Team Members\n• AI Document Generation\n• Basic CRM & Tasks\n• Standard Support', { lineHeight: '2', opacity: 0.8, color: '#475569', marginBottom: '2rem' }),
                                this.createButton('Start 14-Day Trial', { backgroundColor: '#0f172a', color: '#ffffff' })
                            ], { backgroundColor: '#ffffff', borderRadius: '1.25rem', padding: '2rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' }),
                            this.createBox([
                                this.createText('⭐ POPULAR CHOICE', { fontSize: '0.75rem', fontWeight: 'bold', color: '#ffffff', backgroundColor: primaryColor, padding: '0.25rem 0.75rem', borderRadius: '9999px', maxWidth: 'fit-content', marginBottom: '0.5rem' }),
                                this.createText('Growth Pro', { fontWeight: 'bold', fontSize: '1.35rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('$79', { fontWeight: '900', fontSize: '2.5rem', color: primaryColor }),
                                this.createText('per user / month billed annually', { fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.5rem' }),
                                this.createText('• Unlimited Team Members\n• Full Orbit Copilot & Memory\n• Automated Invoicing & Payroll\n• Priority 24/7 Support', { lineHeight: '2', opacity: 0.8, color: '#475569', marginBottom: '2rem' }),
                                this.createButton('Unlock Growth Plan', { backgroundColor: primaryColor, color: '#ffffff' })
                            ], { backgroundColor: '#ffffff', borderRadius: '1.25rem', padding: '2rem', borderStyle: 'solid', borderWidth: '2px', borderColor: primaryColor, transform: 'scale(1.03)', boxShadow: '0 20px 25px -5px rgba(79, 70, 229, 0.15)' }),
                            this.createBox([
                                this.createText('Enterprise', { fontWeight: 'bold', fontSize: '1.35rem', color: '#0f172a', marginBottom: '0.5rem' }),
                                this.createText('$199', { fontWeight: '900', fontSize: '2.5rem', color: primaryColor }),
                                this.createText('per organization / month', { fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1.5rem' }),
                                this.createText('• Custom LLM Model Fine-Tuning\n• Dedicated Solutions Engineer\n• Enterprise RBAC & Audit Logs\n• 99.99% Uptime SLA', { lineHeight: '2', opacity: 0.8, color: '#475569', marginBottom: '2rem' }),
                                this.createButton('Contact Sales', { backgroundColor: '#0f172a', color: '#ffffff' })
                            ], { backgroundColor: '#ffffff', borderRadius: '1.25rem', padding: '2rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' })
                        ], { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem', width: '100%' })
                    ], { maxWidth: '1150px', margin: '0 auto' })
                ]
            });

            // Section 4: Call to Action Banner
            sections.push({
                id: genId('sec-cta'),
                type: 'section',
                data: {},
                style: { paddingY: 6, backgroundColor: '#0b0f19', color: '#ffffff' },
                children: [
                    this.createBox([
                        this.createText('Ready to Build Something Remarkable?', { tagName: 'h2', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '900', textAlign: 'center', marginBottom: '1rem', color: '#ffffff' }),
                        this.createText('Join visionary founders and forward-thinking enterprises scaling on 180 Workspace.', { tagName: 'p', fontSize: '1.2rem', textAlign: 'center', opacity: 0.85, marginBottom: '2.5rem', maxWidth: '600px', color: '#94a3b8' }),
                        this.createButton('Start Your Free 14-Day Trial →', { backgroundColor: primaryColor, color: '#ffffff', fontSize: '1.1rem', fontWeight: 'bold' })
                    ], { maxWidth: '800px', margin: '0 auto', textAlign: 'center', alignItems: 'center' })
                ]
            });
        }

        // Add Floating Contact Element
        sections.push(this.createFloating());

        // Construct standard v2 Multi-Page config
        const finalConfig = {
            version: 2,
            brand,
            header: {
                logo: '',
                showNavigation: true,
                navigation: [
                    { label: 'Features', link: '#features' },
                    { label: 'Pricing', link: '#pricing' },
                    { label: 'About', link: '#about' },
                    { label: 'Contact', link: '#contact' }
                ],
                ctaButton: { text: 'Get Started', link: '#pricing' }
            },
            footer: {
                copyright: `© ${new Date().getFullYear()} ${siteTitle}. All rights reserved.`,
                links: [
                    { label: 'Privacy Policy', link: '/privacy' },
                    { label: 'Terms of Service', link: '/terms' }
                ]
            },
            pages: [
                {
                    id: 'home',
                    name: 'Home',
                    slug: '/',
                    isEnabled: true,
                    sections
                }
            ]
        };

        const website = await this.persistNewWebsite(effectiveCompanyId, userId, siteTitle, finalConfig);
        const slug = website.slug;

        const editUrl = `/advertising/${website.id}/edit`;

        const reply = `🧩 **${siteTitle}** was created from the **${isDiwaliOrFestival ? 'Festive Campaign' : isEcommerce ? 'E-Commerce Storefront' : isAgency ? 'Creative Agency / Portfolio' : 'Landing Page'} starter template** with ${sections.length} sections.\n\n` +
            `• **Subdomain**: \`${slug}\`\n` +
            `• Template text, numbers, reviews and images are sample placeholders — replace them with your real content before sharing.\n\n` +
            `You can open and customize the site live in the **Website Builder** below.`;

        return {
            success: true,
            builderType: this.builderType,
            entityId: website.id,
            title: siteTitle,
            editUrl,
            reply,
            ast: finalConfig,
            actionCards: [
                { type: 'edit', label: 'Open in Website Builder →', url: editUrl }
            ]
        };
    }

    private extractSectionTitle(section: any): string {
        if (!section) return 'Section';
        let foundText = '';
        const search = (node: any) => {
            if (foundText) return;
            if (node?.type === 'text' && node?.data?.content) {
                foundText = node.data.content;
                return;
            }
            if (Array.isArray(node?.children)) {
                for (const child of node.children) search(child);
            }
        };
        search(section);
        if (foundText) {
            return foundText.length > 45 ? foundText.slice(0, 42) + '...' : foundText;
        }
        return (section.id || 'Section').replace(/^sec-/, '').replace(/-\d+.*$/, '');
    }

    private createHeroSection(siteTitle: string, headline?: string, primaryColor: string = '#4f46e5'): ElementNode {
        return {
            id: genId('sec-hero'),
            type: 'section',
            data: {},
            style: { paddingY: 6, backgroundColor: '#0b0f19', color: '#ffffff' },
            children: [
                this.createBox([
                    this.createBox([
                        this.createText('🚀 AI-POWERED PLATFORM • LIVE SYNTHESIS', {
                            fontSize: '0.8rem',
                            fontWeight: '700',
                            color: primaryColor,
                            backgroundColor: 'rgba(79, 70, 229, 0.15)',
                            padding: '0.35rem 0.85rem',
                            borderRadius: '9999px',
                            maxWidth: 'fit-content',
                            marginBottom: '1rem'
                        }),
                        this.createText(headline || `Supercharge High-Velocity Teams with ${siteTitle}`, {
                            tagName: 'h1',
                            fontSize: 'clamp(2.5rem, 5vw, 4rem)',
                            fontWeight: '900',
                            lineHeight: '1.15',
                            marginBottom: '1rem',
                            color: '#ffffff'
                        }),
                        this.createText('A unified workspace platform combining intelligent autonomous agents, AST document synthesis, real-time CRM pipelines, and effortless automation.', {
                            tagName: 'p',
                            fontSize: 'clamp(1rem, 2vw, 1.25rem)',
                            opacity: 0.85,
                            marginBottom: '2rem',
                            lineHeight: '1.6',
                            color: '#94a3b8'
                        }),
                        this.createRow([
                            this.createButton('Get Started Free →', { backgroundColor: primaryColor, color: '#ffffff', fontWeight: 'bold' }, '#pricing'),
                            this.createButton('Explore Features', { backgroundColor: 'transparent', color: '#ffffff', borderWidth: '1px', borderColor: '#334155' }, '#features')
                        ], { gap: '1rem', alignItems: 'center' })
                    ], { maxWidth: '800px', margin: '0 auto', textAlign: 'center', alignItems: 'center' })
                ])
            ]
        };
    }

    private createTestimonialsSection(primaryColor: string = '#4f46e5'): ElementNode {
        return {
            id: genId('sec-testimonials'),
            type: 'section',
            data: {},
            style: { paddingY: 6, backgroundColor: '#ffffff' },
            children: [
                this.createBox([
                    this.createText('Loved by Thousands of Growing Teams', { tagName: 'h2', fontSize: 'clamp(2rem, 4vw, 2.75rem)', fontWeight: '900', textAlign: 'center', marginBottom: '0.75rem', color: '#0f172a' }),
                    this.createText('See how our platform helps teams scale revenue and automate execution.', { tagName: 'p', fontSize: '1.1rem', textAlign: 'center', opacity: 0.7, marginBottom: '3rem', color: '#64748b' }),
                    this.createBox([
                        this.createBox([
                            this.createText('⭐⭐⭐⭐⭐', { fontSize: '1.1rem', marginBottom: '0.75rem' }),
                            this.createText('"180 Workspace transformed our entire delivery workflow. We automated client onboarding and invoice delivery in one afternoon."', { fontStyle: 'italic', color: '#334155', lineHeight: '1.6', marginBottom: '1rem' }),
                            this.createText('Sarah Jenkins — COO, HyperCloud', { fontWeight: 'bold', fontSize: '0.95rem', color: '#0f172a' })
                        ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.75rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' }),
                        this.createBox([
                            this.createText('⭐⭐⭐⭐⭐', { fontSize: '1.1rem', marginBottom: '0.75rem' }),
                            this.createText('"The Orbit Copilot and live document generation saved our engineering and sales teams 20+ hours every single week."', { fontStyle: 'italic', color: '#334155', lineHeight: '1.6', marginBottom: '1rem' }),
                            this.createText('Marcus Sterling — Head of Product, FinEdge', { fontWeight: 'bold', fontSize: '0.95rem', color: '#0f172a' })
                        ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.75rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' })
                    ], { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', width: '100%' })
                ], { maxWidth: '1100px', margin: '0 auto' })
            ]
        };
    }

    private createPricingSection(primaryColor: string = '#4f46e5'): ElementNode {
        return {
            id: genId('sec-pricing'),
            type: 'section',
            data: {},
            style: { paddingY: 6, backgroundColor: '#f8fafc' },
            children: [
                this.createBox([
                    this.createText('Transparent, Predictable Pricing', { tagName: 'h2', fontSize: '2.5rem', fontWeight: '900', textAlign: 'center', marginBottom: '0.5rem', color: '#0f172a' }),
                    this.createText('Choose the plan that fits your growth stage.', { tagName: 'p', fontSize: '1.1rem', textAlign: 'center', opacity: 0.7, marginBottom: '3rem', color: '#64748b' }),
                    this.createBox([
                        this.createBox([
                            this.createText('Starter', { fontWeight: 'bold', fontSize: '1.25rem', marginBottom: '0.5rem', color: '#0f172a' }),
                            this.createText('₹2,499 / mo', { fontSize: '2rem', fontWeight: '900', color: primaryColor, marginBottom: '1rem' }),
                            this.createText('• Up to 5 Team Members\n• AI Document Synthesis\n• CRM & Lead Pipeline\n• Standard Support', { whiteSpace: 'pre-line', lineHeight: '1.8', color: '#475569', marginBottom: '1.5rem' }),
                            this.createButton('Get Started', { backgroundColor: primaryColor, color: '#ffffff', padding: '0.75rem 1.5rem', borderRadius: '0.75rem', fontWeight: 'bold' })
                        ], { backgroundColor: '#ffffff', borderRadius: '1.25rem', padding: '2rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }),
                        this.createBox([
                            this.createText('⭐ Growth & Pro', { fontWeight: 'bold', fontSize: '1.25rem', marginBottom: '0.5rem', color: '#0f172a' }),
                            this.createText('₹6,999 / mo', { fontSize: '2rem', fontWeight: '900', color: primaryColor, marginBottom: '1rem' }),
                            this.createText('• Unlimited Team Members\n• Full Autonomous AI OS\n• Custom Domain & Ingestion\n• 24/7 VIP Engineering Desk', { whiteSpace: 'pre-line', lineHeight: '1.8', color: '#475569', marginBottom: '1.5rem' }),
                            this.createButton('Claim Pro Plan', { backgroundColor: primaryColor, color: '#ffffff', padding: '0.75rem 1.5rem', borderRadius: '0.75rem', fontWeight: 'bold' })
                        ], { backgroundColor: '#ffffff', borderRadius: '1.25rem', padding: '2rem', borderStyle: 'solid', borderWidth: '2px', borderColor: primaryColor, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' })
                    ], { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem', width: '100%' })
                ], { maxWidth: '1000px', margin: '0 auto' })
            ]
        };
    }

    private createFAQSection(primaryColor: string = '#4f46e5'): ElementNode {
        return {
            id: genId('sec-faq'),
            type: 'section',
            data: {},
            style: { paddingY: 6, backgroundColor: '#ffffff' },
            children: [
                this.createBox([
                    this.createText('Frequently Asked Questions', { tagName: 'h2', fontSize: '2.5rem', fontWeight: '900', textAlign: 'center', marginBottom: '0.5rem', color: '#0f172a' }),
                    this.createText('Everything you need to know about our platform and services.', { tagName: 'p', fontSize: '1.1rem', textAlign: 'center', opacity: 0.7, marginBottom: '3rem', color: '#64748b' }),
                    this.createBox([
                        this.createBox([
                            this.createText('How quickly can we launch?', { fontWeight: 'bold', fontSize: '1.15rem', color: '#0f172a', marginBottom: '0.4rem' }),
                            this.createText('You can deploy live landing pages, CRM pipelines, and automated contracts in under 5 minutes with our zero-config infrastructure.', { color: '#475569', lineHeight: '1.6' })
                        ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.5rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0', marginBottom: '1rem' }),
                        this.createBox([
                            this.createText('Can we connect our custom domain?', { fontWeight: 'bold', fontSize: '1.15rem', color: '#0f172a', marginBottom: '0.4rem' }),
                            this.createText('Yes! Every page and form supports automated SSL provisioning on your own custom domain or free 180workspace.app subdomains.', { color: '#475569', lineHeight: '1.6' })
                        ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.5rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0', marginBottom: '1rem' }),
                        this.createBox([
                            this.createText('Is our client data safe and isolated?', { fontWeight: 'bold', fontSize: '1.15rem', color: '#0f172a', marginBottom: '0.4rem' }),
                            this.createText('Enterprise data isolation is enforced at the database level with strict multi-tenant encryption and granular RBAC permissions.', { color: '#475569', lineHeight: '1.6' })
                        ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.5rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' })
                    ], { maxWidth: '850px', margin: '0 auto', width: '100%' })
                ], { maxWidth: '1000px', margin: '0 auto' })
            ]
        };
    }

    private createFeaturesSection(primaryColor: string = '#4f46e5'): ElementNode {
        return {
            id: genId('sec-features'),
            type: 'section',
            data: {},
            style: { paddingY: 6, backgroundColor: '#f8fafc' },
            children: [
                this.createBox([
                    this.createText('Engineered for Next-Generation Execution', { tagName: 'h2', fontSize: '2.5rem', fontWeight: '900', textAlign: 'center', marginBottom: '0.75rem', color: '#0f172a' }),
                    this.createText('Powerful tools to help your company scale without operational drag.', { tagName: 'p', fontSize: '1.1rem', textAlign: 'center', opacity: 0.7, marginBottom: '3rem', color: '#64748b' }),
                    this.createBox([
                        this.createBox([
                            this.createText('⚡ Real-Time Copilot', { fontWeight: 'bold', fontSize: '1.25rem', color: '#0f172a', marginBottom: '0.5rem' }),
                            this.createText('Conscious AI that understands your live canvas AST and modifies designs on the fly.', { color: '#475569', lineHeight: '1.6' })
                        ], { backgroundColor: '#ffffff', borderRadius: '1rem', padding: '1.75rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' }),
                        this.createBox([
                            this.createText('🔒 Enterprise Security', { fontWeight: 'bold', fontSize: '1.25rem', color: '#0f172a', marginBottom: '0.5rem' }),
                            this.createText('Multi-tenant company data isolation, signed URLs, and end-to-end audit compliance.', { color: '#475569', lineHeight: '1.6' })
                        ], { backgroundColor: '#ffffff', borderRadius: '1rem', padding: '1.75rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' }),
                        this.createBox([
                            this.createText('📈 Automated Workflows', { fontWeight: 'bold', fontSize: '1.25rem', color: '#0f172a', marginBottom: '0.5rem' }),
                            this.createText('Connect lead forms to deals, dispatch proposals, and trigger webhooks seamlessly.', { color: '#475569', lineHeight: '1.6' })
                        ], { backgroundColor: '#ffffff', borderRadius: '1rem', padding: '1.75rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0' })
                    ], { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', width: '100%' })
                ], { maxWidth: '1100px', margin: '0 auto' })
            ]
        };
    }

    private createStatsSection(primaryColor: string = '#4f46e5'): ElementNode {
        return {
            id: genId('sec-stats'),
            type: 'section',
            data: {},
            style: { paddingY: 5, backgroundColor: '#0f172a', color: '#ffffff' },
            children: [
                this.createBox([
                    this.createBox([
                        this.createBox([
                            this.createText('99.9%', { fontSize: '2.5rem', fontWeight: '900', color: primaryColor }),
                            this.createText('Uptime SLA Guarantee', { opacity: 0.8, fontSize: '0.9rem', color: '#94a3b8' })
                        ], { textAlign: 'center' }),
                        this.createBox([
                            this.createText('10x', { fontSize: '2.5rem', fontWeight: '900', color: primaryColor }),
                            this.createText('Faster Delivery Speed', { opacity: 0.8, fontSize: '0.9rem', color: '#94a3b8' })
                        ], { textAlign: 'center' }),
                        this.createBox([
                            this.createText('50,000+', { fontSize: '2.5rem', fontWeight: '900', color: primaryColor }),
                            this.createText('Active Workspaces', { opacity: 0.8, fontSize: '0.9rem', color: '#94a3b8' })
                        ], { textAlign: 'center' }),
                        this.createBox([
                            this.createText('4.9/5', { fontSize: '2.5rem', fontWeight: '900', color: primaryColor }),
                            this.createText('Customer Satisfaction', { opacity: 0.8, fontSize: '0.9rem', color: '#94a3b8' })
                        ], { textAlign: 'center' })
                    ], { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2rem', width: '100%' })
                ], { maxWidth: '1100px', margin: '0 auto' })
            ]
        };
    }

    private createTeamSection(primaryColor: string = '#4f46e5'): ElementNode {
        return {
            id: genId('sec-team'),
            type: 'section',
            data: {},
            style: { paddingY: 6, backgroundColor: '#ffffff' },
            children: [
                this.createBox([
                    this.createText('Meet Our Leadership Team', { tagName: 'h2', fontSize: '2.5rem', fontWeight: '900', textAlign: 'center', marginBottom: '0.5rem', color: '#0f172a' }),
                    this.createText('World-class builders committed to powering your scale.', { tagName: 'p', fontSize: '1.1rem', textAlign: 'center', opacity: 0.7, marginBottom: '3rem', color: '#64748b' }),
                    this.createBox([
                        this.createBox([
                            this.createText('Alex Rivers', { fontWeight: 'bold', fontSize: '1.2rem', color: '#0f172a' }),
                            this.createText('Founder & CEO', { fontSize: '0.85rem', color: primaryColor, fontWeight: '600', marginBottom: '0.5rem' }),
                            this.createText('Ex-Google & Stripe product leader passionate about developer velocity.', { color: '#64748b', fontSize: '0.9rem', lineHeight: '1.5' })
                        ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.5rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0', textAlign: 'center' }),
                        this.createBox([
                            this.createText('Maya Chen', { fontWeight: 'bold', fontSize: '1.2rem', color: '#0f172a' }),
                            this.createText('Chief Technology Officer', { fontSize: '0.85rem', color: primaryColor, fontWeight: '600', marginBottom: '0.5rem' }),
                            this.createText('Distributed systems and AI infrastructure architect with 12+ years experience.', { color: '#64748b', fontSize: '0.9rem', lineHeight: '1.5' })
                        ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.5rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0', textAlign: 'center' }),
                        this.createBox([
                            this.createText('David Vance', { fontWeight: 'bold', fontSize: '1.2rem', color: '#0f172a' }),
                            this.createText('Head of Design', { fontSize: '0.85rem', color: primaryColor, fontWeight: '600', marginBottom: '0.5rem' }),
                            this.createText('Award-winning interaction designer crafting effortless digital experiences.', { color: '#64748b', fontSize: '0.9rem', lineHeight: '1.5' })
                        ], { backgroundColor: '#f8fafc', borderRadius: '1rem', padding: '1.5rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0', textAlign: 'center' })
                    ], { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '2rem', width: '100%' })
                ], { maxWidth: '1100px', margin: '0 auto' })
            ]
        };
    }

    private createContactSection(primaryColor: string = '#4f46e5'): ElementNode {
        return {
            id: genId('sec-contact'),
            type: 'section',
            data: {},
            style: { paddingY: 6, backgroundColor: '#f8fafc' },
            children: [
                this.createBox([
                    this.createText('Get in Touch with Our Experts', { tagName: 'h2', fontSize: '2.5rem', fontWeight: '900', textAlign: 'center', marginBottom: '0.5rem', color: '#0f172a' }),
                    this.createText('Have a question or looking for a custom enterprise setup? Send us a message.', { tagName: 'p', fontSize: '1.1rem', textAlign: 'center', opacity: 0.7, marginBottom: '2.5rem', color: '#64748b' }),
                    this.createBox([
                        this.createBox([
                            this.createText('📍 Global Headquarters\n100 Enterprise Way, Suite 400\nSan Francisco, CA 94105', { color: '#475569', lineHeight: '1.8', marginBottom: '1.5rem' }),
                            this.createText('✉️ support@180workspace.com\n📞 +1 (800) 555-0199', { color: '#475569', lineHeight: '1.8', marginBottom: '1.5rem' }),
                            this.createButton('Book a Live Demo Call →', { backgroundColor: primaryColor, color: '#ffffff', fontWeight: 'bold' })
                        ], { backgroundColor: '#ffffff', borderRadius: '1.25rem', padding: '2.5rem', borderStyle: 'solid', borderWidth: '1px', borderColor: '#e2e8f0', maxWidth: '600px', margin: '0 auto', textAlign: 'center', alignItems: 'center' })
                    ], { width: '100%' })
                ], { maxWidth: '1000px', margin: '0 auto' })
            ]
        };
    }

    private createCtaSection(headline?: string, primaryColor: string = '#4f46e5'): ElementNode {
        return {
            id: genId('sec-cta'),
            type: 'section',
            data: {},
            style: { paddingY: 6, backgroundColor: '#0b0f19', color: '#ffffff' },
            children: [
                this.createBox([
                    this.createText(headline || 'Ready to Build Something Remarkable?', { tagName: 'h2', fontSize: 'clamp(2rem, 4vw, 3rem)', fontWeight: '900', textAlign: 'center', marginBottom: '1rem', color: '#ffffff' }),
                    this.createText('Join visionary founders and forward-thinking enterprises scaling on 180 Workspace.', { tagName: 'p', fontSize: '1.2rem', textAlign: 'center', opacity: 0.85, marginBottom: '2.5rem', maxWidth: '600px', color: '#94a3b8' }),
                    this.createButton('Start Your Free 14-Day Trial →', { backgroundColor: primaryColor, color: '#ffffff', fontSize: '1.1rem', fontWeight: 'bold' })
                ], { maxWidth: '800px', margin: '0 auto', textAlign: 'center', alignItems: 'center' })
            ]
        };
    }

    private isGreetingOrChitchat(text: string): boolean {
        const clean = text.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '');
        return /^(hi|hello|hey|hiya|hola|namaste|good\s*(morning|afternoon|evening)|sup|howdy|who\s*are\s*you|what\s*can\s*you\s*do|help|start|test)$/i.test(clean);
    }

    private extractJSON(rawText: string): any {
        try {
            let cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();
            const firstBrace = cleaned.indexOf('{');
            const lastBrace = cleaned.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1) {
                cleaned = cleaned.substring(firstBrace, lastBrace + 1);
            }
            return JSON.parse(cleaned);
        } catch {
            return null;
        }
    }

    private createTailoredLandingPage(topic: string, siteTitle: string, userPrimaryColor?: string): {
        sections: ElementNode[];
        title: string;
        reply: string;
        primaryColor: string;
    } {
        const lowerTopic = topic.toLowerCase();
        const isMedicine = lowerTopic.includes('medicine') || lowerTopic.includes('pharma') || lowerTopic.includes('health') || lowerTopic.includes('doctor') || lowerTopic.includes('supplement') || lowerTopic.includes('drug') || lowerTopic.includes('clinical') || lowerTopic.includes('wellness');

        if (isMedicine) {
            const primaryColor = userPrimaryColor && userPrimaryColor !== '#4f46e5' ? userPrimaryColor : '#059669';
            const sections: ElementNode[] = [
                // 1. Hero Section
                {
                    id: genId('sec-hero'),
                    type: 'section',
                    data: {},
                    style: { paddingY: 6, backgroundColor: '#022c22', color: '#ffffff' },
                    children: [
                        this.createBox([
                            this.createBox([
                                this.createText('🌿 CLINICALLY TESTED • 100% PURE & CERTIFIED FORMULA', {
                                    fontSize: '0.8rem',
                                    fontWeight: '700',
                                    color: '#34d399',
                                    backgroundColor: 'rgba(52, 211, 153, 0.15)',
                                    padding: '0.35rem 0.85rem',
                                    borderRadius: '9999px',
                                    maxWidth: 'fit-content',
                                    marginBottom: '1rem'
                                }),
                                this.createText(`Advanced Healthcare & Clinical Wellness Innovation`, {
                                    tagName: 'h1',
                                    fontSize: 'clamp(2.5rem, 5vw, 4rem)',
                                    fontWeight: '900',
                                    lineHeight: '1.15',
                                    marginBottom: '1rem',
                                    color: '#ffffff'
                                }),
                                this.createText('Scientifically formulated, lab-tested, and trusted by over 50,000+ patients worldwide. Safe, effective, and doctor-recommended solutions for daily vitality and recovery.', {
                                    tagName: 'p',
                                    fontSize: 'clamp(1rem, 2vw, 1.25rem)',
                                    opacity: 0.9,
                                    marginBottom: '2rem',
                                    lineHeight: '1.6',
                                    color: '#a7f3d0'
                                }),
                                this.createRow([
                                    this.createButton('Order Now (60-Day Guarantee) →', { backgroundColor: '#10b981', color: '#022c22', fontWeight: 'bold' }, '#pricing'),
                                    this.createButton('View Clinical Studies', { backgroundColor: 'transparent', color: '#ffffff', borderWidth: '1px', borderColor: '#065f46' }, '#features')
                                ], { gap: '1rem', alignItems: 'center' })
                            ], { maxWidth: '850px', margin: '0 auto', textAlign: 'center', alignItems: 'center' })
                        ])
                    ]
                },
                // 2. Clinical Proof Metrics / Stats
                this.createStatsSection(primaryColor),
                // 3. Core Therapeutic Benefits / Features
                this.createFeaturesSection(primaryColor),
                // 4. Doctor & Patient Testimonials
                this.createTestimonialsSection(primaryColor),
                // 5. Treatment & Dosage Bundles / Pricing
                this.createPricingSection(primaryColor),
                // 6. Medical FAQ
                this.createFAQSection(primaryColor),
                // 7. Consultation & Order Form
                this.createContactSection(primaryColor),
                // 8. Final Call to Action Banner
                this.createCtaSection('Experience Clinical Efficacy Today. Guaranteed Results or 100% Refund.', primaryColor)
            ];

            const reply = `✨ **Medicine Product Landing Page Synthesized!**\n\nI have generated a high-converting, clinical-grade landing page on your canvas with **8 tailored sections**:\n• **Hero Banner**: Clinical certification badge, headline, and purchase CTAs.\n• **Clinical Metrics & Proof**: 99.4% efficacy, 50,000+ patients, and lab certifications.\n• **Key Therapeutic Benefits**: Bioavailability, lab-tested purity, fast relief, and doctor formulation.\n• **Doctor & Patient Reviews**: Verified medical testimonials and 5-star patient outcomes.\n• **Treatment & Dosage Bundles**: 1-month, 3-month popular therapy, and 6-month vitality packs.\n• **Medical & Usage FAQ**: Prescription requirements, dosage, storage, and 60-day refund policy.\n• **Doctor Consultation Form**: Direct patient inquiry & prescription block.\n• **Final Call to Action**: Expedited delivery guarantee banner.\n\n---\n💬 **To customize this for your exact product, let me know:**\n1. **Product Name & Classification**: What is your medicine's brand name, and is it OTC, herbal/ayurvedic, or prescription?\n2. **Key Active Ingredients**: Are there specific active ingredients, vitamins, or therapeutic compounds to highlight?\n3. **Pricing & Order Flow**: Do you have custom pricing or dosage bundles, or would you prefer a direct pharmacy purchase button?\n\n*(You can reply with your answers, or tell me: "Change product name to VitalCare" or "Make theme emerald green".)*`;

            return { sections, title: 'Medicine Product Landing Page', reply, primaryColor };
        }

        // Generic / Topic-based Landing Page
        const primaryColor = userPrimaryColor || '#4f46e5';
        const sections: ElementNode[] = [
            this.createHeroSection(siteTitle, `Empower Your Growth with ${siteTitle}`, primaryColor),
            this.createFeaturesSection(primaryColor),
            this.createStatsSection(primaryColor),
            this.createTestimonialsSection(primaryColor),
            this.createPricingSection(primaryColor),
            this.createFAQSection(primaryColor),
            this.createContactSection(primaryColor),
            this.createCtaSection(undefined, primaryColor)
        ];

        const reply = `✨ **Landing Page Synthesized!**\n\nI have generated a high-converting landing page with **8 core sections** on your active canvas:\n• **Hero Banner** with clear value proposition and call to action\n• **Core Features & Benefits** grid\n• **Impact Statistics & Proof** counter\n• **Customer Testimonials & Social Proof**\n• **Transparent 3-Tier Pricing Matrix**\n• **FAQ Accordion**\n• **Contact & Lead Intake Form**\n• **Final High-Converting Call to Action**\n\n---\n💬 **How would you like to refine this?**\n1. **Target Audience**: Who is your primary customer or ideal buyer persona?\n2. **Key Value Proposition**: What is the #1 unique benefit of your product or service?\n3. **Visual Branding**: Would you like to adjust the color theme (e.g. Emerald, Indigo, Amber, or Slate)?`;

        return { sections, title: `${siteTitle} Landing Page`, reply, primaryColor };
    }

    private createThankYouSections(primaryColor: string = '#059669'): ElementNode[] {
        return [
            // 1. Order Confirmed Hero Banner
            {
                id: genId('sec-hero-thankyou'),
                type: 'section',
                data: {},
                style: { paddingY: 6, backgroundColor: '#022c22', color: '#ffffff' },
                children: [
                    this.createBox([
                        this.createBox([
                            this.createText('🎉 ORDER CONFIRMED • 100% DISCREET & SECURE PACKAGING', {
                                fontSize: '0.85rem',
                                fontWeight: '700',
                                color: '#34d399',
                                backgroundColor: 'rgba(52, 211, 153, 0.15)',
                                padding: '0.4rem 1rem',
                                borderRadius: '9999px',
                                maxWidth: 'fit-content',
                                marginBottom: '1.25rem'
                            }),
                            this.createText('Thank You for Your Order!', {
                                tagName: 'h1',
                                fontSize: 'clamp(2.5rem, 5vw, 4rem)',
                                fontWeight: '900',
                                lineHeight: '1.15',
                                marginBottom: '1rem',
                                color: '#ffffff'
                            }),
                            this.createText('Your wellness order has been successfully placed and forwarded to our certified pharmacy fulfillment hub. We guarantee 100% plain, unmarked, tamper-evident packaging for complete privacy. Delivery arrives in 2–4 business days.', {
                                tagName: 'p',
                                fontSize: 'clamp(1rem, 2vw, 1.25rem)',
                                opacity: 0.9,
                                marginBottom: '2rem',
                                lineHeight: '1.6',
                                color: '#a7f3d0'
                            }),
                            this.createRow([
                                this.createButton('Back to Home →', { backgroundColor: '#10b981', color: '#022c22', fontWeight: 'bold' }, '/'),
                                this.createButton('Contact Care Specialist', { backgroundColor: 'transparent', color: '#ffffff', borderWidth: '1px', borderColor: '#065f46' }, '#support')
                            ], { gap: '1rem', alignItems: 'center' })
                        ], { maxWidth: '850px', margin: '0 auto', textAlign: 'center', alignItems: 'center' })
                    ])
                ]
            },
            // 2. Fulfillment Timeline / What Happens Next
            {
                id: genId('sec-timeline'),
                type: 'section',
                data: {},
                style: { paddingY: 5, backgroundColor: '#ffffff', color: '#0f172a' },
                children: [
                    this.createBox([
                        this.createText('WHAT HAPPENS NEXT', { fontSize: '0.85rem', fontWeight: 'bold', color: primaryColor, textAlign: 'center', marginBottom: '0.5rem' }),
                        this.createText('Your Discreet Delivery Journey', { tagName: 'h2', fontSize: '2.25rem', fontWeight: '800', textAlign: 'center', marginBottom: '2.5rem' }),
                        this.createGrid([
                            this.createCard('📦 Step 1: Quality Inspection', 'Each batch is verified for tamper-proof seals and packaged in plain, neutral brown boxes with neutral sender info.'),
                            this.createCard('🚀 Step 2: Priority Cold/Express Dispatch', 'Dispatched within 12 hours with automated real-time SMS & email tracking updates straight to your phone.'),
                            this.createCard('🤝 Step 3: Discreet Handover & Support', 'Direct contactless delivery to your doorstep, backed by our 24/7 clinical support team.')
                        ], 3)
                    ])
                ]
            },
            // 3. Privacy & Delivery FAQ
            this.createFAQSection(primaryColor),
            // 4. Dedicated Support & Contact Intake
            this.createContactSection(primaryColor)
        ];
    }

    /** User-chosen starter template sections (sample copy, clearly labelled as such in the reply). */
    private buildTemplateSections(kind: string, primaryColor: string, siteName: string, instruction: string): { sections: ElementNode[]; label: string } | null {
        const k = kind.toLowerCase().replace(/\s+page$/, '').replace(/s$/, '').replace(/[\s-]+/g, '-');
        switch (k) {
            case 'hero': return { sections: [this.createHeroSection(siteName, undefined, primaryColor)], label: 'Hero' };
            case 'feature': return { sections: [this.createFeaturesSection(primaryColor)], label: 'Features' };
            case 'testimonial': return { sections: [this.createTestimonialsSection(primaryColor)], label: 'Testimonials' };
            case 'pricing': return { sections: [this.createPricingSection(primaryColor)], label: 'Pricing' };
            case 'faq': return { sections: [this.createFAQSection(primaryColor)], label: 'FAQ' };
            case 'stat': return { sections: [this.createStatsSection(primaryColor)], label: 'Stats' };
            case 'team': return { sections: [this.createTeamSection(primaryColor)], label: 'Team' };
            case 'contact': return { sections: [this.createContactSection(primaryColor)], label: 'Contact' };
            case 'cta': return { sections: [this.createCtaSection(undefined, primaryColor)], label: 'Call to action' };
            case 'thank-you': return { sections: this.createThankYouSections(primaryColor), label: 'Thank-you' };
            case 'landing': return { sections: this.createTailoredLandingPage(instruction, siteName, primaryColor).sections, label: 'Landing page' };
            default: return null;
        }
    }

    /**
     * Conversational website editing. Exact structural commands (clear page, delete section N / by name,
     * set an explicit hex theme colour, insert a named starter template) run deterministically. Everything
     * else goes to the company's LLM, whose element output is validated before it is applied. Provider or
     * parse failures throw typed errors; they are never replaced by canned content.
     */
    async patchAST(entityId: string, instruction: string, params: BuilderGenerationParams): Promise<BuilderResult> {
        const { prompt, companyId, stateContext } = params;
        const textInstruction = (instruction || prompt || '').trim().slice(0, 4000);
        if (!companyId) throw new WebsiteBuilderError('COMPANY_REQUIRED', 'A company context is required.');
        if (!entityId) throw new WebsiteBuilderError('INVALID_INPUT', 'Website ID is required.');
        if (!textInstruction) throw new WebsiteBuilderError('INVALID_INPUT', 'Tell the AI what to change.');

        // Tenant-scoped load: a website of another company is "not found".
        const website = await basePrisma.website.findFirst({ where: { id: entityId, companyId } });
        if (!website) throw new WebsiteBuilderError('WEBSITE_NOT_FOUND', 'Website not found');

        const activeState = params.stateContext || params.existingAST;
        const siteName = website.name || 'Website';

        // Live editor state is the ground truth when provided; otherwise the saved config.
        const currentConfig: any = activeState && typeof activeState === 'object' ? activeState : (website.config || {});
        if (!currentConfig.pages || !Array.isArray(currentConfig.pages) || currentConfig.pages.length === 0) {
            currentConfig.pages = [
                {
                    id: 'home',
                    name: 'Home',
                    slug: '/',
                    isEnabled: true,
                    sections: Array.isArray(currentConfig.sections) ? currentConfig.sections : []
                }
            ];
        }
        if (!currentConfig.version) currentConfig.version = 2;
        if (!currentConfig.brand) {
            currentConfig.brand = { primaryColor: '#4f46e5', headingFont: 'Inter', bodyFont: 'Inter' };
        }

        const editUrl = `/advertising/${entityId}/edit`;
        const targetPageId = currentConfig.activePageId || stateContext?.activePageId || 'home';
        const targetPageIndex = currentConfig.pages.findIndex((p: any) => p.id === targetPageId);
        const activePageIndex = targetPageIndex !== -1 ? targetPageIndex : 0;
        const activePage = currentConfig.pages[activePageIndex];
        const activeSections: ElementNode[] = Array.isArray(activePage.sections) ? activePage.sections : [];
        const primaryColor = currentConfig.brand?.primaryColor || '#4f46e5';
        const pageLabel = activePage.name || activePage.id;

        const done = async (reply: string, changed: boolean): Promise<BuilderResult> => {
            if (changed) {
                let count = 0;
                try {
                    ({ count } = await basePrisma.website.updateMany({
                        where: { id: entityId, companyId },
                        // Draft only — changes go live when the user publishes from the editor.
                        data: { config: currentConfig }
                    }));
                } catch (err: any) {
                    throw new WebsiteBuilderError('SAVE_FAILED', `Could not save the website: ${err?.message || 'database error'}`);
                }
                if (!count) throw new WebsiteBuilderError('WEBSITE_NOT_FOUND', 'Website not found');
                reply += '\n\n_Saved as a draft — click **Publish** in the editor to make it live._';
            }
            return {
                success: true,
                builderType: this.builderType,
                entityId,
                title: siteName,
                editUrl,
                reply,
                ast: currentConfig,
                actionCards: [{ type: 'edit', label: 'View in Website Builder →', url: editUrl }]
            };
        };

        // 1. Greeting / help (static help text, no content generated)
        if (this.isGreetingOrChitchat(textInstruction)) {
            const sectionList = activeSections.length > 0
                ? activeSections.map((s: any, idx) => `• Section ${idx + 1}: **${s.name || this.extractSectionTitle(s)}**`).join('\n')
                : '• *(Canvas is currently empty)*';
            return done(`👋 Hello! I am your **180 Workspace AI Website Architect**.\n\nYour website **"${siteName}"** (page **"${pageLabel}"**, ${activeSections.length} sections across ${currentConfig.pages.length} page(s)):\n${sectionList}\n\n**Try:**\n• *"Add an About page"*\n• *"Add an FAQ section about delivery and returns"*\n• *"Rewrite the hero headline to focus on speed"*\n• *"Set theme colour to #10b981"*\n• *"Delete section 2"* or *"Clear page"*\n• *"Add pricing template"* (inserts a starter template with sample copy)`, false);
        }

        // 2. Exact structural commands (no model call)
        const isClearPageIntent = /^(?:please\s+)?(?:del(?:e)?t(?:e)?|clear|reset|erase|wipe)\s+(?:this\s+|the\s+)?(?:p+a+g+e+|all|canvas|everything|all\s+sections?)\s*[.!]?$/i.test(textInstruction);
        if (isClearPageIntent) {
            currentConfig.pages[activePageIndex].sections = [];
            return done(`🗑️ **Canvas Cleared**: All sections on page **"${pageLabel}"** were removed. Use undo in the editor if this was a mistake.`, true);
        }

        const deleteSectionMatch = textInstruction.match(/^(?:please\s+)?(?:del(?:e)?t(?:e)?|remove|drop|erase)\s+(?:the\s+)?([a-z0-9_#\s-]+?)(?:\s+section|\s+block)?\s*[.!]?$/i);
        if (deleteSectionMatch) {
            const targetKey = deleteSectionMatch[1].trim().toLowerCase();
            let foundIndex = -1;
            const numMatch = targetKey.match(/^(?:section\s+|#)?(\d+)$/);
            if (numMatch) {
                const idx = parseInt(numMatch[1], 10) - 1;
                if (idx >= 0 && idx < activeSections.length) foundIndex = idx;
            } else if (targetKey.length >= 3) {
                const key = targetKey.replace(/s$/, '');
                foundIndex = activeSections.findIndex((s: any) =>
                    String(s?.name || '').toLowerCase().includes(key) || String(s?.id || '').toLowerCase().includes(key));
            }
            if (foundIndex !== -1) {
                const removed: any = activeSections[foundIndex];
                const removedTitle = removed.name || this.extractSectionTitle(removed);
                activeSections.splice(foundIndex, 1);
                currentConfig.pages[activePageIndex].sections = activeSections;
                return done(`🗑️ **Section Removed**: Removed **"${removedTitle}"**; your other ${activeSections.length} sections are unchanged.`, true);
            }
        }

        const hexThemeMatch = textInstruction.match(/^(?:please\s+)?(?:set|change|switch|make)\s+(?:the\s+)?(?:theme|brand|primary)?\s*colou?r\s+(?:to\s+)?(#[0-9a-f]{6}|#[0-9a-f]{3})\s*[.!]?$/i);
        if (hexThemeMatch) {
            currentConfig.brand.primaryColor = hexThemeMatch[1];
            return done(`🎨 **Theme Updated**: Primary colour set to ${hexThemeMatch[1]}.`, true);
        }

        const templateMatch = textInstruction.match(/\b(?:add|insert|use)\s+(?:an?\s+|the\s+)?(hero|features?|testimonials?|pricing|faq|stats?|team|contact|cta|landing(?:\s+page)?|thank[\s-]?you(?:\s+page)?)\s+template\b/i);
        if (templateMatch) {
            const tpl = this.buildTemplateSections(templateMatch[1], primaryColor, siteName, textInstruction);
            if (tpl) {
                activeSections.push(...tpl.sections);
                currentConfig.pages[activePageIndex].sections = activeSections;
                return done(`🧩 **${tpl.label} template added** to page **"${pageLabel}"**. Its text, numbers, names and images are sample placeholders; replace them with your real content before publishing.`, true);
            }
        }

        // 3. Live LLM edit
        const { client, companyName } = await this.resolveCompanyClient(companyId);
        const history = Array.isArray(params.history) ? params.history : [];
        const conversationHistoryText = history.length > 0
            ? history.slice(-6).map((m: any) => `${m.role === 'user' || m.sender === 'user' ? 'User' : 'AI Architect'}: "${String(m.text || m.content || '').replace(/\s+/g, ' ').trim().slice(0, 600)}"`).join('\n')
            : '  (New session)';
        const sectionsJson = JSON.stringify(activeSections);
        const sectionsBlock = sectionsJson.length <= 14000
            ? `CURRENT PAGE SECTIONS JSON (1-based order):\n${sectionsJson}`
            : `CURRENT PAGE SECTIONS (titles only, 1-based):\n${describeSections(activeSections) || '  (Empty canvas)'}`;

        const patchPrompt = `You are the 180 Workspace AI Website Architect editing an existing website.
WEBSITE: "${siteName}" (Business: "${companyName}")
BRAND: ${JSON.stringify(currentConfig.brand)}
PAGES: ${currentConfig.pages.map((p: any) => `"${p.name || p.id}" (${p.slug || '/'})`).join(', ')}
ACTIVE PAGE: "${pageLabel}" with ${activeSections.length} sections.
${sectionsBlock}

RECENT CONVERSATION:
${conversationHistoryText}

USER INSTRUCTION: "${textInstruction.replace(/"/g, '\\"')}"

${ELEMENT_SCHEMA_PROMPT}

Choose ONE action and return ONLY a JSON object (no markdown):
{
  "action": "ADD_SECTIONS" | "REPLACE_SECTION" | "REPLACE_PAGE" | "ADD_PAGE" | "REMOVE_SECTION" | "UPDATE_BRAND" | "REPLY_ONLY",
  "reply": "Short markdown summary of what you changed (or your answer/question for REPLY_ONLY)",
  "sections": [ /* section nodes for ADD_SECTIONS, REPLACE_PAGE, ADD_PAGE; exactly one for REPLACE_SECTION */ ],
  "index": 1,
  "page": { "name": "About", "slug": "/about" },
  "brand": { "primaryColor": "#hex", "secondaryColor": "#hex", "textColor": "#hex", "headingFont": "Inter", "bodyFont": "Inter" }
}
"index" is the 1-based section number for REPLACE_SECTION / REMOVE_SECTION, or the insert position for ADD_SECTIONS (omit to append). "page" is only for ADD_PAGE. "brand" is optional with any action.
Use REPLACE_SECTION to edit the text, layout or style of an existing section (return the full updated section). If the user replies "yes"/"do it", act on what you last proposed in the conversation. If the instruction is genuinely ambiguous, use REPLY_ONLY and ask one concise question.`;

        const parsed = await this.callModel(client, patchPrompt);
        const action = String(parsed.action || '').toUpperCase();
        const llmReply = sanitizeRichText(parsed.reply || '', 3000).trim();
        let changed = false;

        const brandPatch = sanitizeBrand(parsed.brand);
        if (Object.keys(brandPatch).length) {
            currentConfig.brand = { ...currentConfig.brand, ...brandPatch };
            if (brandPatch.bodyFont) currentConfig.brand.fontFamily = brandPatch.bodyFont;
            changed = true;
        }

        const needSections = () => {
            const s = sanitizeSections(parsed.sections);
            if (!s.length) throw new WebsiteBuilderError('AI_INVALID_OUTPUT', 'The AI response did not contain any valid sections.');
            return s;
        };
        const indexOf = (max: number) => {
            const n = Number(parsed.index);
            return Number.isInteger(n) && n >= 1 && n <= max ? n - 1 : -1;
        };

        switch (action) {
            case 'ADD_SECTIONS': {
                const s = needSections();
                const at = indexOf(activeSections.length + 1);
                if (at === -1) activeSections.push(...s); else activeSections.splice(at, 0, ...s);
                currentConfig.pages[activePageIndex].sections = activeSections;
                changed = true;
                break;
            }
            case 'REPLACE_SECTION': {
                const at = indexOf(activeSections.length);
                if (at === -1) throw new WebsiteBuilderError('AI_INVALID_OUTPUT', 'The AI referenced a section that does not exist.');
                activeSections.splice(at, 1, needSections()[0]);
                currentConfig.pages[activePageIndex].sections = activeSections;
                changed = true;
                break;
            }
            case 'REPLACE_PAGE': {
                currentConfig.pages[activePageIndex].sections = needSections();
                changed = true;
                break;
            }
            case 'ADD_PAGE': {
                const s = needSections();
                const name = sanitizePlainText(parsed.page?.name, 60) || 'New Page';
                let slug = String(parsed.page?.slug || name).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
                slug = `/${slug || 'page'}`;
                if (currentConfig.pages.some((p: any) => p.slug === slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
                const newPageId = `page_${slug.slice(1).replace(/-/g, '_')}_${Date.now().toString(36).slice(-4)}`;
                currentConfig.pages.push({ id: newPageId, name, slug, isEnabled: true, sections: s });
                currentConfig.activePageId = newPageId;
                changed = true;
                break;
            }
            case 'REMOVE_SECTION': {
                const at = indexOf(activeSections.length);
                if (at === -1) throw new WebsiteBuilderError('AI_INVALID_OUTPUT', 'The AI referenced a section that does not exist.');
                activeSections.splice(at, 1);
                currentConfig.pages[activePageIndex].sections = activeSections;
                changed = true;
                break;
            }
            case 'UPDATE_BRAND':
                if (!changed) throw new WebsiteBuilderError('AI_INVALID_OUTPUT', 'The AI did not return a valid brand change.');
                break;
            case 'REPLY_ONLY':
                if (!llmReply) throw new WebsiteBuilderError('AI_INVALID_OUTPUT', 'The AI returned an empty reply.');
                break;
            default:
                throw new WebsiteBuilderError('AI_INVALID_OUTPUT', `The AI returned an unknown action "${action || 'none'}".`);
        }

        return done(llmReply || 'Website updated.', changed);
    }

    async deleteEntity(entityId: string, companyId: string) {
        if (!companyId) throw new WebsiteBuilderError('COMPANY_REQUIRED', 'A company context is required.');
        const { count } = await basePrisma.website.deleteMany({ where: { id: entityId, companyId } });
        if (!count) return { success: false, message: 'Website not found.' };
        await basePrisma.domainRegistry.deleteMany({ where: { targetId: entityId, type: 'ADVERTISING_WEBSITE' } }).catch(() => {});
        return { success: true, message: 'Website deleted.' };
    }
}

export default WebsiteAIBuilderService;
