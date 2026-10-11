/**
 * Autopilot calendar jobs (WS2).
 *
 * Starts the multi-agent pipeline from @workspace/ai as a background job, persists status/progress in
 * ContentCalendar.metadata.autopilot (no schema changes), saves CalendarContentPieces, optionally creates
 * draft SocialPosts linked by calendarPieceId, and regenerates single pieces.
 *
 * Every query is filtered by companyId and projectId. The database, LLM factory, brand loader, search
 * provider and scheduler are injectable so tests run against in-memory fakes.
 */
import { randomUUID } from 'crypto';
import { prisma } from '@workspace/db';
import {
    AutopilotError,
    ContentMixConfig,
    ContentMixConfigSchema,
    planCadence,
    AutopilotLLM,
    AutopilotPiece,
    AutopilotPlatform,
    AutopilotRunInput,
    AutopilotStage,
    WebSearchProvider,
    buildBrandContext,
    composeCaption,
    createCompanyAutopilotLLM,
    createWebSearchProviderFromEnv,
    estimateAutopilotBudget,
    expandAutopilotFields,
    isValidTimeZone,
    normalizePlatforms,
    pieceToRow,
    priceUsage,
    readAutopilotPayload,
    regenerateAutopilotPiece,
    rowToPiece,
    runAutopilotPipeline,
    runProductionScriptAgent,
    UsageMeter,
} from '@workspace/ai/content/autopilot';
// Deep import on purpose: the autopilot module only needs the AI kernel, not the whole @workspace/ai index
// (which boots Redis-backed memory services on load).
import * as SocialProjectModule from './social-project.service';
import { AgentEventStore, createAgentRunEmitter, getDefaultAgentEventStore } from '@workspace/ai/agent-runs';
import { AgentMemoryService } from './agent-os/agent-memory';

export type AutopilotJobStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AutopilotJobView {
    jobId: string;
    calendarId: string;
    status: AutopilotJobStatus;
    stage: AutopilotStage;
    progress: number;
    detail?: string;
    error?: { code: string; message: string };
    startedAt?: string;
    finishedAt?: string;
    totalPieces?: number;
    researchUsed?: boolean;
    usage?: unknown;
}

export interface AutopilotServiceDeps {
    db: any;
    createLLM: (companyId: string) => Promise<AutopilotLLM>;
    loadBrand: (projectId: string, companyId: string) => Promise<{ profile: any; promptContext?: string }>;
    search: WebSearchProvider | null;
    /** Runs the job after the HTTP response; tests await it directly. */
    schedule: (job: () => Promise<void>) => void;
    now: () => Date;
    log: (event: string, data: Record<string, unknown>) => void;
    /** Agent run event store (null/absent = events are not persisted). */
    events?: AgentEventStore | null;
    /** Compact project memory lines for the strategist (preferences, feedback, performance). */
    loadMemory?: (projectId: string, companyId: string) => Promise<string[]>;
}

/** Brand objectives (Social OS P1) used as plan goals when the request gives none. */
function objectivesAsGoals(profile: any): string[] {
    const o = profile?.objectives;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return [];
    return [o.primary, o.secondary].filter((g): g is string => typeof g === 'string' && g.trim().length > 0).map((g) => g.trim().slice(0, 200));
}

/** A processing job with no heartbeat for this long is treated as dead (server restart, crash). */
export const AUTOPILOT_STALE_MS = 15 * 60 * 1000;

const X_TO_ACCOUNT_PLATFORM: Record<AutopilotPlatform, string> = {
    instagram: 'instagram', facebook: 'facebook', tiktok: 'tiktok', youtube: 'youtube', linkedin: 'linkedin', x: 'twitter',
};
const MEDIA_TYPE: Record<string, string> = { reel: 'video', carousel: 'carousel', static: 'image', text: 'text' };

