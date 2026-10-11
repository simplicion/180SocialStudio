/**
 * Test doubles for the publishing pipeline: an in-memory Prisma subset (where/in/not/lt/lte/OR/increment) and a
 * recording fetch interceptor. No database, no network.
 */
import crypto from 'crypto';

type Row = Record<string, any>;

const cmp = (x: any) => (x instanceof Date ? x.getTime() : x);

export function matches(row: Row, where: Row = {}): boolean {
    for (const [k, cond] of Object.entries(where)) {
        if (cond === undefined) continue;
        if (k === 'OR') {
            if (!(cond as Row[]).some((c) => matches(row, c))) return false;
            continue;
        }
        if (k === 'AND') {
            if (!(cond as Row[]).every((c) => matches(row, c))) return false;
            continue;
        }
        if (k === 'NOT') {
            if (matches(row, cond as Row)) return false;
            continue;
        }
        const v = row[k];
        if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
            // compound unique key, e.g. companyId_platform_platformAccountId
            if (k.includes('_') && !('in' in cond) && !('lt' in cond) && !('not' in cond) && !('lte' in cond) && !('gt' in cond) && !('gte' in cond) && !('equals' in cond)) {
                if (!matches(row, cond as Row)) return false;
                continue;
            }
            if ('in' in cond && !(cond as any).in.includes(v)) return false;
            if ('not' in cond) {
                const n = (cond as any).not;
                if (n === null ? v == null : cmp(v) === cmp(n)) return false;
            }
            if ('equals' in cond && cmp(v) !== cmp((cond as any).equals)) return false;
            if ('lt' in cond && !(v != null && cmp(v) < cmp((cond as any).lt))) return false;
            if ('lte' in cond && !(v != null && cmp(v) <= cmp((cond as any).lte))) return false;
            if ('gt' in cond && !(v != null && cmp(v) > cmp((cond as any).gt))) return false;
            if ('gte' in cond && !(v != null && cmp(v) >= cmp((cond as any).gte))) return false;
        } else if (cond === null) {
            if (v != null) return false;
        } else if (cmp(v) !== cmp(cond)) return false;
    }
    return true;
}

const clone = <T>(r: T): T => (r == null ? r : (Object.fromEntries(Object.entries(r as any).map(([k, v]) => [k, v instanceof Date ? new Date(v) : Array.isArray(v) ? [...v] : v])) as T));

function apply(row: Row, data: Row) {
    for (const [k, v] of Object.entries(data)) {
        if (v === undefined) continue;
        if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v) && 'increment' in v) row[k] = (row[k] || 0) + (v as any).increment;
        else row[k] = v instanceof Date ? new Date(v) : v;
    }
    row.updatedAt = new Date();
}

const DEFAULTS: Record<string, Row> = {
    socialPost: { status: 'draft', publishAttemptCount: 0, versionNumber: 1, approvedVersion: null, history: [], mediaUrls: [], publishedLinks: {}, metadata: {}, publishLeaseUntil: null, nextPublishAttemptAt: null, publishedAt: null, socialAccountId: null, projectId: null },
    socialPostVariant: { publishStatus: 'pending', attemptCount: 0, lastErrorRetryable: false, customMediaUrls: [], platformMeta: {}, socialAccountId: null, publishLeaseUntil: null, externalId: null, externalUrl: null, lastError: null },
    socialAccount: { isActive: true, reauthRequired: false, metadata: {}, scopes: [], projectId: null, accessToken: null, refreshToken: null },
    socialAccountCredential: { refreshFailureCount: 0, scopes: [] },
    socialOAuthSession: { status: 'pending', consumedAt: null, candidatesEnc: null, codeVerifierEnc: null },
    socialPublishAttempt: { status: 'started' },
    project: { socialSettings: {} },
    socialConversation: { isRead: false, lastMessageSnippet: '' },
    socialMessage: { senderType: 'participant' },
};

export class FakeModel {
    rows: Row[] = [];
    constructor(private name: string) {}

