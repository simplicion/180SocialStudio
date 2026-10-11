/**
 * Per-project agent memory (Social OS P4).
 *
 * What is remembered, per project (never shared across projects or companies):
 *   - preference         explicit creator preferences parsed from their words ("less zoom", "smaller captions");
 *                        one row per key, a newer value replaces the older one
 *   - proposal_accepted / proposal_rejected   feedback on agent proposals (Director turns, calendar pieces)
 *   - performance        per-post results (engagement) reported by the insights sync or the client
 *
 * `buildMemoryContext()` turns it into a few compact prompt lines for the Director and the strategist. Free text a
 * person typed (feedback notes) is fenced as untrusted data. Every query filters by companyId AND projectId.
 */
import { prisma } from '@workspace/db';
import { fenceUntrusted, sanitizeInlineUntrusted } from '@workspace/ai/agent-runs';

export const MEMORY_KINDS = ['preference', 'proposal_accepted', 'proposal_rejected', 'performance'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryScope = 'director' | 'strategist' | 'all';

export class AgentOsError extends Error {
    constructor(public statusCode: number, public code: string, message: string, public details?: unknown) {
        super(message);
        this.name = 'AgentOsError';
    }
}

export interface AgentMemoryRow {
    id: string;
    companyId: string;
    projectId: string;
    kind: MemoryKind;
    scope: MemoryScope;
    key: string | null;
    text: string;
    payload: any;
    weight: number;
    createdAt: Date | string;
    updatedAt: Date | string;
}

/** Minimal Prisma surface (tests pass an in-memory stand-in). */
export interface AgentMemoryDb {
    project: { findFirst(a: any): Promise<any> };
    agentMemory: {
        findFirst(a: any): Promise<any>;
        findMany(a: any): Promise<any[]>;
        create(a: any): Promise<any>;
        updateMany(a: any): Promise<{ count: number }>;
        deleteMany(a: any): Promise<{ count: number }>;
    };
}

/** Every Social OS service checks project ownership the same way (404 for foreign or unknown projects). */
export async function requireSocialProject(db: { project: { findFirst(a: any): Promise<any> } }, projectId: string, companyId: string) {
    if (!companyId) throw new AgentOsError(401, 'COMPANY_REQUIRED', 'Company context required');
    if (!projectId || typeof projectId !== 'string' || projectId.length > 128) throw new AgentOsError(400, 'PROJECT_ID_REQUIRED', 'projectId is required');
    const project = await db.project.findFirst({ where: { id: projectId, companyId, projectType: 'social_media', deletedAt: null }, select: { id: true } });
    if (!project) throw new AgentOsError(404, 'PROJECT_NOT_FOUND', 'Project not found');
    return project;
}

// ─── Preference extraction (deterministic) ────────────────────────────────────────────────────────

export interface ExtractedPreference {
    key: string;
    value: string;
    /** Canonical sentence used in prompts (generated here, never the raw user text). */
    text: string;
}

const PREFERENCE_RULES: Array<{ key: string; value: string; text: string; re: RegExp }> = [
    { key: 'zoom', value: 'less', text: 'use fewer, subtler zooms', re: /\b(?:less|fewer|too\s+many|no\s+more|stop\s+(?:the\s+)?|tone\s+down\s+the)\s*(?:zooms?|zooming|punch[- ]?ins?)\b|\bzooms?\s+(?:are\s+)?too\s+(?:much|many|strong|aggressive)\b/i },
    { key: 'zoom', value: 'more', text: 'use more zooms / punch-ins', re: /\bmore\s+(?:zooms?|punch[- ]?ins?)\b/i },
    { key: 'captions.size', value: 'smaller', text: 'keep captions smaller', re: /\bsmaller\s+(?:captions?|subtitles?|text)\b|\b(?:captions?|subtitles?)\s+(?:are\s+)?(?:too\s+(?:big|large)|smaller)\b/i },
    { key: 'captions.size', value: 'bigger', text: 'make captions bigger', re: /\b(?:bigger|larger)\s+(?:captions?|subtitles?)\b|\b(?:captions?|subtitles?)\s+(?:are\s+)?(?:too\s+small|bigger|larger)\b/i },
    { key: 'pacing', value: 'faster', text: 'keep the pacing fast and tight', re: /\b(?:faster|punchier|tighter)\s+(?:pacing|edits|cuts)\b|\b(?:pacing|it)\s+is\s+too\s+slow\b/i },
    { key: 'pacing', value: 'slower', text: 'keep the pacing calm, fewer cuts', re: /\b(?:slower|calmer)\s+(?:pacing|edits?|cuts?)\b|\btoo\s+(?:fast|choppy|jumpy)\b/i },
    { key: 'music', value: 'quieter', text: 'keep background music quiet', re: /\b(?:music\s+(?:is\s+)?too\s+loud|quieter\s+music|lower\s+(?:the\s+)?music)\b/i },
    { key: 'music', value: 'none', text: 'no background music', re: /\b(?:i\s+)?(?:don'?t|do\s+not)\s+(?:like|want)\s+(?:background\s+)?music\b|\bnever\s+add\s+music\b/i },
    { key: 'broll', value: 'less', text: 'use less B-roll', re: /\b(?:less|fewer|too\s+much)\s+b[- ]?roll\b/i },
    { key: 'broll', value: 'more', text: 'use more B-roll', re: /\bmore\s+b[- ]?roll\b/i },
    { key: 'effects', value: 'less', text: 'avoid flashy effects', re: /\b(?:less|fewer|no|too\s+many)\s+(?:flashy\s+)?(?:effects|transitions|flashes)\b|\btoo\s+flashy\b/i },
    { key: 'captions.style', value: 'minimal', text: 'prefer clean, minimal captions', re: /\b(?:simpler|cleaner|minimal)\s+captions?\b/i },
];

/** Parses explicit preferences out of the creator's words. Pure; last rule per key wins. */
export function extractPreferences(prompt: string): ExtractedPreference[] {
    const text = String(prompt || '').replace(/[’‘]/g, "'");
    const byKey = new Map<string, ExtractedPreference>();
    for (const r of PREFERENCE_RULES) if (r.re.test(text)) byKey.set(r.key, { key: r.key, value: r.value, text: r.text });
    return Array.from(byKey.values());
}

// ─── Service ──────────────────────────────────────────────────────────────────────────────────────

export interface FeedbackInput {
    accepted: boolean;
    agent?: 'director' | 'autopilot' | 'creative';
    runId?: string;
    /** What was proposed (e.g. the Director summary). */
    summary?: string;
    operations?: string[];
    /** Optional free text from the person (fenced when used in prompts). */
    note?: string;
}

export interface PerformanceInput {
    postId?: string;
    platform: string;
    format?: string;
    pillar?: string;
    hookType?: string;
    metrics: { views?: number; likes?: number; comments?: number; shares?: number; saves?: number };
}

const clip = (s: unknown, n: number) => (typeof s === 'string' ? s.trim().slice(0, n) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export class AgentMemoryService {
    constructor(private readonly db: AgentMemoryDb = prisma as unknown as AgentMemoryDb, private readonly now: () => Date = () => new Date()) {}

    private scope(projectId: string, companyId: string) {
        return { companyId, projectId };
    }

    /** Stores the preferences found in `prompt`. Returns what was remembered. */
    async rememberPreferencesFrom(projectId: string, companyId: string, prompt: string, scope: MemoryScope = 'all'): Promise<ExtractedPreference[]> {
        const prefs = extractPreferences(prompt);
        if (!prefs.length) return [];
        await requireSocialProject(this.db, projectId, companyId);
        for (const p of prefs) await this.upsertPreference(projectId, companyId, p, scope);
        return prefs;
    }

    async upsertPreference(projectId: string, companyId: string, p: ExtractedPreference, scope: MemoryScope = 'all') {
        const where = { ...this.scope(projectId, companyId), kind: 'preference', key: p.key };
        const existing = await this.db.agentMemory.findFirst({ where });
        const data = { text: p.text, payload: { value: p.value }, scope, updatedAt: this.now() };
        if (existing) await this.db.agentMemory.updateMany({ where: { id: existing.id, ...this.scope(projectId, companyId) }, data });
        else await this.db.agentMemory.create({ data: { ...where, ...data, weight: 1 } });
    }

    async recordFeedback(projectId: string, companyId: string, input: FeedbackInput) {
        await requireSocialProject(this.db, projectId, companyId);
        if (typeof input?.accepted !== 'boolean') throw new AgentOsError(400, 'VALIDATION_FAILED', 'accepted must be true or false');
        const summary = clip(input.summary, 300);
        const operations = Array.isArray(input.operations) ? input.operations.filter((o) => typeof o === 'string').slice(0, 30).map((o) => o.slice(0, 40)) : [];
        const row = await this.db.agentMemory.create({
            data: {
                ...this.scope(projectId, companyId),
                kind: input.accepted ? 'proposal_accepted' : 'proposal_rejected',
                scope: input.agent === 'autopilot' ? 'strategist' : input.agent === 'creative' ? 'all' : 'director',
                key: null,
                text: summary || (input.accepted ? 'proposal accepted' : 'proposal rejected'),
                payload: { runId: clip(input.runId, 64) || null, operations, note: clip(input.note, 500) || null, agent: input.agent || 'director' },
                weight: 1,
            },
        });
        // A note like "less zoom" on a rejection is also an explicit preference.
        if (input.note) await this.rememberPreferencesFrom(projectId, companyId, input.note);
        return row;
    }

    async recordPerformance(projectId: string, companyId: string, input: PerformanceInput) {
        await requireSocialProject(this.db, projectId, companyId);
        const platform = clip(input?.platform, 40).toLowerCase();
        if (!platform) throw new AgentOsError(400, 'VALIDATION_FAILED', 'platform is required');
        const m = input.metrics || {};
        const metrics = { views: num(m.views), likes: num(m.likes), comments: num(m.comments), shares: num(m.shares), saves: num(m.saves) };
        const engagement = metrics.likes + metrics.comments + metrics.shares + metrics.saves;
        const rate = metrics.views > 0 ? engagement / metrics.views : null;
        return this.db.agentMemory.create({
            data: {
                ...this.scope(projectId, companyId),
                kind: 'performance',
                scope: 'strategist',
                key: input.postId ? `post:${clip(input.postId, 64)}` : null,
                text: `${platform}${input.format ? ` ${clip(input.format, 20)}` : ''}`,
                payload: { platform, format: clip(input.format, 20) || null, pillar: clip(input.pillar, 80) || null, hookType: clip(input.hookType, 40) || null, metrics, engagementRate: rate },
                weight: 1,
            },
        });
    }

    async list(projectId: string, companyId: string, opts: { kind?: string; limit?: number } = {}): Promise<AgentMemoryRow[]> {
        await requireSocialProject(this.db, projectId, companyId);
        const kind = opts.kind && (MEMORY_KINDS as readonly string[]).includes(opts.kind) ? opts.kind : undefined;
        return this.db.agentMemory.findMany({
            where: { ...this.scope(projectId, companyId), ...(kind ? { kind } : {}) },
            orderBy: { updatedAt: 'desc' },
            take: Math.max(1, Math.min(200, opts.limit || 50)),
        });
    }

    async forget(projectId: string, companyId: string, id: string) {
        await requireSocialProject(this.db, projectId, companyId);
        const r = await this.db.agentMemory.deleteMany({ where: { id, ...this.scope(projectId, companyId) } });
        if (!r.count) throw new AgentOsError(404, 'MEMORY_NOT_FOUND', 'Memory item not found');
    }

    /**
     * Compact prompt lines for one agent. Returns [] when there is nothing to say. Does not throw for a missing
     * project (callers already verified it); it simply finds nothing.
     */
    async buildMemoryContext(projectId: string, companyId: string, audience: 'director' | 'strategist', opts: { maxChars?: number } = {}): Promise<string[]> {
        if (!projectId || !companyId) return [];
        const rows: AgentMemoryRow[] = await this.db.agentMemory.findMany({
            where: { ...this.scope(projectId, companyId) },
            orderBy: { updatedAt: 'desc' },
            take: 200,
        });
        return formatMemoryContext(rows.filter((r) => r.companyId === companyId && r.projectId === projectId), audience, opts.maxChars ?? 1200);
    }
}

/** Pure formatter (exported for tests). */
export function formatMemoryContext(rows: AgentMemoryRow[], audience: 'director' | 'strategist', maxChars = 1200): string[] {
    const lines: string[] = [];
    const relevant = (r: AgentMemoryRow) => r.scope === 'all' || r.scope === audience;
    const prefs = rows.filter((r) => r.kind === 'preference' && relevant(r));
    if (prefs.length) lines.push(`Creator preferences (remembered, apply unless asked otherwise): ${prefs.slice(0, 8).map((p) => p.text).join('; ')}`);

    const fb = rows.filter((r) => (r.kind === 'proposal_accepted' || r.kind === 'proposal_rejected') && relevant(r));
    if (fb.length) {
        const acc = fb.filter((r) => r.kind === 'proposal_accepted').length;
        const rej = fb.length - acc;
        lines.push(`Past proposals in this project: ${acc} accepted, ${rej} rejected.`);
        const rejected = fb.filter((r) => r.kind === 'proposal_rejected').slice(0, 3);
        if (rejected.length) {
            const body = rejected
                .map((r) => `${sanitizeInlineUntrusted(r.text, 160)}${r.payload?.operations?.length ? ` [ops: ${r.payload.operations.slice(0, 6).join(', ')}]` : ''}${r.payload?.note ? ` (creator note: ${sanitizeInlineUntrusted(r.payload.note, 200)})` : ''}`)
                .join(' | ');
            lines.push('Recently rejected proposals (avoid repeating them):');
            lines.push(fenceUntrusted('memory', body, { maxChars: 700 }).block);
        }
    }

    if (audience === 'strategist') {
        const perf = rows.filter((r) => r.kind === 'performance' && typeof r.payload?.engagementRate === 'number');
        if (perf.length) {
            const groups = new Map<string, { n: number; sum: number }>();
            for (const r of perf) {
                for (const dim of ['pillar', 'format', 'hookType'] as const) {
                    const v = r.payload?.[dim];
                    if (!v) continue;
                    const k = `${dim}:${v}`;
                    const g = groups.get(k) || { n: 0, sum: 0 };
                    g.n += 1;
                    g.sum += r.payload.engagementRate;
                    groups.set(k, g);
                }
            }
            const ranked = Array.from(groups.entries()).filter(([, g]) => g.n >= 2).map(([k, g]) => ({ k, avg: g.sum / g.n, n: g.n })).sort((a, b) => b.avg - a.avg);
            const fmt = (x: { k: string; avg: number; n: number }) => `${sanitizeInlineUntrusted(x.k, 100)} ${(x.avg * 100).toFixed(1)}% (${x.n} posts)`;
            if (ranked.length) {
                lines.push(`Performance history (engagement rate per view, ${perf.length} posts): best ${ranked.slice(0, 3).map(fmt).join('; ')}${ranked.length > 3 ? `; weakest ${fmt(ranked[ranked.length - 1])}` : ''}.`);
            } else {
                lines.push(`Performance history: ${perf.length} post(s) measured; not enough per pillar/format yet to compare.`);
            }
        }
    }

    if (audience === 'strategist') {
        // Posts that beat the account's own median by 3x or more (written by the post-metrics ranking).
        const winners = rows
            .filter((r) => r.kind === 'performance' && typeof r.payload?.outlierMultiple === 'number' && r.payload.outlierMultiple >= 3 && r.payload?.hook)
            .sort((a, b) => b.payload.outlierMultiple - a.payload.outlierMultiple)
            .slice(0, 4);
        if (winners.length) {
            lines.push('Own outlier posts of this account (measured multiple of its median; build on these angles and hook shapes, do not copy the wording):');
            lines.push(fenceUntrusted('memory', winners.map((r) => `${r.payload.outlierMultiple}x on ${sanitizeInlineUntrusted(String(r.payload.platform || ''), 20)}${r.payload.formulaName ? ` [${sanitizeInlineUntrusted(String(r.payload.formulaName), 40)}]` : ''}: ${sanitizeInlineUntrusted(String(r.payload.hook), 160)}`).join(' | '), { maxChars: 700 }).block);
        }
    }

    // Hard cap so memory never crowds out the brand or the request.
    const out: string[] = [];
    let used = 0;
    for (const l of lines) {
        if (used + l.length > maxChars) break;
        out.push(l);
        used += l.length;
    }
    return out;
}
