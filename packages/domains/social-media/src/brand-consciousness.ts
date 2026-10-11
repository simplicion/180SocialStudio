import { prisma } from '@workspace/db';
import { z } from 'zod';

/**
 * Brand consciousness: the per-project brand profile every agent (strategist, script, copy, critic, carousel, AI
 * Director) reads before producing anything.
 *
 * Rules this module enforces:
 * - Only what the user gave is stored. There are no invented values (no default positioning, colours, platforms,
 *   tone or audience written into the profile). Missing fields are reported through `completeness` so a UI or an
 *   agent can ask for them.
 * - Rendering code may fill gaps at use time with `resolveBrandRendering()` (neutral colours / Inter), and that
 *   result is never written back.
 * - Every read and write is scoped by companyId + projectId. A foreign or unknown project is a 404.
 *
 * Storage (no schema change): the existing BrandVoiceProfile row of the project.
 *   columns  tone, targetAudience, forbiddenWords, defaultHashtags, standardCtas, sampleViralPosts
 *   metadata.brand          everything else (v2 marker `v: 2`)
 *   metadata.contentPillars kept where the mobile app already reads/writes it
 */

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export const BRAND_TYPES = ['company', 'creator', 'agency'] as const;
export type BrandType = (typeof BRAND_TYPES)[number];

/** Platforms with a publish adapter (WS4). `x`→`twitter`, `youtube_shorts`→`youtube` are accepted as aliases. */
export const BRAND_PLATFORMS = ['instagram', 'facebook', 'youtube', 'linkedin', 'twitter', 'tiktok'] as const;
export type BrandPlatform = (typeof BRAND_PLATFORMS)[number];
const PLATFORM_ALIASES: Record<string, BrandPlatform> = {
    x: 'twitter', 'x/twitter': 'twitter', youtube_shorts: 'youtube', 'youtube-shorts': 'youtube', shorts: 'youtube',
    ig: 'instagram', fb: 'facebook', meta: 'facebook',
};

/** Caption presets the EditIR compiler can render (packages/video-contracts edit-ir.schema.ts). */
export const CAPTION_STYLE_PRESETS = ['HORMOZI_BOUNCE', 'ALI_ABDAAL_CLEAN', 'MINIMAL_SUBTITLE', 'BOLD_CENTER'] as const;
export type CaptionStylePreset = (typeof CAPTION_STYLE_PRESETS)[number];

/** Curated fonts. All are Google Fonts families (Inter included), so web, mobile and renderers can load them. */
export const BRAND_FONTS = [
    'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Raleway', 'Nunito', 'Work Sans', 'DM Sans',
    'Manrope', 'Plus Jakarta Sans', 'Outfit', 'Space Grotesk', 'IBM Plex Sans', 'Rubik', 'Barlow', 'Archivo',
    'Oswald', 'Bebas Neue', 'Anton', 'Playfair Display', 'Merriweather', 'Lora', 'Source Serif 4', 'DM Serif Display',
] as const;
export type BrandFont = (typeof BRAND_FONTS)[number];

export const HEX_COLOR = /^#[0-9A-F]{6}$/;
export const BRAND_COLOR_KEYS = ['primary', 'secondary', 'accent', 'background', 'text'] as const;
/** Colours a renderer always needs (neutral defaults exist for these; `secondary` never gets an invented default). */
export const RENDER_COLOR_KEYS = ['primary', 'accent', 'background', 'text'] as const;

export interface BrandRestrictions {
    forbiddenTopics: string[];
    claimsToAvoid: string[];
    regulatoryNotes: string | null;
}

export interface BrandPostingFrequency {
    perWeek: number | null;
    /** Posts per week per platform (canonical platform names). */
    platforms?: Record<string, number>;
}

export interface BrandObjectives {
    primary: string | null;
    secondary: string | null;
}

export const EDITING_AUTONOMY = ['AUTO', 'ASSISTED', 'MANUAL'] as const;
export const PUBLISHING_AUTONOMY = ['ASSISTED', 'MANUAL'] as const;
export interface BrandAutonomy {
    editing: (typeof EDITING_AUTONOMY)[number];
    publishing: (typeof PUBLISHING_AUTONOMY)[number];
}
/** Policy defaults (not brand data): the AI proposes edits and a person publishes. */
export const DEFAULT_BRAND_AUTONOMY: Readonly<BrandAutonomy> = Object.freeze({ editing: 'ASSISTED', publishing: 'MANUAL' });

export interface BrandColors {
    primary: string | null;
    secondary: string | null;
    accent: string | null;
    background: string | null;
    text: string | null;
}

export interface BrandCompleteness {
    /** 0–100, over required + recommended fields. */
    percent: number;
    /** True when no required field is missing. */
    isComplete: boolean;
    missingRequired: string[];
    missingRecommended: string[];
}

