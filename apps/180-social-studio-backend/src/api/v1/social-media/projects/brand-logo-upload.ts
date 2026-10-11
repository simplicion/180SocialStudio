/**
 * `POST /api/v1/social-media/projects/:id/brand-consciousness/logo`: multipart field `logo`, PNG / JPEG / WebP / SVG,
 * at most BRAND_LOGO_MAX_BYTES. Stores the file in R2 (existing storage utilities) and saves the URL as the brand's
 * `logoUrl`.
 *
 * - Tenant scoping: the project is checked against the caller's companyId BEFORE anything is stored.
 * - The declared MIME type is not trusted: the file signature must match (and SVGs must not carry scripts).
 * - Storage credentials come from env only; if they are missing the request fails with 503 STORAGE_UNAVAILABLE.
 */
import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
// @ts-ignore - multer ships without bundled types in this workspace
import multer from 'multer';

export const BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const BRAND_LOGO_TYPES: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
};

export class StorageNotConfiguredError extends Error {}

export interface BrandLogoDeps {
    /** Throws BrandConsciousnessError(404) when the project is not the caller's. */
    assertProject: (projectId: string, companyId: string) => Promise<{ logoUrl: string | null }>;
    upload: (buffer: Buffer, key: string, mimetype: string) => Promise<{ url: string }>;
    saveLogoUrl: (projectId: string, companyId: string, logoUrl: string) => Promise<any>;
    /** Best-effort removal of the previous logo object; failures are ignored. */
    removeOld?: (url: string) => Promise<unknown>;
}

/** multer (memory, the file is small) with client errors reported as 400 / 413 / 415. */
export const brandLogoMultipart = (req: Request, res: Response, next: NextFunction) => {
    const parser = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: BRAND_LOGO_MAX_BYTES, files: 1, fields: 5 },
        fileFilter: (_req: any, file: any, cb: any) => {
            if (file.fieldname === 'logo' && BRAND_LOGO_TYPES[file.mimetype]) return cb(null, true);
            const err: any = new Error(`Unsupported logo: field "${file.fieldname}" with type "${file.mimetype}". Send multipart field "logo" as PNG, JPEG, WebP or SVG.`);
            err.code = 'UNSUPPORTED_MEDIA';
            cb(err, false);
        },
    }).single('logo');
    parser(req, res, (err: any) => {
        if (!err) return next();
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ success: false, error: 'FILE_TOO_LARGE', message: `The logo exceeds the ${BRAND_LOGO_MAX_BYTES / 1024 / 1024} MB limit.` });
        }
        if (err.code === 'UNSUPPORTED_MEDIA') return res.status(415).json({ success: false, error: 'UNSUPPORTED_MEDIA', message: err.message });
        if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ success: false, error: 'BAD_UPLOAD', message: 'Send exactly one file in the multipart field "logo".' });
        }
        return res.status(400).json({ success: false, error: 'BAD_UPLOAD', message: err.message || 'Malformed multipart upload' });
    });
};

/** Checks the bytes, not the declared type. Returns an error message or null. */
export function inspectLogo(buffer: Buffer, mimetype: string): string | null {
    if (!buffer?.length) return 'The logo file is empty.';
    const b = buffer;
    switch (mimetype) {
        case 'image/png':
            return b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? null : 'The file is not a PNG image.';
        case 'image/jpeg':
            return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? null : 'The file is not a JPEG image.';
        case 'image/webp':
            return b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? null : 'The file is not a WebP image.';
        case 'image/svg+xml': {
            const text = b.toString('utf8').replace(/^﻿/, '');
            if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(text)) return 'The file is not an SVG image.';
            if (/<script[\s>]|<foreignObject[\s>]|\son[a-z]+\s*=|javascript:|<!ENTITY|(xlink:)?href\s*=\s*["']\s*(https?:|data:(?!image\/(png|jpeg|webp))|\/\/)/i.test(text)) {
                return 'SVG logos may not contain scripts, event handlers, entities or external references.';
            }
            return null;
        }
        default:
            return 'Unsupported logo type.';
    }
}

export function brandLogoHandler(deps: BrandLogoDeps) {
    return async (req: Request, res: Response) => {
        const companyId: string | undefined = (req as any).user?.companyId || (req as any).companyId;
        const projectId = String(req.params.id || '');
        try {
            if (!companyId) return res.status(401).json({ success: false, error: 'COMPANY_REQUIRED', message: 'Authentication required' });
            const current = await deps.assertProject(projectId, companyId);

            const file = (req as any).file;
            if (!file) return res.status(400).json({ success: false, error: 'NO_FILE', message: 'Attach the logo as multipart field "logo".' });
            const problem = inspectLogo(file.buffer, file.mimetype);
            if (problem) return res.status(415).json({ success: false, error: 'UNSUPPORTED_MEDIA', message: problem });

            const key = `brands/logos/${companyId}/${projectId}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${BRAND_LOGO_TYPES[file.mimetype]}`;
            const { url } = await deps.upload(file.buffer, key, file.mimetype);
            const brand = await deps.saveLogoUrl(projectId, companyId, url);

            const old = current.logoUrl;
            if (old && old !== url && deps.removeOld && old.includes(`brands/logos/${companyId}/`)) {
                deps.removeOld(old).catch(() => undefined);
            }
            return res.status(201).json({ success: true, logoUrl: url, brand });
        } catch (err: any) {
            if (err?.name === 'BrandConsciousnessError') {
                return res.status(err.status).json({ success: false, error: err.code, message: err.message });
            }
            if (err instanceof StorageNotConfiguredError) {
                console.error('[BrandLogo]', err.message);
                return res.status(503).json({ success: false, error: 'STORAGE_UNAVAILABLE', message: 'File storage is not configured on the server.' });
            }
            console.error('[BrandLogo] upload failed:', err?.message || err);
            return res.status(502).json({ success: false, error: 'UPLOAD_FAILED', message: 'The logo could not be stored. Please try again.' });
        }
    };
}

/** Production dependencies: R2 via @workspace/integrations, brand store via @workspace/social-media. */
export function defaultBrandLogoDeps(): BrandLogoDeps {
    const social = require('@workspace/social-media');
    return {
        assertProject: async (projectId, companyId) => social.getProjectBrandConsciousness(projectId, companyId),
        upload: async (buffer, key, mimetype) => {
            const env = process.env;
            const configured =
                (env.CLOUDFLARE_R2_ENDPOINT || env.R2_ENDPOINT) &&
                (env.CLOUDFLARE_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY) &&
                (env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || env.R2_SECRET_KEY) &&
                (env.CLOUDFLARE_R2_BUCKET_NAME || env.R2_BUCKET_NAME);
            if (!configured) throw new StorageNotConfiguredError('R2 storage is not configured (R2_ENDPOINT, R2_ACCESS_KEY, R2_SECRET_KEY, R2_BUCKET_NAME).');
            return require('@workspace/integrations').uploadBufferToR2(buffer, key, mimetype);
        },
        saveLogoUrl: (projectId, companyId, logoUrl) => social.applyProjectBrandPatch(projectId, companyId, { logoUrl }),
        removeOld: (url) => require('@workspace/integrations').deleteObjectFromR2(url),
    };
}
