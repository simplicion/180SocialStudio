/**
 * Run: npx tsx --test apps/backend/src/api/v1/social-media/calendar-pieces/calendar-piece-media.test.ts
 * POST /social-media/calendar-pieces/:pieceId/raw-footage and /final-video with an in-memory fake store and a fake
 * uploader: tenant isolation, size/mime limits, post creation, status moves. Also covers the director context loader.
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { calendarPieceMediaRouter, CalendarPieceMediaDeps, maxRawFootageBytes } from './calendar-piece-media';
import { loadDirectorContext, DirectorContextDeps } from '../../media-editor/director-context';

type Row = Record<string, any>;
let pieces: Row[] = [];
let posts: Row[] = [];
let uploads: string[] = [];
let gateCalls = 0;

const deps: CalendarPieceMediaDeps = {
  findPiece: async (id, companyId) => pieces.find((p) => p.id === id && p.companyId === companyId) || null,
  findPostForPiece: async (pieceId, companyId) => posts.find((p) => p.calendarPieceId === pieceId && p.companyId === companyId) || null,
  createPostForPiece: async (piece, companyId, userId, media) => {
    const post = { id: `post_${posts.length + 1}`, companyId, calendarPieceId: piece.id, status: 'draft', createdById: userId, rawMediaUrls: piece.rawMediaUrls || [], metadata: {}, ...media };
    posts.push(post);
    return post;
  },
  updatePiece: async (id, companyId, data) => {
    const p = pieces.find((x) => x.id === id && x.companyId === companyId);
    if (!p) return 0;
    Object.assign(p, data);
    return 1;
  },
  updatePost: async (id, companyId, data) => {
    const p = posts.find((x) => x.id === id && x.companyId === companyId);
    if (!p) return 0;
    Object.assign(p, data);
    return 1;
  },
  findPost: async (id, companyId) => posts.find((p) => p.id === id && p.companyId === companyId) || null,
  upload: async (_path, key) => {
    uploads.push(key);
    return `https://cdn.example.com/${key}`;
  },
};

let server: http.Server;
let base = '';
before(async () => {
  const app = express();
  app.use((req: any, _res, next) => {
    req.user = { id: 'u1', companyId: String(req.headers['x-test-company'] || 'c1') };
    next();
  });
  app.use('/calendar-pieces', calendarPieceMediaRouter({ deps, deviceGate: (_req, _res, next) => { gateCalls++; next(); } }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }));
beforeEach(() => {
  pieces = [
    { id: 'piece_a', companyId: 'c1', calendarId: 'cal1', headline: 'Day 3', status: 'ready', rawMediaUrls: [], calendar: { projectId: 'proj1' } },
    { id: 'piece_b', companyId: 'c2', calendarId: 'cal2', headline: 'Other tenant', status: 'ready', rawMediaUrls: [] },
  ];
  posts = [];
  uploads = [];
  gateCalls = 0;
});

const mp4 = (bytes: number) => { const b = Buffer.alloc(bytes); b.write('ftypisom', 4, 'latin1'); return b; };
const webm = (bytes: number) => { const b = Buffer.alloc(bytes); b.set([0x1a, 0x45, 0xdf, 0xa3], 0); return b; };
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function send(pathname: string, parts: Array<{ field: string; buf: Buffer; type: string; name?: string }>, company = 'c1') {
  const fd = new FormData();
  for (const p of parts) fd.append(p.field, new Blob([p.buf], { type: p.type }), p.name || 'clip.mp4');
  return fetch(base + pathname, { method: 'POST', body: fd, headers: { 'x-test-company': company } }).then(async (r) => ({ status: r.status, json: (await r.json()) as any }));
}

test('raw-footage: stores the URL on the piece, moves it to in_progress', async () => {
  const r = await send('/calendar-pieces/piece_a/raw-footage', [{ field: 'video', buf: mp4(2048), type: 'video/mp4' }]);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.match(r.json.data.url, /^https:\/\/cdn\.example\.com\/social-media\/raw-footage\/c1\/piece_a\/.+\.mp4$/);
  assert.deepEqual(pieces[0].rawMediaUrls, [r.json.data.url]);
  assert.equal(pieces[0].status, 'in_progress');
  const r2 = await send('/calendar-pieces/piece_a/raw-footage', [{ field: 'video', buf: webm(512), type: 'video/webm', name: 'take2.webm' }]);
  assert.equal(r2.status, 201);
  assert.equal(pieces[0].rawMediaUrls.length, 2, 'appends');
  assert.equal(gateCalls, 0, 'raw footage intake is not device gated');
});

test('raw-footage: tenant isolation, another company\'s piece is a 404 and nothing is uploaded', async () => {
  const r = await send('/calendar-pieces/piece_b/raw-footage', [{ field: 'video', buf: mp4(1024), type: 'video/mp4' }], 'c1');
  assert.equal(r.status, 404);
  assert.equal(uploads.length, 0);
  assert.deepEqual(pieces[1].rawMediaUrls, []);
});

test('raw-footage: size limit (RAW_FOOTAGE_UPLOAD_MAX_MB), mime and signature checks', async () => {
  process.env.RAW_FOOTAGE_UPLOAD_MAX_MB = '1';
  assert.equal(maxRawFootageBytes(), 1024 * 1024);
  const big = await send('/calendar-pieces/piece_a/raw-footage', [{ field: 'video', buf: mp4(1024 * 1024 + 10), type: 'video/mp4' }]);
  assert.equal(big.status, 413);
  assert.equal(big.json.error, 'FILE_TOO_LARGE');
  delete process.env.RAW_FOOTAGE_UPLOAD_MAX_MB;
  assert.equal(maxRawFootageBytes(), 2048 * 1024 * 1024, 'default 2 GB');
  assert.equal((await send('/calendar-pieces/piece_a/raw-footage', [{ field: 'video', buf: mp4(100), type: 'image/png' }])).status, 415);
  const fake = await send('/calendar-pieces/piece_a/raw-footage', [{ field: 'video', buf: Buffer.alloc(100), type: 'video/mp4' }]);
  assert.equal(fake.status, 415, 'mislabelled file rejected by signature');
  assert.equal((await send('/calendar-pieces/piece_a/raw-footage', [{ field: 'other', buf: mp4(100), type: 'video/mp4' }])).status, 400, 'unknown file field');
  assert.equal((await send('/calendar-pieces/piece_a/raw-footage', [])).status, 400);
  assert.equal(uploads.length, 0);
});

test('final-video: creates the post when missing, attaches the video, piece -> pending_review, post -> in_review', async () => {
  const r = await send('/calendar-pieces/piece_a/final-video', [
    { field: 'video', buf: mp4(4096), type: 'video/mp4' },
    { field: 'thumbnail', buf: png(), type: 'image/png', name: 't.png' },
  ]);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(gateCalls, 1, 'device gated');
  assert.equal(r.json.data.createdPost, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].calendarPieceId, 'piece_a');
  assert.equal(posts[0].status, 'in_review');
  assert.match(posts[0].finalVideoUrl, /deliverables\/c1\/pieces\/piece_a\/.+\.mp4$/);
  assert.match(posts[0].thumbnailUrl, /-thumb\.png$/);
  assert.equal(pieces[0].status, 'pending_review');
  assert.equal(pieces[0].finalVideoUrl, posts[0].finalVideoUrl);
  // Second export reuses the same post.
  const again = await send('/calendar-pieces/piece_a/final-video', [{ field: 'video', buf: mp4(4096), type: 'video/mp4' }]);
  assert.equal(again.status, 201);
  assert.equal(again.json.data.createdPost, false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].metadata.deliverableHistory.length, 2);
});

test('final-video: tenant isolation, published post conflict, limits', async () => {
  const other = await send('/calendar-pieces/piece_b/final-video', [{ field: 'video', buf: mp4(1024), type: 'video/mp4' }], 'c1');
  assert.equal(other.status, 404);
  assert.equal(posts.length, 0);
  assert.equal(uploads.length, 0);
  posts.push({ id: 'post_pub', companyId: 'c1', calendarPieceId: 'piece_a', status: 'published', metadata: {} });
  const pub = await send('/calendar-pieces/piece_a/final-video', [{ field: 'video', buf: mp4(1024), type: 'video/mp4' }]);
  assert.equal(pub.status, 409);
  assert.equal(uploads.length, 0);
  posts = [];
  assert.equal((await send('/calendar-pieces/piece_a/final-video', [{ field: 'video', buf: webm(100), type: 'video/webm' }])).status, 415, 'final video must be MP4/MOV');
  process.env.MOBILE_VIDEO_UPLOAD_MAX_MB = '1';
  assert.equal((await send('/calendar-pieces/piece_a/final-video', [{ field: 'video', buf: mp4(1024 * 1024 + 10), type: 'video/mp4' }])).status, 413);
  delete process.env.MOBILE_VIDEO_UPLOAD_MAX_MB;
});

// ---------------------------------------------------------------------------------------------
// Director context loader (tenant scoping)
// ---------------------------------------------------------------------------------------------
const ctxDeps = (): DirectorContextDeps => ({
  findPost: async (id, companyId) => (id === 'post1' && companyId === 'c1' ? { id: 'post1', calendarPieceId: 'piece_a', projectId: null } : null),
  findPiece: async (id, companyId) =>
    id === 'piece_a' && companyId === 'c1'
      ? {
          id: 'piece_a', headline: 'Stop doing X', platform: 'instagram', contentType: 'reel', callToAction: 'Follow',
          dateScheduled: '2026-09-27T10:00:00Z', calendar: { projectId: 'proj1', startDate: '2026-09-25T00:00:00Z' },
          videoScriptOrHooks: JSON.stringify({ teleprompterScript: { hook: 'Stop doing X.', solution: 'Do Y.' }, targetDurationSec: 30 }),
        }
      : null,
  getBrand: async (projectId, companyId) => {
    if (projectId !== 'proj1' || companyId !== 'c1') throw new Error('not found');
    const b: any = { projectId, brandName: 'LiftLab', colors: { primary: '#111111', accent: '#FFC400', text: '#FFFFFF', background: null }, logoUrl: 'https://cdn.example.com/logo.png', font: 'Inter', captionStylePreset: 'HORMOZI_BOUNCE', watermarkEnabled: true, tone: 'bold', targetPlatforms: ['instagram'] };
    Object.defineProperty(b, 'toPromptContext', { value: () => 'Brand: LiftLab (bold)', enumerable: false });
    return b;
  },
});

test('director context: post -> piece -> project brand, script parsed, day label, prompt context', async () => {
  const ctx = await loadDirectorContext({ companyId: 'c1', postId: 'post1' }, ctxDeps());
  assert.deepEqual(ctx.warnings, []);
  assert.equal(ctx.piece?.calendarPieceId, 'piece_a');
  assert.equal(ctx.piece?.dayLabel, 'Day 3');
  assert.equal(ctx.piece?.hook, 'Stop doing X.');
  assert.equal(ctx.piece?.targetDurationSec, 30);
  assert.ok(ctx.piece?.sections.some((s) => s.kind === 'cta' && s.text === 'Follow'));
  assert.equal(ctx.brand?.colors.accent, '#FFC400');
  assert.equal(ctx.brand?.promptContext, 'Brand: LiftLab (bold)');
});

test('director context: another tenant gets nothing (warnings only)', async () => {
  const ctx = await loadDirectorContext({ companyId: 'c2', postId: 'post1', calendarPieceId: 'piece_a', projectId: 'proj1' }, ctxDeps());
  assert.equal(ctx.brand, undefined);
  assert.equal(ctx.piece, undefined);
  assert.equal(ctx.warnings.length, 3);
  const none = await loadDirectorContext({ companyId: 'c1' }, ctxDeps());
  assert.deepEqual(none, { warnings: [] });
});