/** The stable object other workstreams consume. Unset scalars are `null`, unset lists are `[]`. */
export interface BrandConsciousness {
    projectId: string;
    projectName: string | null;
    brandName: string | null;
    brandType: BrandType | null;
    /** http(s) URL of the brand's website. */
    website: string | null;
    industry: string | null;
    /** ISO-3166 alpha-2 (upper case). */
    country: string | null;
    /** BCP-47 language tag (canonical case, e.g. en-US). */
    language: string | null;
    positioning: string | null;
    tagline: string | null;
    description: string | null;
    ideation: string | null;
    ideology: string | null;
    colors: BrandColors;
    logoUrl: string | null;
    font: BrandFont | null;
    tone: string | null;
    audience: string | null;
    forbiddenWords: string[];
    ctas: string[];
    hashtags: string[];
    contentPillars: string[];
    sampleViralPosts: string[];
    targetPlatforms: BrandPlatform[];
    captionStylePreset: CaptionStylePreset | null;
    watermarkEnabled: boolean | null;
    customGuidelines: string | null;
    restrictions: BrandRestrictions;
    postingFrequency: BrandPostingFrequency;
    objectives: BrandObjectives;
    /** Always present: the stored choice or the policy default (editing ASSISTED, publishing MANUAL). */
    autonomy: BrandAutonomy;
    updatedAt: string | null;
    completeness: BrandCompleteness;
}

/**
 * @deprecated Pre-v2 field names, exposed as non-enumerable read-only getters so code written against the old shape
 * keeps working during the migration. They are not part of the API response (JSON) and hold the same user-given
 * values (null when missing). New code must use the canonical names.
 */
export interface LegacyBrandAliases {
    readonly brandPositioning: string | null;
    readonly brandTagline: string | null;
    readonly brandIdeation: string | null;
    readonly brandIdeology: string | null;
    readonly brandColors: BrandColors;
    readonly brandLogo: string | null;
    readonly brandFont: string | null;
    readonly targetAudience: string | null;
    readonly standardCtas: string[];
    readonly defaultHashtags: string[];
}

/** Returned by getProjectBrandConsciousness: the plain object plus a non-enumerable prompt builder (and legacy getters). */
export type BrandConsciousnessWithPrompt = BrandConsciousness & LegacyBrandAliases & { toPromptContext(opts?: PromptContextOptions): string };

export class BrandConsciousnessError extends Error {
    constructor(public status: number, public code: string, message: string, public details?: { path: string; message: string }[]) {
        super(message);
        this.name = 'BrandConsciousnessError';
    }
}

// ─── Validation (zod) ────────────────────────────────────────────────────────

const optText = (max: number) =>
    z.string().trim().max(max, `must be at most ${max} characters`).transform((s) => (s.length ? s : null)).nullable().optional();

const hexColor = z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => s === '' || HEX_COLOR.test(s), 'must be a hex colour like #1A2B3C')
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

const cleanList = (items: string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of items) {
        const v = raw.trim();
        if (!v || seen.has(v.toLowerCase())) continue;
        seen.add(v.toLowerCase());
        out.push(v);
    }
    return out;
};

const textList = (maxItems: number, maxLen: number) =>
    z.array(z.string().max(maxLen, `each entry must be at most ${maxLen} characters`)).max(maxItems, `at most ${maxItems} entries`).transform(cleanList).nullable().optional();

