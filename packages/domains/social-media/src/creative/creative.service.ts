import crypto from 'crypto';
import { AgentEventStore, createAgentRunEmitter, getDefaultAgentEventStore } from '@workspace/ai/agent-runs';
import { z } from 'zod';
import type { CreativeBrand } from './brand';
import { toCreativeBrand } from './brand';
import { compileCarousel, compileSingleSlide, type RenderedSlide } from './carousel-compiler';
import { designCarousel, designStaticPost, redesignSlide, type CreativeLlm } from './carousel-design-agent';
import { CAROUSEL_FORMATS, SlideSchema, MAX_SLIDES, MIN_SLIDES, normalizeSlides, type CarouselFormat, type Slide } from './carousel-schema';
import { CreativeError } from './creative-errors';
import { fetchImage, planImageSource, type ImagePlan } from './image-agent';
import { resolveImageProviders, type ImageAttribution, type ImageProviderChain } from './image-providers';
import { buildPhotoPrompt } from './photo-prompt';
import { resolveFont } from './fonts';
import { designThumbnails } from './thumbnail-agent';
import { renderThumbnail, ThumbnailSpecSchema } from './thumbnail-compiler';

/**
 * Creative jobs: design (LLM) -> photos (image agent) -> deterministic render -> upload -> attach to post + piece.
 *
 * Every lookup is scoped by companyId AND projectId. Jobs run in the background; clients poll GET job.
 * Job state lives in a JobStore (in-memory by default, single instance); the finished result is also persisted on the
 * post (`SocialPost.metadata.creative`) so it survives restarts and can be re-opened for slide regeneration.
 */

/* ------------------------------------------------------------------ contracts */

export interface CreativeDb {
    project: { findFirst: (args: any) => Promise<any> };
    calendarContentPiece: { findFirst: (args: any) => Promise<any>; updateMany: (args: any) => Promise<{ count: number }> };
    socialPost: { findFirst: (args: any) => Promise<any>; updateMany: (args: any) => Promise<{ count: number }>; create: (args: any) => Promise<any> };
}

export interface AssetStore {
    /** Stores bytes under `key` and returns a URL clients can load. */
    put: (key: string, body: Buffer, contentType: string) => Promise<string>;
    /** Optional fast check so a job is not started when storage is not configured (throws). */
    assertConfigured?: () => void;
}

export type JobStatus = 'queued' | 'designing' | 'sourcing_images' | 'rendering' | 'uploading' | 'completed' | 'failed';

export interface CreativeSlideResult {
    index: number;
    layout: Slide['layout'];
    url: string;
    width: number;
    height: number;
    imageUrl: string | null;
    imageSource: { provider: string; model: string; kind: 'generative' | 'stock'; attribution?: ImageAttribution } | null;
    truncated: boolean;
    contrastOk: boolean;
    minContrast: number;
    version: number;
}

export interface CreativeJob {
    id: string;
    kind: 'carousel' | 'static';
    companyId: string;
    projectId: string;
    createdById: string | null;
    status: JobStatus;
    step: string;
    progress: { done: number; total: number };
    format: CarouselFormat;
    useImageModel: boolean;
    allowStockFallback: boolean;
    imageMode: ImagePlan['mode'] | null;
    pieceId: string | null;
    postId: string | null;
    operation: { type: 'create' } | { type: 'regenerate_slide'; index: number };
    slides: Slide[] | null;
    result: {
        slides: CreativeSlideResult[];
        mediaUrls: string[];
        coverUrl: string;
        font: { requested: string; used: string; fallback: boolean };
    } | null;
    warnings: string[];
    error: { code: string; message: string } | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
}

export interface JobStore {
    get: (id: string) => Promise<CreativeJob | null>;
    save: (job: CreativeJob) => Promise<void>;
}

export class InMemoryJobStore implements JobStore {
    private jobs = new Map<string, CreativeJob>();
    constructor(private max = 500) {}
    async get(id: string) {
        const j = this.jobs.get(id);
        return j ? JSON.parse(JSON.stringify(j)) : null;
    }
    async save(job: CreativeJob) {
        this.jobs.delete(job.id);
        this.jobs.set(job.id, JSON.parse(JSON.stringify(job)));
        while (this.jobs.size > this.max) this.jobs.delete(this.jobs.keys().next().value as string);
    }
}

export interface CreativeDeps {
    db: CreativeDb;
    store: AssetStore;
    loadBrand: (projectId: string, companyId: string) => Promise<CreativeBrand>;
    getLlm: (companyId: string) => Promise<CreativeLlm | null>;
    getImageProviders: (companyId: string) => Promise<ImageProviderChain>;
    jobs?: JobStore;
    fetchImpl?: typeof fetch;
    font?: { allowNetwork?: boolean; fetchImpl?: typeof fetch };
    now?: () => Date;
    /** Runs the background pipeline. Defaults to setImmediate; tests can await the returned promise. */
    schedule?: (fn: () => Promise<void>) => void;
    /** Agent run event store; absent/null = events are kept in memory only (the production factory passes Prisma). */
    events?: AgentEventStore | null;
}

