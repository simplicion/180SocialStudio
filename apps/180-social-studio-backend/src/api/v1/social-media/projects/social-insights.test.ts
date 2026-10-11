/**
 * Run: npx tsx --test --test-force-exit apps/backend/src/api/v1/social-media/projects/social-insights.test.ts
 * Project analytics (computed from records, tenant-scoped) and brand-voice ideas (AI-backed, no canned output).
 * The database is an in-memory stand-in implementing just the Prisma calls the service makes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateContentIdeas, getProjectAnalytics, SocialInsightsError } from '../../../../../../../packages/domains/social-media/src/social-insights.service';

const NOW = new Date('2026-09-25T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const hoursAfter = (t: Date, h: number) => new Date(t.getTime() + h * 3_600_000);

/** Evaluates the subset of Prisma `where` used by the service. */
function matches(row: any, where: any): boolean {
  return Object.entries(where || {}).every(([k, cond]: [string, any]) => {
    const v = row[k];
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) return (v ?? null) === cond || (v instanceof Date && cond instanceof Date && v.getTime() === cond.getTime());
    if ('in' in cond && !cond.in.includes(v)) return false;
    if ('not' in cond && (v ?? null) === cond.not) return false;
    if ('gte' in cond && !(v && v >= cond.gte)) return false;
    if ('gt' in cond && !(v && v > cond.gt)) return false;
    if ('lte' in cond && !(v && v <= cond.lte)) return false;
    return true;
  });
}

function fakeDb(data: { projects: any[]; posts: any[]; sessions: any[]; conversations: any[]; voices: any[] }) {
  const calls: any[] = [];
  const table = (rows: any[]) => ({
    count: async (a: any) => (calls.push(a.where), rows.filter((r) => matches(r, a.where)).length),
    findMany: async (a: any) => (calls.push(a.where), rows.filter((r) => matches(r, a.where))),
    findFirst: async (a: any) => (calls.push(a.where), rows.find((r) => matches(r, a.where)) ?? null),
  });
  return {
    calls,
    db: {
      project: table(data.projects),
      socialPost: table(data.posts),
      clientReviewSession: table(data.sessions),
      socialConversation: table(data.conversations),
      brandVoiceProfile: table(data.voices),
    },
  };
}

const P = { id: 'p1', companyId: 'co-1', projectType: 'social_media', deletedAt: null, name: 'Acme Social', description: 'Coffee roaster' };
const scope = { companyId: 'co-1', projectId: 'p1' };
const post = (o: any) => ({ ...scope, createdAt: daysAgo(40), updatedAt: daysAgo(40), socialAccountId: null, socialAccount: null, variants: [], ...o });

function dataset() {
  const s1 = daysAgo(5);
  const s2 = daysAgo(3);
  return {
    projects: [P, { ...P, id: 'p-other', companyId: 'co-2' }],
    posts: [
      post({ status: 'published', publishedAt: daysAgo(2), createdAt: daysAgo(4), socialAccountId: 'a1', socialAccount: { platform: 'instagram' } }),
      post({ status: 'published', publishedAt: daysAgo(6), socialAccountId: 'a2', socialAccount: { platform: 'LinkedIn' } }),
      post({ status: 'published', publishedAt: daysAgo(20), variants: [{ platform: 'tiktok' }, { platform: 'tiktok' }] }),
      post({ status: 'published', publishedAt: daysAgo(60) }),
      post({ status: 'scheduled', scheduledFor: new Date(NOW.getTime() + 86_400_000), createdAt: daysAgo(1) }),
      post({ status: 'approved', scheduledFor: daysAgo(1) }),
      post({ status: 'failed', updatedAt: daysAgo(1) }),
      post({ status: 'in_review' }),
      // another tenant's post in a same-id project must never be counted
      post({ companyId: 'co-2', status: 'published', publishedAt: daysAgo(1), socialAccount: { platform: 'instagram' } }),
    ],
    sessions: [
      { ...scope, status: 'approved', createdAt: s1, updatedAt: hoursAfter(s1, 10) },
      { ...scope, status: 'approved', createdAt: s2, updatedAt: hoursAfter(s2, 30) },
      { ...scope, status: 'revisions_requested', createdAt: daysAgo(2), updatedAt: daysAgo(1) },
      { ...scope, status: 'pending', createdAt: daysAgo(1), updatedAt: daysAgo(1) },
      { ...scope, status: 'approved', createdAt: daysAgo(80), updatedAt: daysAgo(79) },
    ],
    conversations: [
      { ...scope, lastMessageAt: daysAgo(1), isRead: false, convertedLeadId: null },
      { ...scope, lastMessageAt: daysAgo(2), isRead: true, convertedLeadId: 'lead-1' },
      { ...scope, lastMessageAt: daysAgo(50), isRead: false, convertedLeadId: null },
    ],
    voices: [{ ...scope, tone: 'Warm, witty', targetAudience: 'Home baristas', forbiddenWords: ['cheap'], defaultHashtags: ['#coffee'], standardCtas: ['Shop now'], sampleViralPosts: ['Our beans, your ritual.'] }],
  };
}