const hashtagList = z
    .array(z.string().max(100, 'each hashtag must be at most 100 characters'))
    .max(30, 'at most 30 hashtags')
    .transform((items) => cleanList(items.map((h) => h.trim().replace(/^#+/, '')).filter(Boolean).map((h) => `#${h}`)))
    .refine((items) => items.every((h) => /^#[\p{L}\p{N}_]+$/u.test(h)), 'hashtags may contain only letters, numbers and _')
    .nullable()
    .optional();

const platformList = z
    .array(z.string())
    .max(BRAND_PLATFORMS.length * 2)
    .transform((items) => cleanList(items.map((p) => { const k = p.trim().toLowerCase(); return PLATFORM_ALIASES[k] || k; })))
    .pipe(z.array(z.enum(BRAND_PLATFORMS, { message: `platform must be one of ${BRAND_PLATFORMS.join(', ')}` })))
    .nullable()
    .optional();

const fontField = z
    .string()
    .trim()
    .transform((s) => (s === '' ? null : (BRAND_FONTS.find((f) => f.toLowerCase() === s.toLowerCase()) ?? s)))
    .refine((s) => s === null || (BRAND_FONTS as readonly string[]).includes(s), `font must be one of: ${BRAND_FONTS.join(', ')}`)
    .nullable()
    .optional();

const logoUrl = z
    .string()
    .trim()
    .max(2048)
    .transform((s) => (s === '' ? null : s))
    .refine((s) => s === null || /^https?:\/\/[^\s]+$/i.test(s), 'logoUrl must be an http(s) URL; upload files with POST .../brand-consciousness/logo')
    .nullable()
    .optional();

const enumOrEmpty = <T extends readonly [string, ...string[]]>(values: T) =>
    z.union([z.literal('').transform(() => null), z.enum(values)]).nullable().optional();

const httpUrl = (field: string) =>
    z
        .string()
        .trim()
        .max(2048)
        .transform((s) => (s === '' ? null : s))
        .refine((s) => {
            if (s === null) return true;
            if (/\s/.test(s)) return false;
            try {
                const u = new URL(s);
                return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
            } catch {
                return false;
            }
        }, `${field} must be an http(s) URL`)
        .nullable()
        .optional();

const countryCode = z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => s === '' || /^[A-Z]{2}$/.test(s), 'country must be an ISO-3166 alpha-2 code like US or IN')
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

/** BCP-47 tag canonicalised by Intl (en-us -> en-US), or null when it is not a valid tag. */
export function canonicalLanguageTag(tag: string): string | null {
    const t = String(tag || '').trim();
    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(t)) return null;
    try {
        return Intl.getCanonicalLocales(t)[0] || null;
    } catch {
        return null;
    }
}

const languageTag = z
    .string()
    .trim()
    .refine((s) => s === '' || canonicalLanguageTag(s) !== null, 'language must be a BCP-47 tag like en, en-US or hi-IN')
    .transform((s) => (s === '' ? null : canonicalLanguageTag(s)))
    .nullable()
    .optional();

const perWeek = z.number().min(0, 'must be 0 or more').max(100, 'must be at most 100 posts a week');

const platformFrequency = z.record(z.string(), perWeek).transform((rec, ctx) => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(rec)) {
        const key = PLATFORM_ALIASES[k.trim().toLowerCase()] || k.trim().toLowerCase();
        if (!(BRAND_PLATFORMS as readonly string[]).includes(key)) {
            ctx.addIssue({ code: 'custom', message: `platform must be one of ${BRAND_PLATFORMS.join(', ')}`, path: [k] });
            continue;
        }
        out[key] = v;
    }
    return out;
});

/** Partial update. Absent = unchanged; `null`/`""`/`[]` = clear. */
export const brandPatchSchema = z
    .object({
        brandName: optText(120),
        brandType: enumOrEmpty(BRAND_TYPES),
        website: httpUrl('website'),
        industry: optText(120),
        country: countryCode,
        language: languageTag,
        positioning: optText(500),
        tagline: optText(160),
        description: optText(2000),
        ideation: optText(2000),
        ideology: optText(2000),
        colors: z
            .object({ primary: hexColor, secondary: hexColor, accent: hexColor, background: hexColor, text: hexColor })
            .strict()
            .nullable()
            .optional(),
        logoUrl,
        font: fontField,
        tone: optText(200),
        audience: optText(1000),
        forbiddenWords: textList(100, 60),
        ctas: textList(20, 200),
        hashtags: hashtagList,
        contentPillars: textList(12, 80),
        sampleViralPosts: textList(10, 3000),
        targetPlatforms: platformList,
        captionStylePreset: enumOrEmpty(CAPTION_STYLE_PRESETS),
        watermarkEnabled: z.boolean().nullable().optional(),
        customGuidelines: optText(4000),
        restrictions: z
            .object({ forbiddenTopics: textList(50, 120), claimsToAvoid: textList(50, 200), regulatoryNotes: optText(2000) })
            .strict()
            .nullable()
            .optional(),
        postingFrequency: z
            .object({ perWeek: perWeek.nullable().optional(), platforms: platformFrequency.nullable().optional() })
            .strict()
            .nullable()
            .optional(),
        objectives: z.object({ primary: optText(300), secondary: optText(300) }).strict().nullable().optional(),
        autonomy: z
            .object({ editing: z.enum(EDITING_AUTONOMY).optional(), publishing: z.enum(PUBLISHING_AUTONOMY).optional() })
            .strict()
            .nullable()
            .optional(),
    })
    .strict();

export type BrandPatch = z.output<typeof brandPatchSchema>;
export type BrandPatchInput = z.input<typeof brandPatchSchema>;

/** Older / alternative field names still sent by existing clients, mapped to the canonical ones. */
const LEGACY_ALIASES: Record<string, keyof BrandPatchInput> = {
    brandPositioning: 'positioning',
    brandTagline: 'tagline',
    brandDescription: 'description',
    brandIdeation: 'ideation',
    brandIdeology: 'ideology',
    brandColors: 'colors',
    brandLogo: 'logoUrl',
    brandFont: 'font',
    targetAudience: 'audience',
    defaultHashtags: 'hashtags',
    standardCtas: 'ctas',
};

function applyAliases(input: Record<string, any>): Record<string, any> {
    const out: Record<string, any> = { ...input };
    for (const [legacy, canonical] of Object.entries(LEGACY_ALIASES)) {
        if (legacy in out) {
            if (!(canonical in out)) out[canonical] = out[legacy];
            delete out[legacy];
        }
    }
    return out;
}

function toValidationError(err: z.ZodError): BrandConsciousnessError {
    const details = err.issues.map((i) => ({ path: i.path.join('.') || '(body)', message: i.message }));
    return new BrandConsciousnessError(400, 'VALIDATION_FAILED', details.map((d) => `${d.path}: ${d.message}`).join('; '), details);
}

/** Validates a PUT body. Unknown fields are rejected so typos surface instead of being silently dropped. */
export function parseBrandPatch(input: unknown): BrandPatch {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new BrandConsciousnessError(400, 'VALIDATION_FAILED', 'Body must be a JSON object', [{ path: '(body)', message: 'expected object' }]);
    }
    const parsed = brandPatchSchema.safeParse(applyAliases(input as Record<string, any>));
    if (!parsed.success) throw toValidationError(parsed.error);
    return parsed.data;
}

const PATCH_KEYS = Object.keys(brandPatchSchema.shape) as (keyof BrandPatchInput)[];
const LEGACY_FLAT_META_KEYS = [
    'brandType', 'brandPositioning', 'brandTagline', 'brandIdeation', 'brandIdeology', 'brandColors', 'brandLogo',
    'brandFont', 'captionStylePreset', 'watermarkEnabled', 'targetPlatforms', 'customGuidelines',
];

function pickBrandKeys(src: any): Record<string, any> {
    const out: Record<string, any> = {};
    if (!src || typeof src !== 'object') return out;
    const aliased = applyAliases(src);
    for (const k of PATCH_KEYS) if (aliased[k] !== undefined) out[k] = aliased[k];
    return out;
}

/**
 * Brand fields from a `POST /projects` body. Accepts the mobile shape (`brandProfile{tone,targetAudience,...,metadata}`),
 * the web shape (top-level `brandPositioning`, `brandColors`, ...), canonical top-level names, and an optional
 * `brandConsciousness{...}` object; later sources win. Returns the validated patch plus the non-brand metadata keys
 * (e.g. the mobile app's `hookStyle`, `hooks`) that must be preserved.
 */
export function brandPatchFromCreateBody(body: any): { patch: BrandPatch; extraMetadata: Record<string, any> } {
    const bp = body?.brandProfile && typeof body.brandProfile === 'object' ? body.brandProfile : {};
    const meta = bp.metadata && typeof bp.metadata === 'object' && !Array.isArray(bp.metadata) ? { ...bp.metadata } : {};
    const extraMetadata: Record<string, any> = { ...meta };
    for (const k of [...LEGACY_FLAT_META_KEYS, 'brand', 'contentPillars']) delete extraMetadata[k];

    // Top-level `description` is the project description; brand description comes from brandDescription / brand.description.
    const { description: _projectDescription, ...topLevel } = body || {};
    const candidate = {
        ...pickBrandKeys(meta),
        ...pickBrandKeys(bp),
        ...pickBrandKeys(topLevel),
        ...pickBrandKeys(body?.brandConsciousness),
    };
    const parsed = brandPatchSchema.safeParse(candidate);
    if (!parsed.success) throw toValidationError(parsed.error);
    return { patch: parsed.data, extraMetadata };
}

// ─── Reading stored rows ─────────────────────────────────────────────────────

/** Values the pre-v2 code wrote when the user gave nothing. On legacy rows they are treated as "not provided". */
const LEGACY_FABRICATED = {
    tone: ['Professional & Insightful'],
    audience: ['General Audience', 'General Audience & Industry Peers', 'Target Audience'],
    positioning: ['Authoritative Industry Leader', 'Industry Authority'],
    brandType: ['company'],
    colors: { primary: '#6366F1', accent: '#EC4899', background: '#090A0E', text: '#FFFFFF' } as Record<string, string>,
    font: ['Inter'],
    captionStylePreset: ['HORMOZI_BOUNCE'],
    targetPlatforms: ['instagram,youtube_shorts,linkedin,twitter'],
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? cleanList(v.filter((x) => typeof x === 'string')) : []);
const hexOrNull = (v: unknown): string | null => { const s = str(v)?.toUpperCase() ?? null; return s && HEX_COLOR.test(s) ? s : null; };
const oneOf = <T extends string>(values: readonly T[], v: unknown): T | null => (typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null);

function metaObject(row: any): Record<string, any> {
    let m = row?.metadata;
    if (typeof m === 'string') { try { m = JSON.parse(m); } catch { m = {}; } }
    return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
}

/** Brand fields as stored (v2), or recovered from a legacy row with fabricated defaults removed. */
function storedBrand(row: any): Record<string, any> {
    const meta = metaObject(row);
    if (meta.brand && typeof meta.brand === 'object') return meta.brand;
    // Legacy flat keys (written by the pre-v2 wizard). Drop values that were defaults, not user input.
    const drop = (v: unknown, fakes: string[]) => (typeof v === 'string' && fakes.includes(v) ? null : v);
    const colors: Record<string, any> = {};
    for (const k of BRAND_COLOR_KEYS) {
        const c = hexOrNull(meta.brandColors?.[k]);
        colors[k] = c && c !== LEGACY_FABRICATED.colors[k] ? c : null;
    }
    const platforms = Array.isArray(meta.targetPlatforms) ? meta.targetPlatforms : [];
    return {
        brandType: drop(meta.brandType, LEGACY_FABRICATED.brandType),
        positioning: drop(meta.brandPositioning, LEGACY_FABRICATED.positioning),
        tagline: meta.brandTagline,
        ideation: meta.brandIdeation,
        ideology: meta.brandIdeology,
        colors,
        logoUrl: meta.brandLogo,
        font: drop(meta.brandFont, LEGACY_FABRICATED.font),
        captionStylePreset: drop(meta.captionStylePreset, LEGACY_FABRICATED.captionStylePreset),
        // The legacy default was `true` for everyone, so a stored `true` says nothing about the user's choice.
        watermarkEnabled: meta.watermarkEnabled === false ? false : null,
        targetPlatforms: LEGACY_FABRICATED.targetPlatforms.includes(platforms.join(',')) ? [] : platforms,
        customGuidelines: meta.customGuidelines,
        legacy: true,
    };
}

function normalizePlatforms(v: unknown): BrandPlatform[] {
    return cleanList(strList(v).map((p) => PLATFORM_ALIASES[p.toLowerCase()] || p.toLowerCase())).filter((p): p is BrandPlatform =>
        (BRAND_PLATFORMS as readonly string[]).includes(p),
    );
}

export const REQUIRED_BRAND_FIELDS = ['brandType', 'positioning', 'description', 'tone', 'audience', 'colors.primary', 'targetPlatforms'] as const;
export const RECOMMENDED_BRAND_FIELDS = [
    'brandName', 'tagline', 'ideology', 'colors.secondary', 'colors.accent', 'colors.background', 'colors.text', 'logoUrl', 'font', 'ctas',
    'hashtags', 'contentPillars', 'captionStylePreset', 'website', 'industry', 'country', 'language', 'objectives.primary',
    'postingFrequency.perWeek',
] as const;

function isFilled(b: Omit<BrandConsciousness, 'completeness'>, path: string): boolean {
    const v = path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), b);
    return Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined;
}

