/**
 * Studio library metadata sync (PRODUCTION_READINESS_PLAN P2.8): idempotent upserts, company isolation, soft deletes,
 * input validation. In-memory Prisma; never a real database.
 */
import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { FakeModel, createFakeDb } from './publishing/fakes';
import { setPublishingDb } from '../src/publishing/http';
import { StudioLibraryService } from '../src/studio-library.service';

let db: any;
beforeEach(() => {
    db = createFakeDb();
    db.studioMediaFolder = new FakeModel('studioMediaFolder');
    db.studioMediaAsset = new FakeModel('studioMediaAsset');
    db.project.rows.push({ id: 'pA', companyId: 'A' }, { id: 'pB', companyId: 'B' });
    setPublishingDb(db);
});
after(() => setPublishingDb(null));

const clip = (over: any = {}) => ({ id: 'clip1', type: 'video', name: 'Clip 1', pieceId: 'piece1', takeIndex: 1, durationMs: 4200, fileSizeBytes: 1024, localPath: '/data/clips/a.mp4', ...over });

test('push is an idempotent upsert; pull returns numbers for BigInt columns', async () => {
    await StudioLibraryService.push('A', { projectId: 'pA', deviceId: 'dev1', folders: [{ id: 'f1', name: 'Day 2', colorValue: 0xff4f46e5 }], items: [clip({ folderId: 'f1' })] });
    await StudioLibraryService.push('A', { projectId: 'pA', deviceId: 'dev1', items: [clip({ folderId: 'f1', name: 'Hook take' })] });
    assert.equal(db.studioMediaAsset.rows.length, 1);
    const r = await StudioLibraryService.pull('A', { projectId: 'pA' });
    assert.equal(r.items[0].name, 'Hook take');
    assert.equal(r.items[0].pieceId, 'piece1');
    assert.equal(r.items[0].deviceId, 'dev1');
    assert.equal(r.folders[0].colorValue, 0xff4f46e5);
    assert.equal(typeof r.items[0].fileSizeBytes, 'number');
});

test('another company never sees or overwrites the rows', async () => {
    await StudioLibraryService.push('A', { projectId: 'pA', items: [clip()] });
    assert.deepEqual((await StudioLibraryService.pull('B')).items, []);
    await assert.rejects(StudioLibraryService.push('B', { items: [clip({ name: 'hijack' })] }), (e: any) => e.code === 'ID_CONFLICT');
    await assert.rejects(StudioLibraryService.push('B', { deletedItemIds: ['clip1'] }), (e: any) => e.code === 'ID_CONFLICT');
    await assert.rejects(StudioLibraryService.push('A', { projectId: 'pB', items: [] }), (e: any) => e.statusCode === 404);
    assert.equal(db.studioMediaAsset.rows[0].name, 'Clip 1');
});

test('deletes are soft so other devices learn about them; re-pushing restores', async () => {
    await StudioLibraryService.push('A', { items: [clip()] });
    await StudioLibraryService.push('A', { deletedItemIds: ['clip1'] });
    const r = await StudioLibraryService.pull('A');
    assert.ok(r.items[0].deletedAt);
    await StudioLibraryService.push('A', { items: [clip()] });
    assert.equal(db.studioMediaAsset.rows[0].deletedAt, null);
});

test('validation: bad ids, unknown types, oversized batches', async () => {
    await assert.rejects(StudioLibraryService.push('A', { items: [clip({ id: '../etc' })] }), (e: any) => e.statusCode === 400);
    await assert.rejects(StudioLibraryService.push('A', { items: [clip({ type: 'exe' })] }), (e: any) => e.statusCode === 400);
    await assert.rejects(StudioLibraryService.push('A', { items: Array.from({ length: 501 }, (_, i) => clip({ id: `c${i}` })) }), (e: any) => e.statusCode === 400);
    await assert.rejects(StudioLibraryService.pull('A', { since: 'yesterday' }), (e: any) => e.statusCode === 400);
});
