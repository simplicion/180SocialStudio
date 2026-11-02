/**
 * READ-ONLY export of every content piece the agents have generated, joined to the published post and its
 * per-platform metrics (SocialPostVariant.platformMeta.metrics, written by platform-team/post-metrics.ts).
 *
 *   DATABASE_URL=<read replica or snapshot> CORPUS_SALT=<secret> \
 *     npx tsx packages/domains/ai/scripts/corpus/export-corpus.ts [--out <file.jsonl>] [--since 2026-01-01]
 *
 * Point DATABASE_URL at a read replica or a snapshot, never the primary. Only findMany is used.
 * companyId / projectId are salted-hashed. The file still contains customer-written text, so it stays out of git
 * (scripts/corpus/out/ is ignored) and must be deleted after the analysis.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '@workspace/db';

export interface CorpusRow {
    pieceId: string;
    company: string;
    project: string;
    calendar: string;
    createdAt: string;
    autopilot: boolean;
    platform: string;
    contentType: string;
    pillar: string;
    headline: string;
    status: string;
    /** Parsed autopilot payload (schema autopilot.v1) or null for legacy pieces. */
    payload: Record<string, any> | null;
    caption: string;
    postingTime: string;
    post: null | {
        status: string;
        publishedAt: string | null;
        variants: { platform: string; publishStatus: string; metrics: Record<string, number | null> | null }[];
    };
}

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i > -1 ? process.argv[i + 1] : undefined;
}

export function hashId(id: string | null | undefined, salt: string): string {
    if (!id) return '';
    return crypto.createHash('sha256').update(`${salt}:${id}`).digest('hex').slice(0, 12);
}

export function parsePayload(raw: string): Record<string, any> | null {
    try {
        const v = JSON.parse(raw || '');
        return v && typeof v === 'object' && v.schema === 'autopilot.v1' ? v : null;
    } catch {
        return null;
    }
}

async function main() {
    const salt = process.env.CORPUS_SALT;
    if (!salt || salt.length < 12) throw new Error('Set CORPUS_SALT (12+ chars) so ids are hashed consistently and cannot be reversed.');
    const out = arg('out') || path.resolve(__dirname, 'out', `corpus-${new Date().toISOString().slice(0, 10)}.jsonl`);
    const since = arg('since');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const stream = fs.createWriteStream(out);

    const db: any = prisma;
    let cursor: string | undefined;
    let total = 0, withMetrics = 0;
    for (;;) {
        const rows: any[] = await db.calendarContentPiece.findMany({
            take: 500,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            where: since ? { createdAt: { gte: new Date(since) } } : undefined,
            orderBy: { id: 'asc' },
            select: {
                id: true, companyId: true, calendarId: true, createdAt: true, platform: true, contentType: true, pillar: true, headline: true,
                status: true, videoScriptOrHooks: true, adCopyFull: true, postingTimeTz: true,
                calendar: { select: { projectId: true } },
                socialPost: { select: { status: true, publishedAt: true, variants: { select: { platform: true, publishStatus: true, platformMeta: true } } } },
            },
        });
        if (!rows.length) break;
        for (const r of rows) {
            const payload = parsePayload(r.videoScriptOrHooks);
            const variants = (r.socialPost?.variants || []).map((v: any) => ({
                platform: v.platform, publishStatus: v.publishStatus,
                metrics: v.platformMeta && typeof v.platformMeta === 'object' && v.platformMeta.metrics ? v.platformMeta.metrics : null,
            }));
            if (variants.some((v: any) => v.metrics)) withMetrics++;
            const row: CorpusRow = {
                pieceId: hashId(r.id, salt), company: hashId(r.companyId, salt), project: hashId(r.calendar?.projectId, salt), calendar: hashId(r.calendarId, salt),
                createdAt: new Date(r.createdAt).toISOString(), autopilot: !!payload, platform: r.platform, contentType: r.contentType, pillar: r.pillar,
                headline: r.headline, status: r.status, payload, caption: r.adCopyFull || '', postingTime: r.postingTimeTz || '',
                post: r.socialPost ? { status: r.socialPost.status, publishedAt: r.socialPost.publishedAt ? new Date(r.socialPost.publishedAt).toISOString() : null, variants } : null,
            };
            stream.write(JSON.stringify(row) + '\n');
            total++;
        }
        cursor = rows[rows.length - 1].id;
        process.stdout.write(`\r[corpus] exported ${total} pieces (${withMetrics} with metrics)`);
    }
    stream.end();
    await db.$disconnect?.();
    console.log(`\n[corpus] wrote ${out}`);
}

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(1); });
}
