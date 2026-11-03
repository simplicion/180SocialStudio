/**
 * Trend Lab — "Create from Trends".
 *
 *   start      topic -> background research job (4 research agents) -> TrendReport row
 *   get/list   report status, per-agent stage and the finished report (all numbers computed in code)
 *   createScript  report + cluster + angle + platforms/format/duration/mood -> one piece through the same agents as
 *              the calendar, saved in the project's "Trend Lab" calendar so shooting script, regenerate, carousel
 *              render, Library and publishing flows work unchanged
 *   getScript  script job status + the expanded piece
 *
 * Every query is scoped by companyId + projectId. The built-in template engine is never used here: Trend Lab output
 * must come from a real model reading real research.
 */
import { randomUUID } from 'crypto';
import { prisma } from '@workspace/db';
import {
    AutopilotLLM,
    AutopilotPlatform,
    CONTENT_MOODS,
    ContentMood,
    PieceTrend,
    UsageMeter,
    buildBrandContext,
    createCompanyAutopilotLLM,
    expandAutopilotFields,
    isValidTimeZone,
    normalizePlatforms,
    pieceToRow,
    runSinglePiecePipeline,
} from '@workspace/ai/content/autopilot';
import { describeLanes, trendResearchConfigFromEnv, createTrendResearchRunner, TrendResearchRunner } from '@workspace/ai/research';
import type { InstagramMedia, ReportCluster, TrendResearchReport } from '@workspace/ai/research';
import { defaultLoadBrand } from '../autopilot-calendar.service';
import { loadOwnPostOutcomes, OwnPostOutcome, winningExemplars } from '../platform-team/own-performance';
import { instagramHashtagReader } from '../platform-team/instagram-hashtags';
import { youtubeTokenProvider } from '../platform-team/youtube-token';

export class TrendLabError extends Error {
    constructor(readonly code: string, readonly statusCode: number, message: string) { super(message); this.name = 'TrendLabError'; }
}

export interface TrendLabDeps {
    db: any;
    createLLM: (companyId: string) => Promise<AutopilotLLM>;
    loadBrand: (projectId: string, companyId: string) => Promise<{ profile: any; promptContext?: string }>;
    research: TrendResearchRunner | null;
    /** Which research lanes are live (for the UI); defaults to none. */
    lanes?: { lane: string; on: boolean; hint?: string }[];
    loadOwnOutcomes?: (projectId: string, companyId: string) => Promise<OwnPostOutcome[]>;
    instagramReader?: (projectId: string, companyId: string) => Promise<((tag: string) => Promise<InstagramMedia[]>) | null>;
    /** Connected YouTube channel token (YouTube lane fallback when YOUTUBE_API_KEY is not set). */
    youtubeToken?: (projectId: string, companyId: string) => () => Promise<string | null>;
    schedule: (job: () => Promise<void>) => void;
    now: () => Date;
    log: (event: string, data: Record<string, unknown>) => void;
    dailyReportLimit?: number;
}

export const TREND_REPORT_STALE_MS = 10 * 60 * 1000;
const FORMAT_MAP = { video: 'reel', carousel: 'carousel', text: 'text' } as const;
const TREND_LAB_CALENDAR = 'Trend Lab';

export function defaultTrendLabDeps(env: NodeJS.ProcessEnv = process.env): TrendLabDeps {
    const cfg = trendResearchConfigFromEnv(prisma, env);
    const lanes = describeLanes(cfg);
    return {
        db: prisma,
        createLLM: (companyId) => createCompanyAutopilotLLM(companyId),
        loadBrand: defaultLoadBrand,
        research: lanes.some((l) => l.on) ? createTrendResearchRunner(cfg) : null,
        lanes,
        loadOwnOutcomes: (projectId, companyId) => loadOwnPostOutcomes(prisma, { companyId, projectId }),
        instagramReader: (projectId, companyId) => instagramHashtagReader({ companyId, projectId }),
        youtubeToken: (projectId, companyId) => youtubeTokenProvider({ companyId, projectId }),
        schedule: (job) => { setImmediate(() => { job().catch((e) => console.error('[trend-lab] job crashed', e)); }); },
        now: () => new Date(),
        log: (event, data) => console.info(`[trend-lab] ${event}`, JSON.stringify(data)),
        dailyReportLimit: Number(env.TREND_LAB_DAILY_LIMIT) || 20,
    };
}

const str = (v: unknown, field: string, max: number, min = 1): string => {
    const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
    if (s.length < min) throw new TrendLabError('INVALID_INPUT', 400, `"${field}" is required.`);
    if (s.length > max) throw new TrendLabError('INVALID_INPUT', 400, `"${field}" must be at most ${max} characters.`);
    return s;
};

const asObj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});