export interface CreativeContext {
    companyId: string;
    projectId: string;
    userId?: string | null;
}

export const CreateCreativeSchema = z
    .object({
        pieceId: z.string().trim().min(1).optional(),
        postId: z.string().trim().min(1).optional(),
        brief: z.string().trim().min(3).max(4000).optional(),
        headline: z.string().trim().min(1).max(300).optional(),
        /** Skip the design agent: render these slides as given. */
        slides: z.array(SlideSchema).min(1).max(MAX_SLIDES).optional(),
        slideCount: z.number().int().min(MIN_SLIDES).max(MAX_SLIDES).optional(),
        format: z.enum(['portrait', 'square']).default('portrait'),
        useImageModel: z.boolean().default(true),
        allowStockFallback: z.boolean().default(false),
    })
    .refine((v) => v.pieceId || v.postId || v.brief || v.headline || v.slides, { message: 'Provide pieceId, postId, brief, headline or slides.' });
export type CreateCreativeInput = z.input<typeof CreateCreativeSchema>;

const ThumbFaceSchema = z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0).max(1),
    h: z.number().min(0).max(1),
    smile: z.number().min(0).max(1).nullable().optional(),
    eyesOpen: z.number().min(0).max(1).nullable().optional(),
});

export const DesignThumbnailsSchema = z.object({
    format: z.enum(['9:16', '16:9']),
    platform: z.string().max(40).optional(),
    title: z.string().max(300).optional(),
    caption: z.string().max(2200).optional(),
    transcript: z.string().max(6000).optional(),
    frames: z
        .array(
            z.object({
                /** JPEG / PNG bytes (≤ ~1.5 MB each), base64. */
                imageBase64: z.string().min(100).max(2_000_000),
                tMs: z.number().int().min(0),
                faces: z.array(ThumbFaceSchema).max(8).default([]),
                sharpness: z.number().min(0).max(1).nullable().optional(),
                brightness: z.number().min(0).max(1).nullable().optional(),
            }),
        )
        .min(1)
        .max(6),
});

export const RenderThumbnailSchema = z.object({
    format: z.enum(['9:16', '16:9']),
    frame: z.object({
        imageBase64: z.string().min(100).max(2_000_000),
        faces: z.array(ThumbFaceSchema).max(8).default([]),
    }),
    spec: ThumbnailSpecSchema,
});

export const RegenerateSlideSchema = z
    .object({
        instruction: z.string().trim().min(2).max(1000).optional(),
        regenerateImage: z.boolean().default(false),
        slide: SlideSchema.partial().optional(),
    })
    .refine((v) => v.instruction || v.regenerateImage || v.slide, { message: 'Provide instruction, regenerateImage or slide.' });
export type RegenerateSlideInput = z.input<typeof RegenerateSlideSchema>;

const TERMINAL_POST = ['publishing', 'published'];
const ACTIVE: JobStatus[] = ['queued', 'designing', 'sourcing_images', 'rendering', 'uploading'];

function parseInput<T>(schema: z.ZodType<T>, raw: unknown): T {
    const r = schema.safeParse(raw ?? {});
    if (!r.success) {
        const msg = r.error.issues.slice(0, 5).map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
        throw new CreativeError(400, 'INVALID_INPUT', msg);
    }
    return r.data;
}

const asObject = (v: any): Record<string, any> => {
    if (!v) return {};
    if (typeof v === 'string') {
        try {
            const p = JSON.parse(v);
            return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
        } catch {
            return {};
        }
    }
    return typeof v === 'object' && !Array.isArray(v) ? v : {};
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
    const out: R[] = new Array(items.length);
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, async () => {
            while (next < items.length) {
                const i = next++;
                out[i] = await fn(items[i], i);
            }
        }),
    );
    return out;
}

/* ------------------------------------------------------------------ service */

export class CreativeService {
    private jobs: JobStore;
    private photoCache = new Map<string, (Buffer | null)[]>();
    private running = new Set<Promise<void>>();

    constructor(private deps: CreativeDeps) {
        this.jobs = deps.jobs || new InMemoryJobStore();
    }

    private now() {
        return (this.deps.now ? this.deps.now() : new Date()).toISOString();
    }

    /** Resolves when every background run started so far has finished (tests / graceful shutdown). */
    async idle(): Promise<void> {
        while (this.running.size) await Promise.all([...this.running]);
    }

    private launch(fn: () => Promise<void>) {
        const p = new Promise<void>((resolve) => {
            const go = () => fn().finally(resolve);
            if (this.deps.schedule) this.deps.schedule(go);
            else setImmediate(go);
        });
        this.running.add(p);
        p.finally(() => this.running.delete(p));
    }

    private async requireProject(ctx: CreativeContext) {
        if (!ctx.companyId) throw new CreativeError(401, 'COMPANY_REQUIRED', 'Company context required');
        const project = await this.deps.db.project.findFirst({
            where: { id: ctx.projectId, companyId: ctx.companyId, projectType: 'social_media', deletedAt: null },
            select: { id: true, name: true },
        });
        if (!project) throw new CreativeError(404, 'PROJECT_NOT_FOUND', 'Project not found');
        return project;
    }

