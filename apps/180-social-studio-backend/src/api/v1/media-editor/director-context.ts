/**
 * Loads the AI Director's brand + script context for a request (WS5).
 *
 * Everything is scoped to the caller's companyId from the verified JWT: a projectId, calendar
 * piece or post that belongs to another tenant is treated exactly like one that does not exist
 * (a warning, no data). The director never trusts brand data sent by the client.
 */
import {
  DirectorContext,
  DirectorBrandContext,
  DirectorBrandRendering,
  DirectorPieceContext,
  parsePieceScript,
} from '@workspace/video-contracts';

export interface DirectorContextRequest {
    companyId?: string;
    projectId?: string;
    calendarPieceId?: string;
    postId?: string;
}

/** Data access, injectable for tests. */
export interface DirectorContextDeps {
    findPost(id: string, companyId: string): Promise<any | null>;
    findPiece(id: string, companyId: string): Promise<any | null>;
    /** WS1 `getProjectBrandConsciousness(projectId, companyId)`; throws when missing / other tenant. */
    getBrand(projectId: string, companyId: string): Promise<any>;
    /** WS1 `resolveBrandRendering(brand)`: render values with explicit neutral defaults (never saved). */
    resolveRendering?(brand: any): DirectorBrandRendering | null;
}

export function defaultDirectorContextDeps(): DirectorContextDeps {
    const db = () => require('@workspace/db').prisma;
    return {
        findPost: (id, companyId) => db().socialPost.findFirst({ where: { id, companyId } }),
        findPiece: (id, companyId) =>
            db().calendarContentPiece.findFirst({
                // Legacy pieces may have a null companyId; they are scoped through their calendar's company.
                where: { id, OR: [{ companyId }, { companyId: null, calendar: { companyId } }] },
                include: { calendar: { select: { id: true, projectId: true, startDate: true, companyId: true } } },
            }),
        getBrand: (projectId, companyId) => {
            const sm = require('@workspace/social-media');
            const fn = sm.getProjectBrandConsciousness || ((p: string, c: string) => sm.SocialProjectService.getProjectBrandConsciousness(p, c));
            return fn(projectId, companyId);
        },
        resolveRendering: (brand) => {
            const { resolveBrandRendering } = require('@workspace/social-media');
            if (typeof resolveBrandRendering !== 'function' || !brand?.colors || !Array.isArray(brand?.completeness?.missingRequired)) return null;
            return resolveBrandRendering(brand);
        },
    };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayLabel(scheduled?: Date | string | null, start?: Date | string | null): string | undefined {
    if (!scheduled || !start) return undefined;
    const d = Math.floor((new Date(scheduled).setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0)) / DAY_MS) + 1;
    return Number.isFinite(d) && d >= 1 && d <= 366 ? `Day ${d}` : undefined;
}

function scriptTargetSec(raw: unknown): number | undefined {
    if (typeof raw !== 'string' || !raw.trim().startsWith('{')) return undefined;
    try {
        const j = JSON.parse(raw);
        const v = Number(j.targetDurationSec ?? j.durationSec ?? j.teleprompterScript?.targetDurationSec);
        return Number.isFinite(v) && v > 0 && v <= 600 ? v : undefined;
    } catch {
        return undefined;
    }
}

export function toBrandContext(b: any, projectId: string): DirectorBrandContext {
    const colors = b.colors || b.brandColors || {};
    let promptContext: string | undefined;
    try {
        if (typeof b.toPromptContext === 'function') promptContext = b.toPromptContext();
    } catch {
        promptContext = undefined;
    }
    return {
        projectId,
        name: b.brandName || b.projectName || undefined,
        brandType: b.brandType || undefined,
        positioning: b.positioning ?? b.brandPositioning ?? undefined,
        tagline: b.tagline ?? b.brandTagline ?? undefined,
        colors: { primary: colors.primary || undefined, accent: colors.accent || undefined, background: colors.background || undefined, text: colors.text || undefined },
        logoUrl: b.logoUrl ?? b.brandLogo ?? null,
        font: b.font ?? b.brandFont ?? undefined,
        captionStylePreset: b.captionStylePreset || undefined,
        watermarkEnabled: b.watermarkEnabled ?? undefined,
        tone: b.tone || undefined,
        targetAudience: b.audience ?? b.targetAudience ?? undefined,
        targetPlatforms: Array.isArray(b.targetPlatforms) ? b.targetPlatforms : undefined,
        forbiddenWords: Array.isArray(b.forbiddenWords) ? b.forbiddenWords : undefined,
        standardCtas: b.ctas ?? b.standardCtas ?? undefined,
        promptContext,
        // Project autonomy policy (Social OS P1); the brand module always returns it (defaults ASSISTED / MANUAL).
        ...(b.autonomy && typeof b.autonomy === 'object' ? { autonomy: { editing: b.autonomy.editing, publishing: b.autonomy.publishing } } : {}),
    };
}

