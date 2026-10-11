/**
 * Profile rubrics for LinkedIn, X, YouTube and Facebook, in the same shape as the Instagram 12-point audit
 * (ProfileAuditor). Each rule scores only what the caller actually supplied: a field that is undefined is left
 * out of the total instead of being guessed, so a partial import never inflates or deflates the score.
 */
import { CraftPlatform } from './platform-specs';
import { ProfileAuditor, ProfileAuditReport, ProfileInput, RubricItemAudit } from './profile-auditor';

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

type Rule = (i: PlatformProfileInput) => Omit<RubricItemAudit, 'status'> | null;

const OUTCOME_RE = /\b(help|helping|for|turn|grow|build|scale|teach|teaching|so you|without|in \d+|from .+ to)\b/i;
const PROOF_RE = /(\d[\d,.]*\s?(k|m|\+|%|x)?\b|\$\d|clients|customers|students|founders|brands|featured in|ex-|former)/i;
const CTA_RE = /\b(dm|message|book|subscribe|follow|download|join|get|grab|visit|email|call|apply|start)\b/i;
const TITLE_ONLY_RE = /^(ceo|founder|co-founder|director|manager|consultant|entrepreneur|owner|freelancer|student)\b[^|•,]*$/i;

const pts = (cond: boolean | undefined, max: number) => (cond ? max : 0);

function textRule(id: string, name: string, max: number, priority: number, pick: (i: PlatformProfileInput) => string | undefined,
    grade: (text: string, i: PlatformProfileInput) => [number, string]): Rule {
    return (i) => {
        const text = pick(i);
        if (text === undefined) return null;
        const [awarded, feedback] = grade(text.trim(), i);
        return { id, name, maxPoints: max, awardedPoints: awarded, feedback, priorityOrder: priority };
    };
}

function boolRule(id: string, name: string, max: number, priority: number, pick: (i: PlatformProfileInput) => boolean | undefined, ok: string, fix: string): Rule {
    return (i) => {
        const v = pick(i);
        if (v === undefined) return null;
        return { id, name, maxPoints: max, awardedPoints: pts(v, max), feedback: v ? ok : fix, priorityOrder: priority };
    };
}

const keywordIn = (text: string, i: PlatformProfileInput) => !i.keyword || text.toLowerCase().includes(i.keyword.toLowerCase());

