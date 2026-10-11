/**
 * AI inbox settings per connected account: off | reply | qualify. Only platforms whose direct messages reach us
 * (Meta webhooks: Instagram and Facebook) can be switched on; everything is scoped to the caller's company.
 */
import { getDb } from '../publishing/http';
import { SocialDomainError, notFound, requireCompanyId } from '../tenant-scope';
import { AI_INBOX_MODES, AiInboxMode } from './ai-engagement-agent';

export const AI_INBOX_PLATFORMS = ['instagram', 'facebook', 'linkedin', 'threads', 'youtube', 'x'] as const;

const SETTINGS_SELECT = {
    id: true,
    platform: true,
    accountName: true,
    username: true,
    profileImageUrl: true,
    projectId: true,
    reauthRequired: true,
    aiInboxMode: true,
    aiInboxInstructions: true,
} as const;

function parseMode(mode: unknown): AiInboxMode {
    if (!AI_INBOX_MODES.includes(mode as AiInboxMode)) {
        throw new SocialDomainError('VALIDATION_FAILED', 400, `mode must be one of ${AI_INBOX_MODES.join(', ')}`);
    }
    return mode as AiInboxMode;
}

function parseInstructions(v: unknown): string | null | undefined {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    if (typeof v !== 'string' || v.length > 2000) throw new SocialDomainError('VALIDATION_FAILED', 400, 'instructions must be at most 2000 characters');
    return v.trim();
}

export class AiInboxService {
    /** Every active account of the company (optionally one project) with its AI inbox mode and whether DMs are supported. */
    static async listSettings(companyId: string, projectId?: string) {
        requireCompanyId(companyId);
        const accounts = await (getDb() as any).socialAccount.findMany({
            where: { companyId, isActive: true, ...(projectId ? { projectId } : {}) },
            select: SETTINGS_SELECT,
            orderBy: { createdAt: 'asc' },
        });
        return accounts.map((a: any) => ({ ...a, dmSupported: (AI_INBOX_PLATFORMS as readonly string[]).includes(String(a.platform).toLowerCase()) }));
    }

    static async setAccountMode(companyId: string, accountId: string, input: { mode: unknown; instructions?: unknown }) {
        requireCompanyId(companyId);
        const mode = parseMode(input?.mode);
        const instructions = parseInstructions(input?.instructions);
        const db = getDb() as any;
        const account = await db.socialAccount.findFirst({ where: { id: String(accountId), companyId, isActive: true }, select: { id: true, platform: true } });
        if (!account) throw notFound('Social account');
        if (mode !== 'off' && !(AI_INBOX_PLATFORMS as readonly string[]).includes(String(account.platform).toLowerCase())) {
            throw new SocialDomainError('AI_INBOX_UNSUPPORTED', 422, `Interactions from ${account.platform} do not reach 180 Workspace, so the AI inbox cannot answer them.`);
        }
        await db.socialAccount.updateMany({
            where: { id: account.id, companyId },
            data: { aiInboxMode: mode, ...(instructions !== undefined ? { aiInboxInstructions: instructions } : {}) },
        });
        return db.socialAccount.findFirst({ where: { id: account.id, companyId }, select: SETTINGS_SELECT });
    }

    /** One switch for many accounts, e.g. "AI replies on all my accounts". Unsupported platforms are skipped. */
    static async setModeBulk(companyId: string, input: { mode: unknown; platform?: unknown; projectId?: unknown }) {
        requireCompanyId(companyId);
        const mode = parseMode(input?.mode);
        const platform = input?.platform == null ? null : String(input.platform).toLowerCase();
        if (platform && !(AI_INBOX_PLATFORMS as readonly string[]).includes(platform as any)) {
            throw new SocialDomainError('AI_INBOX_UNSUPPORTED', 422, `The AI inbox supports ${AI_INBOX_PLATFORMS.join(', ')}.`);
        }
        const projectId = input?.projectId == null ? null : String(input.projectId);
        const db = getDb() as any;
        if (projectId && !(await db.project.findFirst({ where: { id: projectId, companyId }, select: { id: true } }))) throw notFound('Project');
        const result = await db.socialAccount.updateMany({
            where: {
                companyId,
                isActive: true,
                platform: platform ? platform : { in: [...AI_INBOX_PLATFORMS] },
                ...(projectId ? { projectId } : {}),
            },
            data: { aiInboxMode: mode },
        });
        return { updated: result.count, mode };
    }
}
