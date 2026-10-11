/**
 * Calendar piece ↔ Studio bridge (WS5).
 *
 *  POST /api/v1/social-media/calendar-pieces/:pieceId/raw-footage   multipart "video" (+ optional "note")
 *       Raw footage intake. Streamed to a temp file by multer, then streamed to R2 (never held in memory).
 *       Appends the URL to piece.rawMediaUrls (and the linked post's rawMediaUrls). Limit: RAW_FOOTAGE_UPLOAD_MAX_MB
 *       (default 2048 MB). MP4 / MOV / WebM only, checked by container signature.
 *
 *  POST /api/v1/social-media/calendar-pieces/:pieceId/final-video   multipart "video" (+ optional "thumbnail", "notes")
 *       Native-device gated (like posts/:id/submit-for-approval). Creates the piece's SocialPost when it has none
 *       (SocialPostService.createPost with calendarPieceId), uploads the export, sets finalVideoUrl/thumbnailUrl,
 *       moves the post to in_review and the piece to pending_review. Publishing is not touched.
 *
 * Tenant scoping: every lookup and update repeats the caller's companyId from the verified JWT. A piece of another
 * company is a 404, exactly like a missing one, and nothing is uploaded for it.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Router, type NextFunction, type Request, type Response } from 'express';
// @ts-ignore - multer ships without bundled types in this workspace
import multer from 'multer';
import {
    deliverableMultipart,
    looksLikeIsoBmff,
    looksLikeImage,
    streamToR2,
    StorageNotConfigured,
} from '../posts/deliverable-upload';

const DEFAULT_RAW_MAX_MB = 2048;
const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const MAX_RAW_URLS = 20;
const TERMINAL_POST = ['publishing', 'published'];
export const RAW_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

export function maxRawFootageBytes(): number {
    const mb = Number(process.env.RAW_FOOTAGE_UPLOAD_MAX_MB || DEFAULT_RAW_MAX_MB);
    return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_RAW_MAX_MB) * 1024 * 1024;
}

const tmpDir = path.join(os.tmpdir(), '180ws-raw-footage');

/** multer: exactly one `video` part (MP4/MOV/WebM), streamed to a temp file. */
export const rawFootageMultipart = (req: Request, res: Response, next: NextFunction) => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const parser = multer({
        storage: multer.diskStorage({
            destination: tmpDir,
            filename: (_req: any, _file: any, cb: any) => cb(null, `${crypto.randomUUID()}.upload`),
        }),
        limits: { fileSize: maxRawFootageBytes(), files: 1, fields: 5 },
        fileFilter: (_req: any, file: any, cb: any) => {
            if (file.fieldname === 'video' && RAW_VIDEO_TYPES.includes(file.mimetype)) return cb(null, true);
            const err: any = new Error(`Unsupported upload: field "${file.fieldname}" with type "${file.mimetype}". Send "video" as video/mp4, video/quicktime or video/webm.`);
            err.code = 'UNSUPPORTED_MEDIA';
            cb(err, false);
        },
    }).single('video');
    parser(req, res, (err: any) => {
        if (!err) return next();
        const f: any = (req as any).file;
        if (f?.path) fs.promises.unlink(f.path).catch(() => undefined);
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, error: 'FILE_TOO_LARGE', message: `The video exceeds the ${Math.round(maxRawFootageBytes() / 1024 / 1024)} MB limit.` });
        }
        if (err.code === 'UNSUPPORTED_MEDIA') return res.status(415).json({ success: false, error: 'UNSUPPORTED_MEDIA', message: err.message });
        if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ success: false, error: 'BAD_UPLOAD', message: 'Send exactly one multipart file field named "video".' });
        }
        return res.status(400).json({ success: false, error: 'BAD_UPLOAD', message: err.message || 'Malformed multipart upload' });
    });
};

