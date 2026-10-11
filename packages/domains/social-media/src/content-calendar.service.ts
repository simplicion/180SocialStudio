import { prisma, requestContext } from '@workspace/db';
import { aiContentService, expandAutopilotFields } from '@workspace/ai';
import { SocialProjectService } from './social-project.service';
import { getDb } from './publishing/http';
import { notFound, pieceScope, requireCompanyId } from './tenant-scope';

/** The caller's company: explicit (from the verified JWT) or the request context. Never "any company". */
const tenantOf = (companyId?: string) => requireCompanyId(companyId || (requestContext.getStore()?.companyId as string | undefined));

/** Fields a client may never write through the generic update endpoints. */
const IMMUTABLE_FIELDS = ['id', '_id', 'companyId', 'company', 'createdAt', 'updatedAt'];

/**
 * Legacy content calendars. Every read/write carries the caller's companyId: lookups use findFirst, writes use
 * update / deleteMany with `companyId` in the where. findUnique / update / delete by id alone bypass the Prisma
 * tenant filter (packages/db/src/index.ts), so another company's id is always a 404.
 */
export class ContentCalendarService {
    /** 404 unless the calendar exists and belongs to the company. */
    private static async ownedCalendar(id: string, companyId: string) {
        const calendar = await getDb().contentCalendar.findFirst({ where: { id, companyId } });
        if (!calendar) throw notFound('Calendar');
        return calendar;
    }

    /** 404 unless the project exists and belongs to the company. */
    private static async assertOwnedProject(projectId: string, companyId: string) {
        const project = await getDb().project.findFirst({ where: { id: projectId, companyId }, select: { id: true } });
        if (!project) throw notFound('Project');
    }