export async function defaultLoadBrand(projectId: string, companyId: string) {
    const mod: any = SocialProjectModule;
    const svc = mod.SocialProjectService;
    const profile = await svc.getProjectBrandConsciousness(projectId, companyId);
    // WS1 exposes toPromptContext(); accept it as a module function, a static method or a profile method.
    const toCtx = mod.toPromptContext || svc?.toPromptContext;
    let promptContext: string | undefined;
    if (typeof profile?.toPromptContext === 'function') promptContext = profile.toPromptContext();
    else if (typeof toCtx === 'function') promptContext = toCtx.call(svc, profile);
    return { profile, promptContext };
}

export function defaultAutopilotDeps(): AutopilotServiceDeps {
    return {
        db: prisma,
        createLLM: createCompanyAutopilotLLM,
        loadBrand: defaultLoadBrand,
        search: createWebSearchProviderFromEnv(),
        schedule: (job) => { setImmediate(() => { job().catch((e) => console.error('[autopilot] job crashed', e)); }); },
        now: () => new Date(),
        log: (event, data) => console.info(`[autopilot] ${event}`, JSON.stringify(data)),
        events: getDefaultAgentEventStore(),
        loadMemory: (projectId, companyId) => new AgentMemoryService().buildMemoryContext(projectId, companyId, 'strategist'),
    };
}

const asObject = (v: unknown): Record<string, any> => {
    if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch { return {}; } }
    return v && typeof v === 'object' ? (v as Record<string, any>) : {};
};

function todayIn(timeZone: string, now: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    return parts; // en-CA gives YYYY-MM-DD
}

async function loadProject(db: any, projectId: string, companyId: string) {
    if (!companyId) throw new AutopilotError('INVALID_INPUT', 'company context required');
    const project = await db.project.findFirst({ where: { id: projectId, companyId } });
    if (!project || project.projectType !== 'social_media' || project.deletedAt) {
        throw new AutopilotError('NOT_FOUND', 'Social project not found');
    }
    return project;
}

export interface StartAutopilotBody {
    days?: unknown;
    startDate?: unknown;
    platforms?: unknown;
    goals?: unknown;
    createDrafts?: unknown;
    name?: unknown;
    structureDirectives?: unknown;
    referenceInspirations?: unknown;
    contentMix?: unknown;
    targetReelDurationSec?: unknown;
    carouselSlideCount?: unknown;
}

export class AutopilotCalendarService {
    constructor(private readonly deps: AutopilotServiceDeps = defaultAutopilotDeps()) {}

