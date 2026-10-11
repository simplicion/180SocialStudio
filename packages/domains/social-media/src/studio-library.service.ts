/**
 * Studio library metadata sync. Folders and items (names, folders, calendar-piece links, take order, notes) live in
 * the database so they survive reinstalls and show on every device; the media files themselves never leave the
 * device that recorded them (`deviceId` + `localPath` say where the file is).
 *
 * Client-generated ids make every push an idempotent upsert. Ids that already belong to another company are refused,
 * never overwritten. Deletes are soft (`deletedAt`) so other devices learn about them on their next pull.
 */
import { getDb } from './publishing/http';
import { SocialDomainError, notFound, requireCompanyId } from './tenant-scope';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ITEM_TYPES = ['video', 'image', 'audio', 'note', 'document', 'other'];
const MAX_BATCH = 500;

const invalid = (m: string) => new SocialDomainError('VALIDATION_FAILED', 400, m);
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);
const int = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : min;
};
const id = (v: unknown, what: string): string => {
    if (typeof v !== 'string' || !ID_RE.test(v)) throw invalid(`${what} must be an id of letters, digits, - or _`);
    return v;
};
const optId = (v: unknown, what: string): string | null => (v == null || v === '' ? null : id(v, what));

export interface LibrarySyncInput {
    projectId?: string | null;
    deviceId?: string | null;
    folders?: any[];
    items?: any[];
    deletedFolderIds?: string[];
    deletedItemIds?: string[];
}

/** BigInt columns are returned as numbers (colour ARGB values and byte sizes fit in a double). */
const plain = (row: any) => (row ? { ...row, ...(row.colorValue != null ? { colorValue: Number(row.colorValue) } : {}), ...(row.fileSizeBytes != null ? { fileSizeBytes: Number(row.fileSizeBytes) } : {}) } : row);

export class StudioLibraryService {
    private static async requireProject(companyId: string, projectId: string | null) {
        if (!projectId) return null;
        const p = await (getDb() as any).project.findFirst({ where: { id: projectId, companyId }, select: { id: true } });
        if (!p) throw notFound('Project');
        return p.id as string;
    }

    /** Everything changed since [since] (or everything), including soft-deleted rows so devices can drop them. */
    static async pull(companyId: string, opts: { projectId?: string | null; since?: string | null } = {}) {
        requireCompanyId(companyId);
        const projectId = await this.requireProject(companyId, opts.projectId ?? null);
        const since = opts.since ? new Date(opts.since) : null;
        if (since && Number.isNaN(since.getTime())) throw invalid('since must be an ISO date');
        const where: any = { companyId, ...(projectId ? { projectId } : {}), ...(since ? { updatedAt: { gt: since } } : {}) };
        const db = getDb() as any;
        const [folders, items] = await Promise.all([
            db.studioMediaFolder.findMany({ where, orderBy: { updatedAt: 'asc' }, take: 5000 }),
            db.studioMediaAsset.findMany({ where, orderBy: { updatedAt: 'asc' }, take: 5000 }),
        ]);
        return { folders: folders.map(plain), items: items.map(plain), serverTime: new Date().toISOString() };
    }

    static async push(companyId: string, input: LibrarySyncInput) {
        requireCompanyId(companyId);
        const projectId = await this.requireProject(companyId, input?.projectId ? String(input.projectId) : null);
        const deviceId = input?.deviceId == null ? null : str(input.deviceId, 128);
        const folders = Array.isArray(input?.folders) ? input.folders : [];
        const items = Array.isArray(input?.items) ? input.items : [];
        const delF = Array.isArray(input?.deletedFolderIds) ? input.deletedFolderIds.map((x) => id(x, 'deletedFolderIds[]')) : [];
        const delI = Array.isArray(input?.deletedItemIds) ? input.deletedItemIds.map((x) => id(x, 'deletedItemIds[]')) : [];
        if (folders.length + items.length + delF.length + delI.length > MAX_BATCH) throw invalid(`At most ${MAX_BATCH} changes per sync`);

        const folderRows = folders.map((f) => ({
            id: id(f?.id, 'folders[].id'),
            name: str(f?.name, 200) ?? 'Untitled folder',
            colorValue: BigInt(int(f?.colorValue, 0, 0xffffffff)),
            parentId: optId(f?.parentId, 'folders[].parentId'),
        }));
        const itemRows = items.map((i) => {
            const type = String(i?.type || 'other');
            if (!ITEM_TYPES.includes(type)) throw invalid(`items[].type must be one of ${ITEM_TYPES.join(', ')}`);
            return {
                id: id(i?.id, 'items[].id'),
                folderId: optId(i?.folderId, 'items[].folderId'),
                pieceId: optId(i?.pieceId, 'items[].pieceId'),
                name: str(i?.name, 200) ?? 'Untitled item',
                type,
                durationMs: int(i?.durationMs, 0, 24 * 3600_000),
                fileSizeBytes: BigInt(int(i?.fileSizeBytes)),
                takeIndex: i?.takeIndex == null ? null : int(i.takeIndex, 1, 10_000),
                tags: Array.isArray(i?.tags) ? i.tags.filter((t: unknown) => typeof t === 'string').slice(0, 30).map((t: string) => t.slice(0, 60)) : [],
                noteContent: str(i?.noteContent, 20_000),
                noteCategory: str(i?.noteCategory, 40),
                localPath: str(i?.localPath, 1000),
            };
        });

        const db = getDb() as any;
        // Refuse ids that another company already owns (ids are global primary keys).
        const allIds = [...folderRows.map((f) => f.id), ...delF];
        const allItemIds = [...itemRows.map((i) => i.id), ...delI];
        const [foreignF, foreignI] = await Promise.all([
            allIds.length ? db.studioMediaFolder.findMany({ where: { id: { in: allIds }, NOT: { companyId } }, select: { id: true } }) : [],
            allItemIds.length ? db.studioMediaAsset.findMany({ where: { id: { in: allItemIds }, NOT: { companyId } }, select: { id: true } }) : [],
        ]);
        if (foreignF.length || foreignI.length) throw new SocialDomainError('ID_CONFLICT', 409, 'Some library ids belong to another workspace.');

        const now = new Date();
        for (const f of folderRows) {
            const existing = await db.studioMediaFolder.findFirst({ where: { id: f.id, companyId }, select: { id: true } });
            if (existing) await db.studioMediaFolder.updateMany({ where: { id: f.id, companyId }, data: { ...f, deletedAt: null } });
            else await db.studioMediaFolder.create({ data: { ...f, companyId, projectId } });
        }
        for (const i of itemRows) {
            const existing = await db.studioMediaAsset.findFirst({ where: { id: i.id, companyId }, select: { id: true } });
            const data = { ...i, ...(deviceId ? { deviceId } : {}), deletedAt: null };
            if (existing) await db.studioMediaAsset.updateMany({ where: { id: i.id, companyId }, data });
            else await db.studioMediaAsset.create({ data: { ...data, companyId, projectId } });
        }
        if (delF.length) await db.studioMediaFolder.updateMany({ where: { id: { in: delF }, companyId }, data: { deletedAt: now } });
        if (delI.length) await db.studioMediaAsset.updateMany({ where: { id: { in: delI }, companyId }, data: { deletedAt: now } });
        return { folders: folderRows.length, items: itemRows.length, deleted: delF.length + delI.length };
    }
}
