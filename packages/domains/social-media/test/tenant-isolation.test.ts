/**
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/tenant-isolation.test.ts
 *
 * Phase 0 security fixes (docs/social-studio-mobile/PRODUCTION_GAP_AUDIT.md):
 *   - syncVideoFromStudio, legacy content calendars and engagement rules are scoped to the caller's company
 *     (another company's id is a 404 and nothing is written);
 *   - publishing never picks an arbitrary account for a post without one (ACCOUNT_NOT_CONNECTED);
 *   - responses never carry the legacy plaintext token columns, and the engagement dispatcher never falls back to them;
 *   - the Meta webhook verify token has no built-in default (missing env -> 503).
 * The database is an in-memory stand-in implementing just the Prisma calls these services make (including relation
 * filters such as `calendar: { companyId }` and `include: { socialAccount: { select } }`).
 */
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { requestContext } from '@workspace/db';
import { setPublishingDb } from '../src/publishing/http';
import { SocialPostService } from '../src/social-post.service';
import { ContentCalendarService } from '../src/content-calendar.service';
import { EngagementRuleService } from '../src/engagement/engagement-rule.service';
import { EngagementDispatcher } from '../src/engagement/engagement-dispatcher';
import { SocialInboxService } from '../src/social-inbox.service';
import { PublishDispatcher } from '../src/publishing/publish-dispatcher';
import { MetaWebhooksService } from '../src/publishing/webhooks.service';
import { PublishError } from '../src/publishing/errors';

type Row = Record<string, any>;
const TOKEN_FIELDS = ['accessToken', 'refreshToken', 'credential', 'accessTokenEnc', 'refreshTokenEnc'];
const PLAINTEXT = 'plaintext-legacy-token-should-never-leak';

// ── in-memory Prisma stand-in ────────────────────────────────────────────────────────────────────────────────

type Resolver = (row: Row) => Row | Row[] | null | undefined;

class Model {
    rows: Row[] = [];
    writes: Array<{ op: string; where: any; data?: any }> = [];
    relations: Record<string, Resolver> = {};

    private matches(row: Row, where: Row = {}): boolean {
        for (const [k, cond] of Object.entries(where)) {
            if (cond === undefined) continue;
            if (k === 'OR') {
                if (!(cond as Row[]).some((c) => this.matches(row, c))) return false;
                continue;
            }
            const v = row[k];
            if (cond === null) {
                if (v != null) return false;
                continue;
            }
            if (typeof cond === 'object' && !Array.isArray(cond) && !(cond instanceof Date)) {
                if ('in' in cond) {
                    if (!(cond as any).in.includes(v)) return false;
                    continue;
                }
                if ('not' in cond) {
                    if (v === (cond as any).not) return false;
                    continue;
                }
                const rel = this.relations[k]?.(row);
                if (!rel || Array.isArray(rel) || !modelMatch(rel, cond)) return false;
                continue;
            }
            if (v !== cond) return false;
        }
        return true;
    }

    private shape(row: Row | undefined, args: any = {}): Row | null {
        if (!row) return null;
        let out: Row = { ...row };
        if (args.select) out = Object.fromEntries(Object.keys(args.select).filter((k) => args.select[k]).map((k) => [k, row[k]]));
        for (const [k, spec] of Object.entries(args.include || {})) {
            const rel = this.relations[k]?.(row) ?? null;
            const pick = (r: Row) => ((spec as any)?.select ? Object.fromEntries(Object.keys((spec as any).select).map((f) => [f, r[f]])) : { ...r });
            out[k] = rel == null ? null : Array.isArray(rel) ? rel.map(pick) : pick(rel);
        }
        return out;
    }

