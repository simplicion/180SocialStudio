/**
 * Project media index + search (Social OS P2/P3 "user library first").
 *
 * The device (phone / desktop app) analyses the creator's own media and sends TEXT only: transcript segments, scene
 * captions, OCR and caption lines, with timings and an optional URL. The server stores them per project and ranks
 * them for a query. Media never leaves the device.
 *
 * Ranking is local Okapi BM25 over stemmed tokens: free, deterministic, no network and no new dependency. The
 * workspace RAG embedding engine (packages/domains/rag) was not reused because it is company/vault-scoped, needs a
 * paid OpenAI key, and silently falls back to hashed pseudo-vectors (mixing vector spaces between index and query
 * time). A real embedding provider can be added behind `MediaSearchRanker` later without changing the API.
 */
import { prisma } from '@workspace/db';
import { AgentOsError, requireSocialProject } from './agent-memory';

export const MEDIA_INDEX_KINDS = ['transcript', 'scene', 'ocr', 'caption'] as const;
export type MediaIndexKind = (typeof MEDIA_INDEX_KINDS)[number];

export interface MediaIndexItem {
    assetId: string;
    kind: MediaIndexKind;
    text: string;
    startMs?: number | null;
    endMs?: number | null;
    url?: string | null;
}

export interface MediaSearchResult {
    assetId: string;
    kind: MediaIndexKind;
    text: string;
    startMs: number | null;
    endMs: number | null;
    url: string | null;
    score: number;
}

export interface MediaIndexDb {
    project: { findFirst(a: any): Promise<any> };
    mediaIndexEntry: {
        findFirst(a: any): Promise<any>;
        findMany(a: any): Promise<any[]>;
        create(a: any): Promise<any>;
        updateMany(a: any): Promise<{ count: number }>;
    };
}

export const MEDIA_INDEX_LIMITS = { maxItems: 500, maxText: 4000, maxEntriesScanned: 5000, maxResults: 50 } as const;

const STOP = new Set([
    'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are', 'was', 'but', 'not', 'have', 'has', 'our',
    'out', 'into', 'about', 'its', 'it', 'is', 'of', 'to', 'in', 'on', 'at', 'a', 'an', 'or', 'as', 'be', 'by', 'we', 'i',
    'me', 'my', 'so', 'do', 'if', 'up', 'can', 'just', 'like', 'um', 'uh',
]);

/** Lower-case, accent-free, stemmed tokens (Unicode letters and digits). */
export function tokenize(text: string): string[] {
    return String(text || '')
        .normalize('NFKD')
        .replace(/\p{M}+/gu, '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 1 && !STOP.has(t))
        .map((t) => (t.length > 4 ? t.replace(/(?:ing|ers|er|es|ed|s)$/u, '') : t));
}

/** Okapi BM25 over the given documents. Pure. */
export function bm25Rank(query: string, docs: Array<{ text: string }>, k1 = 1.2, b = 0.75): number[] {
    const q = Array.from(new Set(tokenize(query)));
    if (!q.length || !docs.length) return docs.map(() => 0);
    const toks = docs.map((d) => tokenize(d.text));
    const avgLen = toks.reduce((a, t) => a + t.length, 0) / toks.length || 1;
    const df = new Map<string, number>();
    for (const t of toks) for (const term of new Set(t)) df.set(term, (df.get(term) || 0) + 1);
    const N = docs.length;
    return toks.map((t) => {
        const tf = new Map<string, number>();
        for (const term of t) tf.set(term, (tf.get(term) || 0) + 1);
        let score = 0;
        for (const term of q) {
            const f = tf.get(term) || 0;
            if (!f) continue;
            const n = df.get(term) || 0;
            const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
            score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * t.length) / avgLen)));
        }
        return score;
    });
}

const msOrNull = (v: unknown, path: string, issues: string[]) => {
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 4 * 3600 * 1000) {
        issues.push(`${path} must be an integer number of milliseconds`);
        return null;
    }
    return v;
};

