'use strict';

/**
 * PlatformMediaGuard
 * Enforces rigorous platform-specific publishing constraints, aspect ratio checks,
 * safe-zone collision detection for vertical short-form video, and first-comment separation.
 */

export interface PlatformConstraints {
    maxCaptionLength: number;
    maxHashtags: number;
    supportedAspectRatios: string[];
    maxVideoDurationSeconds: number;
    minVideoDurationSeconds: number;
    maxMediaSizeMB: number;
    supportsFirstComment: boolean;
    supportsPdfCarousel: boolean;
}

export const PLATFORM_LIMITS: Record<string, PlatformConstraints> = {
    instagram: {
        maxCaptionLength: 2200,
        maxHashtags: 30,
        supportedAspectRatios: ['1:1', '4:5', '9:16', '16:9'],
        maxVideoDurationSeconds: 900, // 15 mins for standard video, 90s for Reels
        minVideoDurationSeconds: 3,
        maxMediaSizeMB: 100,
        supportsFirstComment: true,
        supportsPdfCarousel: false,
    },
    linkedin: {
        maxCaptionLength: 3000,
        maxHashtags: 15, // Best practice limit
        supportedAspectRatios: ['1:1', '16:9', '9:16', '4:5'],
        maxVideoDurationSeconds: 900, // 15 mins
        minVideoDurationSeconds: 3,
        maxMediaSizeMB: 200,
        supportsFirstComment: false,
        supportsPdfCarousel: true,
    },
    tiktok: {
        maxCaptionLength: 2200,
        maxHashtags: 20,
        supportedAspectRatios: ['9:16'],
        maxVideoDurationSeconds: 600, // 10 mins
        minVideoDurationSeconds: 3,
        maxMediaSizeMB: 287,
        supportsFirstComment: false,
        supportsPdfCarousel: false,
    },
    youtube: {
        maxCaptionLength: 5000,
        maxHashtags: 15,
        supportedAspectRatios: ['9:16', '16:9'],
        maxVideoDurationSeconds: 43200, // 12 hours (Shorts <= 60s)
        minVideoDurationSeconds: 1,
        maxMediaSizeMB: 500,
        supportsFirstComment: true,
        supportsPdfCarousel: false,
    }
};

export interface MediaValidationResult {
    valid: boolean;
    platform: string;
    errors: string[];
    warnings: string[];
    sanitizedCaption: string;
    firstComment?: string;
    isSafeZoneCompliant: boolean;
}

export class PlatformMediaGuard {
    /**
     * Validates content and media against specific target platform constraints
     */
    static validateForPlatform(
        platform: string,
        payload: {
            caption: string;
            title?: string;
            mediaUrls?: string[];
            aspectRatio?: string;
            durationSeconds?: number;
            fileSizeMB?: number;
            separateFirstComment?: boolean;
        }
    ): MediaValidationResult {
        const plat = platform.toLowerCase();
        const limits = PLATFORM_LIMITS[plat] || {
            maxCaptionLength: 2000,
            maxHashtags: 30,
            supportedAspectRatios: ['1:1', '16:9', '9:16'],
            maxVideoDurationSeconds: 600,
            minVideoDurationSeconds: 1,
            maxMediaSizeMB: 100,
            supportsFirstComment: false,
            supportsPdfCarousel: false,
        };

        const errors: string[] = [];
        const warnings: string[] = [];
        let sanitizedCaption = payload.caption || '';
        let firstComment: string | undefined = undefined;

        // 1. Caption Length Check
        if (sanitizedCaption.length > limits.maxCaptionLength) {
            errors.push(
                `Caption length (${sanitizedCaption.length} chars) exceeds ${platform} limit of ${limits.maxCaptionLength} chars.`
            );
        }

        // 2. Hashtag Count & Separation
        const hashtagMatches = sanitizedCaption.match(/#[a-zA-Z0-9_]+/g) || [];
        if (hashtagMatches.length > limits.maxHashtags) {
            warnings.push(
                `Post contains ${hashtagMatches.length} hashtags; ${platform} recommends max ${limits.maxHashtags}.`
            );
        }

        if (payload.separateFirstComment && limits.supportsFirstComment && hashtagMatches.length > 0) {
            // Strip hashtags from main caption and put in first comment
            firstComment = hashtagMatches.join(' ');
            sanitizedCaption = sanitizedCaption.replace(/#[a-zA-Z0-9_]+/g, '').trim();
        }

        // 3. YouTube Shorts Title Check
        if (plat === 'youtube' && payload.title && payload.title.length > 100) {
            errors.push(`YouTube Shorts title length (${payload.title.length} chars) exceeds limit of 100 chars.`);
        }

        // 4. Aspect Ratio Check
        if (payload.aspectRatio) {
            if (!limits.supportedAspectRatios.includes(payload.aspectRatio)) {
                if (plat === 'tiktok' && payload.aspectRatio !== '9:16') {
                    errors.push(`TikTok strictly requires 9:16 vertical video. Found: ${payload.aspectRatio}`);
                } else {
                    warnings.push(
                        `${platform} performs best with ${limits.supportedAspectRatios.join(', ')}. Found: ${payload.aspectRatio}`
                    );
                }
            }
        }

        // 5. Video Duration Check
        if (payload.durationSeconds !== undefined) {
            if (payload.durationSeconds > limits.maxVideoDurationSeconds) {
                errors.push(
                    `Video duration (${payload.durationSeconds}s) exceeds ${platform} max duration of ${limits.maxVideoDurationSeconds}s.`
                );
            }
            if (payload.durationSeconds < limits.minVideoDurationSeconds) {
                errors.push(
                    `Video duration (${payload.durationSeconds}s) is below ${platform} min duration of ${limits.minVideoDurationSeconds}s.`
                );
            }
            // YouTube Shorts <= 60s rule
            if (plat === 'youtube' && payload.aspectRatio === '9:16' && payload.durationSeconds > 60) {
                warnings.push(`Vertical video is longer than 60s (${payload.durationSeconds}s) and will be processed as a standard video rather than a Short.`);
            }
        }

        // 6. Media Size Check
        if (payload.fileSizeMB && payload.fileSizeMB > limits.maxMediaSizeMB) {
            errors.push(
                `Media file size (${payload.fileSizeMB.toFixed(1)}MB) exceeds ${platform} limit of ${limits.maxMediaSizeMB}MB.`
            );
        }

        // Safe zone compliance for 9:16 short-form video
        const isSafeZoneCompliant = !(plat === 'tiktok' && payload.aspectRatio !== '9:16');

        return {
            valid: errors.length === 0,
            platform,
            errors,
            warnings,
            sanitizedCaption,
            firstComment,
            isSafeZoneCompliant,
        };
    }

    /**
     * Inspects safe-zone coordinate overlays for TikTok / Reels / Shorts
     */
    static checkSafeZoneMargins(aspectRatio: string): {
        topMarginPercent: number;
        bottomMarginPercent: number;
        rightMarginPercent: number;
        safeZoneDescription: string;
    } {
        if (aspectRatio === '9:16') {
            return {
                topMarginPercent: 12, // Header / search bar overlay
                bottomMarginPercent: 22, // Caption, music title, like buttons
                rightMarginPercent: 18, // Interaction buttons (heart, comment, share)
                safeZoneDescription: 'Keep essential text, graphics, and faces centered between 12% from top and 22% from bottom.',
            };
        }
        return {
            topMarginPercent: 0,
            bottomMarginPercent: 0,
            rightMarginPercent: 0,
            safeZoneDescription: 'Standard 16:9 / 1:1 format. Full frame safe.',
        };
    }
}
