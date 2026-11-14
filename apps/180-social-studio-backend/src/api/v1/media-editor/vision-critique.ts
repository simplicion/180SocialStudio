/**
 * POST /media-editor/vision/critique (AI Director quality-fix plan, Phase 5). See AI_DIRECTOR_CONTRACT.md 2026-11-13 (e).
 *
 * multipart: `frames` (1..40 JPEG stills of the RENDERED edit, ≤ 400 KB each), `checkpoints` (JSON array, one per
 * frame, as the Director returned them: {tMs, kind, label, refs}), `width`, `height`, optional `aspect`, optional
 * `prompt` (the creator's request), and `consent=granted`. Native devices only.
 *
 * Same retention as the vision pass: the stills live in memory for this request only and are released when it ends.
 * Returns the VisualCritique (score, issues with fixes, summary); nothing is cached or stored.
 */
import type { Request, Response } from 'express';
import { VisualCheckpointSchema, type VisualCritique } from '@workspace/video-contracts';

export const MAX_CRITIQUE_FRAMES = 40;

export interface CritiqueDeps {
    resolveClient(companyId: string): Promise<{ client: any; label: string; model?: string } | null>;
    critique(p: { frames: any[]; request?: string; canvas: { width: number; height: number; aspect?: string } }, client: any, opts: { model?: string; label?: string }): Promise<VisualCritique>;
}

export function defaultCritiqueDeps(): CritiqueDeps {
    const ai = require('@workspace/ai');
    return {
        async resolveClient(companyId) {
            const { settings } = await ai.AICompanyConfigService.getCompanyAISettings(companyId, { purpose: 'director' });
            const client = await ai.AIProviderService.getInstance().getClient(settings, { purpose: 'director' });
            return client ? { client, label: `${client.provider}/${client.model}`, model: client.model } : null;
        },
        critique: ai.critiqueFrames,
    };
}

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const dim = (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 && n <= 16384 ? n : null;
};

export function critiqueHandler(deps: () => CritiqueDeps = defaultCritiqueDeps) {
    return async (req: Request, res: Response) => {
        const companyId = (req as any).user?.companyId;
        if (!companyId) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
        const files = ((req as any).files || []) as Array<{ buffer: Buffer }>;
        try {
            const b = req.body || {};
            if (b.consent !== 'granted') {
                return res.status(403).json({ success: false, error: 'CONSENT_REQUIRED', message: 'The creator has not allowed stills to be looked at.' });
            }
            if (!files.length) return res.status(400).json({ success: false, error: 'FRAMES_REQUIRED', message: "Upload the stills as multipart field 'frames'." });
            if (files.length > MAX_CRITIQUE_FRAMES) return res.status(413).json({ success: false, error: 'TOO_MANY_FRAMES', message: `At most ${MAX_CRITIQUE_FRAMES} stills.` });
            if (files.some((f) => !isJpeg(f.buffer))) return res.status(415).json({ success: false, error: 'UNSUPPORTED_FRAME_TYPE', message: 'Stills must be JPEG.' });
            let checkpoints: any[];
            try {
                checkpoints = JSON.parse(String(b.checkpoints ?? '[]'));
            } catch {
                checkpoints = [];
            }
            const parsed = Array.isArray(checkpoints) ? checkpoints.map((c) => VisualCheckpointSchema.safeParse(c)) : [];
            const width = dim(b.width);
            const height = dim(b.height);
            if (parsed.length !== files.length || parsed.some((p) => !p.success) || !width || !height) {
                return res.status(400).json({ success: false, error: 'INVALID_REQUEST', message: 'width, height and one checkpoint per still are required.' });
            }
            const prompt = typeof b.prompt === 'string' ? b.prompt.slice(0, 2000) : undefined;
            const aspect = typeof b.aspect === 'string' && /^(9:16|16:9|1:1|4:5)$/.test(b.aspect) ? b.aspect : undefined;
            const d = deps();
            let resolved: Awaited<ReturnType<CritiqueDeps['resolveClient']>> = null;
            try {
                resolved = await d.resolveClient(companyId);
            } catch (err: any) {
                console.error('[vision] critique: could not load AI settings:', err?.message || err);
            }
            if (!resolved) return res.status(503).json({ success: false, error: 'VISION_UNAVAILABLE', message: 'No AI provider is configured to look at stills.' });
            try {
                const critique = await d.critique(
                    {
                        frames: files.map((f, i) => ({ ...(parsed[i] as any).data, data: f.buffer.toString('base64') })),
                        request: prompt,
                        canvas: { width, height, aspect },
                    },
                    resolved.client,
                    { model: resolved.model, label: resolved.label }
                );
                return res.status(200).json({ success: true, data: critique });
            } catch (err: any) {
                console.error(`[vision] critique failed (${resolved.label}):`, String(err?.message || err).slice(0, 300));
                if (err?.code === 'NO_VISION_MODEL') return res.status(503).json({ success: false, error: 'VISION_UNAVAILABLE', message: 'The configured AI provider cannot look at images.' });
                return res.status(502).json({ success: false, error: 'CRITIQUE_FAILED', message: 'The check could not be made. The edit is unchanged.' });
            }
        } finally {
            for (const f of files) f.buffer = Buffer.alloc(0);
        }
    };
}