/** Trend evidence stored on a Trend Lab piece (same shape the calendar uses). */
export function clusterToPieceTrend(c: ReportCluster): PieceTrend {
    const m = c.metrics;
    return {
        id: c.id,
        title: c.title,
        whyNow: c.whyNow,
        signal: [m.momentumLabel !== 'unknown' ? m.momentumLabel : '', `opportunity ${m.opportunityScore}/100`, `${m.totalItems} posts`].filter(Boolean).join(' · '),
        audienceQuestions: c.audienceQuestions.slice(0, 4),
        quotes: c.reactionQuotes.slice(0, 4).map((q) => ({ quote: q.quote, url: q.url })),
        sourceUrls: c.items.slice(0, 5).map((i) => i.url),
    };
}

export class TrendLabService {
    constructor(private readonly deps: TrendLabDeps = defaultTrendLabDeps()) {}

    private async project(projectId: string, companyId: string) {
        if (!companyId) throw new TrendLabError('UNAUTHORIZED', 401, 'Company context required');
        const project = await this.deps.db.project.findFirst({ where: { id: projectId, companyId } });
        if (!project || project.projectType !== 'social_media' || project.deletedAt) throw new TrendLabError('NOT_FOUND', 404, 'Social project not found');
        return project;
    }

    private async brandFor(project: any, companyId: string) {
        const loaded = await this.deps.loadBrand(project.id, companyId);
        return buildBrandContext(loaded.profile, { brandName: project.name, industry: loaded.profile?.industry || project.description || undefined, promptContext: loaded.promptContext });
    }

    private async llmFor(companyId: string): Promise<AutopilotLLM> {
        const llm = await this.deps.createLLM(companyId);
        if (llm.provider === 'builtin') throw new TrendLabError('AI_NOT_CONFIGURED', 503, 'Trend Lab needs an AI provider key. Add one in Settings → AI provider.');
        return llm;
    }

    lanes() {
        return { configured: !!this.deps.research, lanes: this.deps.lanes || [] };
    }

    // ------------------------------------------------------------------ reports

    async start(params: { companyId: string; userId: string; projectId: string; body: any }) {
        const project = await this.project(params.projectId, params.companyId);
        const topic = str(params.body?.topic, 'topic', 200, 2);
        if (!this.deps.research) throw new TrendLabError('RESEARCH_NOT_CONFIGURED', 503, 'Trend research is not configured on this server yet.');
        const since = new Date(this.deps.now().getTime() - 24 * 60 * 60 * 1000);
        const used = await this.deps.db.trendReport.count({ where: { companyId: params.companyId, createdAt: { gte: since } } });
        const limit = this.deps.dailyReportLimit ?? 20;
        if (used >= limit) throw new TrendLabError('RATE_LIMITED', 429, `You have used today's ${limit} trend researches. Try again tomorrow, or reopen a recent report.`);

        const row = await this.deps.db.trendReport.create({
            data: {
                id: randomUUID(), companyId: params.companyId, projectId: project.id, userId: params.userId || null, topic,
                normalizedTopic: topic.toLowerCase(), status: 'queued', stage: 'queued', progress: 0, heartbeatAt: this.deps.now(),
            },
        });
        this.deps.schedule(() => this.runReport({ reportId: row.id, companyId: params.companyId, project, topic }));
        return { reportId: row.id, status: 'queued' as const };
    }

    /** Runs the research. Never throws: failures land on the row. */
    async runReport(ctx: { reportId: string; companyId: string; project: any; topic: string }): Promise<void> {
        const { db } = this.deps;
        const where = { id: ctx.reportId, companyId: ctx.companyId };
        let last = 0;
        const update = (data: Record<string, unknown>) => db.trendReport.updateMany({ where, data: { ...data, heartbeatAt: this.deps.now() } });
        try {
            await update({ status: 'running', stage: 'planning', progress: 2 });
            const llm = await this.llmFor(ctx.companyId);
            const brand = await this.brandFor(ctx.project, ctx.companyId);
            const outcomes = await (this.deps.loadOwnOutcomes?.(ctx.project.id, ctx.companyId) ?? Promise.resolve([])).catch(() => [] as OwnPostOutcome[]);
            const ig = await (this.deps.instagramReader?.(ctx.project.id, ctx.companyId) ?? Promise.resolve(null)).catch(() => null);
            const meter = new UsageMeter();
            const report = await this.deps.research!({
                llm, meter, topic: ctx.topic,
                brand: { industry: brand.industry, audience: brand.audience, promptContext: brand.promptContext },
                ownHistory: async () => outcomes.map((o) => ({ format: o.format, multiple: o.multiple })),
                instagramHashtagTopMedia: ig ?? undefined,
                youtubeAccessToken: this.deps.youtubeToken?.(ctx.project.id, ctx.companyId),
                onStage: async (stage, progress, detail) => {
                    if (progress - last < 5 && stage !== 'done') return;
                    last = progress;
                    await update({ stage, progress: Math.min(99, progress), ...(detail ? { sourcesUsed: { detail } } : {}) });
                },
            });
            await update({ status: 'done', stage: 'done', progress: 100, report: report as any, sourcesUsed: { statuses: report.statuses } as any, usage: meter.totals() as any, error: null });
            this.deps.log('trend_report_done', { reportId: ctx.reportId, clusters: report.clusters.length, usage: meter.totals().calls });
        } catch (err: any) {
            const message = String(err?.message || err).slice(0, 500);
            await update({ status: 'failed', stage: 'failed', error: `${err?.code || 'FAILED'}: ${message}` }).catch(() => undefined);
            this.deps.log('trend_report_failed', { reportId: ctx.reportId, code: err?.code, message });
        }
    }