async function looksLikeWebm(filePath: string): Promise<boolean> {
    const fh = await fs.promises.open(filePath, 'r');
    try {
        const b = Buffer.alloc(4);
        await fh.read(b, 0, 4, 0);
        return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
    } finally {
        await fh.close();
    }
}

/** Data access + storage, injectable for tests. */
export interface CalendarPieceMediaDeps {
    findPiece(pieceId: string, companyId: string): Promise<any | null>;
    findPostForPiece(pieceId: string, companyId: string): Promise<any | null>;
    createPostForPiece(piece: any, companyId: string, userId: string, media: { finalVideoUrl?: string; thumbnailUrl?: string }): Promise<any>;
    updatePiece(pieceId: string, companyId: string, data: Record<string, any>): Promise<number>;
    updatePost(postId: string, companyId: string, data: Record<string, any>): Promise<number>;
    findPost(postId: string, companyId: string): Promise<any | null>;
    upload(filePath: string, key: string, contentType: string): Promise<string>;
}

const pieceScope = (id: string, companyId: string) => ({ id, OR: [{ companyId }, { companyId: null, calendar: { companyId } }] });

export function defaultCalendarPieceMediaDeps(): CalendarPieceMediaDeps {
    const db = () => require('@workspace/db').prisma;
    return {
        findPiece: (id, companyId) => db().calendarContentPiece.findFirst({ where: pieceScope(id, companyId), include: { calendar: { select: { id: true, projectId: true, clientId: true } } } }),
        findPostForPiece: (pieceId, companyId) => db().socialPost.findFirst({ where: { calendarPieceId: pieceId, companyId } }),
        createPostForPiece: async (piece, companyId, userId, media) => {
            // Reuse the existing post creation service; it reads the tenant from the request context.
            const { requestContext } = require('@workspace/db');
            const { SocialPostService } = require('@workspace/social-media');
            return requestContext.run({ companyId }, () =>
                SocialPostService.createPost(
                    {
                        projectId: piece.calendar?.projectId || undefined,
                        clientId: piece.calendar?.clientId || undefined,
                        calendarId: piece.calendarId,
                        calendarPieceId: piece.id,
                        title: piece.headline || undefined,
                        content: piece.adCopyFull || piece.headline || '',
                        rawMediaUrls: piece.rawMediaUrls || [],
                        finalVideoUrl: media.finalVideoUrl,
                        thumbnailUrl: media.thumbnailUrl,
                        mediaType: 'video',
                        metadata: { createdFrom: 'calendar-piece-final-video' },
                    },
                    userId,
                ),
            );
        },
        updatePiece: async (id, companyId, data) => (await db().calendarContentPiece.updateMany({ where: pieceScope(id, companyId), data })).count,
        updatePost: async (id, companyId, data) => (await db().socialPost.updateMany({ where: { id, companyId }, data })).count,
        findPost: (id, companyId) => db().socialPost.findFirst({ where: { id, companyId } }),
        upload: (filePath, key, contentType) => streamToR2(filePath, key, contentType),
    };
}

function cleanupFiles(req: Request) {
    const files: any[] = [];
    const r: any = req;
    if (r.file) files.push(r.file);
    for (const list of Object.values(r.files || {})) files.push(...(list as any[]));
    for (const f of files) if (f?.path) fs.promises.unlink(f.path).catch(() => undefined);
}

function storageError(res: Response, err: any, label: string) {
    if (err instanceof StorageNotConfigured || err?.name === 'StorageNotConfigured') {
        console.error(`[${label}]`, err.message);
        return res.status(503).json({ success: false, error: 'STORAGE_UNAVAILABLE', message: 'File storage is not configured on the server.' });
    }
    console.error(`[${label}] failed:`, err?.message || err);
    return res.status(502).json({ success: false, error: 'UPLOAD_FAILED', message: 'The video could not be stored. Please try again.' });
}

const extFor = (mime: string) => (mime === 'video/quicktime' ? 'mov' : mime === 'video/webm' ? 'webm' : 'mp4');