    async findFirst(args: any = {}) {
        return this.shape(this.rows.find((r) => this.matches(r, args.where)), args);
    }
    async findUnique(args: any = {}) {
        return this.findFirst(args);
    }
    async findMany(args: any = {}) {
        return this.rows.filter((r) => this.matches(r, args.where)).map((r) => this.shape(r, args));
    }
    async count(args: any = {}) {
        return this.rows.filter((r) => this.matches(r, args.where)).length;
    }
    async create({ data }: any) {
        const row = { id: data.id ?? crypto.randomUUID(), createdAt: new Date(), ...data };
        this.rows.push(row);
        this.writes.push({ op: 'create', where: null, data });
        return { ...row };
    }
    async update(args: any) {
        const row = this.rows.find((r) => this.matches(r, args.where));
        if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
        Object.assign(row, args.data);
        this.writes.push({ op: 'update', where: args.where, data: args.data });
        return this.shape(row, args);
    }
    async updateMany({ where, data }: any) {
        const hit = this.rows.filter((r) => this.matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        if (hit.length) this.writes.push({ op: 'updateMany', where, data });
        return { count: hit.length };
    }
    async deleteMany({ where }: any = {}) {
        const before = this.rows.length;
        this.rows = this.rows.filter((r) => !this.matches(r, where));
        const count = before - this.rows.length;
        if (count) this.writes.push({ op: 'deleteMany', where });
        return { count };
    }
    async delete({ where }: any) {
        const i = this.rows.findIndex((r) => this.matches(r, where));
        if (i < 0) throw Object.assign(new Error('Record to delete does not exist.'), { code: 'P2025' });
        this.writes.push({ op: 'delete', where });
        return this.rows.splice(i, 1)[0];
    }
}

let modelMatch: (row: Row, where: Row) => boolean = () => false;

function createDb() {
    const names = ['contentCalendar', 'calendarContentPiece', 'socialPost', 'socialPostVariant', 'socialAccount', 'socialAccountCredential', 'project', 'socialEngagementRule', 'socialInteractionLog', 'socialConversation', 'socialMessage'];
    const db: Record<string, Model> = {};
    for (const n of names) db[n] = new Model(n);
    const byId = (m: string, key: string) => (row: Row) => db[m].rows.find((r) => r.id === row[key]) ?? null;
    db.calendarContentPiece.relations.calendar = byId('contentCalendar', 'calendarId');
    db.socialEngagementRule.relations.socialAccount = byId('socialAccount', 'socialAccountId');
    db.socialEngagementRule.relations.socialPost = byId('socialPost', 'postId');
    db.socialEngagementRule.relations.logs = () => [];
    db.socialConversation.relations.socialAccount = byId('socialAccount', 'socialAccountId');
    db.socialConversation.relations.project = byId('project', 'projectId');
    db.socialConversation.relations.messages = () => [];
    // Relation filters (e.g. `calendar: { companyId }`) compare plain fields of the related row.
    modelMatch = (row, where) => Object.entries(where).every(([k, v]) => row[k] === v);
    return db;
}

let db: ReturnType<typeof createDb>;

function seed() {
    db = createDb();
    db.project.rows.push({ id: 'proj-1', companyId: 'co-1', projectType: 'social_media', deletedAt: null }, { id: 'proj-2', companyId: 'co-2', projectType: 'social_media', deletedAt: null });
    db.contentCalendar.rows.push(
        { id: 'cal-1', companyId: 'co-1', name: 'Acme March', metadata: {} },
        { id: 'cal-2', companyId: 'co-2', name: 'Globex March', metadata: {} },
    );
    db.calendarContentPiece.rows.push(
        { id: 'piece-1', calendarId: 'cal-1', companyId: 'co-1', headline: 'Acme hook', status: 'draft' },
        // legacy row: no companyId of its own, belongs to co-2 through its calendar
        { id: 'piece-2', calendarId: 'cal-2', companyId: null, headline: 'Globex hook', status: 'draft' },
    );
    db.socialPost.rows.push(
        { id: 'post-1', companyId: 'co-1', calendarPieceId: 'piece-1', status: 'draft', content: 'a', mediaUrls: [] },
        { id: 'post-2', companyId: 'co-2', calendarPieceId: 'piece-2', status: 'draft', content: 'b', mediaUrls: [] },
        // a co-2 post pointing at co-1's piece id must never be touched by co-1's sync
        { id: 'post-x', companyId: 'co-2', calendarPieceId: 'piece-1', status: 'draft', content: 'x', mediaUrls: [] },
    );
    db.socialAccount.rows.push(
        { id: 'acc-1', companyId: 'co-1', platform: 'instagram', platformAccountId: 'ig-1', accountName: 'Acme', username: 'acme', isActive: true, reauthRequired: false, accessToken: PLAINTEXT, refreshToken: PLAINTEXT },
        { id: 'acc-2', companyId: 'co-2', platform: 'instagram', platformAccountId: 'ig-2', accountName: 'Globex', username: 'globex', isActive: true, reauthRequired: false, accessToken: PLAINTEXT, refreshToken: PLAINTEXT },
    );
    setPublishingDb(db);
}

beforeEach(seed);

const is404 = (e: any) => e?.statusCode === 404 && e?.code === 'NOT_FOUND';
const is401 = (e: any) => e?.statusCode === 401;
const noTokens = (obj: any, where: string) => {
    for (const f of TOKEN_FIELDS) assert.equal(obj?.[f], undefined, `${where} must not include ${f}`);
    assert.ok(!JSON.stringify(obj ?? null).includes(PLAINTEXT), `${where} must not contain the plaintext token`);
};

// ── item 2: syncVideoFromStudio ─────────────────────────────────────────────────────────────────────────────

test('syncVideoFromStudio: another company\'s piece is a 404 and nothing is written', async () => {
    await assert.rejects(SocialPostService.syncVideoFromStudio('piece-1', 'https://cdn/x.mp4', undefined, 'co-2'), is404);
    // legacy piece whose company is only on the calendar
    await assert.rejects(SocialPostService.syncVideoFromStudio('piece-2', 'https://cdn/x.mp4', undefined, 'co-1'), is404);
    await assert.rejects(SocialPostService.syncVideoFromStudio('does-not-exist', 'https://cdn/x.mp4', undefined, 'co-1'), is404);
    assert.equal(db.calendarContentPiece.writes.length, 0);
    assert.equal(db.socialPost.writes.length, 0);
    assert.equal(db.calendarContentPiece.rows.find((p) => p.id === 'piece-1')!.finalVideoUrl, undefined);
});

test('syncVideoFromStudio: own piece and own linked post are updated; another company\'s post on the same piece id is not', async () => {
    const res = await SocialPostService.syncVideoFromStudio('piece-1', 'https://cdn/final.mp4', 'https://cdn/t.jpg', 'co-1');
    assert.equal(res.success, true);
    assert.equal(res.piece.finalVideoUrl, 'https://cdn/final.mp4');
    assert.equal(res.linkedPost.id, 'post-1');
    assert.equal(db.socialPost.rows.find((p) => p.id === 'post-1')!.finalVideoUrl, 'https://cdn/final.mp4');
    assert.equal(db.socialPost.rows.find((p) => p.id === 'post-x')!.finalVideoUrl, undefined, 'co-2 post untouched');

    // legacy piece (companyId only on the calendar) works for its owner
    const legacy = await SocialPostService.syncVideoFromStudio('piece-2', 'https://cdn/g.mp4', undefined, 'co-2');
    assert.equal(legacy.piece.finalVideoUrl, 'https://cdn/g.mp4');
});

test('syncVideoFromStudio: no company is a 401, never "any company"', async () => {
    await assert.rejects(SocialPostService.syncVideoFromStudio('piece-1', 'https://cdn/x.mp4', undefined, undefined), is401);
    assert.equal(db.calendarContentPiece.writes.length, 0);
});

// ── item 3: legacy content calendars ────────────────────────────────────────────────────────────────────────

test('content calendar: get / pieces / list are scoped to the caller', async () => {
    await assert.rejects(ContentCalendarService.getCalendar('cal-1', 'co-2'), is404);
    await assert.rejects(ContentCalendarService.getCalendarPieces('cal-1', 'co-2'), is404);
    const own = await ContentCalendarService.getCalendar('cal-1', 'co-1');
    assert.equal(own.calendar.id, 'cal-1');
    assert.deepEqual(own.pieces.map((p: any) => p.id), ['piece-1']);
    const list = await ContentCalendarService.listCalendars(10, 0, 'co-2');
    assert.deepEqual(list.map((c: any) => c.id), ['cal-2']);
    await assert.rejects(ContentCalendarService.listCalendars(10, 0, undefined), is401);
});

test('content calendar: update / delete of another company\'s calendar is a 404 and writes nothing', async () => {
    await assert.rejects(ContentCalendarService.updateCalendar('cal-1', { name: 'pwned' }, 'co-2'), is404);
    await assert.rejects(ContentCalendarService.deleteCalendar('cal-1', 'co-2'), is404);
    assert.equal(db.contentCalendar.writes.length, 0);
    assert.equal(db.calendarContentPiece.writes.length, 0);
    assert.equal(db.contentCalendar.rows.find((c) => c.id === 'cal-1')!.name, 'Acme March');
    assert.ok(db.calendarContentPiece.rows.some((p) => p.id === 'piece-1'));
});

test('content calendar: owner can update (companyId cannot be changed) and delete', async () => {
    const updated = await ContentCalendarService.updateCalendar('cal-1', { name: 'Acme April', companyId: 'co-2', id: 'other' }, 'co-1');
    assert.equal(updated.name, 'Acme April');
    assert.equal(db.contentCalendar.rows.find((c) => c.id === 'cal-1')!.companyId, 'co-1');
    // moving the calendar to another company's project is a 404
    await assert.rejects(ContentCalendarService.updateCalendar('cal-1', { projectId: 'proj-2' }, 'co-1'), is404);

    const res = await ContentCalendarService.deleteCalendar('cal-1', 'co-1');
    assert.equal(res.success, true);
    assert.ok(!db.contentCalendar.rows.some((c) => c.id === 'cal-1'));
    assert.ok(!db.calendarContentPiece.rows.some((p) => p.id === 'piece-1'));
    assert.ok(db.contentCalendar.rows.some((c) => c.id === 'cal-2'), 'other company untouched');
});

test('content calendar: piece update is scoped (own piece, legacy piece of another company, wrong calendar)', async () => {
    await assert.rejects(ContentCalendarService.updateCalendarPiece('piece-1', { headline: 'pwned' }, 'co-2'), is404);
    await assert.rejects(ContentCalendarService.updateCalendarPiece('piece-2', { headline: 'pwned' }, 'co-1'), is404);
    await assert.rejects(ContentCalendarService.updateCalendarPiece('piece-1', { headline: 'x' }, 'co-1', 'cal-2'), is404);
    assert.equal(db.calendarContentPiece.writes.length, 0);

    const piece = await ContentCalendarService.updateCalendarPiece('piece-1', { headline: 'New hook', calendarId: 'cal-2', companyId: 'co-2' }, 'co-1', 'cal-1');
    assert.equal(piece.headline, 'New hook');
    const row = db.calendarContentPiece.rows.find((p) => p.id === 'piece-1')!;
    assert.equal(row.calendarId, 'cal-1');
    assert.equal(row.companyId, 'co-1');
});

test('content calendar: create with another company\'s project is a 404 before any AI call or write', async () => {
    await assert.rejects(ContentCalendarService.createCalendar({ projectId: 'proj-2', name: 'x' }, { id: 'u1' }, 'co-1'), is404);
    assert.equal(db.contentCalendar.writes.length, 0);
});

// ── item 5: engagement rules reference only the caller's records ────────────────────────────────────────────

const ruleDto = (extra: Record<string, any> = {}) => ({ name: 'Blueprint DM', triggerType: 'comment_keyword' as const, triggerKeywords: ['BLUEPRINT'], actionDmTemplate: 'Hi {name}', ...extra });

test('engagement rule: another company\'s project / account / post is a 404 and no rule is created', async () => {
    await assert.rejects(EngagementRuleService.createRule('co-1', ruleDto({ socialAccountId: 'acc-2' })), is404);
    await assert.rejects(EngagementRuleService.createRule('co-1', ruleDto({ postId: 'post-2' })), is404);
    await assert.rejects(EngagementRuleService.createRule('co-1', ruleDto({ projectId: 'proj-2' })), is404);
    assert.equal(db.socialEngagementRule.rows.length, 0);

    const rule = await EngagementRuleService.createRule('co-1', ruleDto({ socialAccountId: 'acc-1', postId: 'post-1', projectId: 'proj-1' }));
    assert.equal(rule.companyId, 'co-1');
    assert.equal(rule.socialAccountId, 'acc-1');
});

test('engagement rule: update cannot re-point a rule at another company\'s account or post', async () => {
    const rule = await EngagementRuleService.createRule('co-1', ruleDto({ socialAccountId: 'acc-1' }));
    await assert.rejects(EngagementRuleService.updateRule('co-1', rule.id, { socialAccountId: 'acc-2' }), is404);
    await assert.rejects(EngagementRuleService.updateRule('co-1', rule.id, { postId: 'post-2' }), is404);
    assert.equal(db.socialEngagementRule.rows[0].socialAccountId, 'acc-1');
    // and another company cannot update the rule at all
    await assert.rejects(EngagementRuleService.updateRule('co-2', rule.id, { name: 'pwned' }), is404);
    assert.equal(db.socialEngagementRule.rows[0].name, 'Blueprint DM');
});

test('engagement rule: missing required fields are a typed 400, not a crash', async () => {
    await assert.rejects(EngagementRuleService.createRule('co-1', { triggerType: 'comment_keyword', actionDmTemplate: 'x' } as any), (e: any) => e?.statusCode === 400);
});

// ── item 7: no token columns in responses, no plaintext fallback ───────────────────────────────────────────

test('getRule response embeds the account without any token field', async () => {
    const rule = await EngagementRuleService.createRule('co-1', ruleDto({ socialAccountId: 'acc-1' }));
    const got = await EngagementRuleService.getRule('co-1', rule.id);
    assert.equal(got.socialAccount.id, 'acc-1');
    noTokens(got.socialAccount, 'getRule().socialAccount');
});

test('inbox getConversation response embeds the account without any token field', async () => {
    db.socialConversation.rows.push({ id: 'conv-1', companyId: 'co-1', socialAccountId: 'acc-1', platform: 'instagram', isRead: true });
    const conv = await requestContext.run({ companyId: 'co-1' }, () => SocialInboxService.getConversation('conv-1'));
    assert.equal(conv.socialAccount.id, 'acc-1');
    noTokens(conv.socialAccount, 'getConversation().socialAccount');
    await assert.rejects(requestContext.run({ companyId: 'co-2' }, () => SocialInboxService.getConversation('conv-1')));
});

test('engagement dispatcher never uses the legacy plaintext token (vault only) and never another company\'s account', async () => {
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any = {}) => {
        calls.push(`${String(url)} ${JSON.stringify(init.headers || {})} ${String(init.body || '')}`);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as any;
    try {
        const rule = { id: 'r1', name: 'r', actionAutoLike: true, actionPublicReplies: ['Sent!'], actionSendDm: true, actionDmTemplate: 'Hi', actionEnableAiAgent: false };
        const event = { companyId: 'co-1', socialAccountId: 'acc-1', platform: 'instagram', eventType: 'comment' as const, commentId: 'c1', senderId: 's1', senderHandle: 'fan', text: 'BLUEPRINT' };
        // acc-1 has only plaintext columns and no vault credential: nothing may be sent with that token.
        const out = await EngagementDispatcher.executeEngagement(rule, event);
        assert.ok(out.error && /credential|reconnect/i.test(out.error), `explains the missing credentials: ${out.error}`);
        assert.equal(out.publicReplySent, undefined);
        assert.ok(!calls.some((c) => c.includes(PLAINTEXT)), 'the plaintext token never reaches a provider');

        // An event naming another company's account resolves nothing.
        const cross = await EngagementDispatcher.executeEngagement(rule, { ...event, socialAccountId: 'acc-2' });
        assert.match(cross.error || '', /not found/);
    } finally {
        globalThis.fetch = original;
    }
});

// ── item 6: no arbitrary account for a post without one ────────────────────────────────────────────────────

test('ensureVariants: a post with no variants and no account throws ACCOUNT_NOT_CONNECTED and creates nothing', async () => {
    delete process.env.SIMULATE_SOCIAL_PUBLISHING;
    delete process.env.ALLOW_SIMULATED_PUBLISHING;
    const post = { id: 'post-1', companyId: 'co-1', projectId: null, socialAccountId: null, content: 'a', mediaUrls: [] };
    await assert.rejects(PublishDispatcher.ensureVariants(post), (e: any) => e instanceof PublishError && e.code === 'ACCOUNT_NOT_CONNECTED' && e.httpStatus === 409);
    assert.equal(db.socialPostVariant.rows.length, 0, 'acc-1 (active, same company) was not picked');

    // an explicit account of the same company still works
    const [v] = await PublishDispatcher.ensureVariants({ ...post, socialAccountId: 'acc-1' });
    assert.equal(v.socialAccountId, 'acc-1');
    // an explicit account of another company does not
    db.socialPostVariant.rows = [];
    await assert.rejects(PublishDispatcher.ensureVariants({ ...post, socialAccountId: 'acc-2' }), (e: any) => e?.code === 'ACCOUNT_NOT_CONNECTED');
});

// ── item 1: Meta webhook verify token has no default ───────────────────────────────────────────────────────

test('Meta webhook verification without META_WEBHOOK_VERIFY_TOKEN is a 503 (the old committed default no longer works)', () => {
    const saved = process.env.META_WEBHOOK_VERIFY_TOKEN;
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    const errors: any[] = [];
    const origError = console.error;
    console.error = (...a: any[]) => void errors.push(a);
    try {
        const res = MetaWebhooksService.verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': '180workspace_meta_webhook_verify_token_prod_2026', 'hub.challenge': '42' });
        assert.equal(res.success, false);
        assert.equal(res.statusCode, 503);
        assert.equal(res.challenge, undefined);
        assert.ok(errors.some((a) => String(a[0]).includes('META_WEBHOOK_VERIFY_TOKEN')), 'logs a clear server-side error');
    } finally {
        console.error = origError;
        if (saved === undefined) delete process.env.META_WEBHOOK_VERIFY_TOKEN;
        else process.env.META_WEBHOOK_VERIFY_TOKEN = saved;
    }
});