    async start(params: { companyId: string; userId: string; projectId: string; body: StartAutopilotBody }) {
        const { companyId, userId, projectId, body } = params;
        const { db } = this.deps;

        const days = Number(body.days);
        if (![7, 14, 30].includes(days)) throw new AutopilotError('INVALID_INPUT', 'days must be 7, 14 or 30');
        const goals = Array.isArray(body.goals) ? body.goals.map((g) => String(g || '').trim()).filter(Boolean) : [];
        if (goals.length > 5 || goals.some((g) => g.length > 200)) throw new AutopilotError('INVALID_INPUT', 'goals: at most 5 goals of up to 200 characters');
        if (body.platforms !== undefined && !Array.isArray(body.platforms)) throw new AutopilotError('INVALID_INPUT', 'platforms must be an array');

        const project = await loadProject(db, projectId, companyId);
        const settings = asObject(project.socialSettings);
        const timezone = typeof settings.defaultTimezone === 'string' && isValidTimeZone(settings.defaultTimezone) ? settings.defaultTimezone : 'UTC';
        const rawDate = body.startDate === undefined || body.startDate === null || body.startDate === ''
            ? todayIn(timezone, this.deps.now())
            : String(body.startDate).trim();
        let startDate: string;
        const dateMatch = rawDate.match(/^(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
            startDate = dateMatch[1];
        } else if (/^[A-Za-z]{3,9}\b.*\d{1,2}/.test(rawDate) || /^\d{1,2}\s+[A-Za-z]{3,9}/.test(rawDate)) {
            // Human date from mobile picker like "Sat 31 Oct" or "31 Oct"
            const curYear = this.deps.now().getFullYear();
            const parsed = Date.parse(`${rawDate} ${curYear}`);
            if (!Number.isNaN(parsed)) {
                const dt = new Date(parsed);
                startDate = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
            } else {
                throw new AutopilotError('INVALID_INPUT', 'startDate must be YYYY-MM-DD');
            }
        } else {
            throw new AutopilotError('INVALID_INPUT', 'startDate must be YYYY-MM-DD');
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || Number.isNaN(Date.parse(`${startDate}T00:00:00Z`))) {
            throw new AutopilotError('INVALID_INPUT', 'startDate must be YYYY-MM-DD');
        }

        // Fail fast on a missing AI key: nothing is created and no job is queued.
        const llm = await this.deps.createLLM(companyId);

        const brand = await this.deps.loadBrand(projectId, companyId);
        let platforms: AutopilotPlatform[];
        if (Array.isArray(body.platforms)) {
            platforms = normalizePlatforms(body.platforms);
            if (!platforms.length) throw new AutopilotError('INVALID_INPUT', 'platforms has no supported platform (instagram, facebook, tiktok, youtube, linkedin, x)');
        } else {
            const accounts = await db.socialAccount.findMany({ where: { companyId, projectId, isActive: true } });
            platforms = normalizePlatforms([...(brand.profile?.targetPlatforms || []), ...accounts.map((a: any) => a.platform)]);
            if (!platforms.length) throw new AutopilotError('INVALID_INPUT', 'No target platforms: pass platforms or set target platforms on the project');
        }

        // One running autopilot per project; prevents double spend from double clicks.
        const running = await db.contentCalendar.findMany({ where: { companyId, projectId, status: 'processing' } });
        const nowMs = this.deps.now().getTime();
        const live = running.find((c: any) => {
            const a = asObject(c.metadata).autopilot;
            return a && (a.status === 'queued' || a.status === 'running') && nowMs - Date.parse(a.heartbeatAt || a.startedAt || 0) < AUTOPILOT_STALE_MS;
        });
        if (live) throw new AutopilotError('CONFLICT', 'An autopilot calendar is already being generated for this project', { jobId: asObject(live.metadata).autopilotJobId, calendarId: live.id });

        const jobId = `apj_${randomUUID()}`;
        const nowIso = this.deps.now().toISOString();
        const campaignName = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : undefined;
        const structureDirectives = typeof body.structureDirectives === 'string' && body.structureDirectives.trim() ? body.structureDirectives.trim().slice(0, 2000) : undefined;
        const referenceInspirations = typeof body.referenceInspirations === 'string' && body.referenceInspirations.trim() ? body.referenceInspirations.trim().slice(0, 4000) : undefined;
        const targetReelDurationSec = typeof body.targetReelDurationSec === 'number' ? body.targetReelDurationSec : undefined;
        const carouselSlideCount = typeof body.carouselSlideCount === 'number' ? body.carouselSlideCount : undefined;
        // The mix is validated (and its defaults applied) here, so a bad mix is a 400 before anything is created.
        let contentMix: ContentMixConfig | undefined;
        if (body.contentMix && typeof body.contentMix === 'object') {
            const parsed = ContentMixConfigSchema.safeParse({
                ...(body.contentMix as object),
                ...(targetReelDurationSec !== undefined ? { targetReelDurationSec } : {}),
                ...(carouselSlideCount !== undefined ? { carouselSlideCount } : {}),
            });
            if (!parsed.success) {
                throw new AutopilotError('INVALID_INPUT', `contentMix: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
            }
            contentMix = parsed.data;
            planCadence(days, contentMix, platforms);
        }

        const request = {
            days, startDate, timezone, platforms, goals, createDrafts: body.createDrafts === true,
            name: campaignName, structureDirectives, referenceInspirations, contentMix, targetReelDurationSec, carouselSlideCount,
        };
        const metadata: Record<string, any> = {
            projectId,
            userId,
            platforms,
            timezone,
            generator: 'autopilot',
            autopilotJobId: jobId,
            autopilot: { jobId, status: 'queued', stage: 'queued', progress: 0, request, startedAt: nowIso, heartbeatAt: nowIso, provider: llm.provider },
        };
        const endDate = new Date(Date.parse(`${startDate}T00:00:00Z`) + (days - 1) * 86_400_000);
        const calendar = await db.contentCalendar.create({
            data: {
                companyId,
                projectId,
                name: campaignName || `${project.name || 'Brand'} autopilot · ${days} days from ${startDate}`,
                startDate: new Date(`${startDate}T00:00:00Z`),
                endDate,
                tone: brand.profile?.tone || '',
                engagementGoal: goals.join('; ').slice(0, 500),
                status: 'processing',
                metadata,
            },
        });

        this.deps.schedule(() => this.runJob({ companyId, userId, projectId, calendarId: calendar.id, metadata, llm, brand, project, request }));
        this.deps.log('autopilot_queued', { companyId, projectId, jobId, calendarId: calendar.id, days, platforms });
        return { jobId, calendarId: calendar.id, status: 'queued' as const };
    }

    /** Runs the pipeline and persists results. Never throws: failures land in the job status. */
    async runJob(ctx: {
        companyId: string; userId: string; projectId: string; calendarId: string; metadata: Record<string, any>;
        llm: AutopilotLLM; brand: { profile: any; promptContext?: string }; project: any;
        request: { days: number; startDate: string; timezone: string; platforms: AutopilotPlatform[]; goals: string[]; createDrafts: boolean; [key: string]: any };
    }): Promise<void> {
        const { db } = this.deps;
        const { companyId, calendarId, metadata } = ctx;
        const auto = metadata.autopilot;
        const persist = async (extra: Record<string, unknown> = {}) => {
            auto.heartbeatAt = this.deps.now().toISOString();
            await db.contentCalendar.updateMany({ where: { id: calendarId, companyId }, data: { metadata, ...extra } });
        };
        let lastWrite = { stage: '', progress: -10 };
        const events = createAgentRunEmitter({ store: this.deps.events || null, agent: 'autopilot', scope: { companyId, projectId: ctx.projectId } });
        auto.runId = events.runId;
        events.emit('AgentStarted', { agent: 'autopilot', jobId: auto.jobId, calendarId, days: ctx.request.days, platforms: ctx.request.platforms });

        try {
            auto.status = 'running';
            await persist();
            let memoryContext: string[] = [];
            try {
                memoryContext = this.deps.loadMemory ? await this.deps.loadMemory(ctx.projectId, companyId) : [];
            } catch (e: any) {
                this.deps.log('autopilot_memory_unavailable', { companyId, projectId: ctx.projectId, message: e?.message });
            }
            const input: AutopilotRunInput = {
                days: ctx.request.days as 7 | 14 | 30,
                startDate: ctx.request.startDate,
                timezone: ctx.request.timezone,
                platforms: ctx.request.platforms,
                goals: ctx.request.goals.length ? ctx.request.goals : objectivesAsGoals(ctx.brand.profile),
                memoryContext,
                campaignName: ctx.request.name,
                structureDirectives: ctx.request.structureDirectives,
                referenceInspirations: ctx.request.referenceInspirations,
                contentMix: ctx.request.contentMix,
                targetReelDurationSec: ctx.request.targetReelDurationSec,
                carouselSlideCount: ctx.request.carouselSlideCount,
                brand: buildBrandContext(ctx.brand.profile, {
                    brandName: ctx.project.name,
                    industry: ctx.brand.profile?.industry || ctx.project.description || undefined,
                    promptContext: ctx.brand.promptContext,
                }),
            };
            const result = await runAutopilotPipeline(input, {
                llm: ctx.llm,
                search: this.deps.search,
                log: this.deps.log,
                emit: events.emit,
                onProgress: async (stage, progress, detail) => {
                    auto.stage = stage; auto.progress = progress; auto.detail = detail;
                    if (stage !== lastWrite.stage || progress - lastWrite.progress >= 5) {
                        lastWrite = { stage, progress };
                        await persist();
                    }
                },
            });

            auto.stage = 'saving'; auto.progress = 92;
            await persist();

            const rows = result.pieces.map((p) => pieceToRow(p, calendarId, companyId));
            try {
                await db.calendarContentPiece.createMany({ data: rows });
            } catch (batchErr: any) {
                this.deps.log('autopilot_createmany_fallback', { error: batchErr?.message });
                for (const row of rows) {
                    await db.calendarContentPiece.create({ data: row });
                }
            }

            let draftsCreated = 0;
            if (ctx.request.createDrafts) {
                const saved = await db.calendarContentPiece.findMany({ where: { calendarId, companyId } });
                draftsCreated = await this.createDrafts(saved, ctx);
            }

            const count = (f: string) => result.pieces.filter((p) => p.format === f).length;
            auto.status = 'completed';
            auto.stage = 'done';
            auto.progress = 100;
            auto.detail = undefined;
            auto.finishedAt = this.deps.now().toISOString();
            auto.totalPieces = result.pieces.length;
            auto.needsReview = result.pieces.filter((p) => p.status === 'needs_review').length;
            auto.draftsCreated = draftsCreated;
            auto.strategy = result.strategy;
            auto.research = result.research;
            // Token usage per agent, plus money when the operator configured prices (never an assumed rate).
            auto.usage = { ...result.usage, cost: priceUsage(result.usage) };
            await persist({
                status: 'active',
                totalPieces: result.pieces.length,
                reelsCount: count('reel'),
                carouselsCount: count('carousel'),
                postsCount: count('static') + count('text'),
                contentPillars: result.strategy.pillars.map((p) => p.name),
            });
            this.deps.log('autopilot_completed', { companyId, calendarId, jobId: auto.jobId, pieces: result.pieces.length, usage: result.usage });
            events.emit('ToolCompleted', { tool: 'persist', final: true, pieces: result.pieces.length, draftsCreated });
            await events.flush();
        } catch (err: any) {
            const code = err?.name === 'AutopilotError' && err?.code ? err.code : 'AI_PROVIDER_ERROR';
            auto.status = 'failed';
            auto.error = { code, message: err?.message || String(err) };
            auto.finishedAt = this.deps.now().toISOString();
            this.deps.log('autopilot_failed', { companyId, calendarId, jobId: auto.jobId, code, message: auto.error.message });
            events.emit('AgentFailed', { agent: 'autopilot', code, message: String(auto.error.message).slice(0, 300) });
            await events.flush();
            try { await persist({ status: 'failed' }); } catch (e: any) { console.error('[autopilot] could not persist failure', e?.message); }
        }
    }

    private async createDrafts(savedRows: any[], ctx: { companyId: string; userId: string; projectId: string; calendarId: string }): Promise<number> {
        const { db } = this.deps;
        let created = 0;
        for (const row of savedRows) {
            const piece = rowToPiece(row);
            if (!piece) continue;
            const primary = piece.captions[piece.primaryPlatform];
            const post = await db.socialPost.create({
                data: {
                    companyId: ctx.companyId,
                    projectId: ctx.projectId,
                    calendarId: ctx.calendarId,
                    calendarPieceId: row.id,
                    createdById: ctx.userId,
                    title: piece.headline,
                    content: primary ? composeCaption(primary.caption, primary.hashtags) : piece.headline,
                    mediaType: MEDIA_TYPE[piece.format] || 'image',
                    status: 'draft',
                    metadata: { source: 'autopilot', format: piece.format, plannedFor: row.dateScheduled, hookType: piece.hookType },
                },
            });
            for (const platform of piece.platforms) {
                const copy = piece.captions[platform];
                if (!copy) continue;
                await db.socialPostVariant.create({
                    data: { postId: post.id, platform: X_TO_ACCOUNT_PLATFORM[platform], customContent: composeCaption(copy.caption, copy.hashtags), platformMeta: { postingTime: copy.postingTime, timezone: piece.timezone } },
                });
            }
            created += 1;
        }
        return created;
    }

    async getJob(params: { companyId: string; projectId: string; jobId: string }): Promise<AutopilotJobView> {
        const { db } = this.deps;
        if (!/^apj_[0-9a-f-]{36}$/.test(params.jobId || '')) throw new AutopilotError('NOT_FOUND', 'Job not found');
        const calendar = await db.contentCalendar.findFirst({
            where: { companyId: params.companyId, projectId: params.projectId, metadata: { path: ['autopilotJobId'], equals: params.jobId } },
        });
        if (!calendar) throw new AutopilotError('NOT_FOUND', 'Job not found');
        const metadata = asObject(calendar.metadata);
        const auto = metadata.autopilot || {};

        if ((auto.status === 'queued' || auto.status === 'running') && this.deps.now().getTime() - Date.parse(auto.heartbeatAt || auto.startedAt) > AUTOPILOT_STALE_MS) {
            auto.status = 'failed';
            auto.error = { code: 'JOB_STALLED', message: 'The job stopped responding (server restart or crash). Start it again.' };
            auto.finishedAt = this.deps.now().toISOString();
            await db.contentCalendar.updateMany({ where: { id: calendar.id, companyId: params.companyId }, data: { status: 'failed', metadata } });
        }

        return {
            jobId: params.jobId,
            calendarId: calendar.id,
            status: auto.status,
            stage: auto.stage,
            progress: auto.progress ?? 0,
            ...(auto.detail ? { detail: auto.detail } : {}),
            ...(auto.error ? { error: auto.error } : {}),
            startedAt: auto.startedAt,
            ...(auto.finishedAt ? { finishedAt: auto.finishedAt } : {}),
            ...(auto.status === 'completed' ? { totalPieces: auto.totalPieces, researchUsed: !!auto.research?.researchUsed, usage: auto.usage } : {}),
        };
    }

    /**
     * AI calls and output-token ceiling for a calendar with these settings, per agent, before anything runs.
     * Needs no AI key. Uses the same caps the run passes to the model.
     */
    async estimate(params: { companyId: string; projectId: string; body: StartAutopilotBody }) {
        const { db } = this.deps;
        const { companyId, projectId } = params;
        const body = params.body || {};
        await loadProject(db, projectId, companyId);
        const days = Number(body.days);
        if (![7, 14, 30].includes(days)) throw new AutopilotError('INVALID_INPUT', 'days must be 7, 14 or 30');
        let platforms: AutopilotPlatform[];
        if (Array.isArray(body.platforms)) {
            platforms = normalizePlatforms(body.platforms);
        } else {
            const brand = await this.deps.loadBrand(projectId, companyId);
            const accounts = await db.socialAccount.findMany({ where: { companyId, projectId, isActive: true } });
            platforms = normalizePlatforms([...(brand.profile?.targetPlatforms || []), ...accounts.map((a: any) => a.platform)]);
        }
        if (!platforms.length) throw new AutopilotError('INVALID_INPUT', 'No target platforms: pass platforms or set target platforms on the project');
        let contentMix: ContentMixConfig | undefined;
        if (body.contentMix && typeof body.contentMix === 'object') {
            const parsed = ContentMixConfigSchema.safeParse(body.contentMix);
            if (!parsed.success) throw new AutopilotError('INVALID_INPUT', `contentMix: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
            contentMix = parsed.data;
        }
        const budget = estimateAutopilotBudget({ days, platforms, contentMix, researchEnabled: !!this.deps.search });
        // Typical input size is not knowable up front, so money is only quoted for the output ceiling.
        const ceiling = priceUsage({ inputTokens: 0, outputTokens: budget.maxOutputTokens });
        return { budget, platforms, outputCeilingUsd: ceiling ? ceiling.outputUsd : null, pricesConfigured: !!ceiling };
    }

    async regeneratePiece(params: { companyId: string; projectId: string; pieceId: string; instruction: unknown }) {
        const { db } = this.deps;
        const { companyId, projectId, pieceId } = params;
        const instruction = typeof params.instruction === 'string' ? params.instruction.trim() : '';
        if (!instruction) throw new AutopilotError('INVALID_INPUT', 'instruction is required');
        if (instruction.length > 1000) throw new AutopilotError('INVALID_INPUT', 'instruction must be at most 1000 characters');

        const project = await loadProject(db, projectId, companyId);
        const row = await db.calendarContentPiece.findFirst({ where: { id: pieceId, companyId } });
        if (!row) throw new AutopilotError('NOT_FOUND', 'Piece not found');
        const calendar = await db.contentCalendar.findFirst({ where: { id: row.calendarId, companyId, projectId } });
        if (!calendar) throw new AutopilotError('NOT_FOUND', 'Piece not found');
        const auto = asObject(calendar.metadata).autopilot;
        const piece = rowToPiece(row);
        if (!piece || !auto?.strategy || !auto?.request) throw new AutopilotError('INVALID_INPUT', 'Only pieces created by autopilot can be regenerated');

        const llm = await this.deps.createLLM(companyId);
        const brand = await this.deps.loadBrand(projectId, companyId);
        const input: AutopilotRunInput = {
            ...auto.request,
            brand: buildBrandContext(brand.profile, { brandName: project.name, industry: brand.profile?.industry || project.description || undefined, promptContext: brand.promptContext }),
        };
        const { piece: next, usage } = await regenerateAutopilotPiece({ piece, instruction, input, strategy: auto.strategy, deps: { llm, log: this.deps.log } });

        const data: Record<string, unknown> = pieceToRow(next, row.calendarId, companyId);
        delete data.calendarId;
        delete data.companyId;
        await db.calendarContentPiece.updateMany({ where: { id: pieceId, companyId }, data });

        // Keep an untouched draft post in sync with the new copy.
        const post = await db.socialPost.findFirst({ where: { companyId, calendarPieceId: pieceId } });
        if (post && post.status === 'draft') {
            const primary = next.captions[next.primaryPlatform];
            await db.socialPost.updateMany({
                where: { id: post.id, companyId },
                data: { title: next.headline, content: primary ? composeCaption(primary.caption, primary.hashtags) : next.headline },
            });
        }
        this.deps.log('autopilot_piece_regenerated', { companyId, pieceId, usage });
        const updated = await db.calendarContentPiece.findFirst({ where: { id: pieceId, companyId } });
        return { piece: expandAutopilotFields({ ...updated, _id: updated.id }), usage };
    }

    /**
     * Scene-by-scene shooting script for one video piece (Shooting Script Director agent). Generated once and
     * stored on the piece; pass force to regenerate after the script changed.
     */
    async generateShootingScript(params: { companyId: string; projectId: string; pieceId: string; force?: boolean }) {
        const { db } = this.deps;
        const { companyId, projectId, pieceId } = params;
        const project = await loadProject(db, projectId, companyId);
        const row = await db.calendarContentPiece.findFirst({ where: { id: pieceId, companyId } });
        if (!row) throw new AutopilotError('NOT_FOUND', 'Piece not found');
        const calendar = await db.contentCalendar.findFirst({ where: { id: row.calendarId, companyId, projectId } });
        if (!calendar) throw new AutopilotError('NOT_FOUND', 'Piece not found');
        const payload = readAutopilotPayload(row);
        const piece = rowToPiece(row);
        if (!payload || !piece) throw new AutopilotError('INVALID_INPUT', 'Only pieces created by autopilot have a shooting script');
        if (payload.productionScript && !params.force) return { productionScript: payload.productionScript, cached: true };

        const llm = await this.deps.createLLM(companyId);
        const brand = await this.deps.loadBrand(projectId, companyId);
        const meter = new UsageMeter();
        const productionScript = await runProductionScriptAgent({
            llm,
            brand: buildBrandContext(brand.profile, { brandName: project.name, industry: brand.profile?.industry || project.description || undefined, promptContext: brand.promptContext }),
            piece,
            meter,
            log: this.deps.log,
        });
        await db.calendarContentPiece.updateMany({
            where: { id: pieceId, companyId },
            data: { videoScriptOrHooks: JSON.stringify({ ...payload, productionScript }) },
        });
        this.deps.log('autopilot_shooting_script', { companyId, pieceId, usage: meter.totals() });
        return { productionScript, cached: false, usage: meter.totals() };
    }
}

let defaultService: AutopilotCalendarService | null = null;
export function getAutopilotCalendarService(): AutopilotCalendarService {
    return (defaultService ||= new AutopilotCalendarService());
}
