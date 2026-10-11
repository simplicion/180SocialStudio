/**
 * What each platform publisher can actually do through its official API (verified 2026-09-27, sources in
 * docs/social-studio-mobile/PUBLISHING.md §6). Clients use this to offer only supported operations; the adapters'
 * validate() enforces the same rules server-side (tests keep the two in sync).
 *
 * `canSchedule` means the post can be scheduled in 180 Workspace: our scheduler publishes at the chosen time, so it
 * is true for every API platform. `nativeScheduling` says whether the provider itself holds the scheduled post
 * (YouTube publishAt); everything else is sent at the scheduled time by our scheduler.
 */
import type { PublishPlatform } from '../publishing/config';

export interface PlatformPublishCapabilities {
    platform: PublishPlatform;
    canPublishText: boolean;
    canPublishImage: boolean;
    canPublishVideo: boolean;
    canPublishCarousel: boolean;
    canPublishStories: boolean;
    canPublishReels: boolean;
    canPublishDocument: boolean;
    canSchedule: boolean;
    nativeScheduling: boolean;
    /** Media is posted as a link to the public URL rather than uploaded natively (Reddit). */
    mediaAsLink: boolean;
    maxCaptionChars: number;
    maxTitleChars: number | null;
    titleRequired: boolean;
    carousel: { min: number; max: number } | null;
    video: { minSec: number; maxSec: number; maxBytes: number } | null;
    /** Requirements the account / app must meet before API publishing works at all. */
    requirements: string[];
}

const MB = 1024 * 1024;

export const PUBLISH_CAPABILITIES: Record<PublishPlatform, PlatformPublishCapabilities> = {
    instagram: {
        platform: 'instagram',
        canPublishText: false,
        canPublishImage: true,
        canPublishVideo: true,
        canPublishCarousel: true,
        canPublishStories: true,
        canPublishReels: true,
        canPublishDocument: false,
        canSchedule: true,
        nativeScheduling: false,
        mediaAsLink: false,
        maxCaptionChars: 2200,
        maxTitleChars: null,
        titleRequired: false,
        carousel: { min: 2, max: 10 },
        video: { minSec: 3, maxSec: 900, maxBytes: 300 * MB },
        requirements: ['Instagram professional (Business or Creator) account', 'instagram_content_publish / instagram_business_content_publish approved in App Review', '100 API posts per 24h', 'JPEG images only'],
    },
    facebook: {
        platform: 'facebook',
        canPublishText: true,
        canPublishImage: true,
        canPublishVideo: true,
        canPublishCarousel: true,
        canPublishStories: false,
        canPublishReels: true,
        canPublishDocument: false,
        canSchedule: true,
        nativeScheduling: false,
        mediaAsLink: false,
        maxCaptionChars: 63206,
        maxTitleChars: 255,
        titleRequired: false,
        carousel: { min: 2, max: 30 },
        video: { minSec: 1, maxSec: 4 * 3600, maxBytes: 1024 * MB },
        requirements: ['Facebook Page (not a personal profile)', 'pages_manage_posts + pages_read_engagement approved in App Review', 'User has CREATE_CONTENT task on the Page', 'Reels: 3–90s, 9:16'],
    },
    threads: {
        platform: 'threads',
        canPublishText: true,
        canPublishImage: true,
        canPublishVideo: true,
        canPublishCarousel: true,
        canPublishStories: false,
        canPublishReels: false,
        canPublishDocument: false,
        canSchedule: true,
        nativeScheduling: false,
        mediaAsLink: false,
        maxCaptionChars: 500,
        maxTitleChars: null,
        titleRequired: false,
        carousel: { min: 2, max: 20 },
        video: { minSec: 0, maxSec: 300, maxBytes: 1024 * MB },
        requirements: ['threads_basic + threads_content_publish approved in App Review', '250 posts per 24h'],
    },
    youtube: {
        platform: 'youtube',
        canPublishText: false,
        canPublishImage: false,
        canPublishVideo: true,
        canPublishCarousel: false,
        canPublishStories: false,
        canPublishReels: false,
        canPublishDocument: false,
        canSchedule: true,
        nativeScheduling: true,
        mediaAsLink: false,
        maxCaptionChars: 5000,
        maxTitleChars: 100,
        titleRequired: true,
        carousel: null,
        video: { minSec: 0, maxSec: 12 * 3600, maxBytes: 256 * 1024 * MB },
        requirements: ['Google Cloud project verified (API audit) or uploads are forced to private', 'Daily quota: ~100 uploads/day by default', 'Shorts = square/vertical ≤ 3 min'],
    },
    linkedin: {
        platform: 'linkedin',
        canPublishText: true,
        canPublishImage: true,
        canPublishVideo: true,
        canPublishCarousel: true,
        canPublishStories: false,
        canPublishReels: false,
        canPublishDocument: true,
        canSchedule: true,
        nativeScheduling: false,
        mediaAsLink: false,
        maxCaptionChars: 3000,
        maxTitleChars: 200,
        titleRequired: false,
        carousel: { min: 2, max: 20 },
        video: { minSec: 3, maxSec: 30 * 60, maxBytes: 500 * MB },
        requirements: ['Member posts: "Share on LinkedIn" product (w_member_social)', 'Company pages: Community Management API access (w_organization_social) and ADMINISTRATOR/CONTENT_ADMIN role', 'LinkedIn-Version header ≤ 12 months old'],
    },
    x: {
        platform: 'x',
        canPublishText: true,
        canPublishImage: true,
        canPublishVideo: true,
        canPublishCarousel: true,
        canPublishStories: false,
        canPublishReels: false,
        canPublishDocument: false,
        canSchedule: true,
        nativeScheduling: false,
        mediaAsLink: false,
        maxCaptionChars: 280,
        maxTitleChars: null,
        titleRequired: false,
        carousel: { min: 2, max: 4 },
        video: { minSec: 0.5, maxSec: 20 * 60, maxBytes: 512 * MB },
        requirements: ['Paid X API access (pay-per-use credits since 2026-02-06)', 'OAuth 2.0 scopes tweet.write + media.write + offline.access'],
    },
};

export function getPublishCapabilities(platform: PublishPlatform): PlatformPublishCapabilities | null {
    return (PUBLISH_CAPABILITIES as Record<string, PlatformPublishCapabilities>)[platform] ?? null;
}
