/**
 * Profile rubrics for LinkedIn, X, YouTube and Facebook, in the same shape as the Instagram 12-point audit
 * (ProfileAuditor). Each rule scores only what the caller actually supplied: a field that is undefined is left
 * out of the total instead of being guessed, so a partial import never inflates or deflates the score.
 */
import { CraftPlatform } from './platform-specs';
import { ProfileAuditReport, ProfileInput } from './profile-auditor';
export interface PlatformProfileInput {
    handle: string;
    /** Display name / channel name / page name. */
    displayName?: string;
    /** LinkedIn headline, X/Instagram bio, YouTube channel description, Facebook intro. */
    bio?: string;
    /** LinkedIn About, Facebook About, YouTube long description. */
    about?: string;
    linkUrl?: string;
    hasProfilePhoto?: boolean;
    hasBanner?: boolean;
    /** LinkedIn featured items, X pinned post, YouTube channel trailer / featured video, Facebook pinned post. */
    featuredCount?: number;
    /** YouTube playlists / Facebook highlights / LinkedIn services listed. */
    collectionsCount?: number;
    hasCustomUrl?: boolean;
    /** Facebook page / YouTube channel call-to-action button or link set up. */
    hasActionButton?: boolean;
    /** Search keyword the account wants to be found for. */
    keyword?: string;
    /** Instagram-only extras pass through to the Instagram auditor. */
    instagram?: Partial<ProfileInput>;
}
export declare function auditPlatformProfile(platform: CraftPlatform, input: PlatformProfileInput): ProfileAuditReport & {
    platform: CraftPlatform;
    scoredFields: number;
};
