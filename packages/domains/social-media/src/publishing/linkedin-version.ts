/**
 * LinkedIn Marketing API version (`LinkedIn-Version: YYYYMM`). LinkedIn supports each monthly version for ~12 months
 * and then rejects it; 202507 (the old default in config.ts) is past sunset as of 2026-09. Verified 2026-09-27 at
 * learn.microsoft.com/linkedin/marketing/versioning (supported: 202510 … 202609; 202510 sunsets 2026-10-15).
 * LINKEDIN_API_VERSION overrides the default; a value older than 12 months is logged once because LinkedIn will
 * answer 426/400 for it.
 */
export const LINKEDIN_DEFAULT_API_VERSION = '202609';

let warned = false;

/** Computes the preceding month's YYYYMM which is guaranteed to be active in LinkedIn's 12-month rolling window. */
export function computeActiveLinkedInVersion(now: Date = new Date()): string {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${y}${m}`;
}

export function linkedInApiVersion(now: Date = new Date()): string {
    const raw = process.env.LINKEDIN_API_VERSION?.trim();
    if (raw && !isLinkedInVersionSunset(raw, now)) {
        return raw;
    }
    if (raw && isLinkedInVersionSunset(raw, now)) {
        if (!warned) {
            warned = true;
            console.error(`[social-publishing] LINKEDIN_API_VERSION=${raw} is past its 12-month sunset date; LinkedIn will reject it. Automatically falling back to active version.`);
        }
    }
    const defaultActive = isLinkedInVersionSunset(LINKEDIN_DEFAULT_API_VERSION, now)
        ? computeActiveLinkedInVersion(now)
        : LINKEDIN_DEFAULT_API_VERSION;
    return defaultActive;
}

export function isLinkedInVersionSunset(v: string, now: Date = new Date()): boolean {
    const m = /^(\d{4})(\d{2})$/.exec(v);
    if (!m) return true;
    const months = (now.getUTCFullYear() - Number(m[1])) * 12 + (now.getUTCMonth() + 1 - Number(m[2]));
    return months >= 12;
}