    private async staleCheck(row: any) {
        if ((row.status === 'running' || row.status === 'queued') && row.heartbeatAt && this.deps.now().getTime() - new Date(row.heartbeatAt).getTime() > TREND_REPORT_STALE_MS) {
            await this.deps.db.trendReport.updateMany({ where: { id: row.id, companyId: row.companyId }, data: { status: 'failed', stage: 'failed', error: 'JOB_STALLED: research stopped responding; start it again.' } });
            return { ...row, status: 'failed', stage: 'failed', error: 'JOB_STALLED: research stopped responding; start it again.' };
        }
        return row;
    }

    private view(row: any) {
        const [code, ...rest] = String(row.error || '').split(': ');
        return {
            reportId: row.id, topic: row.topic, status: row.status, stage: row.stage, progress: row.progress,
            detail: asObj(row.sourcesUsed).detail ?? null,
            error: row.error ? { code, message: rest.join(': ') || row.error } : null,
            report: row.status === 'done' ? (row.report as TrendResearchReport) : null,
            createdAt: row.createdAt,
        };
    }

    async get(params: { companyId: string; projectId: string; reportId: string }) {
        await this.project(params.projectId, params.companyId);
        const row = await this.deps.db.trendReport.findFirst({ where: { id: params.reportId, companyId: params.companyId, projectId: params.projectId } });
        if (!row) throw new TrendLabError('NOT_FOUND', 404, 'Trend report not found');
        return this.view(await this.staleCheck(row));
    }

    async list(params: { companyId: string; projectId: string }) {
        await this.project(params.projectId, params.companyId);
        const rows = await this.deps.db.trendReport.findMany({ where: { companyId: params.companyId, projectId: params.projectId }, orderBy: { createdAt: 'desc' }, take: 20 });
        return {
            reports: rows.map((r: any) => {
                const top = (r.report as TrendResearchReport | null)?.clusters?.[0];
                return { reportId: r.id, topic: r.topic, status: r.status, createdAt: r.createdAt, topTrend: top ? { title: top.title, verdict: top.metrics.verdict, opportunityScore: top.metrics.opportunityScore } : null };
            }),
        };
    }

    // ------------------------------------------------------------------ scripts

    private async trendLabCalendar(projectId: string, companyId: string) {
        const existing = await this.deps.db.contentCalendar.findMany({ where: { companyId, projectId, name: TREND_LAB_CALENDAR } });
        const found = existing.find((c: any) => asObj(c.metadata).kind === 'trend_lab');
        if (found) return found;
        return this.deps.db.contentCalendar.create({
            data: { id: randomUUID(), companyId, projectId, name: TREND_LAB_CALENDAR, description: 'Scripts created from Trend Lab research', status: 'active', metadata: { kind: 'trend_lab' } },
        });
    }

    async createScript(params: { companyId: string; userId: string; projectId: string; reportId: string; body: any }) {
        const project = await this.project(params.projectId, params.companyId);
        const row = await this.deps.db.trendReport.findFirst({ where: { id: params.reportId, companyId: params.companyId, projectId: project.id } });
        if (!row) throw new TrendLabError('NOT_FOUND', 404, 'Trend report not found');
        if (row.status !== 'done' || !row.report) throw new TrendLabError('CONFLICT', 409, 'The research is not finished yet.');
        const report = row.report as TrendResearchReport;
        const b = params.body || {};
        const cluster = report.clusters.find((c) => c.id === b.clusterId);
        if (!cluster) throw new TrendLabError('INVALID_INPUT', 400, 'Pick one of the trends in this report.');
        const angle = cluster.angles.find((a) => a.id === b.angleId) ?? cluster.angles[0];
        if (!angle) throw new TrendLabError('INVALID_INPUT', 400, 'This trend has no angle to write from.');
        const format = FORMAT_MAP[b.format as keyof typeof FORMAT_MAP];
        if (!format) throw new TrendLabError('INVALID_INPUT', 400, '"format" must be video, carousel or text.');
        const platforms = normalizePlatforms(b.platforms);
        if (!platforms.length) throw new TrendLabError('INVALID_INPUT', 400, 'Pick at least one platform.');
        const durationSec = format === 'reel' ? Math.round(Number(b.durationSec) || 45) : undefined;
        if (durationSec !== undefined && (durationSec < 15 || durationSec > 180)) throw new TrendLabError('INVALID_INPUT', 400, 'Video length must be 15 to 180 seconds.');
        const mood = b.mood === undefined || b.mood === null ? undefined : (CONTENT_MOODS as readonly string[]).includes(b.mood) ? (b.mood as ContentMood) : null;
        if (mood === null) throw new TrendLabError('INVALID_INPUT', 400, `"mood" must be one of ${CONTENT_MOODS.join(', ')}.`);
        const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 600) : '';
        const settings = asObj(project.socialSettings);
        const timezone = typeof settings.defaultTimezone === 'string' && isValidTimeZone(settings.defaultTimezone) ? settings.defaultTimezone : 'UTC';

