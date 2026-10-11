/**
 * Run: npx tsx --test --test-force-exit apps/backend/src/api/v1/social-media/projects/brand-consciousness.test.ts
 * Brand consciousness: validation, no invented values, completeness, tenant isolation, prompt context, logo upload.
 * The database is an in-memory stand-in implementing just the Prisma calls the module makes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import {
    applyProjectBrandPatch,
    brandPatchFromCreateBody,
    BrandConsciousnessError,
    getProjectBrandConsciousness,
    mergeBrandPatch,
    parseBrandPatch,
    readBrandConsciousness,
    resolveBrandRendering,
    toBrandPromptContext,
    updateProjectBrandConsciousness,
} from '../../../../../../../packages/domains/social-media/src/brand-consciousness';
import { brandLogoHandler, brandLogoMultipart, BRAND_LOGO_MAX_BYTES, inspectLogo, StorageNotConfiguredError } from './brand-logo-upload';

function matches(row: any, where: any): boolean {
    return Object.entries(where || {}).every(([k, v]) => (row[k] ?? null) === v);
}

function fakeDb(seed?: { projects?: any[]; voices?: any[] }) {
    const projects = seed?.projects ?? [
        { id: 'p1', companyId: 'co-1', name: 'Acme Social', projectType: 'social_media', deletedAt: null },
        { id: 'p2', companyId: 'co-2', name: 'Other Co', projectType: 'social_media', deletedAt: null },
    ];
    const voices: any[] = seed?.voices ?? [];
    const calls: any[] = [];
    let n = 0;
    return {
        voices,
        calls,
        db: {
            project: { findFirst: async (a: any) => (calls.push(a.where), projects.find((p) => matches(p, a.where)) ?? null) },
            brandVoiceProfile: {
                findFirst: async (a: any) => (calls.push(a.where), voices.find((v) => matches(v, a.where)) ?? null),
                create: async (a: any) => { const row = { id: `bv${++n}`, updatedAt: new Date(), ...a.data }; voices.push(row); return row; },
                update: async (a: any) => { const row = voices.find((v) => v.id === a.where.id); Object.assign(row, a.data, { updatedAt: new Date() }); return row; },
            },
        },
    };
}

const isErr = (status: number, code?: string) => (e: any) => e instanceof BrandConsciousnessError && e.status === status && (!code || e.code === code);

// ─── Validation ──────────────────────────────────────────────────────────────

test('validation: bad hex, unknown font, unknown platform, unknown field and bad enum are rejected with field paths', () => {
    const cases: [any, string][] = [
        [{ colors: { primary: 'red' } }, 'colors.primary'],
        [{ colors: { primary: '#12345' } }, 'colors.primary'],
        [{ colors: { shadow: '#123456' } }, 'colors'],
        [{ font: 'Comic Sans MS' }, 'font'],
        [{ targetPlatforms: ['myspace'] }, 'targetPlatforms'],
        [{ brandType: 'nonprofit' }, 'brandType'],
        [{ captionStylePreset: 'SPARKLY' }, 'captionStylePreset'],
        [{ positioningg: 'typo' }, '(body)'],
        [{ hashtags: ['#bad tag'] }, 'hashtags'],
        [{ logoUrl: 'javascript:alert(1)' }, 'logoUrl'],
        [{ tagline: 'x'.repeat(161) }, 'tagline'],
        [{ watermarkEnabled: 'yes' }, 'watermarkEnabled'],
    ];
    for (const [body, path] of cases) {
        assert.throws(() => parseBrandPatch(body), (e: any) => {
            assert.ok(isErr(400, 'VALIDATION_FAILED')(e), `400 for ${JSON.stringify(body)}`);
            assert.ok(e.details.some((d: any) => d.path === path || d.path.startsWith(path + '.') || (path === '(body)' && /positioningg|Unrecognized/i.test(d.message + d.path))), `${path} in ${JSON.stringify(e.details)}`);
            return true;
        });
    }
    assert.throws(() => parseBrandPatch([1, 2]), isErr(400));
});

test('validation: normalizes colours, fonts, platform aliases, hashtags and legacy field names', () => {
    const p = parseBrandPatch({
        colors: { primary: '#aabbcc', accent: '' },
        font: 'playfair display',
        targetPlatforms: ['Instagram', 'x', 'youtube_shorts', 'instagram'],
        hashtags: ['coffee', '#coffee', ' ##roast '],
        forbiddenWords: [' cheap ', 'Cheap', ''],
        brandPositioning: 'Third-wave coffee for home baristas',
        targetAudience: 'Home baristas',
        tagline: '   ',
    });
    assert.deepEqual(p.colors, { primary: '#AABBCC', accent: null });
    assert.equal(p.font, 'Playfair Display');
    assert.deepEqual(p.targetPlatforms, ['instagram', 'twitter', 'youtube']);
    assert.deepEqual(p.hashtags, ['#coffee', '#roast']);
    assert.deepEqual(p.forbiddenWords, ['cheap']);
    assert.equal(p.positioning, 'Third-wave coffee for home baristas');
    assert.equal(p.audience, 'Home baristas');
    assert.equal(p.tagline, null, 'blank string clears');
});

// ─── No fabricated defaults ──────────────────────────────────────────────────

test('create: an empty brand stores nothing invented and reports every required field as missing', () => {
    const { patch, extraMetadata } = brandPatchFromCreateBody({ name: 'Acme', description: 'Project notes' });
    const { columns, metadata } = mergeBrandPatch({ id: 'p1', name: 'Acme' }, null, patch, extraMetadata);
    assert.equal(columns.tone, '', 'no default tone');
    assert.equal(columns.targetAudience, '', 'no default audience');
    assert.deepEqual(columns.standardCtas, []);
    assert.equal(metadata.brand.positioning, null);
    assert.equal(metadata.brand.brandType, null);
    assert.deepEqual(metadata.brand.colors, { primary: null, secondary: null, accent: null, background: null, text: null });
    assert.deepEqual(metadata.brand.targetPlatforms, []);
    assert.equal(metadata.brand.font, null);
    assert.equal(metadata.brand.captionStylePreset, null);
    assert.equal(metadata.brand.watermarkEnabled, null);
    assert.equal(metadata.brand.description, null, 'project description is not copied into the brand');

    const b = readBrandConsciousness({ id: 'p1', name: 'Acme' }, { ...columns, metadata });
    assert.equal(b.completeness.isComplete, false);
    assert.deepEqual(b.completeness.missingRequired, ['brandType', 'positioning', 'description', 'tone', 'audience', 'colors.primary', 'targetPlatforms']);
    assert.equal(b.completeness.percent, 0);
});

test('create: mobile body shape (brandProfile + metadata) and web shape (top-level legacy names) are both accepted', () => {
    const mobile = brandPatchFromCreateBody({
        name: 'Acme',
        brandProfile: {
            tone: 'Warm, witty', targetAudience: 'Home baristas', forbiddenWords: ['cheap'], defaultHashtags: ['#coffee'],
            standardCtas: ['Shop now'], sampleViralPosts: [], contentPillars: ['Brewing'],
            metadata: { hookStyle: 'question', hooks: ['Ever wondered…'], contentPillars: ['Brewing'] },
        },
    });
    assert.equal(mobile.patch.tone, 'Warm, witty');
    assert.equal(mobile.patch.audience, 'Home baristas');
    assert.deepEqual(mobile.patch.contentPillars, ['Brewing']);
    assert.deepEqual(mobile.extraMetadata, { hookStyle: 'question', hooks: ['Ever wondered…'] }, 'non-brand metadata preserved');

    const web = brandPatchFromCreateBody({
        name: 'Acme', brandType: 'creator', brandPositioning: 'Coffee nerd', brandColors: { primary: '#112233' }, brandFont: 'Inter',
        targetPlatforms: ['instagram'], brandProfile: { tone: 'Calm' },
    });
    assert.equal(web.patch.brandType, 'creator');
    assert.equal(web.patch.positioning, 'Coffee nerd');
    assert.deepEqual(web.patch.colors, { primary: '#112233' });
    assert.equal(web.patch.tone, 'Calm');
    assert.throws(() => brandPatchFromCreateBody({ name: 'Acme', brandColors: { primary: 'blue' } }), isErr(400, 'VALIDATION_FAILED'));
});

test('read: legacy rows drop the old fabricated defaults instead of presenting them as the brand', () => {
    const b = readBrandConsciousness({ id: 'p1', name: 'Acme' }, {
        tone: 'Professional & Insightful', targetAudience: 'General Audience', standardCtas: [], defaultHashtags: [], forbiddenWords: [],
        metadata: {
            brandType: 'company', brandPositioning: 'Authoritative Industry Leader', brandTagline: 'Real tagline',
            brandColors: { primary: '#6366F1', accent: '#123456', background: '#090A0E', text: '#FFFFFF' },
            brandFont: 'Inter', captionStylePreset: 'HORMOZI_BOUNCE', watermarkEnabled: true,
            targetPlatforms: ['instagram', 'youtube_shorts', 'linkedin', 'twitter'],
        },
    });
    assert.equal(b.tone, null);
    assert.equal(b.audience, null);
    assert.equal(b.positioning, null);
    assert.equal(b.brandType, null);
    assert.equal(b.tagline, 'Real tagline');
    assert.deepEqual(b.colors, { primary: null, secondary: null, accent: '#123456', background: null, text: null });
    assert.equal(b.font, null);
    assert.equal(b.captionStylePreset, null);
    assert.equal(b.watermarkEnabled, null);
    assert.deepEqual(b.targetPlatforms, []);
});

// ─── Service: get / update / tenant isolation ───────────────────────────────

test('update: partial PUT changes only given fields, clears with null, keeps other metadata, completeness updates', async () => {
    const f = fakeDb({ voices: [{ id: 'bv0', companyId: 'co-1', projectId: 'p1', tone: 'Warm', targetAudience: '', forbiddenWords: [], defaultHashtags: [], standardCtas: [], sampleViralPosts: [], metadata: { hookStyle: 'question' } }] });
    let b = await updateProjectBrandConsciousness('p1', 'co-1', {
        brandType: 'company', positioning: 'Best beans', description: 'Roaster', audience: 'Home baristas',
        colors: { primary: '#112233', accent: '#445566' }, targetPlatforms: ['instagram', 'tiktok'], tagline: 'Brew slow',
    }, f.db);
    assert.equal(b.tone, 'Warm', 'untouched');
    assert.equal(b.completeness.isComplete, true);
    assert.deepEqual(b.completeness.missingRequired, []);
    assert.ok(b.completeness.missingRecommended.includes('logoUrl'));

    b = await updateProjectBrandConsciousness('p1', 'co-1', { colors: { accent: null }, tagline: null, targetPlatforms: [] }, f.db);
    assert.deepEqual(b.colors, { primary: '#112233', secondary: null, accent: null, background: null, text: null });
    assert.equal(b.tagline, null);
    assert.deepEqual(b.targetPlatforms, []);
    assert.deepEqual(b.completeness.missingRequired, ['targetPlatforms']);
    assert.equal(f.voices[0].metadata.hookStyle, 'question', 'mobile metadata survives');
    assert.equal(f.voices.length, 1);
    assert.equal(JSON.parse(JSON.stringify(b)).toPromptContext, undefined, 'prompt builder is not serialized');
    assert.equal(JSON.parse(JSON.stringify(b)).brandPositioning, undefined, 'legacy getters are not serialized');
    assert.equal((b as any).brandPositioning, 'Best beans', 'legacy getter still readable in-process');
});

test('update: creates the profile row when the project has none', async () => {
    const f = fakeDb();
    const b = await applyProjectBrandPatch('p1', 'co-1', { tone: 'Bold' }, f.db);
    assert.equal(b.tone, 'Bold');
    assert.equal(f.voices.length, 1);
    assert.equal(f.voices[0].companyId, 'co-1');
    assert.equal(f.voices[0].targetAudience, '');
});

test('tenant isolation: another company cannot read or write the brand, and every query carries companyId', async () => {
    const f = fakeDb({ voices: [{ id: 'bv0', companyId: 'co-2', projectId: 'p2', tone: 'Secret tone', targetAudience: 'x', forbiddenWords: [], defaultHashtags: [], standardCtas: [], sampleViralPosts: [], metadata: {} }] });
    await assert.rejects(getProjectBrandConsciousness('p2', 'co-1', f.db), isErr(404, 'PROJECT_NOT_FOUND'));
    await assert.rejects(updateProjectBrandConsciousness('p2', 'co-1', { tone: 'Hacked' }, f.db), isErr(404));
    await assert.rejects(getProjectBrandConsciousness('p1', '', f.db), isErr(401));
    await assert.rejects(getProjectBrandConsciousness('missing', 'co-1', f.db), isErr(404));
    assert.equal(f.voices[0].tone, 'Secret tone');
    for (const w of f.calls) assert.ok(w.companyId, `query without companyId: ${JSON.stringify(w)}`);
});

test('toPromptContext: concise, null-free, lists missing required fields', async () => {
    const f = fakeDb();
    await applyProjectBrandPatch('p1', 'co-1', parseBrandPatch({
        brandName: 'Acme Coffee', brandType: 'company', positioning: 'Third-wave coffee for home baristas', tone: 'Warm, witty',
        forbiddenWords: ['cheap'], ctas: ['Shop the roast'], hashtags: ['coffee'], colors: { primary: '#112233' }, font: 'Inter',
    }), f.db);
    const b = await getProjectBrandConsciousness('p1', 'co-1', f.db);
    const ctx = b.toPromptContext();
    assert.match(ctx, /^Brand: Acme Coffee \(company\)/);
    assert.match(ctx, /Never use these words: cheap/);
    assert.match(ctx, /Colours: primary #112233/);
    assert.match(ctx, /do not invent these\): description, audience, targetPlatforms/);
    assert.doesNotMatch(ctx, /null|undefined/);
    assert.equal(toBrandPromptContext(b, { includeVisual: false }).includes('Colours'), false);
});

test('resolveBrandRendering: neutral defaults at use time, reported, never written back', async () => {
    const f = fakeDb();
    const b = await applyProjectBrandPatch('p1', 'co-1', { colors: { primary: '#AA0000' } }, f.db);
    const r = resolveBrandRendering(b);
    assert.equal(r.colors.primary, '#AA0000');
    assert.equal(r.font, 'Inter');
    assert.ok(r.usedDefaults.includes('colors.accent') && r.usedDefaults.includes('font'));
    assert.equal(f.voices[0].metadata.brand.font, null);
    assert.equal(f.voices[0].metadata.brand.colors.accent, null);
});

// ─── Logo upload ─────────────────────────────────────────────────────────────

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

test('inspectLogo: signatures must match the declared type; unsafe SVGs are rejected', () => {
    assert.equal(inspectLogo(PNG, 'image/png'), null);
    assert.match(inspectLogo(PNG, 'image/jpeg')!, /not a JPEG/);
    assert.equal(inspectLogo(Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), 'image/svg+xml'), null);
    assert.match(inspectLogo(Buffer.from('<svg><script>alert(1)</script></svg>'), 'image/svg+xml')!, /scripts/);
    assert.match(inspectLogo(Buffer.from('<svg onload="x()"></svg>'), 'image/svg+xml')!, /scripts/);
    assert.match(inspectLogo(Buffer.from('<svg><image href="https://evil/x.png"/></svg>'), 'image/svg+xml')!, /external/);
    assert.match(inspectLogo(Buffer.from('hello'), 'image/svg+xml')!, /not an SVG/);
});

/** multipart POST over node:http (undici fetch leaves handles that crash --test-force-exit on Windows). */
async function fetch(url: string, init: { method: string; body: FormData }): Promise<{ status: number; json: () => Promise<any> }> {
    const encoded = new Response(init.body);
    const body = Buffer.from(await encoded.arrayBuffer());
    return new Promise((resolve, reject) => {
        const req = http.request(url, { method: init.method, headers: { 'content-type': encoded.headers.get('content-type')!, 'content-length': body.length, connection: 'close' } }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode!, json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
        });
        req.on('error', reject);
        req.end(body);
    });
}