function readPlatformFrequency(v: unknown): Record<string, number> | undefined {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
        if ((BRAND_PLATFORMS as readonly string[]).includes(k) && typeof n === 'number' && Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return Object.keys(out).length ? out : undefined;
}

function readAutonomy(v: any): BrandAutonomy {
    return {
        editing: oneOf(EDITING_AUTONOMY, v?.editing) ?? DEFAULT_BRAND_AUTONOMY.editing,
        publishing: oneOf(PUBLISHING_AUTONOMY, v?.publishing) ?? DEFAULT_BRAND_AUTONOMY.publishing,
    };
}

/** Reads the stored v2 objects (and tolerates the short-lived list/string shapes by ignoring them). */
function readRestrictions(v: any): BrandRestrictions {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    return { forbiddenTopics: strList(o.forbiddenTopics), claimsToAvoid: strList(o.claimsToAvoid), regulatoryNotes: str(o.regulatoryNotes) };
}
function readPostingFrequency(v: any): BrandPostingFrequency {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const n = typeof o.perWeek === 'number' && Number.isFinite(o.perWeek) && o.perWeek >= 0 ? o.perWeek : null;
    const platforms = readPlatformFrequency(o.platforms);
    return platforms ? { perWeek: n, platforms } : { perWeek: n };
}
function readObjectives(v: any): BrandObjectives {
    const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    return { primary: str(o.primary), secondary: str(o.secondary) };
}

export function computeBrandCompleteness(b: Omit<BrandConsciousness, 'completeness'>): BrandCompleteness {
    const missingRequired = REQUIRED_BRAND_FIELDS.filter((f) => !isFilled(b, f));
    const missingRecommended = RECOMMENDED_BRAND_FIELDS.filter((f) => !isFilled(b, f));
    const total = REQUIRED_BRAND_FIELDS.length + RECOMMENDED_BRAND_FIELDS.length;
    const filled = total - missingRequired.length - missingRecommended.length;
    return {
        percent: Math.round((filled / total) * 100),
        isComplete: missingRequired.length === 0,
        missingRequired: [...missingRequired],
        missingRecommended: [...missingRecommended],
    };
}

/** Pure: builds the public object from the project row and its BrandVoiceProfile row (either may lack fields). */
export function readBrandConsciousness(project: { id: string; name?: string | null }, row: any | null): BrandConsciousness {
    const brand = row ? storedBrand(row) : {};
    const meta = row ? metaObject(row) : {};
    const legacy = !!(brand as any).legacy;
    const colTone = str(row?.tone);
    const colAudience = str(row?.targetAudience);
    const base: Omit<BrandConsciousness, 'completeness'> = {
        projectId: project.id,
        projectName: str(project.name),
        brandName: str(brand.brandName),
        brandType: oneOf(BRAND_TYPES, brand.brandType),
        website: str(brand.website),
        industry: str(brand.industry),
        country: typeof brand.country === 'string' && /^[A-Z]{2}$/.test(brand.country) ? brand.country : null,
        language: typeof brand.language === 'string' ? canonicalLanguageTag(brand.language) : null,
        positioning: str(brand.positioning),
        tagline: str(brand.tagline),
        description: str(brand.description),
        ideation: str(brand.ideation),
        ideology: str(brand.ideology),
        colors: {
            primary: hexOrNull(brand.colors?.primary),
            secondary: hexOrNull(brand.colors?.secondary),
            accent: hexOrNull(brand.colors?.accent),
            background: hexOrNull(brand.colors?.background),
            text: hexOrNull(brand.colors?.text),
        },
        logoUrl: str(brand.logoUrl),
        font: oneOf(BRAND_FONTS, brand.font),
        tone: legacy && colTone && LEGACY_FABRICATED.tone.includes(colTone) ? null : colTone,
        audience: legacy && colAudience && LEGACY_FABRICATED.audience.includes(colAudience) ? null : colAudience,
        forbiddenWords: strList(row?.forbiddenWords),
        ctas: strList(row?.standardCtas),
        hashtags: strList(row?.defaultHashtags),
        contentPillars: strList(meta.contentPillars),
        sampleViralPosts: strList(row?.sampleViralPosts),
        targetPlatforms: normalizePlatforms(brand.targetPlatforms),
        captionStylePreset: oneOf(CAPTION_STYLE_PRESETS, brand.captionStylePreset),
        watermarkEnabled: typeof brand.watermarkEnabled === 'boolean' ? brand.watermarkEnabled : null,
        customGuidelines: str(brand.customGuidelines),
        restrictions: readRestrictions(brand.restrictions),
        postingFrequency: readPostingFrequency(brand.postingFrequency),
        objectives: readObjectives(brand.objectives),
        autonomy: readAutonomy(brand.autonomy),
        updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
    return { ...base, completeness: computeBrandCompleteness(base) };
}

// ─── Writing ─────────────────────────────────────────────────────────────────

/**
 * Pure: merges a validated patch into an existing BrandVoiceProfile row (or none) and returns the column values and
 * metadata to persist. Only fields present in the patch change; nothing is filled in.
 */
export function mergeBrandPatch(
    project: { id: string; name?: string | null },
    row: any | null,
    patch: BrandPatch,
    extraMetadata: Record<string, any> = {},
): { columns: Record<string, any>; metadata: Record<string, any> } {
    const current = readBrandConsciousness(project, row);
    const has = (k: keyof BrandPatch) => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;
    const pick = <K extends keyof BrandPatch>(k: K, cur: any) => (has(k) ? (patch[k] ?? null) : cur);
    const list = <K extends keyof BrandPatch>(k: K, cur: string[]) => (has(k) ? ((patch[k] as string[] | null) ?? []) : cur);

    const colors = { ...current.colors };
    if (has('colors')) {
        if (patch.colors === null) for (const k of BRAND_COLOR_KEYS) colors[k] = null;
        else for (const k of BRAND_COLOR_KEYS) if (patch.colors && patch.colors[k] !== undefined) colors[k] = patch.colors[k] ?? null;
    }

    // Nested objects merge per key like `colors`; `null` clears the whole object.
    const restrictions: BrandRestrictions = { ...current.restrictions };
    if (has('restrictions')) {
        const r = patch.restrictions;
        if (r === null) Object.assign(restrictions, { forbiddenTopics: [], claimsToAvoid: [], regulatoryNotes: null });
        else if (r) {
            if (r.forbiddenTopics !== undefined) restrictions.forbiddenTopics = r.forbiddenTopics ?? [];
            if (r.claimsToAvoid !== undefined) restrictions.claimsToAvoid = r.claimsToAvoid ?? [];
            if (r.regulatoryNotes !== undefined) restrictions.regulatoryNotes = r.regulatoryNotes ?? null;
        }
    }
    const postingFrequency: BrandPostingFrequency = { ...current.postingFrequency };
    if (has('postingFrequency')) {
        const f = patch.postingFrequency;
        if (f === null) {
            postingFrequency.perWeek = null;
            delete postingFrequency.platforms;
        } else if (f) {
            if (f.perWeek !== undefined) postingFrequency.perWeek = f.perWeek ?? null;
            if (f.platforms !== undefined) {
                if (f.platforms && Object.keys(f.platforms).length) postingFrequency.platforms = f.platforms;
                else delete postingFrequency.platforms;
            }
        }
    }
    const objectives: BrandObjectives = { ...current.objectives };
    if (has('objectives')) {
        const o = patch.objectives;
        if (o === null) Object.assign(objectives, { primary: null, secondary: null });
        else if (o) {
            if (o.primary !== undefined) objectives.primary = o.primary ?? null;
            if (o.secondary !== undefined) objectives.secondary = o.secondary ?? null;
        }
    }
    // Autonomy is stored only once the user chooses it; `null` goes back to the policy default.
    const prevAutonomy = row ? (storedBrand(row) as any).autonomy : undefined;
    let autonomy: Partial<BrandAutonomy> | null = prevAutonomy && typeof prevAutonomy === 'object' ? { ...prevAutonomy } : null;
    if (has('autonomy')) {
        if (patch.autonomy === null) autonomy = null;
        else if (patch.autonomy) {
            autonomy = { ...(autonomy || {}) };
            if (patch.autonomy.editing) autonomy.editing = patch.autonomy.editing;
            if (patch.autonomy.publishing) autonomy.publishing = patch.autonomy.publishing;
        }
    }

    const brand = {
        v: 2,
        brandName: pick('brandName', current.brandName),
        brandType: pick('brandType', current.brandType),
        website: pick('website', current.website),
        industry: pick('industry', current.industry),
        country: pick('country', current.country),
        language: pick('language', current.language),
        positioning: pick('positioning', current.positioning),
        tagline: pick('tagline', current.tagline),
        description: pick('description', current.description),
        ideation: pick('ideation', current.ideation),
        ideology: pick('ideology', current.ideology),
        colors,
        logoUrl: pick('logoUrl', current.logoUrl),
        font: pick('font', current.font),
        targetPlatforms: list('targetPlatforms', current.targetPlatforms),
        captionStylePreset: pick('captionStylePreset', current.captionStylePreset),
        watermarkEnabled: pick('watermarkEnabled', current.watermarkEnabled),
        customGuidelines: pick('customGuidelines', current.customGuidelines),
        restrictions,
        postingFrequency,
        objectives,
        ...(autonomy ? { autonomy } : {}),
        updatedAt: new Date().toISOString(),
    };

    const oldMeta = row ? metaObject(row) : {};
    const metadata: Record<string, any> = { ...oldMeta, ...extraMetadata };
    for (const k of LEGACY_FLAT_META_KEYS) delete metadata[k];
    metadata.brand = brand;
    metadata.contentPillars = list('contentPillars', current.contentPillars);

    const columns = {
        // Non-null columns with DB defaults: write '' explicitly so the schema default is never stored as user data.
        tone: pick('tone', current.tone) ?? '',
        targetAudience: pick('audience', current.audience) ?? '',
        forbiddenWords: list('forbiddenWords', current.forbiddenWords),
        defaultHashtags: list('hashtags', current.hashtags),
        standardCtas: list('ctas', current.ctas),
        sampleViralPosts: list('sampleViralPosts', current.sampleViralPosts),
    };
    return { columns, metadata };
}

// ─── Prompt context and rendering defaults ───────────────────────────────────

export interface PromptContextOptions {
    /** Include colours / font / logo / caption preset lines (for visual agents). Default true. */
    includeVisual?: boolean;
    /** Add a line naming fields the brand has not provided, telling the model not to invent them. Default true. */
    includeMissing?: boolean;
    /** Per-field character cap. Default 400. */
    maxFieldChars?: number;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Concise, null-free brand block for LLM prompts. */
export function toBrandPromptContext(b: BrandConsciousness, opts: PromptContextOptions = {}): string {
    const { includeVisual = true, includeMissing = true, maxFieldChars = 400 } = opts;
    const lines: string[] = [];
    const add = (label: string, v: string | null | undefined) => { if (v) lines.push(`${label}: ${clip(v, maxFieldChars)}`); };
    const name = b.brandName || b.projectName;
    add('Brand', name ? (b.brandType ? `${name} (${b.brandType})` : name) : b.brandType ? `(${b.brandType})` : null);
    add('Website', b.website);
    add('Industry', b.industry);
    add('Market', [b.country ? `country ${b.country}` : '', b.language ? `language ${b.language}` : ''].filter(Boolean).join(', ') || null);
    add('Positioning', b.positioning);
    add('Tagline', b.tagline ? `"${b.tagline}"` : null);
    add('Description', b.description);
    add('Ideation', b.ideation);
    add('Ideology / values', b.ideology);
    add('Audience', b.audience);
    add('Tone', b.tone);
    if (b.restrictions.forbiddenTopics.length) add('Never cover these topics', b.restrictions.forbiddenTopics.join('; '));
    if (b.restrictions.claimsToAvoid.length) add('Never make these claims', b.restrictions.claimsToAvoid.join('; '));
    add('Regulatory notes (must follow)', b.restrictions.regulatoryNotes);
    if (b.postingFrequency.perWeek != null || b.postingFrequency.platforms) {
        const per = b.postingFrequency.platforms ? Object.entries(b.postingFrequency.platforms).map(([p, n]) => `${p} ${n}/week`).join(', ') : '';
        add('Posting frequency', [b.postingFrequency.perWeek != null ? `${b.postingFrequency.perWeek} posts/week` : '', per].filter(Boolean).join('; '));
    }
    add('Growth objectives', [b.objectives.primary ? `primary: ${b.objectives.primary}` : '', b.objectives.secondary ? `secondary: ${b.objectives.secondary}` : ''].filter(Boolean).join('; ') || null);
    if (b.targetPlatforms.length) add('Target platforms', b.targetPlatforms.join(', '));
    if (b.contentPillars.length) add('Content pillars', b.contentPillars.join('; '));
    if (b.ctas.length) add('Preferred CTAs', b.ctas.map((c) => `"${c}"`).join('; '));
    if (b.hashtags.length) add('Brand hashtags', b.hashtags.join(' '));
    if (b.forbiddenWords.length) add('Never use these words', b.forbiddenWords.join(', '));
    if (includeVisual) {
        const colors = BRAND_COLOR_KEYS.filter((k) => b.colors[k]).map((k) => `${k} ${b.colors[k]}`);
        if (colors.length) add('Colours', colors.join(', '));
        add('Font', b.font);
        add('Caption style', b.captionStylePreset);
        if (b.logoUrl) add('Logo', b.watermarkEnabled === false ? 'provided (no watermark)' : 'provided');
    }
    add('Guidelines', b.customGuidelines);
    if (includeMissing) {
        const missing = b.completeness.missingRequired.filter((f) => includeVisual || !f.startsWith('colors.'));
        if (missing.length) lines.push(`Not provided by the brand (do not invent these): ${missing.join(', ')}`);
    }
    return lines.join('\n');
}

/** Neutral values for rendering only. Never persisted, never shown as the brand's choice. */
export const BRAND_RENDER_DEFAULTS = {
    colors: { primary: '#111111', accent: '#666666', background: '#FFFFFF', text: '#111111' },
    font: 'Inter' as BrandFont,
    captionStylePreset: 'MINIMAL_SUBTITLE' as CaptionStylePreset,
    watermarkEnabled: false,
};

/** Fills visual gaps with neutral defaults for a renderer, and says which ones were filled. */
export function resolveBrandRendering(b: BrandConsciousness) {
    const usedDefaults: string[] = [];
    const colors = {} as Record<(typeof RENDER_COLOR_KEYS)[number], string>;
    for (const k of RENDER_COLOR_KEYS) {
        colors[k] = b.colors[k] ?? BRAND_RENDER_DEFAULTS.colors[k];
        if (!b.colors[k]) usedDefaults.push(`colors.${k}`);
    }
    if (!b.font) usedDefaults.push('font');
    if (!b.captionStylePreset) usedDefaults.push('captionStylePreset');
    if (b.watermarkEnabled === null) usedDefaults.push('watermarkEnabled');
    return {
        colors,
        /** The brand's own secondary colour, or null (no default is invented for it). */
        secondaryColor: b.colors.secondary ?? null,
        font: b.font ?? BRAND_RENDER_DEFAULTS.font,
        captionStylePreset: b.captionStylePreset ?? BRAND_RENDER_DEFAULTS.captionStylePreset,
        watermarkEnabled: b.watermarkEnabled ?? BRAND_RENDER_DEFAULTS.watermarkEnabled,
        logoUrl: b.logoUrl,
        usedDefaults,
    };
}

const LEGACY_GETTERS: Record<keyof LegacyBrandAliases, keyof BrandConsciousness> = {
    brandPositioning: 'positioning', brandTagline: 'tagline', brandIdeation: 'ideation', brandIdeology: 'ideology',
    brandColors: 'colors', brandLogo: 'logoUrl', brandFont: 'font', targetAudience: 'audience', standardCtas: 'ctas',
    defaultHashtags: 'hashtags',
};

function withPrompt(b: BrandConsciousness): BrandConsciousnessWithPrompt {
    Object.defineProperty(b, 'toPromptContext', {
        value: (opts?: PromptContextOptions) => toBrandPromptContext(b, opts),
        enumerable: false,
    });
    for (const [legacy, canonical] of Object.entries(LEGACY_GETTERS)) {
        Object.defineProperty(b, legacy, { get: () => b[canonical], enumerable: false });
    }
    return b as BrandConsciousnessWithPrompt;
}

// ─── Data access ─────────────────────────────────────────────────────────────

/** Minimal Prisma surface, so tests can pass an in-memory stand-in. */
export interface BrandDb {
    project: { findFirst: (args: any) => Promise<any> };
    brandVoiceProfile: {
        findFirst: (args: any) => Promise<any>;
        create: (args: any) => Promise<any>;
        update: (args: any) => Promise<any>;
    };
}

const defaultDb = () => prisma as unknown as BrandDb;

async function findOwnedProject(db: BrandDb, projectId: string, companyId: string) {
    if (!companyId) throw new BrandConsciousnessError(401, 'COMPANY_REQUIRED', 'Company context required');
    if (!projectId || typeof projectId !== 'string') throw new BrandConsciousnessError(400, 'PROJECT_ID_REQUIRED', 'projectId is required');
    const project = await db.project.findFirst({
        where: { id: projectId, companyId, projectType: 'social_media', deletedAt: null },
        select: { id: true, name: true, companyId: true },
    });
    if (!project) throw new BrandConsciousnessError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    return project;
}

/**
 * THE function other workstreams call. Returns the user's brand profile (no invented values) with `completeness`
 * and a non-enumerable `toPromptContext()`.
 */
export async function getProjectBrandConsciousness(projectId: string, companyId: string, db: BrandDb = defaultDb()): Promise<BrandConsciousnessWithPrompt> {
    const project = await findOwnedProject(db, projectId, companyId);
    const row = await db.brandVoiceProfile.findFirst({ where: { projectId: project.id, companyId } });
    return withPrompt(readBrandConsciousness(project, row));
}

/** Validates `input` (PUT body) and applies it as a partial update. */
export async function updateProjectBrandConsciousness(
    projectId: string,
    companyId: string,
    input: unknown,
    db: BrandDb = defaultDb(),
): Promise<BrandConsciousnessWithPrompt> {
    const patch = parseBrandPatch(input);
    return applyProjectBrandPatch(projectId, companyId, patch, db);
}

/** Applies an already-validated patch (used by the PUT route, logo upload and project creation). */
export async function applyProjectBrandPatch(
    projectId: string,
    companyId: string,
    patch: BrandPatch,
    db: BrandDb = defaultDb(),
    extraMetadata: Record<string, any> = {},
): Promise<BrandConsciousnessWithPrompt> {
    const project = await findOwnedProject(db, projectId, companyId);
    const row = await db.brandVoiceProfile.findFirst({ where: { projectId: project.id, companyId } });
    const { columns, metadata } = mergeBrandPatch(project, row, patch, extraMetadata);
    const saved = row
        ? await db.brandVoiceProfile.update({ where: { id: row.id }, data: { ...columns, metadata } })
        : await db.brandVoiceProfile.create({ data: { companyId, projectId: project.id, ...columns, metadata } });
    return withPrompt(readBrandConsciousness(project, saved));
}