    private async findPiece(ctx: CreativeContext, pieceId: string) {
        // A piece is owned through its calendar, which carries the tenant and project.
        const piece = await this.deps.db.calendarContentPiece.findFirst({
            where: { id: pieceId, calendar: { companyId: ctx.companyId, projectId: ctx.projectId } },
        });
        if (!piece) throw new CreativeError(404, 'PIECE_NOT_FOUND', 'Content piece not found in this project');
        return piece;
    }

    private async findPost(ctx: CreativeContext, where: Record<string, any>) {
        return this.deps.db.socialPost.findFirst({ where: { ...where, companyId: ctx.companyId, projectId: ctx.projectId } });
    }

    /**
     * AI thumbnail design team (thumbnail-agent.ts): real frames sent by the phone (base64 JPEG/PNG, never fetched
     * from client URLs), designed, rendered and QA'd here, uploaded, returned best first. Synchronous (~15–40 s).
     */
    async designThumbnails(ctx: CreativeContext, raw: unknown) {
        await this.requireProject(ctx);
        const input = parseInput(DesignThumbnailsSchema, raw);
        const llm = await this.deps.getLlm(ctx.companyId);
        if (!llm) throw new CreativeError(503, 'AI_NOT_CONFIGURED', 'No AI provider is configured for this workspace. Add one in Settings > AI.');
        this.deps.store.assertConfigured?.();
        const brand = await this.deps.loadBrand(ctx.projectId, ctx.companyId);
        const { loadImage } = require('@napi-rs/canvas');
        const frames = await Promise.all(
            input.frames.map(async (f, i) => {
                const buf = Buffer.from(f.imageBase64, 'base64');
                const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
                const png = buf[0] === 0x89 && buf[1] === 0x50;
                if (!jpeg && !png) throw new CreativeError(400, 'INVALID_INPUT', `Frame ${i} is not a JPEG or PNG image.`);
                try {
                    return { image: await loadImage(buf), faces: f.faces };
                } catch {
                    throw new CreativeError(400, 'INVALID_INPUT', `Frame ${i} could not be decoded.`);
                }
            }),
        );
        const fonts = new Map<string, string>();
        const familyFor = async (name: string) => {
            if (!fonts.has(name)) fonts.set(name, (await resolveFont(name, this.deps.font)).family);
            return fonts.get(name)!;
        };
        const result = await designThumbnails(
            llm,
            {
                format: input.format,
                platform: input.platform,
                title: input.title,
                caption: input.caption,
                transcript: input.transcript,
                brand,
                frames: input.frames.map((f, index) => ({ index, tMs: f.tMs, faces: f.faces, sharpness: f.sharpness ?? null, brightness: f.brightness ?? null })),
            },
            async (spec) => {
                try {
                    return await renderThumbnail(spec, frames[spec.frameIndex], input.format, await familyFor(spec.font));
                } catch (e: any) {
                    throw new CreativeError(500, 'RENDER_FAILED', `Rendering the thumbnail failed: ${String(e?.message || e).slice(0, 200)}`);
                }
            },
        );
        const stamp = (this.deps.now?.() ?? new Date()).getTime();
        const variants = [];
        for (const [i, v] of result.variants.entries()) {
            const url = await this.put(`creative/${ctx.companyId}/${ctx.projectId}/thumbnails/${stamp}-${i}.png`, v.png, 'image/png');
            variants.push({ url, spec: v.spec, qa: v.qa, score: v.score, notes: v.notes, revised: v.revised });
        }
        return { variants, hooks: result.hooks, rationale: result.rationale, format: input.format };
    }

    /**
     * Manual thumbnail (no AI): the creator's own frame + text through the same compositor and measured QA.
     * The second path when AI is not configured or the team's designs are not wanted.
     */
    async renderThumbnailManual(ctx: CreativeContext, raw: unknown) {
        await this.requireProject(ctx);
        const input = parseInput(RenderThumbnailSchema, raw);
        this.deps.store.assertConfigured?.();
        const { loadImage } = require('@napi-rs/canvas');
        const buf = Buffer.from(input.frame.imageBase64, 'base64');
        if (!((buf[0] === 0xff && buf[1] === 0xd8) || (buf[0] === 0x89 && buf[1] === 0x50))) {
            throw new CreativeError(400, 'INVALID_INPUT', 'The frame is not a JPEG or PNG image.');
        }
        const image = await loadImage(buf).catch(() => {
            throw new CreativeError(400, 'INVALID_INPUT', 'The frame could not be decoded.');
        });
        const spec = { ...input.spec, frameIndex: 0 };
        const family = (await resolveFont(spec.font, this.deps.font)).family;
        const out = await renderThumbnail(spec, { image, faces: input.frame.faces }, input.format, family);
        const stamp = (this.deps.now?.() ?? new Date()).getTime();
        const url = await this.put(`creative/${ctx.companyId}/${ctx.projectId}/thumbnails/${stamp}-manual.png`, out.png, 'image/png');
        return { url, spec: out.spec, qa: out.qa, format: input.format };
    }