async function withServer(deps: any, run: (url: string) => Promise<void>, companyId: string | null = 'co-1') {
    const app = express();
    app.use((req: any, _res, next) => { if (companyId) req.user = { id: 'u1', companyId }; next(); });
    app.post('/projects/:id/brand-consciousness/logo', brandLogoMultipart, brandLogoHandler(deps));
    const server = app.listen(0);
    try {
        await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    } finally {
        server.closeAllConnections();
        await new Promise((r) => server.close(() => r(undefined)));
    }
}

const form = (buf: Buffer, type: string, field = 'logo', name = 'logo.png') => {
    const fd = new FormData();
    fd.append(field, new Blob([buf], { type }), name);
    return fd;
};

function logoDeps(f: ReturnType<typeof fakeDb>, over: any = {}) {
    const uploads: any[] = [];
    const removed: string[] = [];
    return {
        uploads,
        removed,
        deps: {
            assertProject: (id: string, co: string) => getProjectBrandConsciousness(id, co, f.db),
            upload: async (buffer: Buffer, key: string, mimetype: string) => (uploads.push({ key, mimetype, size: buffer.length }), { url: `https://cdn.test/${key}` }),
            saveLogoUrl: (id: string, co: string, logoUrl: string) => applyProjectBrandPatch(id, co, { logoUrl }, f.db),
            removeOld: async (url: string) => { removed.push(url); },
            ...over,
        },
    };
}