test('analytics: 7d range counts only this project and tenant, by platform, turnaround, inbox', async () => {
  const { db, calls } = fakeDb(dataset());
  const a = await getProjectAnalytics({ projectId: 'p1', companyId: 'co-1', range: '7d', now: NOW }, db as any);
  assert.equal(a.range, '7d');
  assert.equal(a.rangeDays, 7);
  assert.equal(a.postsPublished, 2);
  assert.equal(a.published_instagram, 1);
  assert.equal(a.published_linkedin, 1);
  assert.equal(a.published_tiktok, undefined);
  assert.equal(a.postsScheduledInRange, 1);
  assert.equal(a.postsScheduledUpcoming, 1);
  assert.equal(a.postsFailed, 1);
  assert.equal(a.postsAwaitingApproval, 1);
  assert.equal(a.postsCreated, 2);
  assert.equal(a.reviewSessionsSent, 4);
  assert.equal(a.reviewSessionsApproved, 2);
  assert.equal(a.reviewSessionsRevisionsRequested, 1);
  assert.equal(a.reviewSessionsPending, 1);
  assert.equal(a.approvalTurnaroundHoursAvg, 20);
  assert.equal(a.approvalTurnaroundHoursMedian, 20);
  assert.equal(a.inboxConversations, 2);
  assert.equal(a.inboxUnread, 1);
  assert.equal(a.inboxConvertedToLeads, 1);
  for (const v of Object.values(a)) assert.ok(typeof v === 'number' || typeof v === 'string', 'flat fields only');
  for (const w of calls.slice(1)) assert.equal(w.companyId, 'co-1', 'every metric query is tenant-scoped');
});

test('analytics: 30d widens the window; variants give the platform when no account is linked', async () => {
  const { db } = fakeDb(dataset());
  const a = await getProjectAnalytics({ projectId: 'p1', companyId: 'co-1', range: '30d', now: NOW }, db as any);
  assert.equal(a.postsPublished, 3);
  assert.equal(a.published_tiktok, 1, 'a post counts once per platform');
});

test('analytics: no approved sessions -> no invented turnaround number', async () => {
  const data = dataset();
  data.sessions = [];
  const { db } = fakeDb(data);
  const a = await getProjectAnalytics({ projectId: 'p1', companyId: 'co-1', range: '7d', now: NOW }, db as any);
  assert.equal(a.approvalTurnaroundHoursAvg, undefined);
  assert.equal(a.reviewSessionsApproved, 0);
});

test('analytics: unknown or other-tenant project -> 404; bad range -> 400', async () => {
  const { db } = fakeDb(dataset());
  await assert.rejects(getProjectAnalytics({ projectId: 'nope', companyId: 'co-1' }, db as any), (e: any) => e instanceof SocialInsightsError && e.status === 404);
  await assert.rejects(getProjectAnalytics({ projectId: 'p-other', companyId: 'co-1' }, db as any), (e: any) => e.status === 404);
  await assert.rejects(getProjectAnalytics({ projectId: 'p1', companyId: 'co-1', range: '1y' }, db as any), (e: any) => e.status === 400 && e.code === 'INVALID_RANGE');
});

const aiReturning = (raw: string, seen: string[] = []) => async () => ({ generate: async (prompt: string) => (seen.push(prompt), raw) });

test('ideas: grounded in the saved brand voice, shaped for the mobile parser, forbidden words filtered, count respected', async () => {
  const { db } = fakeDb(dataset());
  const prompts: string[] = [];
  const raw = '```json\n' + JSON.stringify([
    { title: 'Morning ritual', hook: 'Your 7am deserves better', caption: 'Brew it slow. #coffee', platform: 'Instagram', pillar: 'community' },
    { title: 'Cheap beans exposed', hook: 'x', caption: 'y', platform: 'tiktok', pillar: 'educational' },
    { headline: 'Roast day', hook: 'Behind the drum', content: 'Watch us roast', platform: 'linkedin', pillar: 'behind_the_scenes' },
    { title: 'Extra', hook: 'h', caption: 'c', platform: 'youtube', pillar: 'x' },
  ]) + '\n```';
  const ideas = await generateContentIdeas({ projectId: 'p1', companyId: 'co-1', count: 2 }, { db: db as any, ai: aiReturning(raw, prompts) });
  assert.deepEqual(ideas.map((i) => i.title), ['Morning ritual', 'Roast day']);
  assert.deepEqual(Object.keys(ideas[0]).sort(), ['caption', 'hook', 'pillar', 'platform', 'title']);
  assert.equal(ideas[0].platform, 'instagram');
  assert.match(prompts[0], /Warm, witty/);
  assert.match(prompts[0], /Home baristas/);
  assert.match(prompts[0], /cheap/);
});

test('ideas: no AI provider -> 503 AI_NOT_CONFIGURED (no canned ideas)', async () => {
  const { db } = fakeDb(dataset());
  await assert.rejects(
    generateContentIdeas({ projectId: 'p1', companyId: 'co-1' }, { db: db as any, ai: async () => null }),
    (e: any) => e.status === 503 && e.code === 'AI_NOT_CONFIGURED'
  );
});

test('ideas: provider failure -> 502, unusable output -> 502, missing brand voice -> 409, foreign project -> 404', async () => {
  const { db } = fakeDb(dataset());
  const failing = async () => ({ generate: async () => { throw new Error('401 from provider'); } });
  await assert.rejects(generateContentIdeas({ projectId: 'p1', companyId: 'co-1' }, { db: db as any, ai: failing }), (e: any) => e.status === 502 && e.code === 'AI_PROVIDER_ERROR');
  await assert.rejects(generateContentIdeas({ projectId: 'p1', companyId: 'co-1' }, { db: db as any, ai: aiReturning('sorry, I cannot') }), (e: any) => e.code === 'AI_BAD_RESPONSE');

  const noVoice = dataset();
  noVoice.voices = [];
  await assert.rejects(
    generateContentIdeas({ projectId: 'p1', companyId: 'co-1' }, { db: fakeDb(noVoice).db as any, ai: aiReturning('[]') }),
    (e: any) => e.status === 409 && e.code === 'BRAND_VOICE_NOT_CONFIGURED'
  );
  await assert.rejects(generateContentIdeas({ projectId: 'p-other', companyId: 'co-1' }, { db: db as any, ai: aiReturning('[]') }), (e: any) => e.status === 404);
});
