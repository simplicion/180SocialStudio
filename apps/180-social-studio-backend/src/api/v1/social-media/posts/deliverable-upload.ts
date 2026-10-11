/**
 * "Submit for client approval" from native clients (the Flutter mobile app): upload a finished, client-rendered MP4,
 * attach it to a SocialPost and move the post to `in_review`, which is what the web ContentDetailDrawer / project
 * content list show as awaiting approval.
 *
 * - The file is streamed to disk by multer and then streamed to R2; it is never held in memory whole.
 * - No FFmpeg runs here (media processing belongs to the native apps): we only check the container signature.
 * - Tenant scoping: the post is looked up by id AND the caller's companyId from the verified JWT.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { NextFunction, Request, Response } from 'express';
// @ts-ignore - multer ships without bundled types in this workspace
import multer from 'multer';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
// DB / storage helpers are required lazily so the multipart gate can be unit-tested without a database.
const db = () => require('@workspace/db').prisma;

const DEFAULT_MAX_MB = 300;

export function maxDeliverableBytes(): number {
    const mb = Number(process.env.MOBILE_VIDEO_UPLOAD_MAX_MB || DEFAULT_MAX_MB);
    return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_MB) * 1024 * 1024;
}

const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
const VIDEO_TYPES = ['video/mp4', 'video/quicktime'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const tmpDir = path.join(os.tmpdir(), '180ws-deliverables');

/** multer: `video` (required, MP4/MOV) and optional `thumbnail` (JPEG/PNG/WebP), streamed to a temp dir. */
export const deliverableMultipart = (req: Request, res: Response, next: NextFunction) => {
    fs.mkdirSync(tmpDir, { recursive: true });
    const parser = multer({
        storage: multer.diskStorage({
            destination: tmpDir,
            filename: (_req: any, _file: any, cb: any) => cb(null, `${crypto.randomUUID()}.upload`),
        }),
        limits: { fileSize: maxDeliverableBytes(), files: 2, fields: 10 },
        fileFilter: (_req: any, file: any, cb: any) => {
            if (file.fieldname === 'video' && VIDEO_TYPES.includes(file.mimetype)) return cb(null, true);
            if (file.fieldname === 'thumbnail' && IMAGE_TYPES.includes(file.mimetype)) return cb(null, true);
            const err: any = new Error(`Unsupported upload: field "${file.fieldname}" with type "${file.mimetype}". Send "video" as video/mp4 (or video/quicktime) and optional "thumbnail" as image/jpeg|png|webp.`);
            err.code = 'UNSUPPORTED_MEDIA';
            cb(err, false);
        },
    }).fields([{ name: 'video', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]);

    parser(req, res, (err: any) => {
        if (!err) return next();
        cleanup(req);
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, error: 'FILE_TOO_LARGE', message: `The video exceeds the ${Math.round(maxDeliverableBytes() / 1024 / 1024)} MB limit.` });
        }
        if (err.code === 'UNSUPPORTED_MEDIA') return res.status(415).json({ success: false, error: 'UNSUPPORTED_MEDIA', message: err.message });
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({ success: false, error: 'BAD_UPLOAD', message: 'Only the multipart file fields "video" and "thumbnail" are accepted (one each).' });
        }
        return res.status(400).json({ success: false, error: 'BAD_UPLOAD', message: err.message || 'Malformed multipart upload' });
    });
};

function filesOf(req: Request): { video?: any; thumbnail?: any } {
    const files: any = (req as any).files || {};
    return { video: files.video?.[0], thumbnail: files.thumbnail?.[0] };
}

function cleanup(req: Request) {
    const { video, thumbnail } = filesOf(req);
    for (const f of [video, thumbnail]) {
        if (f?.path) fs.promises.unlink(f.path).catch(() => undefined);
    }
}

/** ISO BMFF (MP4/MOV) files carry the `ftyp` box at byte offset 4. Cheap guard against mislabelled uploads. */
export async function looksLikeIsoBmff(filePath: string): Promise<boolean> {
    const fh = await fs.promises.open(filePath, 'r');
    try {
        const buf = Buffer.alloc(12);
        await fh.read(buf, 0, 12, 0);
        return buf.toString('latin1', 4, 8) === 'ftyp';
    } finally {
        await fh.close();
    }
}

export async function looksLikeImage(filePath: string): Promise<boolean> {
    const fh = await fs.promises.open(filePath, 'r');
    try {
        const b = Buffer.alloc(12);
        await fh.read(b, 0, 12, 0);
        const jpeg = b[0] === 0xff && b[1] === 0xd8;
        const png = b.toString('latin1', 1, 4) === 'PNG';
        const webp = b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP';
        return jpeg || png || webp;
    } finally {
        await fh.close();
    }
}

/** R2 client from env. No fallbacks: a missing credential is a deployment error and must fail loudly. */
let s3: S3Client | null = null;
function r2(): { client: S3Client; bucket: string } {
    const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT || process.env.R2_ENDPOINT;
    const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY;
    const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_KEY;
    const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME || process.env.R2_BUCKET_NAME;
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
        throw new StorageNotConfigured('R2 storage is not configured (R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET_NAME).');
    }
    if (!s3) s3 = new S3Client({ region: 'auto', endpoint, credentials: { accessKeyId, secretAccessKey }, maxAttempts: 3 });
    return { client: s3, bucket };
}