    /** Which image sources are configured for this company (for the client's "use image model" toggle). */
    async getStatus(ctx: CreativeContext) {
        await this.requireProject(ctx);
        const chain = await this.deps.getImageProviders(ctx.companyId);
        const llm = await this.deps.getLlm(ctx.companyId);
        return {
            ai: { configured: !!llm },
            imageModel: { configured: chain.generative.length > 0, providers: chain.generative.map((p) => ({ id: p.id, model: p.model })) },
            stock: { configured: chain.stock.length > 0, providers: chain.stock.map((p) => p.id) },
            formats: CAROUSEL_FORMATS,
        };
    }

    async startCarousel(ctx: CreativeContext, raw: unknown) {
        return this.start(ctx, raw, 'carousel');
    }

    async startStaticPost(ctx: CreativeContext, raw: unknown) {
        return this.start(ctx, raw, 'static');
    }

    private async start(ctx: CreativeContext, raw: unknown, kind: 'carousel' | 'static'): Promise<CreativeJob> {
        const input = parseInput(CreateCreativeSchema, raw);
        if (kind === 'carousel' && input.slides && input.slides.length < MIN_SLIDES) {
            throw new CreativeError(400, 'INVALID_INPUT', `A carousel needs ${MIN_SLIDES}-${MAX_SLIDES} slides.`);
        }
        await this.requireProject(ctx);

        let piece: any = null;
        let post: any = null;
        if (input.pieceId) {
            piece = await this.findPiece(ctx, input.pieceId);
            post = await this.findPost(ctx, { calendarPieceId: piece.id });
        }
        if (input.postId) {
            post = await this.findPost(ctx, { id: input.postId });
            if (!post) throw new CreativeError(404, 'POST_NOT_FOUND', 'Post not found in this project');
            if (!piece && post.calendarPieceId) piece = await this.findPiece(ctx, post.calendarPieceId).catch(() => null);
        }
        if (!input.slides) {
            const script = asObject(piece?.videoScriptOrHooks);
            const hasContent = [input.headline, input.brief, piece?.headline, piece?.adCopyFull, piece?.visualAssetsBrief, script.carouselBrief, post?.title, post?.content]
                .some((v) => typeof v === 'string' && v.trim()) || (Array.isArray(script.carouselSlides) && script.carouselSlides.length > 0);
            if (!hasContent) throw new CreativeError(400, 'INVALID_INPUT', 'Nothing to design from: add a headline or brief, or use a piece/post that has copy.');
        }
        if (post && TERMINAL_POST.includes(post.status)) {
            throw new CreativeError(409, 'INVALID_INPUT', `This post is ${post.status}; create a new post or repurpose it instead.`);
        }

        // Fail fast (synchronously) on missing configuration, so the client gets a typed 503 and not a failed job.
        try {
            this.deps.store.assertConfigured?.();
        } catch (e: any) {
            throw new CreativeError(503, 'STORAGE_UNAVAILABLE', String(e?.message || 'File storage is not configured on the server.'));
        }
        const chain = await this.deps.getImageProviders(ctx.companyId);
        const plan = planImageSource(chain, { useImageModel: input.useImageModel, allowStockFallback: input.allowStockFallback });
        if (!input.slides) {
            const llm = await this.deps.getLlm(ctx.companyId);
            if (!llm) throw new CreativeError(503, 'AI_NOT_CONFIGURED', 'No AI provider is configured for this workspace. Add one in Settings > AI.');
        }

        const job: CreativeJob = {
            id: `crj_${crypto.randomUUID()}`,
            kind,
            companyId: ctx.companyId,
            projectId: ctx.projectId,
            createdById: ctx.userId || null,
            status: 'queued',
            step: 'Queued',
            progress: { done: 0, total: 4 },
            format: input.format as CarouselFormat,
            useImageModel: input.useImageModel,
            allowStockFallback: input.allowStockFallback,
            imageMode: plan.mode,
            pieceId: piece?.id || null,
            postId: post?.id || null,
            operation: { type: 'create' },
            slides: null,
            result: null,
            warnings: [...plan.warnings],
            error: null,
            createdAt: this.now(),
            updatedAt: this.now(),
            completedAt: null,
        };
        await this.jobs.save(job);
        this.launch(() => this.runCreate(job, input, plan, piece, post));
        return job;
    }

    private async update(job: CreativeJob, patch: Partial<CreativeJob>) {
        Object.assign(job, patch, { updatedAt: this.now() });
        await this.jobs.save(job);
    }

    private async fail(job: CreativeJob, e: any) {
        const code = e instanceof CreativeError ? e.code : 'RENDER_FAILED';
        const message = e instanceof CreativeError ? e.message : 'The creative could not be produced. Please try again.';
        if (!(e instanceof CreativeError)) console.error('[CreativeService] job failed:', e?.stack || e);
        await this.update(job, { status: 'failed', step: 'Failed', error: { code, message }, completedAt: this.now() });
    }