        const calendar = await this.trendLabCalendar(project.id, params.companyId);
        const pieceId = randomUUID();
        await this.deps.db.calendarContentPiece.create({
            data: {
                id: pieceId, calendarId: calendar.id, companyId: params.companyId, platform: platforms[0],
                contentType: format === 'reel' ? 'Reel' : format === 'carousel' ? 'Carousel' : 'Text', pillar: 'Trend Lab',
                headline: angle.title.slice(0, 200), status: 'generating', notes: `Trend Lab report ${row.id}`,
            },
        });
        this.deps.schedule(() => this.runScript({
            pieceId, calendarId: calendar.id, companyId: params.companyId, project,
            request: {
                platforms, format, durationSec, mood, notes, timezone, topic: cluster.title,
                angle: { title: String(angle.title || cluster.title), tension: String(angle.tension || cluster.whyNow), draftHook: String(angle.draftHook || '') },
                trend: clusterToPieceTrend(cluster),
            },
        }));
        return { pieceId, calendarId: calendar.id, status: 'generating' as const };
    }

    async runScript(ctx: {
        pieceId: string; calendarId: string; companyId: string; project: any;
        request: { platforms: AutopilotPlatform[]; format: 'reel' | 'carousel' | 'text'; durationSec?: number; mood?: ContentMood; notes: string; timezone: string; topic: string; angle: { title: string; tension: string; draftHook: string }; trend: PieceTrend };
    }): Promise<void> {
        const where = { id: ctx.pieceId, companyId: ctx.companyId };
        try {
            const llm = await this.llmFor(ctx.companyId);
            const brand = await this.brandFor(ctx.project, ctx.companyId);
            const outcomes = await (this.deps.loadOwnOutcomes?.(ctx.project.id, ctx.companyId) ?? Promise.resolve([])).catch(() => [] as OwnPostOutcome[]);
            const { piece, usage } = await runSinglePiecePipeline({ ...ctx.request, brand, winningExemplars: winningExemplars(outcomes), date: this.deps.now().toISOString().slice(0, 10) }, { llm, log: this.deps.log });
            const { calendarId, companyId, ...data } = pieceToRow(piece, ctx.calendarId, ctx.companyId);
            await this.deps.db.calendarContentPiece.updateMany({ where, data: { ...data, dateScheduled: null } });
            this.deps.log('trend_script_done', { pieceId: ctx.pieceId, calls: usage.calls });
        } catch (err: any) {
            const message = String(err?.message || err).slice(0, 400);
            await this.deps.db.calendarContentPiece.updateMany({ where, data: { status: 'failed', notes: `${err?.code || 'FAILED'}: ${message}` } }).catch(() => undefined);
            this.deps.log('trend_script_failed', { pieceId: ctx.pieceId, code: err?.code, message });
        }
    }

    async getScript(params: { companyId: string; projectId: string; pieceId: string }) {
        await this.project(params.projectId, params.companyId);
        const row = await this.deps.db.calendarContentPiece.findFirst({ where: { id: params.pieceId, companyId: params.companyId }, include: { calendar: { select: { projectId: true } } } });
        if (!row || row.calendar?.projectId !== params.projectId) throw new TrendLabError('NOT_FOUND', 404, 'Script not found');
        const { calendar, ...piece } = row;
        const status = row.status === 'generating' ? 'generating' : row.status === 'failed' ? 'failed' : 'done';
        const [code, ...rest] = String(row.notes || '').split(': ');
        return {
            pieceId: row.id, calendarId: row.calendarId, status,
            error: status === 'failed' ? { code, message: rest.join(': ') || row.notes } : null,
            piece: status === 'done' ? expandAutopilotFields(piece) : null,
        };
    }
}

let defaultService: TrendLabService | null = null;
export function getTrendLabService(): TrendLabService {
    return (defaultService ||= new TrendLabService());
}