export function rawFootageHandler(deps: CalendarPieceMediaDeps = defaultCalendarPieceMediaDeps()) {
    return async (req: Request, res: Response) => {
        const user = (req as any).user;
        const companyId: string | undefined = user?.companyId;
        const video: any = (req as any).file;
        try {
            if (!user?.id || !companyId) return res.status(401).json({ success: false, error: 'Authentication required' });
            if (!video) return res.status(400).json({ success: false, error: 'VIDEO_REQUIRED', message: 'Attach the footage as multipart field "video".' });
            const piece = await deps.findPiece(String(req.params.pieceId), companyId);
            if (!piece) return res.status(404).json({ success: false, error: 'PIECE_NOT_FOUND', message: 'Calendar piece not found' });
            const okSig = video.mimetype === 'video/webm' ? await looksLikeWebm(video.path) : await looksLikeIsoBmff(video.path);
            if (!okSig) return res.status(415).json({ success: false, error: 'UNSUPPORTED_MEDIA', message: 'The uploaded file is not a playable MP4/MOV/WebM video.' });
            if ((piece.rawMediaUrls || []).length >= MAX_RAW_URLS) {
                return res.status(409).json({ success: false, error: 'TOO_MANY_RAW_FILES', message: `A piece can hold at most ${MAX_RAW_URLS} raw footage files.` });
            }
            const key = `social-media/raw-footage/${companyId}/${piece.id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extFor(video.mimetype)}`;
            const url = await deps.upload(video.path, key, video.mimetype);
            const rawMediaUrls = [...(piece.rawMediaUrls || []), url];
            const count = await deps.updatePiece(piece.id, companyId, {
                rawMediaUrls,
                // Footage is in: the piece is now being worked on (never moves a reviewed/published piece back).
                ...(['ready', 'draft', 'planned', 'idea', ''].includes(piece.status || '') ? { status: 'in_progress' } : {}),
            });
            if (count !== 1) return res.status(404).json({ success: false, error: 'PIECE_NOT_FOUND', message: 'Calendar piece not found' });
            const post = await deps.findPostForPiece(piece.id, companyId);
            if (post) await deps.updatePost(post.id, companyId, { rawMediaUrls: [...(post.rawMediaUrls || []), url].slice(-MAX_RAW_URLS) });
            return res.status(201).json({
                success: true,
                data: { pieceId: piece.id, url, rawMediaUrls, bytes: video.size, contentType: video.mimetype, postId: post?.id || null },
            });
        } catch (err: any) {
            return storageError(res, err, 'RawFootage');
        } finally {
            cleanupFiles(req);
        }
    };
}