    static async listCalendars(limit: number = 10, offset: number = 0, explicitCompanyId?: string, projectId?: string) {
        const companyId = tenantOf(explicitCompanyId);
        const where: any = { companyId };
        if (projectId) where.projectId = projectId;
        const calendars: any[] = await getDb().contentCalendar.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: offset,
            take: limit
        });

        const mappedCalendars = calendars.map(c => {
            let meta = c.metadata || {};
            if (typeof meta === 'string') {
                try { meta = JSON.parse(meta); } catch(e) { meta = {}; }
            }
            return {
                platforms: [],
                contentPillars: [],
                ...c,
                ...(typeof meta === 'object' ? meta : {}),
                _id: c.id
            };
        });

        return mappedCalendars;
    }

    static async getCalendar(id: string, explicitCompanyId?: string) {
        const companyId = tenantOf(explicitCompanyId);
        const calendar = await this.ownedCalendar(id, companyId);

        const pieces: any[] = await getDb().calendarContentPiece.findMany({
            where: { calendarId: calendar.id },
            orderBy: { dateScheduled: 'asc' },
            take: 200
        });

        let meta = calendar.metadata || {};
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch(e) { meta = {}; }
        }
        const mappedCalendar = { 
            platforms: [], 
            contentPillars: [], 
            ...calendar, 
            ...(typeof meta === 'object' ? meta : {}), 
            _id: calendar.id 
        };
        const mappedPieces = pieces.map(p => {
            let tags: any[] = [];
            if (p.hashtagsResearched) {
                if (typeof p.hashtagsResearched === 'string') {
                    try { tags = JSON.parse(p.hashtagsResearched); } catch(e) { tags = p.hashtagsResearched.split(',').map(s=>s.trim()); }
                } else if (Array.isArray(p.hashtagsResearched)) {
                    tags = p.hashtagsResearched;
                }
            }
            return expandAutopilotFields({
                ...p,
                _id: p.id,
                hashtags: tags,
                engagementTarget: {
                    estimatedImpressions: p.engagementTargetEstimatedImpressions || 0,
                    estimatedEngagementPercent: p.engagementTargetEstimatedEngagementPercent || 0
                }
            });
        });

        return { calendar: mappedCalendar, pieces: mappedPieces };
    }

    static async createCalendar(body: any, user: any, explicitCompanyId?: string) {
        const companyId = tenantOf(explicitCompanyId || user?.companyId);

        // Verify the project before spending AI credits: a project of another company is a 404, not a silent skip.
        if (body.projectId) await this.assertOwnedProject(String(body.projectId), companyId);

        // 1. Resolve Brand Consciousness if projectId is provided
        let brandConsciousness = body.brandConsciousness;
        if (body.projectId && !brandConsciousness) {
            try {
                brandConsciousness = await SocialProjectService.getProjectBrandConsciousness(body.projectId, companyId);
            } catch (e) {
                console.warn('[ContentCalendarService] Failed to load brand consciousness:', e);
            }
        }

        const enrichedBody = {
            ...body,
            brandConsciousness: brandConsciousness || body.brandConsciousness,
            brandVoice: brandConsciousness?.tone || body.brandVoice || body.brand_voice,
            contentPillars: brandConsciousness?.contentPillars || body.contentPillars || body.content_pillars
        };

        // 2. Call AI Service to generate calendar data based on enrichedBody
        const aiResponse = await aiContentService.generateContentCalendar(enrichedBody, user.id, companyId);

        if (!aiResponse.success) {
            const err: any = new Error(aiResponse.error || 'AI generation failed');
            err.code = (aiResponse as any).code || 'AI_PROVIDER_ERROR';
            err.statusCode = (aiResponse as any).statusCode || 502;
            throw err;
        }

        const generatedPieces = aiResponse.data;
        const meta: any = aiResponse.meta || {};

        // 3. Save Calendar Metadata
        const calendar = await prisma.contentCalendar.create({ data: {
            companyId: companyId,
            name: body.name || `${body.brandName || body.brand_name || brandConsciousness?.brandTagline || 'Brand'} Content Calendar`,
            startDate: body.startDate ? new Date(body.startDate) : new Date(),
            contentPillars: enrichedBody.contentPillars || [],
            tone: enrichedBody.brandVoice || 'Professional',
            engagementGoal: body.engagementGoal || body.engagement_goal || 'Growth',
            hashtagStrategy: body.hashtagStrategy || body.hashtag_strategy || 'Mixed',
            competitors: body.competitors || [],
            status: 'active',
            totalPieces: generatedPieces.length,
            reelsCount: generatedPieces.filter((p: any) => ['reel', 'video', 'tiktok', 'short'].includes(p.contentType?.toLowerCase())).length,
            postsCount: generatedPieces.filter((p: any) => ['post', 'image', 'text'].includes(p.contentType?.toLowerCase())).length,
            carouselsCount: generatedPieces.filter((p: any) => p.contentType?.toLowerCase() === 'carousel').length,
            metadata: { 
                aiProviderUsed: meta.provider,
                userId: user.id,
                projectId: body.projectId || null,
                brandName: body.brandName || body.brand_name || 'Brand',
                brandConsciousness: brandConsciousness || null,
                industry: body.industry || 'General',
                subdomain: body.subdomain || 'company',
                targetAudience: body.targetAudience || body.target_audience || 'General Audience',
                platforms: body.platforms || [],
                calendarDuration: body.durationWords || body.calendar_duration || '1 month',
                frequency: body.frequency || 'Weekly',
                timezone: body.timezone || 'UTC'
            }
        } });

        // Link the calendar to the (already ownership-checked) project.
        if (body.projectId) {
            await getDb().contentCalendar.update({
                where: { id: calendar.id, companyId },
                data: { projectId: String(body.projectId) }
            });
        }

        // 4. Save Calendar Pieces
        const piecesToInsert = generatedPieces.map((piece: any, index: number) => {
            const et = piece.engagementTarget || {};
            return {
                calendarId: calendar.id,
                companyId,
                dateScheduled: piece.dateScheduled ? new Date(piece.dateScheduled) : new Date(),
                platform: piece.platform || 'General',
                contentType: piece.contentType || 'Post',
                pillar: piece.pillar || 'General',
                headline: piece.headline || '',
                adCopyFull: piece.adCopyFull || '',
                videoScriptOrHooks: typeof piece.videoScriptOrHooks === 'object' ? JSON.stringify(piece.videoScriptOrHooks) : String(piece.videoScriptOrHooks || ''),
                visualAssetsBrief: typeof piece.visualAssetsBrief === 'object' ? JSON.stringify(piece.visualAssetsBrief) : String(piece.visualAssetsBrief || ''),
                hashtagsResearched: piece.hashtags ? (Array.isArray(piece.hashtags) ? piece.hashtags.join(', ') : String(piece.hashtags)) : (piece.hashtagsResearched || ''),
                callToAction: piece.callToAction || '',
                engagementTargetEstimatedImpressions: et.estimatedImpressions ? String(et.estimatedImpressions) : '',
                engagementTargetEstimatedEngagementPercent: et.estimatedEngagementPercent ? parseFloat(et.estimatedEngagementPercent) || 0 : 0,
                engagementTargetEstimatedShares: et.estimatedShares ? String(et.estimatedShares) : '',
                weekNumber: Math.floor(index / 7) + 1,
                viralScore: 5
            };
        });

        if (piecesToInsert.length > 0) {
            await prisma.calendarContentPiece.createMany({
                data: piecesToInsert
            });
        }

        // 4. Log AI Request
        await prisma.aiRequestLog.create({ data: {
            calendarId: calendar.id,
            userId: user.id,
            inputParameters: body,
            aiResponseTimeMs: meta.durationMs || 0,
            totalPiecesGenerated: piecesToInsert.length,
            qualityScore: 0
        } });

        return {
            status: 'success',
            calendar_id: calendar.id,
            message: 'Calendar generated successfully',
            total_pieces: piecesToInsert.length,
            preview_url: `/dashboard/content-calendar/${calendar.id}`
        };
    }

    static async updateCalendar(id: string, body: any, explicitCompanyId?: string) {
        const companyId = tenantOf(explicitCompanyId);
        const updateData = { ...body };
        for (const f of IMMUTABLE_FIELDS) delete updateData[f];
        if (updateData.projectId) await this.assertOwnedProject(String(updateData.projectId), companyId);

        await this.ownedCalendar(id, companyId);
        // `update` with the extra companyId filter (Prisma 5 extended unique where): still scoped, and unlike
        // updateMany it accepts the relation writes the FK normaliser in packages/db turns projectId/clientId into.
        const calendar = await getDb().contentCalendar.update({
            where: { id, companyId },
            data: updateData
        });
        return { ...calendar, _id: calendar.id };
    }

    static async deleteCalendar(id: string, explicitCompanyId?: string) {
        const companyId = tenantOf(explicitCompanyId);
        await this.ownedCalendar(id, companyId);
        await getDb().calendarContentPiece.deleteMany({ where: { calendarId: id } });
        const { count } = await getDb().contentCalendar.deleteMany({ where: { id, companyId } });
        if (!count) throw notFound('Calendar');
        return { success: true, message: 'Calendar deleted successfully' };
    }

    static async getCalendarPieces(calendarId: string, explicitCompanyId?: string) {
        const companyId = tenantOf(explicitCompanyId);
        await this.ownedCalendar(calendarId, companyId);
        const pieces: any[] = await getDb().calendarContentPiece.findMany({ 
            where: { calendarId }, 
            orderBy: { dateScheduled: 'asc' },
            take: 200
        });
        
        const mappedPieces = pieces.map(p => {
            let tags: any[] = [];
            if (p.hashtagsResearched) {
                if (typeof p.hashtagsResearched === 'string') {
                    try { tags = JSON.parse(p.hashtagsResearched); } catch(e) { tags = p.hashtagsResearched.split(',').map(s=>s.trim()); }
                } else if (Array.isArray(p.hashtagsResearched)) {
                    tags = p.hashtagsResearched;
                }
            }
            return expandAutopilotFields({
                ...p,
                _id: p.id,
                hashtags: tags,
                engagementTarget: {
                    estimatedImpressions: p.engagementTargetEstimatedImpressions || 0,
                    estimatedEngagementPercent: p.engagementTargetEstimatedEngagementPercent || 0
                }
            });
        });
        return mappedPieces;
    }

    static async updateCalendarPiece(pieceId: string, body: any, explicitCompanyId?: string, calendarId?: string) {
        const companyId = tenantOf(explicitCompanyId);
        const updateData = { ...body };
        for (const f of [...IMMUTABLE_FIELDS, 'calendarId', 'calendar']) delete updateData[f];

        if (updateData.hashtags !== undefined) {
            updateData.hashtagsResearched = JSON.stringify(updateData.hashtags);
            delete updateData.hashtags;
        }

        if (updateData.engagementTarget) {
            updateData.engagementTargetEstimatedImpressions = parseInt(updateData.engagementTarget.estimatedImpressions) || 0;
            updateData.engagementTargetEstimatedEngagementPercent = parseFloat(updateData.engagementTarget.estimatedEngagementPercent) || 0;
            delete updateData.engagementTarget;
        }

        if (updateData.dateScheduled) {
            updateData.dateScheduled = new Date(updateData.dateScheduled);
        }

        const scope: any = pieceScope(pieceId, companyId);
        if (calendarId) scope.calendarId = calendarId;
        if (!(await getDb().calendarContentPiece.findFirst({ where: scope, select: { id: true } }))) throw notFound('Calendar piece');
        const piece = await getDb().calendarContentPiece.update({ where: scope, data: updateData });

        let tags: any[] = [];
        if (piece.hashtagsResearched) {
            if (typeof piece.hashtagsResearched === 'string') {
                try { tags = JSON.parse(piece.hashtagsResearched); } catch(e) { tags = piece.hashtagsResearched.split(',').map(s=>s.trim()); }
            } else if (Array.isArray(piece.hashtagsResearched)) {
                tags = piece.hashtagsResearched;
            }
        }
        
        const mappedPiece = expandAutopilotFields({
            ...piece,
            _id: piece.id,
            hashtags: tags,
            engagementTarget: {
                estimatedImpressions: piece.engagementTargetEstimatedImpressions || 0,
                estimatedEngagementPercent: piece.engagementTargetEstimatedEngagementPercent || 0
            }
        });

        return mappedPiece;
    }
}
