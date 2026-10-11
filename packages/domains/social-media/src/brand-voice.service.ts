import { prisma, requestContext } from '@workspace/db';

export interface UpsertBrandVoiceDTO {
    tone?: string;
    targetAudience?: string;
    sampleViralPosts?: string[];
    forbiddenWords?: string[];
    defaultHashtags?: string[];
    standardCtas?: string[];
    metadata?: Record<string, any>;
}

const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : undefined;

/**
 * Legacy brand-voice endpoints (`GET/POST /brand-voice/:projectId`) used by the mobile app.
 * The full brand profile lives behind `/projects/:id/brand-consciousness` (brand-consciousness.ts); both read and
 * write the same BrandVoiceProfile row. Nothing here invents values: an absent profile returns empty fields.
 */
export class BrandVoiceService {
    private static async assertProject(projectId: string, companyId: string) {
        const project = await (prisma as any).project.findFirst({
            where: { id: projectId, companyId, projectType: 'social_media', deletedAt: null },
            select: { id: true },
        });
        if (!project) throw new Error('Project not found');
    }

    static async getBrandVoice(projectId: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new Error('Company context required');
        await this.assertProject(projectId, companyId);

        const profile = await (prisma as any).brandVoiceProfile.findFirst({
            where: { companyId, projectId }
        });

        if (!profile) {
            return {
                projectId,
                companyId,
                tone: '',
                targetAudience: '',
                sampleViralPosts: [],
                forbiddenWords: [],
                defaultHashtags: [],
                standardCtas: [],
                metadata: {}
            };
        }

        return profile;
    }

    /** Partial upsert: absent fields stay as they are; metadata is merged so brand-consciousness keys survive. */
    static async upsertBrandVoice(
        projectIdOrData: string | (UpsertBrandVoiceDTO & { projectId?: string }),
        maybeData?: UpsertBrandVoiceDTO
    ) {
        const projectId = typeof projectIdOrData === 'string' ? projectIdOrData : (projectIdOrData.projectId as string);
        const data = (typeof projectIdOrData === 'string' ? maybeData : projectIdOrData) || {};
        if (!projectId) throw new Error('Project ID required');

        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new Error('Company context required');
        await this.assertProject(projectId, companyId);

        const existing = await (prisma as any).brandVoiceProfile.findFirst({ where: { companyId, projectId } });
        const oldMeta = existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata) ? existing.metadata : {};
        const incomingMeta = data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata) ? data.metadata : {};
        // `brand` is owned by the brand-consciousness endpoints and validated there; never overwrite it from here.
        const { brand: _ignored, ...safeIncoming } = incomingMeta as Record<string, any>;

        const fields = {
            ...(typeof data.tone === 'string' ? { tone: data.tone.trim() } : {}),
            ...(typeof data.targetAudience === 'string' ? { targetAudience: data.targetAudience.trim() } : {}),
            ...(strings(data.sampleViralPosts) ? { sampleViralPosts: strings(data.sampleViralPosts) } : {}),
            ...(strings(data.forbiddenWords) ? { forbiddenWords: strings(data.forbiddenWords) } : {}),
            ...(strings(data.defaultHashtags) ? { defaultHashtags: strings(data.defaultHashtags) } : {}),
            ...(strings(data.standardCtas) ? { standardCtas: strings(data.standardCtas) } : {}),
            metadata: { ...oldMeta, ...safeIncoming },
        };

        if (existing) {
            return (prisma as any).brandVoiceProfile.update({ where: { id: existing.id }, data: fields });
        }
        return (prisma as any).brandVoiceProfile.create({
            // Non-null columns: '' rather than the schema default, so no invented tone/audience is stored.
            data: { companyId, projectId, tone: '', targetAudience: '', ...fields },
        });
    }
}