export function finalVideoHandler(deps: CalendarPieceMediaDeps = defaultCalendarPieceMediaDeps()) {
    return async (req: Request, res: Response) => {
        const user = (req as any).user;
        const companyId: string | undefined = user?.companyId;
        const files: any = (req as any).files || {};
        const video = files.video?.[0];
        const thumbnail = files.thumbnail?.[0];
        try {
            if (!user?.id || !companyId) return res.status(401).json({ success: false, error: 'Authentication required' });
            if (!video) return res.status(400).json({ success: false, error: 'VIDEO_REQUIRED', message: 'Attach the rendered MP4 as multipart field "video".' });
            const piece = await deps.findPiece(String(req.params.pieceId), companyId);
            if (!piece) return res.status(404).json({ success: false, error: 'PIECE_NOT_FOUND', message: 'Calendar piece not found' });
            let post = await deps.findPostForPiece(piece.id, companyId);
            if (post && TERMINAL_POST.includes(post.status)) {
                return res.status(409).json({ success: false, error: 'POST_ALREADY_PUBLISHED', message: `This piece's post is ${post.status}; repurpose it instead.` });
            }
            if (!(await looksLikeIsoBmff(video.path))) {
                return res.status(415).json({ success: false, error: 'UNSUPPORTED_MEDIA', message: 'The uploaded file is not an MP4/MOV video.' });
            }
            if (thumbnail && (thumbnail.size > MAX_THUMBNAIL_BYTES || !(await looksLikeImage(thumbnail.path)))) {
                return res.status(415).json({ success: false, error: 'UNSUPPORTED_MEDIA', message: 'The thumbnail must be a JPEG/PNG/WebP image under 5 MB.' });
            }

            const base = `social-media/deliverables/${companyId}/pieces/${piece.id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
            const finalVideoUrl = await deps.upload(video.path, `${base}.${extFor(video.mimetype)}`, video.mimetype);
            const thumbnailUrl = thumbnail
                ? await deps.upload(thumbnail.path, `${base}-thumb.${thumbnail.mimetype.split('/')[1].replace('jpeg', 'jpg')}`, thumbnail.mimetype)
                : undefined;

            let createdPost = false;
            if (!post) {
                try {
                    post = await deps.createPostForPiece(piece, companyId, user.id, { finalVideoUrl, thumbnailUrl });
                    createdPost = true;
                } catch (err: any) {
                    // A concurrent upload created it first (calendarPieceId is unique): use that one.
                    post = await deps.findPostForPiece(piece.id, companyId);
                    if (!post) throw err;
                }
            }

            const notes = typeof (req as any).body?.notes === 'string' ? (req as any).body.notes.slice(0, 5000) : undefined;
            let metadata: any = post.metadata || {};
            if (typeof metadata === 'string') {
                try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
            }
            const deliverable = {
                url: finalVideoUrl,
                thumbnailUrl: thumbnailUrl || null,
                bytes: video.size,
                contentType: video.mimetype,
                uploadedById: user.id,
                uploadedAt: new Date().toISOString(),
                source: typeof (req as any).body?.source === 'string' ? (req as any).body.source.slice(0, 40) : 'studio',
                deviceId: (req as any).desktopDeviceId || null,
                calendarPieceId: piece.id,
            };
            const wasApproved = post.status === 'approved';
            const updated = await deps.updatePost(post.id, companyId, {
                finalVideoUrl,
                ...(thumbnailUrl ? { thumbnailUrl } : {}),
                mediaType: 'video',
                status: 'in_review',
                ...(notes !== undefined ? { revisionNotes: notes } : {}),
                ...(wasApproved ? { versionNumber: (post.versionNumber || 1) + 1 } : {}),
                metadata: { ...metadata, lastDeliverable: deliverable, deliverableHistory: [...(metadata.deliverableHistory || []).slice(-19), deliverable] },
            });
            if (updated !== 1) return res.status(404).json({ success: false, error: 'POST_NOT_FOUND', message: 'The linked post could not be updated.' });
            await deps.updatePiece(piece.id, companyId, { finalVideoUrl, ...(thumbnailUrl ? { thumbnailUrl } : {}), status: 'pending_review' });

            const fresh = await deps.findPost(post.id, companyId);
            return res.status(201).json({ success: true, data: { post: fresh, createdPost, pieceId: piece.id, pieceStatus: 'pending_review', deliverable } });
        } catch (err: any) {
            return storageError(res, err, 'PieceFinalVideo');
        } finally {
            cleanupFiles(req);
        }
    };
}

type Middleware = (req: Request, res: Response, next: NextFunction) => any;

export function calendarPieceMediaRouter(opts: { deps?: CalendarPieceMediaDeps; deviceGate?: Middleware } = {}): Router {
    const router = Router();
    const gate: Middleware = opts.deviceGate || require('../../desktop/desktop-device').requireNativeDevice;
    router.post('/:pieceId/raw-footage', rawFootageMultipart, rawFootageHandler(opts.deps));
    router.post('/:pieceId/final-video', gate, deliverableMultipart, finalVideoHandler(opts.deps));
    return router;
}
