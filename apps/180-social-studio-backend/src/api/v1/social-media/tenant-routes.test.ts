/**
 * Run: npx tsx --test --test-force-exit apps/backend/src/api/v1/social-media/tenant-routes.test.ts
 *
 * HTTP contract of the Phase 0 fixes (docs/social-studio-mobile/PRODUCTION_GAP_AUDIT.md):
 *   - POST /posts/sync-studio-render takes the tenant from the JWT user only: 401 without one, 404 for another
 *     company's piece (nothing written);
 *   - legacy /content-calendar routes are tenant-scoped (404) and unexpected errors are a generic 500 (no internals);
 *   - POST /accounts/connect is limited to company admins;
 *   - video-studio routes ignore x-company-id / body companyId (401 without a JWT company).
 * The services run for real over an in-memory DB installed with setPublishingDb (the routes import the built
 * @workspace/social-media package, so the hook comes from there too).
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { setPublishingDb } from '@workspace/social-media';
import socialPostRoutes from './posts/social-post.routes';
import contentCalendarRoutes from './content-calendar/content-calendar.routes';
import socialAccountRoutes from './accounts/social-account.routes';
import { VideoStudioController } from '../workspace-tools/video-studio/video-studio.controller';

type Row = Record<string, any>;

function matches(row: Row, where: Row, rel: (k: string, row: Row) => Row | null): boolean {
    return Object.entries(where || {}).every(([k, c]) => {
        if (c === undefined) return true;
        if (k === 'OR') return (c as Row[]).some((w) => matches(row, w, rel));
        if (c === null) return row[k] == null;
        if (typeof c === 'object' && !Array.isArray(c)) {
            const r = rel(k, row);
            return Boolean(r && matches(r, c, rel));
        }
        return row[k] === c;
    });
}

let rows: Record<string, Row[]>;
let writes: string[];
let failNext: Error | null;

function model(name: string) {
    const rel = (k: string, row: Row) => (name === 'calendarContentPiece' && k === 'calendar' ? rows.contentCalendar.find((c) => c.id === row.calendarId) ?? null : null);
    const guard = () => {
        if (failNext) {
            const e = failNext;
            failNext = null;
            throw e;
        }
    };
    return {
        findFirst: async (a: any = {}) => (guard(), rows[name].find((r) => matches(r, a.where, rel)) ?? null),
        findMany: async (a: any = {}) => (guard(), rows[name].filter((r) => matches(r, a.where, rel))),
        updateMany: async (a: any) => {
            const hit = rows[name].filter((r) => matches(r, a.where, rel));
            hit.forEach((r) => Object.assign(r, a.data));
            if (hit.length) writes.push(`${name}.updateMany`);
            return { count: hit.length };
        },
        update: async (a: any) => {
            const r = rows[name].find((x) => matches(x, a.where, rel));
            if (!r) throw new Error('Record to update not found.');
            Object.assign(r, a.data);
            writes.push(`${name}.update`);
            return r;
        },
        deleteMany: async (a: any) => {
            const before = rows[name].length;
            rows[name] = rows[name].filter((r) => !matches(r, a.where, rel));
            if (before !== rows[name].length) writes.push(`${name}.deleteMany`);
            return { count: before - rows[name].length };
        },
    };
}

beforeEach(() => {
    rows = {
        contentCalendar: [
            { id: 'cal-1', companyId: 'co-1', name: 'Acme', metadata: {} },
            { id: 'cal-2', companyId: 'co-2', name: 'Globex', metadata: {} },
        ],
        calendarContentPiece: [{ id: 'piece-1', calendarId: 'cal-1', companyId: 'co-1', status: 'draft' }],
        socialPost: [{ id: 'post-1', companyId: 'co-1', calendarPieceId: 'piece-1', status: 'draft' }],
        project: [],
    };
    writes = [];
    failNext = null;
    const db: Row = {};
    for (const n of Object.keys(rows)) db[n] = model(n);
    setPublishingDb(db);
});

let server: http.Server;
let base = '';

before(async () => {
    const app = express();
    app.use(express.json());
    // Test auth: x-test-user "<companyId>:<role>" stands in for the verified JWT user set by `protect`.
    app.use((req: any, _res, next) => {
        const u = req.headers['x-test-user'];
        if (typeof u === 'string') {
            const [companyId, role] = u.split(':');
            req.user = { id: 'u1', companyId, role, roles: [role] };
        }
        next();
    });
    app.use('/posts', socialPostRoutes);
    app.use('/content-calendar', contentCalendarRoutes);
    app.use('/accounts', socialAccountRoutes);
    app.get('/video-studio/projects', VideoStudioController.listProjects);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    setPublishingDb(null);
    await new Promise((r) => server?.close(r));
});

/** Plain http.request (no fetch keep-alive pool left behind at exit). */
function call(method: string, path: string, opts: { user?: string; body?: any; headers?: Record<string, string> } = {}): Promise<{ status: number; json: any; text: string }> {
    const payload = opts.body ? JSON.stringify(opts.body) : undefined;
    return new Promise((resolve, reject) => {
        const req = http.request(
            base + path,
            {
                method,
                agent: false,
                headers: {
                    'content-type': 'application/json',
                    ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
                    ...(opts.user ? { 'x-test-user': opts.user } : {}),
                    ...(opts.headers || {}),
                },
            },
            (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (c) => (text += c));
                res.on('end', () => {
                    let json: any = null;
                    try {
                        json = JSON.parse(text);
                    } catch {
                        /* not json */
                    }
                    resolve({ status: res.statusCode || 0, json, text });
                });
            },
        );
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

test('sync-studio-render: 401 without a JWT company, even with a company in the body or header', async () => {
    const r = await call('POST', '/posts/sync-studio-render', { body: { calendarPieceId: 'piece-1', finalVideoUrl: 'https://cdn/x.mp4', companyId: 'co-1' }, headers: { 'x-company-id': 'co-1' } });
    assert.equal(r.status, 401);
    assert.deepEqual(writes, []);
});

test('sync-studio-render: another company\'s piece is a 404 and nothing is written; the owner succeeds', async () => {
    const cross = await call('POST', '/posts/sync-studio-render', { user: 'co-2:employee', body: { calendarPieceId: 'piece-1', finalVideoUrl: 'https://cdn/x.mp4' } });
    assert.equal(cross.status, 404);
    assert.equal(cross.json.code, 'NOT_FOUND');
    assert.deepEqual(writes, []);

    const own = await call('POST', '/posts/sync-studio-render', { user: 'co-1:employee', body: { calendarPieceId: 'piece-1', finalVideoUrl: 'https://cdn/final.mp4' } });
    assert.equal(own.status, 200);
    assert.equal(rows.calendarContentPiece[0].finalVideoUrl, 'https://cdn/final.mp4');
    assert.equal(rows.socialPost[0].finalVideoUrl, 'https://cdn/final.mp4');
});

test('content-calendar: another company\'s calendar is a 404 for get / update / delete / pieces', async () => {
    assert.equal((await call('GET', '/content-calendar/cal-1', { user: 'co-2:admin' })).status, 404);
    assert.equal((await call('PUT', '/content-calendar/cal-1', { user: 'co-2:admin', body: { name: 'pwned' } })).status, 404);
    assert.equal((await call('DELETE', '/content-calendar/cal-1', { user: 'co-2:admin' })).status, 404);
    assert.equal((await call('GET', '/content-calendar/cal-1/pieces', { user: 'co-2:admin' })).status, 404);
    assert.equal((await call('PUT', '/content-calendar/cal-1/pieces/piece-1', { user: 'co-2:admin', body: { headline: 'x' } })).status, 404);
    assert.deepEqual(writes, []);
    assert.equal(rows.contentCalendar[0].name, 'Acme');

    const own = await call('GET', '/content-calendar/cal-1', { user: 'co-1:employee' });
    assert.equal(own.status, 200);
    assert.equal(own.json.calendar.id, 'cal-1');
    assert.equal((await call('GET', '/content-calendar', {})).status, 401);
});

test('content-calendar: an unexpected error is a generic 500 without internals', async () => {
    failNext = new Error('Invalid `prisma.contentCalendar.findFirst()` invocation: connection to 10.0.0.5:5432 refused');
    const origError = console.error;
    console.error = () => {};
    try {
        const r = await call('GET', '/content-calendar/cal-1', { user: 'co-1:employee' });
        assert.equal(r.status, 500);
        assert.equal(r.json.error, 'Unexpected error');
        assert.ok(!r.text.includes('prisma') && !r.text.includes('10.0.0.5'), 'no internal detail leaks');
    } finally {
        console.error = origError;
    }
});

test('accounts/connect: company admins only', async () => {
    const r = await call('POST', '/accounts/connect', { user: 'co-1:employee', body: { platform: 'instagram', platformAccountId: 'x', accessToken: 'y' } });
    assert.equal(r.status, 403);
    assert.equal((await call('POST', '/accounts/connect', { body: {} })).status, 401);
});

test('video-studio: the tenant never comes from x-company-id (401 without a JWT company)', async () => {
    const r = await call('GET', '/video-studio/projects', { headers: { 'x-company-id': 'co-1' } });
    assert.equal(r.status, 401);
});
