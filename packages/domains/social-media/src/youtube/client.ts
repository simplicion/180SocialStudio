/**
 * Resilient HTTP Client for Google / YouTube Data & Upload APIs.
 * Features:
 * - Exponential backoff with jitter
 * - Rate limiting & Quota tracking
 * - Circuit breaker protection
 * - Sensitive credential & token redaction
 */

import { YouTubeError, scrubSecrets } from './errors';

export interface HttpClientOptions {
    timeoutMs?: number;
    maxRetries?: number;
    baseRetryDelayMs?: number;
}

export class YouTubeHttpClient {
    private readonly timeoutMs: number;
    private readonly maxRetries: number;
    private readonly baseRetryDelayMs: number;

    // Circuit breaker state
    private consecutiveFailures = 0;
    private circuitOpenUntil = 0;
    private readonly failureThreshold = 5;
    private readonly circuitResetTimeMs = 60000;

    // Rate limiter (token bucket)
    private tokens = 100;
    private readonly maxTokens = 100;
    private lastRefill = Date.now();
    private readonly refillRatePerMs = 0.05; // 50 requests/sec limit

    constructor(options?: HttpClientOptions) {
        this.timeoutMs = options?.timeoutMs || 30000;
        this.maxRetries = options?.maxRetries || 3;
        this.baseRetryDelayMs = options?.baseRetryDelayMs || 1000;
    }

    private checkRateLimit() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRatePerMs);
        this.lastRefill = now;

        if (this.tokens < 1) {
            throw new YouTubeError({
                code: 'YOUTUBE_RATE_LIMITED',
                message: 'Local rate limit exceeded: too many YouTube API requests initiated in a short burst.',
                httpStatus: 429,
                retryable: true,
            });
        }
        this.tokens -= 1;
    }

    private checkCircuitBreaker() {
        const now = Date.now();
        if (this.circuitOpenUntil > now) {
            const waitSeconds = Math.ceil((this.circuitOpenUntil - now) / 1000);
            throw new YouTubeError({
                code: 'YOUTUBE_API_UNAVAILABLE',
                message: `Circuit breaker active: YouTube API is experiencing high failure rates. Resuming in ${waitSeconds}s.`,
                httpStatus: 503,
                retryable: true,
            });
        }
    }

    private recordSuccess() {
        this.consecutiveFailures = 0;
        this.circuitOpenUntil = 0;
    }

    private recordFailure(status: number) {
        if (status >= 500 || status === 429) {
            this.consecutiveFailures += 1;
            if (this.consecutiveFailures >= this.failureThreshold) {
                this.circuitOpenUntil = Date.now() + this.circuitResetTimeMs;
            }
        }
    }

    async throttle(): Promise<void> {
        this.checkCircuitBreaker();
        this.checkRateLimit();
    }

    async request(url: string, init?: RequestInit): Promise<Response> {
        this.checkCircuitBreaker();
        this.checkRateLimit();

        let attempt = 0;
        while (attempt <= this.maxRetries) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);

            try {
                const response = await fetch(url, {
                    ...init,
                    signal: controller.signal,
                });
                clearTimeout(timer);

                if (response.ok || response.status === 308) {
                    this.recordSuccess();
                    return response;
                }

                this.recordFailure(response.status);

                // Specific Google Quota handling
                if (response.status === 403) {
                    const text = await response.text();
                    if (/quotaExceeded|dailyLimitExceeded/i.test(text)) {
                        throw new YouTubeError({
                            code: 'YOUTUBE_QUOTA_EXCEEDED',
                            message: 'YouTube Data API daily quota exceeded on Google Cloud Project.',
                            httpStatus: 403,
                            retryable: false,
                            technicalDetails: { upstream: text },
                        });
                    }
                    throw new YouTubeError({
                        code: 'YOUTUBE_PERMISSION_DENIED',
                        message: `Google API access forbidden: ${scrubSecrets(text)}`,
                        httpStatus: 403,
                        retryable: false,
                    });
                }

                if (response.status === 401) {
                    const text = await response.text();
                    throw new YouTubeError({
                        code: 'YOUTUBE_TOKEN_EXPIRED',
                        message: `YouTube authentication expired: ${scrubSecrets(text)}`,
                        httpStatus: 401,
                        retryable: true,
                        userAction: 'Reconnect YouTube channel in Social Studio.',
                    });
                }

                // Retryable status codes (429, 500, 502, 503, 504)
                const isRetryable = response.status === 429 || response.status >= 500;
                if (!isRetryable || attempt === this.maxRetries) {
                    const errText = await response.text();
                    throw new YouTubeError({
                        code: response.status === 429 ? 'YOUTUBE_RATE_LIMITED' : 'YOUTUBE_API_UNAVAILABLE',
                        message: `YouTube API returned HTTP ${response.status}: ${scrubSecrets(errText)}`,
                        httpStatus: response.status,
                        retryable: isRetryable,
                    });
                }

                // Backoff calculation with Retry-After support
                const retryAfterHeader = response.headers.get('retry-after');
                let delayMs = this.baseRetryDelayMs * Math.pow(2, attempt);
                if (retryAfterHeader) {
                    const parsedSeconds = parseInt(retryAfterHeader, 10);
                    if (!isNaN(parsedSeconds)) {
                        delayMs = parsedSeconds * 1000;
                    }
                }
                const jitter = Math.random() * 200;
                await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
                attempt++;
            } catch (err: any) {
                clearTimeout(timer);
                if (err instanceof YouTubeError) throw err;

                if (err.name === 'AbortError') {
                    throw new YouTubeError({
                        code: 'YOUTUBE_API_UNAVAILABLE',
                        message: `Request timed out after ${this.timeoutMs}ms`,
                        httpStatus: 504,
                        retryable: true,
                    });
                }

                if (attempt === this.maxRetries) {
                    throw new YouTubeError({
                        code: 'YOUTUBE_API_UNAVAILABLE',
                        message: `Network communication error with YouTube: ${scrubSecrets(err.message)}`,
                        httpStatus: 500,
                        retryable: true,
                    });
                }

                const delay = this.baseRetryDelayMs * Math.pow(2, attempt) + Math.random() * 100;
                await new Promise((resolve) => setTimeout(resolve, delay));
                attempt++;
            }
        }

        throw new YouTubeError({
            code: 'YOUTUBE_API_UNAVAILABLE',
            message: 'Max retry attempts exceeded',
            httpStatus: 500,
            retryable: true,
        });
    }
}