test('logo: PNG upload is stored under the tenant prefix and saved as logoUrl; old logo removed', async () => {
    const f = fakeDb();
    await applyProjectBrandPatch('p1', 'co-1', { logoUrl: 'https://cdn.test/brands/logos/co-1/p1/old.png' }, f.db);
    const d = logoDeps(f);
    await withServer(d.deps, async (url) => {
        const r = await fetch(`${url}/projects/p1/brand-consciousness/logo`, { method: 'POST', body: form(PNG, 'image/png') });
        const j: any = await r.json();
        assert.equal(r.status, 201, JSON.stringify(j));
        assert.match(j.logoUrl, /^https:\/\/cdn\.test\/brands\/logos\/co-1\/p1\/\d+-[0-9a-f]{8}\.png$/);
        assert.equal(j.brand.logoUrl, j.logoUrl);
        assert.equal(f.voices[0].metadata.brand.logoUrl, j.logoUrl);
    });
    assert.equal(d.uploads.length, 1);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(d.removed, ['https://cdn.test/brands/logos/co-1/p1/old.png']);
});

test('logo: wrong type 415, spoofed bytes 415, too large 413, missing file 400, foreign project 404 (nothing uploaded)', async () => {
    const f = fakeDb();
    const d = logoDeps(f);
    await withServer(d.deps, async (url) => {
        const post = (body: any, id = 'p1') => fetch(`${url}/projects/${id}/brand-consciousness/logo`, { method: 'POST', body });
        let r = await post(form(Buffer.from('GIF89a'), 'image/gif', 'logo', 'a.gif'));
        assert.equal(r.status, 415);
        r = await post(form(Buffer.from('not really a png'), 'image/png'));
        assert.equal(r.status, 415);
        assert.equal(((await r.json()) as any).error, 'UNSUPPORTED_MEDIA');
        r = await post(form(Buffer.concat([PNG, Buffer.alloc(BRAND_LOGO_MAX_BYTES)]), 'image/png'));
        assert.equal(r.status, 413);
        assert.equal(((await r.json()) as any).error, 'FILE_TOO_LARGE');
        const empty = new FormData();
        empty.append('note', 'x');
        r = await post(empty);
        assert.equal(r.status, 400);
        r = await post(form(PNG, 'image/png', 'file'));
        assert.equal(r.status, 400, 'wrong field name');
        r = await post(form(PNG, 'image/png'), 'p2');
        assert.equal(r.status, 404);
    });
    assert.equal(d.uploads.length, 0);
});

test('logo: missing storage configuration fails loudly with 503, never a fake URL', async () => {
    const f = fakeDb();
    const d = logoDeps(f, { upload: async () => { throw new StorageNotConfiguredError('R2 storage is not configured'); } });
    await withServer(d.deps, async (url) => {
        const r = await fetch(`${url}/projects/p1/brand-consciousness/logo`, { method: 'POST', body: form(PNG, 'image/png') });
        assert.equal(r.status, 503);
        assert.equal(((await r.json()) as any).error, 'STORAGE_UNAVAILABLE');
    });
    assert.equal(f.voices.length, 0, 'nothing saved');
});

test('logo: unauthenticated request is 401', async () => {
    const f = fakeDb();
    await withServer(logoDeps(f).deps, async (url) => {
        const r = await fetch(`${url}/projects/p1/brand-consciousness/logo`, { method: 'POST', body: form(PNG, 'image/png') });
        assert.equal(r.status, 401);
    }, null);
});
