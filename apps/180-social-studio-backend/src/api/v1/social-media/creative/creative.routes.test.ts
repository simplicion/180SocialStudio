/**
 * Run: npx tsx --test --test-force-exit apps/backend/src/api/v1/social-media/creative/creative.routes.test.ts
 * HTTP contract of the creative engine routes, with the real CreativeService over an in-memory DB, a fake LLM,
 * a fake image provider and an in-memory asset store.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'net';
import { CreativeService } from '../../../../../../../packages/domains/social-media/src/creative/creative.service';
import { createCreativeRouter } from './creative.routes';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createCanvas } = require('@napi-rs/canvas');

const SLIDES = {
    slides: [
        { layout: 'cover', title: 'Hook title', body: 'Sub', imagePrompt: 'a cafe at dawn', emphasis: 'Hook' },
        { layout: 'point', title: 'Point one', body: 'Body', imagePrompt: null, emphasis: null },
        { layout: 'stat', title: '42%', body: 'Stat body', imagePrompt: null, emphasis: null },
        { layout: 'list', title: 'List', body: 'a\nb\nc', imagePrompt: null, emphasis: null },
        { layout: 'cta', title: 'Follow', body: 'Now', imagePrompt: null, emphasis: null },
    ],
};

function photo() {
    const c = createCanvas(200, 250);
    const x = c.getContext('2d');
    x.fillStyle = '#886644';
    x.fillRect(0, 0, 200, 250);
    return c.toBuffer('image/jpeg');
}

function build(opts: { generative?: boolean } = {}) {
    const posts: any[] = [{ id: 'post-1', companyId: 'co-1', projectId: 'p1', status: 'draft', title: 'Coffee myths', content: 'Five coffee myths, busted.', mediaUrls: [], metadata: {} }];
    const projects = [
        { id: 'p1', companyId: 'co-1' },
        { id: 'p2', companyId: 'co-2' },
    ];
    const eq = (row: any, where: any) => Object.entries(where).every(([k, v]) => (typeof v === 'object' && v !== null ? true : (row[k] ?? null) === v));
    const service = new CreativeService({
        db: {
            project: { findFirst: async (a: any) => projects.find((p) => p.id === a.where.id && p.companyId === a.where.companyId) ?? null },
            calendarContentPiece: { findFirst: async () => null, updateMany: async () => ({ count: 0 }) },
            socialPost: {
                findFirst: async (a: any) => posts.find((p) => eq(p, a.where)) ?? null,
                updateMany: async (a: any) => {
                    const hits = posts.filter((p) => eq(p, a.where));
                    hits.forEach((h) => Object.assign(h, a.data));
                    return { count: hits.length };
                },
                create: async (a: any) => a.data,
            },
        },
        store: { put: async (key) => `https://cdn.test/${key}` },
        loadBrand: async () => ({
            name: 'Acme',
            colors: { primary: '#123456', accent: '#FFAA00', background: '#101010', text: '#FFFFFF' },
            font: 'Inter',
            promptContext: 'Brand: Acme',
            forbiddenWords: [],
            standardCtas: [],
        }),
        getLlm: async () => ({ generate: async () => JSON.stringify(SLIDES) }),
        getImageProviders: async () => ({
            generative: opts.generative === false ? [] : [{ id: 'fake', kind: 'generative', model: 'fake-1', generate: async () => ({ buffer: photo(), mimeType: 'image/jpeg', provider: 'fake', model: 'fake-1', kind: 'generative' }) }],
            stock: [],
        }),
        font: { allowNetwork: false },
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        const co = req.header('x-test-company');
        if (co) (req as any).user = { id: 'u1', companyId: co };
        next();
    });
    app.use('/projects/:id/creative', createCreativeRouter(() => service));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const call = async (method: string, path: string, body?: any, company = 'co-1') => {
        const res = await fetch(base + path, {
            method,
            headers: { 'content-type': 'application/json', ...(company ? { 'x-test-company': company } : {}) },
            body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, body: (await res.json()) as any };
    };
    return { service, server, call, posts };
}

test('POST carousels -> 202 job, GET job -> completed with slide URLs attached to the post', async () => {
    const { service, server, call, posts } = build();
    try {
        const start = await call('POST', '/projects/p1/creative/carousels', { postId: 'post-1', format: 'square', useImageModel: true });
        assert.equal(start.status, 202);
        assert.match(start.body.job.id, /^crj_/);
        await service.idle();
        const got = await call('GET', `/projects/p1/creative/jobs/${start.body.job.id}`);
        assert.equal(got.status, 200);
        assert.equal(got.body.job.status, 'completed', JSON.stringify(got.body.job.error));
        assert.equal(got.body.job.result.slides.length, 5);
        assert.equal(got.body.job.result.slides[0].width, 1080);
        assert.equal(got.body.job.result.slides[0].height, 1080);
        assert.deepEqual(posts[0].mediaUrls, got.body.job.result.mediaUrls);
        assert.equal(posts[0].mediaType, 'carousel');

        const regen = await call('POST', `/projects/p1/creative/jobs/${start.body.job.id}/slides/2/regenerate`, { slide: { title: '57%' } });
        assert.equal(regen.status, 202);
        await service.idle();
        const after = await call('GET', `/projects/p1/creative/jobs/${start.body.job.id}`);
        assert.equal(after.body.job.slides[2].title, '57%');
        assert.match(after.body.job.result.mediaUrls[2], /slide-03-v2\.png$/);

        const status = await call('GET', '/projects/p1/creative/status');
        assert.equal(status.status, 200);
        assert.equal(status.body.imageModel.configured, true);
    } finally {
        server.close();
    }
});

test('typed errors: 401 without company, 404 across tenants, 400 invalid body, 503 missing image model', async () => {
    const { service, server, call } = build({ generative: false });
    try {
        assert.equal((await call('POST', '/projects/p1/creative/carousels', { brief: 'hello world' }, '')).status, 401);

        const noKey = await call('POST', '/projects/p1/creative/carousels', { brief: 'hello world', useImageModel: true });
        assert.equal(noKey.status, 503);
        assert.equal(noKey.body.code, 'IMAGE_MODEL_NOT_CONFIGURED');

        const bad = await call('POST', '/projects/p1/creative/carousels', { format: 'banner' });
        assert.equal(bad.status, 400);
        assert.equal(bad.body.code, 'INVALID_INPUT');

        const ok = await call('POST', '/projects/p1/creative/carousels', { brief: 'hello world', useImageModel: false });
        assert.equal(ok.status, 202);
        await service.idle();
        const foreignProject = await call('GET', `/projects/p1/creative/jobs/${ok.body.job.id}`, undefined, 'co-2');
        assert.equal(foreignProject.status, 404);
        const foreignJob = await call('GET', `/projects/p2/creative/jobs/${ok.body.job.id}`, undefined, 'co-2');
        assert.equal(foreignJob.status, 404);
        assert.equal(foreignJob.body.code, 'JOB_NOT_FOUND');
    } finally {
        server.close();
    }
});