/** Validates an upsert body; throws 400 VALIDATION_FAILED listing every problem. */
export function parseMediaIndexItems(body: unknown): MediaIndexItem[] {
    const raw = Array.isArray(body) ? body : (body as any)?.items;
    if (!Array.isArray(raw) || raw.length === 0) throw new AgentOsError(400, 'VALIDATION_FAILED', 'Send a non-empty array of items (or { items: [...] })');
    if (raw.length > MEDIA_INDEX_LIMITS.maxItems) throw new AgentOsError(400, 'VALIDATION_FAILED', `At most ${MEDIA_INDEX_LIMITS.maxItems} items per request`);
    const issues: string[] = [];
    const out: MediaIndexItem[] = raw.map((it: any, i: number) => {
        const p = `items[${i}]`;
        const assetId = typeof it?.assetId === 'string' ? it.assetId.trim() : '';
        if (!assetId || assetId.length > 128) issues.push(`${p}.assetId is required (1..128 chars)`);
        if (!(MEDIA_INDEX_KINDS as readonly string[]).includes(it?.kind)) issues.push(`${p}.kind must be one of ${MEDIA_INDEX_KINDS.join(', ')}`);
        const text = typeof it?.text === 'string' ? it.text.trim() : '';
        if (!text || text.length > MEDIA_INDEX_LIMITS.maxText) issues.push(`${p}.text is required (1..${MEDIA_INDEX_LIMITS.maxText} chars)`);
        const startMs = msOrNull(it?.startMs, `${p}.startMs`, issues);
        const endMs = msOrNull(it?.endMs, `${p}.endMs`, issues);
        if (startMs != null && endMs != null && endMs < startMs) issues.push(`${p}.endMs must be >= startMs`);
        let url: string | null = null;
        if (it?.url != null && it.url !== '') {
            try {
                const u = new URL(String(it.url));
                if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad protocol');
                url = u.toString();
            } catch {
                issues.push(`${p}.url must be an http(s) URL`);
            }
        }
        return { assetId, kind: it?.kind, text, startMs, endMs, url };
    });
    if (issues.length) throw new AgentOsError(400, 'VALIDATION_FAILED', issues.slice(0, 20).join('; '), issues);
    return out;
}

export class MediaIndexService {
    constructor(private readonly db: MediaIndexDb = prisma as unknown as MediaIndexDb) {}

    /** Upsert by (project, assetId, kind, startMs). Returns counts. */
    async upsert(projectId: string, companyId: string, body: unknown): Promise<{ created: number; updated: number }> {
        await requireSocialProject(this.db, projectId, companyId);
        const items = parseMediaIndexItems(body);
        let created = 0;
        let updated = 0;
        for (const it of items) {
            const key = { companyId, projectId, assetId: it.assetId, kind: it.kind, startMs: it.startMs ?? null };
            const existing = await this.db.mediaIndexEntry.findFirst({ where: key, select: { id: true } });
            const data = { text: it.text, endMs: it.endMs ?? null, url: it.url ?? null };
            if (existing) {
                await this.db.mediaIndexEntry.updateMany({ where: { id: existing.id, companyId, projectId }, data });
                updated++;
            } else {
                await this.db.mediaIndexEntry.create({ data: { ...key, ...data } });
                created++;
            }
        }
        return { created, updated };
    }

    async search(projectId: string, companyId: string, body: unknown): Promise<{ results: MediaSearchResult[] }> {
        await requireSocialProject(this.db, projectId, companyId);
        const query = typeof (body as any)?.query === 'string' ? (body as any).query.trim() : '';
        if (!query || query.length > 500) throw new AgentOsError(400, 'VALIDATION_FAILED', 'query is required (1..500 chars)');
        const rawLimit = (body as any)?.limit;
        const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MEDIA_INDEX_LIMITS.maxResults) : 10;
        const rows = await this.db.mediaIndexEntry.findMany({
            where: { companyId, projectId },
            orderBy: { updatedAt: 'desc' },
            take: MEDIA_INDEX_LIMITS.maxEntriesScanned,
        });
        // Defence in depth: never rank a row from another tenant/project even if a stand-in ignored the filter.
        const scoped = rows.filter((r) => r.companyId === companyId && r.projectId === projectId);
        const scores = bm25Rank(query, scoped);
        const results = scoped
            .map((r, i) => ({ r, score: scores[i] }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(({ r, score }) => ({
                assetId: r.assetId,
                kind: r.kind,
                text: r.text,
                startMs: r.startMs ?? null,
                endMs: r.endMs ?? null,
                url: r.url ?? null,
                score: Math.round(score * 1000) / 1000,
            }));
        return { results };
    }
}
