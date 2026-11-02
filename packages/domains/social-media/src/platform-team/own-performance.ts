/**
 * The creator's own published posts measured against THEIR usual result (never against other accounts).
 *
 * Source data: SocialPostVariant.platformMeta.metrics, written by post-metrics.ts from each network's official API.
 * Value = views when the platform reports them, otherwise likes + comments; each post is compared with the median of
 * the same project + platform + value basis (groups under 5 posts are skipped: no stable baseline).
 *
 * Used for: the writer's "hooks that worked for you" exemplars (autopilot) and Trend Lab's performance outlook.
 * Tenant data: always scoped by companyId + projectId and never cached across companies.
 */
import { labelAgainstOwnBaseline, OutcomeSample } from '@workspace/ai/content/learning/outcome-model';
import { readAutopilotPayload } from '@workspace/ai/content/autopilot';
import type { WinningExemplar } from '@workspace/ai/content/autopilot';
import { requireCompanyId } from '../tenant-scope';

export interface OwnPostOutcome {
    postId: string;
    platform: string;
    format: string;
    hook: string;
    multiple: number;
    publishedAt: string | null;
}

const MEDIA_FORMAT: Record<string, string> = { video: 'reel', carousel: 'carousel', image: 'static', document: 'carousel', text: 'text' };

const firstLine = (t: unknown) => String(t || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 200) || '';

export async function loadOwnPostOutcomes(db: any, params: { companyId: string; projectId: string; limit?: number }): Promise<OwnPostOutcome[]> {
    const companyId = requireCompanyId(params.companyId);
    const posts: any[] = await db.socialPost.findMany({
        where: { companyId, projectId: params.projectId, status: 'published' },
        orderBy: { publishedAt: 'desc' },
        take: params.limit ?? 300,
        select: {
            id: true, content: true, title: true, mediaType: true, publishedAt: true,
            variants: { select: { platform: true, publishStatus: true, platformMeta: true } },
            calendarPiece: { select: { videoScriptOrHooks: true } },
        },
    });
    const samples: (OutcomeSample & { meta: Omit<OwnPostOutcome, 'multiple' | 'platform'> })[] = [];
    for (const p of posts) {
        const payload = p.calendarPiece ? readAutopilotPayload(p.calendarPiece) : null;
        const format = String(payload?.format || MEDIA_FORMAT[p.mediaType] || 'static');
        const hook = String(payload?.spokenHook || '') || firstLine(p.title) || firstLine(p.content);
        for (const v of p.variants || []) {
            if (v.publishStatus !== 'published') continue;
            const m = v.platformMeta && typeof v.platformMeta === 'object' ? (v.platformMeta as any).metrics : null;
            if (!m) continue;
            const views = typeof m.views === 'number' ? m.views : null;
            const eng = typeof m.likes === 'number' || typeof m.comments === 'number' ? (m.likes || 0) + (m.comments || 0) : null;
            const basis = views !== null ? 'views' : eng !== null ? 'eng' : null;
            if (!basis) continue;
            samples.push({
                group: `${v.platform}:${basis}`, value: (basis === 'views' ? views : eng) as number, categorical: { platform: v.platform }, numeric: {},
                meta: { postId: p.id, format, hook, publishedAt: p.publishedAt ? new Date(p.publishedAt).toISOString() : null },
            });
        }
    }
    return labelAgainstOwnBaseline(samples).map((s: any) => ({
        ...s.meta, platform: String(s.categorical.platform), multiple: Math.round(s.multiple * 100) / 100,
    }));
}

/** Top hooks that beat the creator's usual by 1.5x or more (one per post, at most 5). */
export function winningExemplars(outcomes: OwnPostOutcome[], max = 5): WinningExemplar[] {
    const best = new Map<string, OwnPostOutcome>();
    for (const o of outcomes) {
        if (!o.hook || o.multiple < 1.5) continue;
        const prev = best.get(o.postId);
        if (!prev || o.multiple > prev.multiple) best.set(o.postId, o);
    }
    return [...best.values()].sort((a, b) => b.multiple - a.multiple).slice(0, max)
        .map((o) => ({ hook: o.hook, format: o.format, platform: o.platform, multiple: o.multiple }));
}