    private one(where: Row) {
        return this.rows.find((r) => matches(r, where));
    }
    async findUnique({ where }: any) {
        return clone(this.one(where) ?? null);
    }
    async findFirst({ where }: any = {}) {
        return clone(this.one(where) ?? null);
    }
    async findMany({ where, take, orderBy }: any = {}) {
        let out = this.rows.filter((r) => matches(r, where));
        if (orderBy) {
            const [k, dir] = Object.entries(orderBy)[0] as [string, string];
            out = [...out].sort((a, b) => (cmp(a[k]) > cmp(b[k]) ? 1 : -1) * (dir === 'desc' ? -1 : 1));
        }
        return out.slice(0, take ?? out.length).map(clone);
    }
    async count({ where }: any = {}) {
        return this.rows.filter((r) => matches(r, where)).length;
    }
    async create({ data }: any) {
        const row: Row = { id: data.id ?? crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[this.name] || {}) };
        apply(row, data);
        this.rows.push(row);
        return clone(row);
    }
    async update({ where, data }: any) {
        const row = this.one(where);
        if (!row) throw new Error(`${this.name}.update: record not found`);
        apply(row, data);
        return clone(row);
    }
    async updateMany({ where, data }: any) {
        const hit = this.rows.filter((r) => matches(r, where));
        hit.forEach((r) => apply(r, data));
        return { count: hit.length };
    }
    async upsert({ where, create, update }: any) {
        const row = this.one(where);
        if (row) {
            apply(row, update);
            return clone(row);
        }
        return this.create({ data: create });
    }
    async delete({ where }: any) {
        const i = this.rows.findIndex((r) => matches(r, where));
        if (i < 0) throw new Error(`${this.name}.delete: record not found`);
        return this.rows.splice(i, 1)[0];
    }
    async deleteMany({ where }: any = {}) {
        const before = this.rows.length;
        this.rows = this.rows.filter((r) => !matches(r, where));
        return { count: before - this.rows.length };
    }
}

export function createFakeDb() {
    const names = ['socialPost', 'socialPostVariant', 'socialAccount', 'socialAccountCredential', 'socialOAuthSession', 'socialPublishAttempt', 'project', 'socialConversation', 'socialMessage'];
    const db: Record<string, FakeModel> = {};
    for (const n of names) db[n] = new FakeModel(n);
    return db as Record<string, FakeModel> & {
        socialPost: FakeModel;
        socialPostVariant: FakeModel;
        socialAccount: FakeModel;
        socialAccountCredential: FakeModel;
        socialOAuthSession: FakeModel;
        socialPublishAttempt: FakeModel;
        project: FakeModel;
        socialConversation: FakeModel;
        socialMessage: FakeModel;
    };
}

// ── fetch interception ───────────────────────────────────────────────────────

export interface RecordedCall {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: any;
}

export type Handler = (call: RecordedCall) => Response | Promise<Response> | undefined;

export const json = (status: number, body: any, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export const bytes = (size: number, type = 'video/mp4') => new Response(Buffer.alloc(size, 7), { status: 200, headers: { 'content-type': type, 'content-length': String(size) } });

export class FetchMock {
    calls: RecordedCall[] = [];
    private original = globalThis.fetch;
    constructor(private handler: Handler) {}

    install() {
        globalThis.fetch = (async (input: any, init: any = {}) => {
            const url = typeof input === 'string' ? input : input.url;
            const headers: Record<string, string> = {};
            const h = init.headers || {};
            if (h instanceof Headers) h.forEach((v, k) => (headers[k.toLowerCase()] = v));
            else for (const [k, v] of Object.entries(h)) headers[k.toLowerCase()] = String(v);
            let body: any = init.body;
            if (typeof body === 'string') {
                try {
                    body = JSON.parse(body);
                } catch {
                    /* keep string */
                }
            } else if (body instanceof URLSearchParams) body = Object.fromEntries(body);
            const call = { method: (init.method || 'GET').toUpperCase(), url, headers, body };
            this.calls.push(call);
            const res = await this.handler(call);
            if (!res) throw new Error(`Unexpected request in test: ${call.method} ${url}`);
            return res;
        }) as any;
        return this;
    }

    restore() {
        globalThis.fetch = this.original;
    }

    /** "METHOD host/path" without query, for asserting request sequences. */
    sequence(filter?: (c: RecordedCall) => boolean) {
        return this.calls.filter(filter || (() => true)).map((c) => {
            const u = new URL(c.url);
            return `${c.method} ${u.host}${u.pathname}`;
        });
    }
}

export function setTestEnv() {
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
    delete process.env.SOCIAL_TOKEN_ENCRYPTION_KEY_PREVIOUS;
    process.env.SOCIAL_OAUTH_CALLBACK_BASE_URL = 'https://api.test.example';
    process.env.CLIENT_URL = 'https://app.test.example';
    // Fixture app ids for the fake providers (random per run; not real credentials).
    const r = () => crypto.randomBytes(6).toString('hex');
    Object.assign(process.env, {
        META_APP_ID: `meta-${r()}`,
        META_APP_SECRET: `metas-${r()}`,
        GOOGLE_CLIENT_ID: `google-${r()}`,
        GOOGLE_CLIENT_SECRET: `googles-${r()}`,
        LINKEDIN_CLIENT_ID: `li-${r()}`,
        LINKEDIN_CLIENT_SECRET: `lis-${r()}`,
        X_CLIENT_ID: `x-${r()}`,
        X_CLIENT_SECRET: `xs-${r()}`,
        TIKTOK_CLIENT_KEY: `tt-${r()}`,
        TIKTOK_CLIENT_SECRET: `tts-${r()}`,
    });
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;
}