export class StorageNotConfigured extends Error {}

export async function streamToR2(filePath: string, key: string, contentType: string) {
    const { client, bucket } = r2();
    await new Upload({
        client,
        params: { Bucket: bucket, Key: key, Body: fs.createReadStream(filePath), ContentType: contentType },
        queueSize: 4,
        partSize: 8 * 1024 * 1024,
    }).done();
    return require('@workspace/integrations').getR2PublicUrl(key) as string;
}

const TERMINAL = ['publishing', 'published'];

export async function submitForApproval(req: Request, res: Response) {
    const user = (req as any).user;
    const companyId: string | undefined = user?.companyId;
    const { video, thumbnail } = filesOf(req);
    try {
        if (!user?.id || !companyId) return res.status(401).json({ success: false, error: 'Authentication required' });
        if (!video) return res.status(400).json({ success: false, error: 'VIDEO_REQUIRED', message: 'Attach the rendered MP4 as multipart field "video".' });

        const post = await db().socialPost.findFirst({ where: { id: String(req.params.id), companyId } });
        if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
        if (TERMINAL.includes(post.status)) {
            return res.status(409).json({ success: false, error: 'POST_ALREADY_PUBLISHED', message: `This post is ${post.status}; create a new version or repurpose it instead.` });
        }

        if (!(await looksLikeIsoBmff(video.path))) {
            return res.status(415).json({ success: false, error: 'UNSUPPORTED_MEDIA', message: 'The uploaded file is not an MP4/MOV video.' });
        }
        if (thumbnail && (thumbnail.size > MAX_THUMBNAIL_BYTES || !(await looksLikeImage(thumbnail.path)))) {
            return res.status(415).json({ success: false, error: 'UNSUPPORTED_MEDIA', message: 'The thumbnail must be a JPEG/PNG/WebP image under 5 MB.' });
        }

        const base = `social-media/deliverables/${companyId}/${post.id}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
        const ext = video.mimetype === 'video/quicktime' ? 'mov' : 'mp4';
        const finalVideoUrl = await streamToR2(video.path, `${base}.${ext}`, video.mimetype);
        const thumbnailUrl = thumbnail
            ? await streamToR2(thumbnail.path, `${base}-thumb.${thumbnail.mimetype.split('/')[1].replace('jpeg', 'jpg')}`, thumbnail.mimetype)
            : undefined;

        const notes = typeof req.body?.notes === 'string' ? req.body.notes.slice(0, 5000) : undefined;
        const wasApproved = post.status === 'approved';
        let metadata: any = post.metadata || {};
        if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch { metadata = {}; } }
        const deliverable = {
            url: finalVideoUrl,
            thumbnailUrl: thumbnailUrl || null,
            bytes: video.size,
            contentType: video.mimetype,
            uploadedById: user.id,
            uploadedAt: new Date().toISOString(),
            source: typeof req.body?.source === 'string' ? req.body.source.slice(0, 40) : 'native-app',
            deviceId: (req as any).desktopDeviceId || null,
        };

        // Scoped update: the where clause repeats companyId so this can never touch another tenant's row.
        const updated = await db().socialPost.updateMany({
            where: { id: post.id, companyId },
            data: {
                finalVideoUrl,
                ...(thumbnailUrl ? { thumbnailUrl } : {}),
                mediaType: 'video',
                status: 'in_review',
                ...(notes !== undefined ? { revisionNotes: notes } : {}),
                // A new cut of an already-approved post is a new version that needs approval again.
                ...(wasApproved ? { versionNumber: (post.versionNumber || 1) + 1 } : {}),
                metadata: { ...metadata, lastDeliverable: deliverable, deliverableHistory: [...(metadata.deliverableHistory || []).slice(-19), deliverable] },
            },
        });
        if (updated.count !== 1) return res.status(404).json({ success: false, error: 'Post not found' });

        if (post.calendarPieceId) {
            await db().calendarContentPiece.updateMany({
                // Legacy pieces may have a null companyId; they are still scoped through their calendar's company.
                where: { id: post.calendarPieceId, OR: [{ companyId }, { companyId: null, calendar: { companyId } }] },
                data: { finalVideoUrl, ...(thumbnailUrl ? { thumbnailUrl } : {}), status: 'pending_review' },
            });
        }

        const fresh = await db().socialPost.findFirst({ where: { id: post.id, companyId } });
        return res.status(201).json({ success: true, post: fresh, deliverable });
    } catch (err: any) {
        if (err instanceof StorageNotConfigured) {
            console.error('[SubmitForApproval]', err.message);
            return res.status(503).json({ success: false, error: 'STORAGE_UNAVAILABLE', message: 'File storage is not configured on the server.' });
        }
        console.error('[SubmitForApproval] failed:', err?.message || err);
        return res.status(502).json({ success: false, error: 'UPLOAD_FAILED', message: 'The video could not be stored. Please try again.' });
    } finally {
        cleanup(req);
    }
}