    private designInput(brand: CreativeBrand, input: z.infer<typeof CreateCreativeSchema>, piece: any, post: any, useImages: boolean) {
        const script = asObject(piece?.videoScriptOrHooks);
        const existing = Array.isArray(script.carouselSlides) ? script.carouselSlides : undefined;
        return {
            brandContext: brand.promptContext,
            headline: input.headline || piece?.headline || post?.title || undefined,
            brief: input.brief || script.carouselBrief || piece?.visualAssetsBrief || undefined,
            caption: piece?.adCopyFull || post?.content || undefined,
            platform: piece?.platform || undefined,
            existingSlides: existing,
            slideCount: input.slideCount,
            useImages,
            forbiddenWords: brand.forbiddenWords,
            ctas: brand.standardCtas,
        };
    }

    private async fetchBytes(url: string): Promise<Buffer | null> {
        try {
            if (url.startsWith('data:')) {
                const m = /^data:[^;,]+(;base64)?,(.*)$/s.exec(url);
                if (!m) return null;
                return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]));
            }
            if (!/^https?:\/\//i.test(url)) return null;
            const res = await (this.deps.fetchImpl || fetch)(url, { signal: AbortSignal.timeout(20_000) });
            if (!res.ok) return null;
            return Buffer.from(await res.arrayBuffer());
        } catch {
            return null;
        }
    }

    private photoRequest(slide: Slide, brand: CreativeBrand, format: CarouselFormat, index: number, used: Set<string>) {
        const aspect = format === 'portrait' ? 'portrait' : 'square';
        const { width, height } = CAROUSEL_FORMATS[format];
        return {
            prompt: buildPhotoPrompt({ subject: slide.imagePrompt!, brand, aspect, textArea: slide.layout === 'point' ? 'none' : 'bottom' }),
            width: width + 8,
            height: height + 10,
            aspect,
            avoidIds: used,
            seed: 1000 + index,
        } as const;
    }

    private async sourcePhotos(job: CreativeJob, slides: Slide[], brand: CreativeBrand, plan: ImagePlan, onlyIndex?: number) {
        const used = new Set<string>();
        const results = await mapLimit(slides, 3, async (slide, i) => {
            if ((onlyIndex !== undefined && i !== onlyIndex) || !slide.imagePrompt || plan.mode === 'none') return null;
            const { image, errors } = await fetchImage(plan, this.photoRequest(slide, brand, job.format, i, used));
            if (image?.sourceId) used.add(image.sourceId);
            if (!image) {
                if (plan.mode === 'generative') {
                    throw new CreativeError(502, 'IMAGE_PROVIDER_ERROR', `Could not create the photo for slide ${i + 1}: ${errors.join(' | ').slice(0, 400)}`);
                }
                job.warnings.push(`Slide ${i + 1}: no stock photo matched; rendered as a typographic slide.`);
            }
            return image;
        });
        return results;
    }

    private keyBase(job: CreativeJob) {
        return `social-media/creative/${job.companyId}/${job.projectId}/${job.id}`;
    }

    private async runCreate(job: CreativeJob, input: z.infer<typeof CreateCreativeSchema>, plan: ImagePlan, piece: any, post: any) {
        const events = createAgentRunEmitter({
            store: this.deps.events || null,
            agent: 'creative',
            scope: { companyId: job.companyId, projectId: job.projectId },
        });
        events.emit('AgentStarted', { agent: 'creative', jobId: job.id, kind: job.kind, format: job.format, imageMode: plan.mode });
        try {
            await this.update(job, { status: 'designing', step: 'Designing slides', progress: { done: 0, total: 4 } });
            const brand = await this.deps.loadBrand(job.projectId, job.companyId);
            if (brand.usedDefaults?.length) job.warnings.push(`The brand has no ${brand.usedDefaults.join(', ')} set; neutral defaults were used. Complete the brand profile for on-brand slides.`);
            const useImages = plan.mode !== 'none';
            let slides: Slide[];
            if (input.slides) slides = normalizeSlides(input.slides as Slide[]).map((s) => (useImages ? s : { ...s, imagePrompt: null }));
            else {
                const llm = await this.deps.getLlm(job.companyId);
                if (!llm) throw new CreativeError(503, 'AI_NOT_CONFIGURED', 'No AI provider is configured for this workspace.');
                const di = this.designInput(brand, input, piece, post, useImages);
                slides = job.kind === 'static' ? await designStaticPost(llm, di) : await designCarousel(llm, di);
            }
            if (job.kind === 'static') slides = slides.slice(0, 1);
            events.emit('PlanCreated', { slides: slides.length, fromClient: !!input.slides });
            await this.update(job, { slides, status: 'sourcing_images', step: 'Sourcing photos', progress: { done: 1, total: 4 } });

            events.emit('ToolCalled', { tool: 'image_sourcing', mode: plan.mode });
            const images = await this.sourcePhotos(job, slides, brand, plan);
            events.emit('ToolCompleted', { tool: 'image_sourcing', found: images.filter(Boolean).length, of: slides.length });
            const logo = brand.logoUrl ? await this.fetchBytes(brand.logoUrl) : null;
            if (brand.logoUrl && !logo) job.warnings.push('The brand logo could not be downloaded; the brand name was used instead.');

            await this.update(job, { status: 'rendering', step: 'Rendering slides', progress: { done: 2, total: 4 } });
            const compiled = await compileCarousel({
                slides,
                brand,
                format: job.format,
                images: images.map((i) => i?.buffer || null),
                logo,
                mode: job.kind === 'static' ? 'static' : 'carousel',
                font: this.deps.font,
            });
            job.warnings.push(...compiled.warnings);
            this.photoCache.set(job.id, images.map((i) => i?.buffer || null));

            await this.update(job, { status: 'uploading', step: 'Uploading', progress: { done: 3, total: 4 } });
            const base = this.keyBase(job);
            const results: CreativeSlideResult[] = [];
            for (const r of compiled.slides) {
                const img = images[r.index];
                const imageUrl = img ? await this.put(`${base}/photo-${String(r.index + 1).padStart(2, '0')}.${img.mimeType.includes('png') ? 'png' : 'jpg'}`, img.buffer, img.mimeType) : null;
                const url = await this.put(`${base}/slide-${String(r.index + 1).padStart(2, '0')}-v1.png`, r.png, 'image/png');
                results.push(this.slideResult(r, url, imageUrl, img, 1));
            }
            const result = {
                slides: results,
                mediaUrls: results.map((s) => s.url),
                coverUrl: results[0].url,
                font: { requested: compiled.font.requested, used: compiled.font.fallback ? 'Inter' : compiled.font.requested, fallback: compiled.font.fallback },
            };
            job.result = result;
            const attached = await this.attach(job, piece, post);
            await this.update(job, { ...attached, status: 'completed', step: 'Done', progress: { done: 4, total: 4 }, completedAt: this.now() });
            events.emit('ToolCompleted', { tool: 'render_upload', final: true, slides: results.length, warnings: job.warnings.length });
        } catch (e) {
            events.emit('AgentFailed', { agent: 'creative', code: e instanceof CreativeError ? e.code : 'RENDER_FAILED' });
            await this.fail(job, e);
        }
        await events.flush();
    }

    private async put(key: string, body: Buffer, contentType: string) {
        try {
            return await this.deps.store.put(key, body, contentType);
        } catch (e: any) {
            throw new CreativeError(503, 'STORAGE_UNAVAILABLE', `File storage failed: ${String(e?.message || e).slice(0, 200)}`);
        }
    }

    private slideResult(r: RenderedSlide, url: string, imageUrl: string | null, img: any, version: number): CreativeSlideResult {
        return {
            index: r.index,
            layout: r.layout,
            url,
            width: r.width,
            height: r.height,
            imageUrl,
            imageSource: img ? { provider: img.provider, model: img.model, kind: img.kind, ...(img.attribution ? { attribution: img.attribution } : {}) } : null,
            truncated: r.truncated,
            contrastOk: r.contrastOk,
            minContrast: Math.round(r.minContrast * 100) / 100,
            version,
        };
    }

    private creativeRecord(job: CreativeJob) {
        return {
            jobId: job.id,
            kind: job.kind,
            format: job.format,
            useImageModel: job.useImageModel,
            allowStockFallback: job.allowStockFallback,
            slides: job.slides,
            result: job.result,
            generatedAt: this.now(),
        };
    }

    /** Writes the slides to the post (mediaUrls + metadata.creative) and a pointer to the piece. Scoped by tenant. */
    private async attach(job: CreativeJob, piece: any, post: any): Promise<Partial<CreativeJob>> {
        const db = this.deps.db;
        const mediaType = job.kind === 'static' ? 'image' : 'carousel';
        const urls = job.result!.mediaUrls;
        let postId: string | null = post?.id || null;

        if (post) {
            const fresh = await this.findPost(job, { id: post.id });
            const meta = asObject(fresh?.metadata);
            const res = await db.socialPost.updateMany({
                where: { id: post.id, companyId: job.companyId, projectId: job.projectId },
                data: { mediaUrls: urls, mediaType, thumbnailUrl: job.result!.coverUrl, metadata: { ...meta, creative: this.creativeRecord(job) } },
            });
            if (res.count !== 1) throw new CreativeError(404, 'POST_NOT_FOUND', 'The post was removed while the creative was being produced.');
        } else if (piece) {
            const created = await db.socialPost.create({
                data: {
                    companyId: job.companyId,
                    projectId: job.projectId,
                    calendarId: piece.calendarId || null,
                    calendarPieceId: piece.id,
                    createdById: job.createdById,
                    title: piece.headline || null,
                    content: piece.adCopyFull || piece.headline || '',
                    mediaUrls: urls,
                    mediaType,
                    thumbnailUrl: job.result!.coverUrl,
                    status: 'draft',
                    metadata: { creative: this.creativeRecord(job) },
                },
            });
            postId = created.id;
        }

        if (piece) {
            const script = asObject(piece.videoScriptOrHooks);
            const isJson = Object.keys(script).length > 0 || !String(piece.videoScriptOrHooks || '').trim();
            const data: any = { thumbnailUrl: job.result!.coverUrl };
            // Only extend JSON scripts; a plain-text script is left untouched (the post carries the slides).
            if (isJson) data.videoScriptOrHooks = JSON.stringify({ ...script, renderedCarousel: { jobId: job.id, postId, format: job.format, mediaType, urls, updatedAt: this.now() } });
            await db.calendarContentPiece.updateMany({ where: { id: piece.id, calendar: { companyId: job.companyId, projectId: job.projectId } }, data });
        }
        return { postId, pieceId: piece?.id || null };
    }

    /** Current job state. Falls back to the record persisted on the post after a restart. */
    async getJob(ctx: CreativeContext, jobId: string): Promise<CreativeJob> {
        await this.requireProject(ctx);
        const job = await this.jobs.get(jobId);
        if (job) {
            if (job.companyId !== ctx.companyId || job.projectId !== ctx.projectId) throw new CreativeError(404, 'JOB_NOT_FOUND', 'Job not found');
            return job;
        }
        const restored = await this.restoreFromPost(ctx, jobId);
        if (!restored) throw new CreativeError(404, 'JOB_NOT_FOUND', 'Job not found');
        return restored;
    }

    private async restoreFromPost(ctx: CreativeContext, jobId: string): Promise<CreativeJob | null> {
        if (!/^crj_[0-9a-f-]{36}$/i.test(jobId)) return null;
        const post = await this.findPost(ctx, { metadata: { path: ['creative', 'jobId'], equals: jobId } }).catch(() => null);
        const rec = asObject(post?.metadata).creative;
        if (!post || !rec || rec.jobId !== jobId) return null;
        const job: CreativeJob = {
            id: jobId,
            kind: rec.kind,
            companyId: ctx.companyId,
            projectId: ctx.projectId,
            createdById: null,
            status: 'completed',
            step: 'Done',
            progress: { done: 4, total: 4 },
            format: rec.format,
            useImageModel: !!rec.useImageModel,
            allowStockFallback: !!rec.allowStockFallback,
            imageMode: null,
            pieceId: post.calendarPieceId || null,
            postId: post.id,
            operation: { type: 'create' },
            slides: rec.slides,
            result: rec.result,
            warnings: [],
            error: null,
            createdAt: rec.generatedAt,
            updatedAt: rec.generatedAt,
            completedAt: rec.generatedAt,
        };
        await this.jobs.save(job);
        return job;
    }

    /** Re-does one slide (copy via instruction, a new photo, or a manual edit) and re-renders only that slide. */
    async regenerateSlide(ctx: CreativeContext, jobId: string, index: number, raw: unknown): Promise<CreativeJob> {
        const input = parseInput(RegenerateSlideSchema, raw);
        const job = await this.getJob(ctx, jobId);
        if (ACTIVE.includes(job.status)) throw new CreativeError(409, 'JOB_BUSY', 'This creative is still being produced; wait for it to finish.');
        if (!job.result || !job.slides) throw new CreativeError(409, 'JOB_BUSY', 'This job has no finished slides to regenerate.');
        if (!Number.isInteger(index) || index < 0 || index >= job.slides.length) throw new CreativeError(400, 'INVALID_INPUT', `Slide index must be 0-${job.slides.length - 1}.`);

        let plan: ImagePlan | null = null;
        const needsImage = input.regenerateImage || (input.slide?.imagePrompt && input.slide.imagePrompt !== job.slides[index].imagePrompt);
        if (needsImage) {
            plan = planImageSource(await this.deps.getImageProviders(ctx.companyId), { useImageModel: job.useImageModel, allowStockFallback: job.allowStockFallback });
        }
        if (input.instruction && !(await this.deps.getLlm(ctx.companyId))) {
            throw new CreativeError(503, 'AI_NOT_CONFIGURED', 'No AI provider is configured for this workspace. Add one in Settings > AI.');
        }

        await this.update(job, { status: 'designing', step: `Regenerating slide ${index + 1}`, operation: { type: 'regenerate_slide', index }, error: null, warnings: [], completedAt: null });
        this.launch(() => this.runRegenerate(job, index, input as z.infer<typeof RegenerateSlideSchema>, plan));
        return job;
    }

    private async runRegenerate(job: CreativeJob, index: number, input: z.infer<typeof RegenerateSlideSchema>, plan: ImagePlan | null) {
        try {
            const brand = await this.deps.loadBrand(job.projectId, job.companyId);
            const slides = [...job.slides!];
            const previousPrompt = slides[index].imagePrompt;
            let slide = slides[index];
            if (input.slide) slide = SlideSchema.parse({ ...slide, ...input.slide });
            if (input.instruction) {
                const llm = await this.deps.getLlm(job.companyId);
                if (!llm) throw new CreativeError(503, 'AI_NOT_CONFIGURED', 'No AI provider is configured for this workspace.');
                slide = await redesignSlide(llm, { brandContext: brand.promptContext, slides, index, instruction: input.instruction, useImages: job.imageMode !== 'none' });
            }
            slides[index] = normalizeSlides([slide])[0];
            await this.update(job, { slides, status: 'sourcing_images', step: `Regenerating slide ${index + 1}` });

            const prev = job.result!.slides[index];
            let photo: Buffer | null = null;
            let img: any = prev.imageSource ? { ...prev.imageSource } : null;
            let imageUrl = prev.imageUrl;
            const promptChanged = slides[index].imagePrompt !== previousPrompt;
            if (slides[index].imagePrompt && (plan || promptChanged)) {
                const p = plan || planImageSource(await this.deps.getImageProviders(job.companyId), { useImageModel: job.useImageModel, allowStockFallback: job.allowStockFallback });
                const [fresh] = (await this.sourcePhotos(job, slides, brand, p, index)).slice(index, index + 1);
                if (fresh) {
                    photo = fresh.buffer;
                    img = fresh;
                    imageUrl = null;
                }
            } else if (slides[index].imagePrompt) {
                photo = this.photoCache.get(job.id)?.[index] || (prev.imageUrl ? await this.fetchBytes(prev.imageUrl) : null);
                if (!photo && prev.imageUrl) job.warnings.push('The previous photo could not be loaded; the slide was rendered without it.');
            } else {
                img = null;
                imageUrl = null;
            }
            const logo = brand.logoUrl ? await this.fetchBytes(brand.logoUrl) : null;

            await this.update(job, { status: 'rendering' });
            const images: (Buffer | null)[] = slides.map((_, i) => (i === index ? photo : null));
            const { slide: rendered, warnings } = await compileSingleSlide({ slides, brand, format: job.format, images, logo, index, mode: job.kind === 'static' ? 'static' : 'carousel', font: this.deps.font });
            job.warnings.push(...warnings);

            await this.update(job, { status: 'uploading' });
            const version = (prev.version || 1) + 1;
            const base = this.keyBase(job);
            if (photo && !imageUrl) imageUrl = await this.put(`${base}/photo-${String(index + 1).padStart(2, '0')}-v${version}.jpg`, photo, img?.mimeType || 'image/jpeg');
            const url = await this.put(`${base}/slide-${String(index + 1).padStart(2, '0')}-v${version}.png`, rendered.png, 'image/png');
            const cache = this.photoCache.get(job.id) || slides.map(() => null);
            cache[index] = photo;
            this.photoCache.set(job.id, cache);

            const result = { ...job.result! };
            result.slides = [...result.slides];
            result.slides[index] = this.slideResult(rendered, url, photo ? imageUrl : null, photo ? img : null, version);
            result.mediaUrls = result.slides.map((s) => s.url);
            result.coverUrl = result.slides[0].url;
            job.result = result;
            job.slides = slides;

            const post = job.postId ? await this.findPost(job, { id: job.postId }) : null;
            const piece = job.pieceId ? await this.deps.db.calendarContentPiece.findFirst({ where: { id: job.pieceId, calendar: { companyId: job.companyId, projectId: job.projectId } } }) : null;
            if (post && !TERMINAL_POST.includes(post.status)) await this.attach(job, piece, post);
            else if (post) job.warnings.push(`The post is ${post.status}; the new slide was not attached to it.`);
            await this.update(job, { status: 'completed', step: 'Done', completedAt: this.now() });
        } catch (e) {
            await this.fail(job, e);
        }
    }
}

