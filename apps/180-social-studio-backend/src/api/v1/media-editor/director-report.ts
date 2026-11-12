/**
 * GET /api/v1/media-editor/director-report?days=7 (AI Director quality-fix plan, Phase 0).
 *
 * How many AI Director edit turns of the caller's workspace were planned by the offline rule-based planner instead
 * of the model in the last N days, why, on which provider/model, and which filters dropped planned operations.
 * Reads the final `TimelineChanged` run event of each Director run (its `turnLog`). Scoped to the verified
 * companyId; workspace admins only. Runs without a verified project are not stored, so they are not counted here
 * (the `[AI Director][turn]` server log line has every turn).
 */
import type { Request, Response } from 'express';
import { summarizeDirectorTurns } from '@workspace/ai';

export interface DirectorReportDeps {
    /** Payloads of final director TimelineChanged events of the company since `since`. */
    listTurnPayloads(companyId: string, since: Date): Promise<Array<Record<string, any>>>;
}

export function defaultDirectorReportDeps(): DirectorReportDeps {
    return {
        async listTurnPayloads(companyId, since) {
            const { prisma } = require('@workspace/db');
            const rows = await prisma.agentRunEvent.findMany({
                where: { companyId, agent: 'director', type: 'TimelineChanged', ts: { gte: since } },
                select: { payload: true },
                orderBy: { ts: 'desc' },
                take: 5000,
            });
            return rows.map((r: any) => r.payload || {});
        },
    };
}

/** Turn records out of stored payloads: the Phase 0 `turnLog`, or the older top-level fields. */
export function turnRecordsFromPayloads(payloads: Array<Record<string, any>>) {
    return payloads
        .filter((p) => p && p.final === true)
        .map((p) => (p.turnLog && typeof p.turnLog === 'object' ? p.turnLog : { plannerSource: p.plannerSource }))
        .filter((r) => typeof r.plannerSource === 'string');
}

export function directorReportHandler(deps: DirectorReportDeps = defaultDirectorReportDeps()) {
    return async (req: Request, res: Response) => {
        const companyId = (req as any).user?.companyId;
        if (!companyId) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
        const raw = parseInt(String(req.query.days ?? '7'), 10);
        const days = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 90) : 7;
        try {
            const since = new Date(Date.now() - days * 86_400_000);
            const records = turnRecordsFromPayloads(await deps.listTurnPayloads(companyId, since));
            return res.status(200).json({ success: true, report: summarizeDirectorTurns(records, days) });
        } catch (err: any) {
            console.error('[media-editor] director-report failed:', err?.message || err);
            return res.status(500).json({ success: false, error: 'INTERNAL', message: 'Unexpected error' });
        }
    };
}
