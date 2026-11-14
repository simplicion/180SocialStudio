/**
 * Vision pass routes (AI Director quality-fix plan, Phase 2). See AI_DIRECTOR_CONTRACT.md "Addendum 2026-11-13 (b)".
 *
 *   GET  /media-editor/vision/shot-log?assetId=&sourceHash=   → the cached ShotLog of this company, or 404 (no upload needed)
 *   POST /media-editor/vision/shot-log  (multipart)           → describes the stills, returns the ShotLog
 *
 * POST fields: `frames` (1..60 JPEG files, ≤ 400 KB each), `timesMs` (JSON array, one source time per frame, same
 * order), `assetId`, `sourceHash`, `durationMs`, `width`, `height`, optional `scenesMs` (JSON array), and
 * `consent=granted` (the creator allowed stills to be looked at). Native devices only.
 *
 * Retention: the stills are held in memory for this request only. They are never written to disk, logged or cached;
 * only the text ShotLog is cached (per company + source hash).
 */
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { MAX_SHOTLOG_FRAMES, type ShotLog } from '@workspace/video-contracts';

export const MAX_FRAME_BYTES = 400 * 1024;

export interface VisionDeps {
    /** The Director's AI client for the company (vision-capable), or null when none is configured. */
    resolveClient(companyId: string): Promise<{ client: any; label: string; model?: string } | null>;
    buildShotLog(req: any, client: any, opts: { model?: string; label?: string }): Promise<ShotLog>;
    cache: { key(companyId: string, sourceHash: string): string; get(key: string): ShotLog | null; set(key: string, log: ShotLog): void };
}

export function defaultVisionDeps(): VisionDeps {
    const ai = require('@workspace/ai');
    return {
        async resolveClient(companyId) {
            const { settings } = await ai.AICompanyConfigService.getCompanyAISettings(companyId, { purpose: 'director' });
            const client = await ai.AIProviderService.getInstance().getClient(settings, { purpose: 'director' });
            if (!client) return null;
            return { client, label: `${client.provider}/${client.model}`, model: client.model };
        },
        buildShotLog: ai.buildShotLog,
        cache: ai.shotLogCache,
    };
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FRAME_BYTES, files: MAX_SHOTLOG_FRAMES, fields: 20, fieldSize: 64 * 1024 },
    fileFilter: (_req, file, cb) => {
        if ((file.mimetype || '').toLowerCase() === 'image/jpeg') return cb(null, true);
        const err: any = new Error(`Frames must be JPEG (got ${file.mimetype})`);
        err.code = 'UNSUPPORTED_FRAME_TYPE';
        cb(err);
    },
});

export function framesUpload(req: Request, res: Response, next: NextFunction) {
    upload.array('frames', MAX_SHOTLOG_FRAMES)(req, res, (err: any) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, error: 'FRAME_TOO_LARGE', message: `Each frame must be ${MAX_FRAME_BYTES / 1024} KB or smaller.` });
        if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(413).json({ success: false, error: 'TOO_MANY_FRAMES', message: `At most ${MAX_SHOTLOG_FRAMES} frames.` });
        if (err.code === 'UNSUPPORTED_FRAME_TYPE') return res.status(415).json({ success: false, error: 'UNSUPPORTED_FRAME_TYPE', message: err.message });
        return res.status(400).json({ success: false, error: 'INVALID_UPLOAD', message: err.message });
    });
}

const ID = /^[A-Za-z0-9._:@-]{1,128}$/;
const HASH = /^[A-Za-z0-9_-]{8,128}$/;
const intIn = (v: unknown, max: number) => {
    const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
    return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};
const msList = (v: unknown, max: number): number[] | null => {
    if (v === undefined || v === '') return [];
    try {
        const a = typeof v === 'string' ? JSON.parse(v) : v;
        if (!Array.isArray(a) || a.length > max) return null;
        const out = a.map((x) => intIn(x, 4 * 60 * 60 * 1000));
        return out.every((x) => x !== null) ? (out as number[]) : null;
    } catch {
        return null;
    }
};
const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export function cachedShotLogHandler(deps: () => VisionDeps = defaultVisionDeps) {
    return (req: Request, res: Response) => {
        const companyId = (req as any).user?.companyId;
        if (!companyId) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
        const assetId = String(req.query.assetId ?? '');
        const sourceHash = String(req.query.sourceHash ?? '');
        if (!ID.test(assetId) || !HASH.test(sourceHash)) return res.status(400).json({ success: false, error: 'INVALID_REQUEST' });
        const d = deps();
        const log = d.cache.get(d.cache.key(companyId, sourceHash));
        if (!log) return res.status(404).json({ success: false, error: 'NOT_CACHED' });
        return res.status(200).json({ success: true, data: { ...log, assetId }, cached: true });
    };
}

