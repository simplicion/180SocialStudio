import { PublishError } from '../publishing/errors';

/** Engagement calls never fake a result: without a token the call fails (the dispatcher logs it). */
export function requireToken(token: string | null | undefined, platform: string): asserts token is string {
    if (!token) throw new PublishError('REAUTH_REQUIRED', `No access token for ${platform}; reconnect the account.`, { platform: platform as any });
}

/**
 * Sandbox tokens (`mock_…`) exist for local demos and unit tests of the legacy static helpers. They are never honoured
 * in production, so a stray `mock_` credential there fails like any other bad token instead of faking a result.
 */
export function isSandboxToken(token: string | null | undefined): boolean {
    return typeof token === 'string' && token.startsWith('mock_') && process.env.NODE_ENV !== 'production';
}
