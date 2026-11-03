/**
 * Check My Content backend: connected-account profile audit, content consistency, own-performance, Instagram
 * hashtag reader. Provider calls and the DB are fakes; the tests check what we ask each official API, that every
 * number comes from the response, and tenant scoping.
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/check-my-content.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditConnectedProfile, contentConsistency, fetchConnectedProfile, RecentPost } from '../src/platform-team/connected-profile';
import { loadOwnPostOutcomes, winningExemplars } from '../src/platform-team/own-performance';
import { instagramHashtagReader } from '../src/platform-team/instagram-hashtags';

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function dbWith(accounts: any[], posts: any[] = []) {
    const match = (r: any, w: any) => Object.entries(w || {}).every(([k, v]) => r[k] === v);
    return {
        socialAccount: { findFirst: async ({ where }: any) => accounts.find((a) => match(a, where)) || null },
        socialPost: { findMany: async ({ where }: any) => posts.filter((p) => match(p, where)) },
    };
}

const IG = { id: 'a1', companyId: 'co-1', projectId: 'p1', platform: 'instagram', isActive: true, platformAccountId: '1789' };

test('Instagram profile audit is filled from the official API and the recent posts are analysed', async () => {
    const urls: string[] = [];
    const fetchJson = async (_platform: string, url: string) => {
        urls.push(url);
        if (url.includes('/media?')) return { data: Array.from({ length: 8 }, (_, i) => ({ caption: i % 2 ? 'Your gums bleed because you floss too little\nmore' : 'Hello everyone, happy Monday', timestamp: day(i * 3), media_type: i % 2 ? 'VIDEO' : 'IMAGE', media_product_type: i % 2 ? 'REELS' : 'FEED', like_count: 30, comments_count: 5 })) };
        return { username: 'northwind', name: 'Northwind Dental', biography: 'Gentle dentistry for nervous adults. Book below', website: 'https://northwind.example', followers_count: 1000, media_count: 120, profile_picture_url: 'https://cdn.example/p.jpg' };
    };
    const r = await auditConnectedProfile('instagram', { companyId: 'co-1', projectId: 'p1' }, { db: dbWith([IG]), getToken: async () => 'tok', fetchJson });
    assert.ok(urls[0].includes('1789?fields=username,name,biography'));
    assert.equal(r.source, 'connected_account');
    assert.equal(r.fields.handle, 'northwind');
    assert.equal(r.followers, 1000);
    assert.ok(r.audit.totalScore >= 0 && r.audit.items.length > 0);
    assert.equal(r.content.postsAnalyzed, 8);
    assert.equal(r.content.formatMix.reel, 50);
    assert.equal(r.content.engagementRatePct, 3.5);
    assert.ok((r.content.postsPerWeek as number) > 2);
});

test('content consistency: cadence, stale account, weak hooks and low engagement are called out', () => {
    const posts: RecentPost[] = [0, 1, 2, 30, 31, 60].map((d) => ({ text: 'So today I wanted to share something', publishedAt: day(d + 20), format: 'static', likes: 2, comments: 0, views: null }));
    const c = contentConsistency(posts, 2000);
    assert.ok((c.cadenceRegularity as number) < 50);
    assert.ok(c.findings.some((f) => f.includes('bursty')));
    assert.ok(c.findings.some((f) => f.includes('days ago')));
    assert.ok(c.findings.some((f) => f.includes('No video')));
    assert.ok(c.findings.some((f) => f.includes('opening lines average')));
    assert.ok(c.findings.some((f) => f.includes('of your followers')));
    assert.equal(contentConsistency([], null).score, null);
});

test('LinkedIn and missing accounts give clear, typed errors; other companies cannot read the account', async () => {
    await assert.rejects(fetchConnectedProfile('linkedin', { companyId: 'co-1', projectId: 'p1' }), (e: any) => e.code === 'PROFILE_API_UNAVAILABLE');
    await assert.rejects(fetchConnectedProfile('instagram', { companyId: 'co-2', projectId: 'p1' }, { db: dbWith([IG]), getToken: async () => 't', fetchJson: async () => ({}) }), (e: any) => e.code === 'ACCOUNT_REQUIRED');
});

test('YouTube channel audit uses channel + uploads statistics', async () => {
    const yt = { ...IG, platform: 'youtube', platformAccountId: 'UC123' };
    const fetchJson = async (_p: string, url: string) => {
        if (url.includes('/channels?')) return { items: [{ snippet: { title: 'Strong After 40', customUrl: '@strong40', description: 'Strength training for busy people over 40. New videos weekly.', thumbnails: { default: { url: 'x' } } }, brandingSettings: { image: { bannerExternalUrl: 'b' } }, statistics: { subscriberCount: '5000' }, contentDetails: { relatedPlaylists: { uploads: 'UU123' } } }] };
        if (url.includes('/playlistItems?')) return { items: [{ contentDetails: { videoId: 'v1' } }, { contentDetails: { videoId: 'v2' } }, { contentDetails: { videoId: 'v3' } }] };
        if (url.includes('/videos?')) return { items: ['v1', 'v2', 'v3'].map((id, i) => ({ id, snippet: { title: `I lifted my first ${50 + i}kg at 47`, publishedAt: day(i * 7) }, statistics: { viewCount: '9000', likeCount: '400', commentCount: '50' } })) };
        throw new Error(url);
    };
    const r = await auditConnectedProfile('youtube', { companyId: 'co-1', projectId: 'p1' }, { db: dbWith([yt]), getToken: async () => 't', fetchJson });
    assert.equal(r.followers, 5000);
    assert.equal(r.fields.hasCustomUrl, true);
    assert.equal(r.content.postsAnalyzed, 3);
    assert.equal(r.content.formatMix.reel, 100);
});

test('own performance: posts measured against the same platform\'s own median; exemplars need 1.5x', async () => {
    const post = (id: string, hook: string, views: number) => ({
        id, companyId: 'co-1', projectId: 'p1', status: 'published', title: hook, content: hook, mediaType: 'video', publishedAt: new Date(),
        variants: [{ platform: 'instagram', publishStatus: 'published', platformMeta: { metrics: { views } } }], calendarPiece: null,
    });
    const posts = [post('a', 'Weak hook one', 100), post('b', 'Weak hook two', 120), post('c', 'Normal hook', 110), post('d', 'Another normal', 90), post('e', 'I lost 9kg in 10 weeks', 400)];
    const outcomes = await loadOwnPostOutcomes(dbWith([], posts), { companyId: 'co-1', projectId: 'p1' });
    assert.equal(outcomes.length, 5);
    const best = outcomes.find((o) => o.postId === 'e')!;
    assert.equal(best.multiple, 3.64);
    assert.equal(best.format, 'reel');
    assert.deepEqual(winningExemplars(outcomes).map((e) => e.hook), ['I lost 9kg in 10 weeks']);
    assert.equal((await loadOwnPostOutcomes(dbWith([], posts), { companyId: 'co-2', projectId: 'p1' })).length, 0);
});

test('Instagram hashtag reader: official hashtag search then top media; null without a connected account', async () => {
    const urls: string[] = [];
    const read = await instagramHashtagReader({ companyId: 'co-1', projectId: 'p1' }, {
        db: dbWith([IG]), getToken: async () => 't',
        fetchJson: async (url) => {
            urls.push(url);
            if (url.includes('ig_hashtag_search')) return { data: [{ id: 'h1' }] };
            return { data: [{ permalink: 'https://instagram.com/p/1', caption: 'Creatine at 45', like_count: 120, comments_count: 9, timestamp: day(2) }, { caption: 'no permalink' }] };
        },
    });
    const media = await read!('#Creatine');
    assert.ok(urls[0].includes('ig_hashtag_search?user_id=1789&q=creatine'));
    assert.ok(urls[1].includes('h1/top_media?user_id=1789'));
    assert.equal(media.length, 1);
    assert.equal(media[0].likes, 120);
    assert.deepEqual(await read!('bad tag!'), []);
    assert.equal(await instagramHashtagReader({ companyId: 'co-1', projectId: 'p9' }, { db: dbWith([IG]) }), null);
});