export function shotLogHandler(deps: () => VisionDeps = defaultVisionDeps) {
    return async (req: Request, res: Response) => {
        const companyId = (req as any).user?.companyId;
        if (!companyId) return res.status(401).json({ success: false, error: 'UNAUTHENTICATED' });
        const files = ((req as any).files || []) as Array<{ buffer: Buffer }>;
        const b = req.body || {};
        if (b.consent !== 'granted') {
            return res.status(403).json({ success: false, error: 'CONSENT_REQUIRED', message: 'The creator has not allowed stills of this clip to be looked at.' });
        }
        const assetId = String(b.assetId ?? '');
        const sourceHash = String(b.sourceHash ?? '');
        const durationMs = intIn(b.durationMs, 4 * 60 * 60 * 1000);
        const width = intIn(b.width, 16384);
        const height = intIn(b.height, 16384);
        const timesMs = msList(b.timesMs, MAX_SHOTLOG_FRAMES);
        const scenesMs = msList(b.scenesMs, 2000);
        if (!ID.test(assetId) || !HASH.test(sourceHash) || !durationMs || !width || !height || !timesMs || !scenesMs) {
            return res.status(400).json({ success: false, error: 'INVALID_REQUEST', message: 'assetId, sourceHash, durationMs, width, height and timesMs are required.' });
        }
        if (!files.length) return res.status(400).json({ success: false, error: 'FRAMES_REQUIRED', message: "Upload the stills as multipart field 'frames'." });
        if (files.length !== timesMs.length) return res.status(400).json({ success: false, error: 'INVALID_REQUEST', message: 'timesMs must have one time per frame.' });
        if (files.some((f) => !isJpeg(f.buffer))) return res.status(415).json({ success: false, error: 'UNSUPPORTED_FRAME_TYPE', message: 'Frames must be JPEG.' });
        if (timesMs.some((t) => t > durationMs)) return res.status(400).json({ success: false, error: 'INVALID_REQUEST', message: 'A frame time is past the end of the clip.' });

        const d = deps();
        const key = d.cache.key(companyId, sourceHash);
        const hit = d.cache.get(key);
        if (hit) return res.status(200).json({ success: true, data: { ...hit, assetId }, cached: true });

        let resolved: Awaited<ReturnType<VisionDeps['resolveClient']>>;
        try {
            resolved = await d.resolveClient(companyId);
        } catch (err: any) {
            console.error('[vision] could not load AI settings:', err?.message || err);
            resolved = null;
        }
        if (!resolved) return res.status(503).json({ success: false, error: 'VISION_UNAVAILABLE', message: 'No AI provider is configured to look at stills.' });

        try {
            const log = await d.buildShotLog(
                { assetId, sourceHash, durationMs, width, height, scenesMs, frames: files.map((f, i) => ({ tMs: timesMs[i], data: f.buffer.toString('base64') })) },
                resolved.client,
                { model: resolved.model, label: resolved.label }
            );
            d.cache.set(key, log);
            return res.status(200).json({ success: true, data: log, cached: false });
        } catch (err: any) {
            // The provider's message is logged with provider/model; frames are never part of it.
            console.error(`[vision] shot log failed (${resolved.label}):`, String(err?.message || err).slice(0, 300));
            if (err?.code === 'NO_VISION_MODEL') return res.status(503).json({ success: false, error: 'VISION_UNAVAILABLE', message: 'The configured AI provider cannot look at images.' });
            return res.status(502).json({ success: false, error: 'VISION_FAILED', message: 'The stills could not be described. Editing continues without them.' });
        } finally {
            // Drop the stills now, not when the request object is collected.
            for (const f of files) f.buffer = Buffer.alloc(0);
        }
    };
}