export async function loadDirectorContext(req: DirectorContextRequest, deps: DirectorContextDeps = defaultDirectorContextDeps()): Promise<DirectorContext> {
    const ctx: DirectorContext = { warnings: [] };
    const { companyId } = req;
    if (!companyId || (!req.projectId && !req.calendarPieceId && !req.postId)) return ctx;
    let projectId = req.projectId;
    let pieceId = req.calendarPieceId;
    let post: any = null;

    if (req.postId) {
        post = await deps.findPost(req.postId, companyId).catch(() => null);
        // Project isolation: a post of another project (same company) never lends its script to this project.
        if (post && req.projectId && post.projectId && post.projectId !== req.projectId) {
            ctx.warnings.push('post belongs to another project: its context was skipped');
            post = null;
        } else if (!post) ctx.warnings.push('post not found: brand/script context from the post was skipped');
        else {
            pieceId = pieceId || post.calendarPieceId || undefined;
            projectId = projectId || post.projectId || undefined;
        }
    }

    if (pieceId) {
        let piece = await deps.findPiece(pieceId, companyId).catch(() => null);
        if (piece && projectId && piece.calendar?.projectId && piece.calendar.projectId !== projectId) {
            ctx.warnings.push('calendar piece belongs to another project: script context was skipped');
            piece = null;
        } else if (!piece) ctx.warnings.push('calendar piece not found: script context was skipped');
        else {
            projectId = projectId || piece.calendar?.projectId || undefined;
            const script = parsePieceScript(piece.videoScriptOrHooks);
            const p: DirectorPieceContext = {
                calendarPieceId: piece.id,
                postId: post?.id,
                headline: piece.headline || undefined,
                platform: piece.platform || undefined,
                contentType: piece.contentType || undefined,
                dayLabel: dayLabel(piece.dateScheduled, piece.calendar?.startDate),
                hook: script.hook,
                sections: script.sections,
                callToAction: script.callToAction || piece.callToAction || undefined,
                targetDurationSec: scriptTargetSec(piece.videoScriptOrHooks),
            };
            if (!p.sections.some((s) => s.kind === 'cta') && piece.callToAction) p.sections.push({ kind: 'cta', text: piece.callToAction });
            ctx.piece = p;
        }
    } else if (post) {
        ctx.piece = { postId: post.id, headline: post.title || undefined, sections: [] };
    }

    if (projectId) {
        try {
            const brand = await deps.getBrand(projectId, companyId);
            if (brand) {
                ctx.brand = toBrandContext(brand, projectId);
                try {
                    const rendering = deps.resolveRendering?.(brand);
                    if (rendering) ctx.brand.rendering = rendering;
                } catch {
                    // Rendering values are optional: the style agent falls back to its own neutral defaults.
                }
            }
        } catch {
            // Unknown id, another tenant's project, or a client-side editor id: no brand, no leak.
            if (req.projectId === projectId && !req.calendarPieceId && !req.postId) {
                ctx.warnings.push('no brand profile for this projectId: brand defaults were not applied');
            } else {
                ctx.warnings.push('brand profile not found: brand defaults were not applied');
            }
        }
    }
    return ctx;
}

/**
 * GET /api/v1/media-editor/director-context?projectId=&calendarPieceId=&postId=
 * Brand + script summary and a greeting for clients that open the editor from a calendar piece
 * (web Media Studio). No media, no LLM, no device token needed (nothing is processed).
 */
export function directorContextHandler(deps?: DirectorContextDeps) {
    return async (req: any, res: any) => {
        const companyId: string | undefined = req.user?.companyId;
        if (!companyId) return res.status(401).json({ success: false, error: 'Authentication required' });
        const q = (k: string) => {
            const v = req.query?.[k];
            return typeof v === 'string' && v.length > 0 && v.length <= 128 ? v : undefined;
        };
        const request = { companyId, projectId: q('projectId'), calendarPieceId: q('calendarPieceId'), postId: q('postId') };
        if (!request.projectId && !request.calendarPieceId && !request.postId) {
            return res.status(400).json({ success: false, error: 'CONTEXT_ID_REQUIRED', message: 'Pass projectId, calendarPieceId or postId.' });
        }
        try {
            const { brandStyleDefaults, buildContextGreeting } = require('@workspace/video-contracts');
            const ctx = await loadDirectorContext(request, deps);
            const style = brandStyleDefaults(ctx.brand);
            const g = buildContextGreeting(ctx);
            return res.json({
                success: true,
                data: {
                    greeting: g.greeting,
                    suggestedPrompt: g.suggestedPrompt,
                    steps: g.steps,
                    warnings: [...ctx.warnings, ...(ctx.brand ? style.warnings : [])],
                    brand: ctx.brand
                        ? { projectId: ctx.brand.projectId, name: ctx.brand.name, highlightColor: style.highlightColor, textColor: style.textColor, captionPreset: style.captionPreset, font: ctx.brand.font || 'Inter', logoUrl: ctx.brand.logoUrl || null, watermarkEnabled: ctx.brand.watermarkEnabled !== false, pacing: style.pacing }
                        : null,
                    piece: ctx.piece
                        ? { calendarPieceId: ctx.piece.calendarPieceId, postId: ctx.piece.postId, headline: ctx.piece.headline, platform: ctx.piece.platform, contentType: ctx.piece.contentType, dayLabel: ctx.piece.dayLabel, hook: ctx.piece.hook, targetDurationSec: ctx.piece.targetDurationSec, sections: ctx.piece.sections }
                        : null,
                },
            });
        } catch (err: any) {
            console.error('[director-context]', err?.message || err);
            return res.status(500).json({ success: false, error: 'CONTEXT_LOAD_FAILED', message: 'Could not load the brand and script context.' });
        }
    };
}
