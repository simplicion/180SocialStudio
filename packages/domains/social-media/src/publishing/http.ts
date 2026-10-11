import { prisma } from '@workspace/db';
import { PublishError } from './errors';
import { intEnv } from './config';

/**
 * Shared plumbing for the publishing pipeline: provider HTTP (global fetch, so tests can intercept it), media
 * download, overridable timing (tests make polling instant) and the Prisma handle (tests swap in a fake).
 */

export const timing = {
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now: () => Date.now(),
};

let dbOverride: any = null;
/** The Prisma client used by vault, OAuth, dispatcher and scheduler. */
export const getDb = (): any => dbOverride ?? (prisma as any);
/** Test hook: replace the Prisma client (pass null to restore). */
export function setPublishingDb(db: any) {
    dbOverride = db;
}

export interface ProviderRequestInit extends RequestInit {
    timeoutMs?: number;
}

export async function providerFetch(platform: string, url: string, init: ProviderRequestInit = {}): Promise<Response> {
    const { timeoutMs = intEnv('SOCIAL_PROVIDER_TIMEOUT_MS', 120_000), ...rest } = init;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, { ...rest, signal: ctrl.signal });
    } catch (e: any) {
        if (e?.name === 'AbortError') throw new PublishError('PROVIDER_TIMEOUT', `${platform} request timed out`, { retryable: true, platform });
        throw new PublishError('PROVIDER_ERROR', `${platform} network error: ${e?.message || e}`, { retryable: true, platform });
    } finally {
        clearTimeout(timer);
    }
}

export async function readBody(res: Response): Promise<any> {
    const text = await res.text().catch(() => '');
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch {
        return { raw: text.slice(0, 500) };
    }
}

/** Extracts a human message from the many provider error shapes. Never includes request headers or tokens. */
export function providerMessage(body: any, fallback: string): string {
    if (!body || typeof body !== 'object') return fallback;
    const e = body.error;
    if (e && typeof e === 'object') return e.error_user_msg || e.message || e.description || e.code || fallback;
    if (typeof e === 'string') return body.error_description || e;
    if (Array.isArray(body.errors) && body.errors.length) return body.errors.map((x: any) => x.message || x.detail || JSON.stringify(x)).join('; ');
    return body.message || body.detail || body.title || body.raw || fallback;
}

/** Map a failed provider response to a typed error: auth failures → REAUTH_REQUIRED, 429/5xx → retryable. */
export function providerFailure(platform: string, res: { status: number }, body: any, what: string): PublishError {
    const msg = `${what}: ${providerMessage(body, `HTTP ${res.status}`)}`;
    const metaCode = body?.error?.code;
    const authError =
        res.status === 401 ||
        metaCode === 190 ||
        metaCode === 102 ||
        body?.error === 'invalid_grant' ||
        body?.error?.code === 'access_token_invalid' ||
        body?.error?.code === 'access_token_expired' ||
        body?.serviceErrorCode === 65601;
    if (authError) return new PublishError('REAUTH_REQUIRED', msg, { platform });
    const retryable = res.status === 429 || res.status >= 500 || body?.error?.is_transient === true;
    return new PublishError('PROVIDER_ERROR', msg, { retryable, platform, details: { httpStatus: res.status } });
}

export async function expectOk(platform: string, res: Response, what: string): Promise<any> {
    const body = await readBody(res);
    if (!res.ok) throw providerFailure(platform, res, body, what);
    if (body?.error && typeof body.error === 'object' && body.error.code && body.error.code !== 'ok' && platform !== 'tiktok') {
        throw providerFailure(platform, res, body, what);
    }
    return body;
}

export interface DownloadedMedia {
    bytes: Buffer;
    contentType: string;
    size: number;
}

/** Downloads media for platforms that need the bytes (YouTube, X, LinkedIn, TikTok FILE_UPLOAD). */
export async function downloadMedia(platform: string, url: string, maxBytes?: number): Promise<DownloadedMedia> {
    const cap = maxBytes ?? intEnv('SOCIAL_PUBLISH_MAX_MEDIA_BYTES', 1024 * 1024 * 1024);
    const res = await providerFetch(platform, url, { method: 'GET', timeoutMs: intEnv('SOCIAL_MEDIA_DOWNLOAD_TIMEOUT_MS', 600_000) });
    if (!res.ok) {
        throw new PublishError('PROVIDER_ERROR', `Could not download media from storage (HTTP ${res.status}).`, { retryable: res.status >= 500, platform });
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > cap) {
        throw new PublishError('VALIDATION_FAILED', `Media is ${declared} bytes, above the ${cap} byte limit.`, { platform });
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > cap) throw new PublishError('VALIDATION_FAILED', `Media is ${bytes.length} bytes, above the ${cap} byte limit.`, { platform });
    if (bytes.length === 0) throw new PublishError('VALIDATION_FAILED', 'Media file is empty.', { platform });
    return { bytes, contentType: res.headers.get('content-type')?.split(';')[0].trim() || guessMime(url), size: bytes.length };
}

export function guessMime(url: string): string {
    const u = url.toLowerCase().split('?')[0];
    if (u.endsWith('.mp4') || u.endsWith('.m4v')) return 'video/mp4';
    if (u.endsWith('.mov')) return 'video/quicktime';
    if (u.endsWith('.webm')) return 'video/webm';
    if (u.endsWith('.png')) return 'image/png';
    if (u.endsWith('.gif')) return 'image/gif';
    if (u.endsWith('.webp')) return 'image/webp';
    if (u.endsWith('.pdf')) return 'application/pdf';
    return 'image/jpeg';
}

export const isVideoUrl = (url: string) => /\.(mp4|m4v|mov|webm)(\?|$)/i.test(url);
export const isPdfUrl = (url: string) => /\.pdf(\?|$)/i.test(url);

/** Poll `fn` until it returns a non-undefined value, sleeping `intervalMs` between attempts. */
export async function pollUntil<T>(fn: () => Promise<T | undefined>, opts: { attempts: number; intervalMs: number; onTimeout: () => Error }): Promise<T> {
    for (let i = 0; i < opts.attempts; i++) {
        const v = await fn();
        if (v !== undefined) return v;
        await timing.sleep(opts.intervalMs);
    }
    throw opts.onTimeout();
}

/** Buffer → fetch body (Node's Buffer is a valid body at runtime; this only satisfies the DOM typings). */
export const asBody = (b: Buffer): any => b;