/* ------------------------------------------------------------------ production wiring */

/**
 * Default dependencies against the platform: Prisma, WS1 brand consciousness, the company's AI provider, and image
 * keys from Company.metadata or env. The asset store is passed in by the host (the backend wires R2).
 */
export function createDefaultCreativeService(opts: { store: AssetStore; jobs?: JobStore }): CreativeService {
    // Lazy requires keep this module importable in tests without a database or SDKs.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prisma } = require('@workspace/db');
    const aiMod = () => require('@workspace/ai');

    const companyMetadata = async (companyId: string) => {
        const c = await prisma.company.findUnique({ where: { id: companyId }, select: { metadata: true } });
        let meta: any = c?.metadata || {};
        for (let i = 0; i < 2 && typeof meta === 'string'; i++) {
            try {
                meta = JSON.parse(meta);
            } catch {
                meta = {};
            }
        }
        return meta && typeof meta === 'object' ? meta : {};
    };

    return new CreativeService({
        db: prisma,
        events: getDefaultAgentEventStore(),
        store: opts.store,
        jobs: opts.jobs,
        loadBrand: async (projectId, companyId) => {
            // WS1's canonical entry point: tenant-scoped, throws 404 for a foreign project.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { getProjectBrandConsciousness } = require('../brand-consciousness');
            const profile = await getProjectBrandConsciousness(projectId, companyId);
            // Handle shown on slides: the username of the project's first active connected account.
            const account = await prisma.socialAccount
                .findFirst({ where: { projectId, companyId, isActive: true }, orderBy: [{ createdAt: 'asc' }], select: { username: true } })
                .catch(() => null);
            return toCreativeBrand(profile, { handle: account?.username || undefined });
        },
        getLlm: async (companyId) => {
            const { AICompanyConfigService, aiProviderService } = aiMod();
            const { settings } = await AICompanyConfigService.getCompanyAISettings(companyId);
            return aiProviderService.getClient(settings);
        },
        getImageProviders: async (companyId) => resolveImageProviders({ companyMetadata: await companyMetadata(companyId) }),
    });
}