const RULES: Record<Exclude<CraftPlatform, 'instagram' | 'tiktok'>, Rule[]> = {
    linkedin: [
        textRule('headline', 'Headline says who you help and the outcome', 20, 1, (i) => i.bio, (t, i) => {
            if (!t) return [0, 'Headline is empty.'];
            if (t.length > 220) return [6, `Headline is ${t.length} characters; LinkedIn cuts at 220.`];
            if (TITLE_ONLY_RE.test(t)) return [5, 'Headline is only a job title. Write "I help [who] [get outcome] | [proof]".'];
            const score = (OUTCOME_RE.test(t) ? 10 : 0) + (PROOF_RE.test(t) ? 5 : 0) + (keywordIn(t, i) ? 5 : 0);
            return [score, score >= 20 ? 'Headline names the audience, the outcome, proof and the search keyword.'
                : `Headline is missing ${[!OUTCOME_RE.test(t) && 'the outcome for a named audience', !PROOF_RE.test(t) && 'a proof point (number, clients, result)', !keywordIn(t, i) && `the keyword "${i.keyword}"`].filter(Boolean).join(', ')}.`];
        }),
        textRule('about_hook', 'About section opens with a hook', 15, 2, (i) => i.about, (t) => {
            if (!t) return [0, 'About section is empty. LinkedIn shows the first ~265 characters before "see more".'];
            const first = t.slice(0, 265);
            if (/^(i am|i'm a|welcome|hello|hi|about me)/i.test(first)) return [5, 'About opens with an introduction. Open with the problem you solve or a specific result.'];
            return [PROOF_RE.test(first) || OUTCOME_RE.test(first) ? 15 : 8, PROOF_RE.test(first) || OUTCOME_RE.test(first) ? 'About opens with a result or the problem you solve.' : 'Put a specific result or the problem you solve in the first two lines.'];
        }),
        textRule('about_cta', 'About section ends with one next step', 10, 3, (i) => i.about, (t) =>
            CTA_RE.test(t.slice(-300)) ? [10, 'About ends with a clear next step.'] : [0, 'End the About section with one next step (book a call, DM a keyword, subscribe to the newsletter).']),
        (i) => i.featuredCount === undefined ? null : {
            id: 'featured', name: 'Featured section has proof and an offer', maxPoints: 15, priorityOrder: 4,
            awardedPoints: i.featuredCount >= 3 ? 15 : i.featuredCount * 5,
            feedback: i.featuredCount >= 3 ? 'Featured has 3+ items.' : 'Add 3 featured items: your best post, a case study or result, and your offer or lead magnet.',
        },
        boolRule('photo', 'Profile photo', 10, 5, (i) => i.hasProfilePhoto, 'Profile photo set.', 'Add a close-up face photo; profiles without one get far fewer connection accepts.'),
        boolRule('banner', 'Banner states the offer', 10, 6, (i) => i.hasBanner, 'Custom banner set.', 'Add a banner with one line: what you do, for whom, and where to start.'),
        boolRule('custom_url', 'Custom profile URL', 5, 7, (i) => i.hasCustomUrl, 'Custom URL set.', 'Claim linkedin.com/in/yourname instead of the default with numbers.'),
        textRule('link', 'Website / newsletter link', 15, 8, (i) => i.linkUrl, (t) => t ? [15, 'A link is set.'] : [0, 'Add a link to your offer, booking page or newsletter.']),
    ],
    x: [
        textRule('name', 'Display name with keyword', 10, 1, (i) => i.displayName, (t, i) => {
            if (!t) return [0, 'Display name is empty.'];
            if (t.length > 50) return [3, 'Display name is over 50 characters.'];
            return keywordIn(t, i) || /[|•·-]/.test(t) ? [10, 'Name carries a searchable descriptor.'] : [5, 'Add a short descriptor: "Name | what you post about".'];
        }),
        textRule('bio', 'Bio: who it is for, what they get, proof', 30, 2, (i) => i.bio, (t, i) => {
            if (!t) return [0, 'Bio is empty.'];
            if (t.length > 160) return [8, `Bio is ${t.length}/160 characters.`];
            const score = (OUTCOME_RE.test(t) ? 12 : 0) + (PROOF_RE.test(t) ? 10 : 0) + (keywordIn(t, i) ? 8 : 0);
            return [score, score >= 30 ? 'Bio names the audience, the benefit and proof.' : 'Write the bio as: what you post about + who it helps + one proof point. Drop emoji lists and job titles.'];
        }),
        (i) => i.featuredCount === undefined ? null : {
            id: 'pinned', name: 'Pinned post', maxPoints: 20, priorityOrder: 3,
            awardedPoints: i.featuredCount > 0 ? 20 : 0,
            feedback: i.featuredCount > 0 ? 'A post is pinned.' : 'Pin your best-performing thread or your offer; it is the first thing profile visitors read.',
        },
        boolRule('photo', 'Profile photo', 10, 4, (i) => i.hasProfilePhoto, 'Profile photo set.', 'Add a clear face photo.'),
        boolRule('header', 'Header image', 10, 5, (i) => i.hasBanner, 'Header image set.', 'Add a header that says what you post about or shows proof.'),
        textRule('link', 'Link', 20, 6, (i) => i.linkUrl, (t) => t ? [20, 'A link is set.'] : [0, 'Add one link (newsletter, offer or booking page).']),
    ],
    youtube: [
        textRule('channel_name', 'Channel name is searchable', 10, 1, (i) => i.displayName, (t, i) =>
            !t ? [0, 'Channel name is empty.'] : keywordIn(t, i) ? [10, 'Channel name is clear and searchable.'] : [5, `Consider adding "${i.keyword}" to the channel name or handle.`]),
        textRule('description', 'Channel description', 25, 2, (i) => i.bio ?? i.about, (t, i) => {
            if (!t) return [0, 'Channel description is empty; it is used for search and the channel page.'];
            if (t.length > 1000) return [8, 'Description is over 1000 characters.'];
            const first = t.slice(0, 150);
            const score = (OUTCOME_RE.test(first) ? 10 : 0) + (keywordIn(t, i) ? 8 : 0) + (/\b(every|weekly|daily|new video|uploads?)\b/i.test(t) ? 7 : 0);
            return [score, score >= 25 ? 'Description states the value, keyword and upload schedule.' : 'First sentence: who the channel is for and what they learn; include the keyword and the upload schedule.'];
        }),
        (i) => i.featuredCount === undefined ? null : {
            id: 'trailer', name: 'Channel trailer / featured video', maxPoints: 20, priorityOrder: 3,
            awardedPoints: i.featuredCount > 0 ? 20 : 0,
            feedback: i.featuredCount > 0 ? 'Trailer or featured video set.' : 'Set a channel trailer for non-subscribers and a featured video for returning viewers.',
        },
        (i) => i.collectionsCount === undefined ? null : {
            id: 'playlists', name: 'Playlists organise binge paths', maxPoints: 15, priorityOrder: 4,
            awardedPoints: i.collectionsCount >= 3 ? 15 : i.collectionsCount * 5,
            feedback: i.collectionsCount >= 3 ? '3+ playlists.' : 'Group videos into at least 3 topic playlists so viewers watch the next one.',
        },
        boolRule('banner', 'Channel banner', 10, 5, (i) => i.hasBanner, 'Banner set.', 'Add a banner with the promise and upload schedule (safe area 1546x423).'),
        boolRule('photo', 'Channel icon', 5, 6, (i) => i.hasProfilePhoto, 'Icon set.', 'Add a channel icon.'),
        textRule('links', 'Channel links', 15, 7, (i) => i.linkUrl, (t) => t ? [15, 'A channel link is set.'] : [0, 'Add your offer or newsletter as the first channel link.']),
    ],
    facebook: [
        textRule('page_name', 'Page name', 10, 1, (i) => i.displayName, (t, i) =>
            !t ? [0, 'Page name is empty.'] : keywordIn(t, i) ? [10, 'Page name is clear.'] : [6, `Make sure people searching "${i.keyword}" can tell this page is about it.`]),
        textRule('intro', 'Intro (101 characters)', 20, 2, (i) => i.bio, (t) => {
            if (!t) return [0, 'Intro is empty.'];
            if (t.length > 101) return [8, `Intro is ${t.length}/101 characters.`];
            return OUTCOME_RE.test(t) ? [20, 'Intro says who the page helps and how.'] : [10, 'Rewrite the intro as who you help and what they get.'];
        }),
        textRule('about', 'About section', 15, 3, (i) => i.about, (t) => t.length >= 80 ? [15, 'About section filled in.'] : [5, 'Fill in About with services, area served and proof.']),
        boolRule('cta_button', 'Action button', 15, 4, (i) => i.hasActionButton, 'Action button set.', 'Add a page button (Book now, Send message, Shop).'),
        boolRule('cover', 'Cover photo', 10, 5, (i) => i.hasBanner, 'Cover set.', 'Add a cover photo that states the offer.'),
        boolRule('photo', 'Profile photo / logo', 10, 6, (i) => i.hasProfilePhoto, 'Profile photo set.', 'Add a logo or face photo.'),
        (i) => i.featuredCount === undefined ? null : {
            id: 'pinned', name: 'Pinned post', maxPoints: 10, priorityOrder: 7,
            awardedPoints: i.featuredCount > 0 ? 10 : 0,
            feedback: i.featuredCount > 0 ? 'A post is pinned.' : 'Pin a post that introduces the offer or shows proof.',
        },
        textRule('link', 'Website link', 10, 8, (i) => i.linkUrl, (t) => t ? [10, 'Website set.'] : [0, 'Add a website or booking link.']),
    ],
};

function gradeOf(score: number): ProfileAuditReport['grade'] {
    if (score >= 90) return 'A+';
    if (score >= 80) return 'A';
    if (score >= 65) return 'B';
    if (score >= 50) return 'C';
    return 'NEEDS_REWRITE';
}

export function auditPlatformProfile(platform: CraftPlatform, input: PlatformProfileInput): ProfileAuditReport & { platform: CraftPlatform; scoredFields: number } {
    if (platform === 'instagram' || platform === 'tiktok') {
        const report = ProfileAuditor.audit({
            handle: input.handle,
            nameField: input.displayName ?? '',
            bio: input.bio ?? '',
            linkUrl: input.linkUrl,
            hasProfilePhoto: input.hasProfilePhoto,
            pinnedPostCount: input.featuredCount,
            ...input.instagram,
        });
        return { ...report, platform, scoredFields: report.items.length };
    }
    const items: RubricItemAudit[] = [];
    for (const rule of RULES[platform]) {
        const r = rule(input);
        if (!r) continue;
        items.push({ ...r, status: r.awardedPoints >= r.maxPoints ? 'FULL' : r.awardedPoints > 0 ? 'PARTIAL' : 'FAIL' });
    }
    const awarded = items.reduce((a, i) => a + i.awardedPoints, 0);
    const possible = items.reduce((a, i) => a + i.maxPoints, 0);
    const totalScore = possible ? Math.round((awarded / possible) * 100) : 0;
    return {
        platform,
        handle: input.handle,
        totalScore,
        grade: gradeOf(totalScore),
        items,
        scoredFields: items.length,
        prioritizedActionPlan: items.filter((i) => i.status !== 'FULL').sort((a, b) => a.priorityOrder - b.priorityOrder)
            .map((i) => `${i.name}: ${i.feedback}`),
    };
}
