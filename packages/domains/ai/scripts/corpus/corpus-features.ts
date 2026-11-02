/**
 * Turns exported corpus rows into (a) quality-audit stats over every generated piece and (b) outcome samples for
 * the published ones. Pure functions so they are unit tested.
 */
import { HookScorer, PlatformCopyLinter, TextHumanizer, toCraftPlatform } from '../../src/content/craft';
import type { OutcomeSample } from '../../src/content/learning/outcome-model';
import type { CorpusRow } from './export-corpus';

const words = (s: unknown) => String(s || '').trim().split(/\s+/).filter(Boolean).length;
const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const PLACEHOLDER_RE = /<[a-z][a-z ,'/-]{2,80}>/i;
/** Spoken pace used by the beat sheet (~2.5 words per second). */
const WORDS_PER_SEC = 2.5;

export function formatOf(row: CorpusRow): string {
    const f = row.payload?.format;
    if (f) return String(f);
    const t = (row.contentType || '').toLowerCase();
    return t.includes('reel') || t.includes('video') ? 'reel' : t.includes('carousel') ? 'carousel' : t.includes('text') ? 'text' : 'static';
}

export function scriptText(p: Record<string, any> | null): string {
    if (!p?.script) return '';
    return [p.script.hook, ...(p.script.body || []).map((b: any) => b?.beat || ''), p.script.retentionLoop, p.script.cta].filter(Boolean).join(' ');
}

export interface QualityAudit {
    pieces: number;
    autopilotPieces: number;
    byFormat: Record<string, number>;
    hook: { mean: number; strongPct: number; dealbreakerPct: number };
    duplicateHooksWithinCalendarPct: number;
    topOpeners: { opener: string; count: number }[];
    topSlop: { phrase: string; count: number }[];
    placeholderLeakPct: number;
    reels: { n: number; missingLoopPct: number; lengthMismatchPct: number };
    topCtas: { cta: string; count: number }[];
    fillerHashtagPct: number;
    needsReviewPct: number;
    criticFlagPct: number;
    hookTypeShare: Record<string, number>;
    psychJobShare: Record<string, number>;
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const top = (m: Map<string, number>, k: number) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k);
const share = (m: Map<string, number>, total: number) => Object.fromEntries(top(m, 50).map(([k, v]) => [k, pct(v, total)]));
const inc = (m: Map<string, number>, k: string) => { if (k) m.set(k, (m.get(k) || 0) + 1); };

export function auditQuality(rows: CorpusRow[]): QualityAudit {
    const ap = rows.filter((r) => r.autopilot && r.payload);
    const byFormat: Record<string, number> = {};
    for (const r of rows) byFormat[formatOf(r)] = (byFormat[formatOf(r)] || 0) + 1;

    const hookEvals = ap.map((r) => HookScorer.score(String(r.payload!.spokenHook || ''), formatOf(r) === 'reel' ? {} : { spoken: false }));
    const openers = new Map<string, number>(), slop = new Map<string, number>(), ctas = new Map<string, number>();
    const hookTypes = new Map<string, number>(), jobs = new Map<string, number>();
    const byCalendar = new Map<string, string[]>();
    let placeholder = 0, reels = 0, missingLoop = 0, lengthMismatch = 0, filler = 0, captions = 0, review = 0, flag = 0;

    for (const r of ap) {
        const p = r.payload!;
        const hook = String(p.spokenHook || '');
        inc(openers, norm(hook).split(' ').slice(0, 3).join(' '));
        (byCalendar.get(r.calendar) || byCalendar.set(r.calendar, []).get(r.calendar)!).push(norm(hook));
        inc(hookTypes, String(p.hookType || ''));
        inc(jobs, String(p.psychologicalJob || ''));
        if (PLACEHOLDER_RE.test(JSON.stringify(p))) placeholder++;
        if (r.status === 'needs_review') review++;
        if (p.critic?.verdict === 'flag') flag++;
        if (p.script?.cta) inc(ctas, norm(String(p.script.cta)).slice(0, 60));
        if (formatOf(r) === 'reel' && p.script) {
            reels++;
            if (!String(p.script.retentionLoop || '').trim()) missingLoop++;
            const target = Number(p.script.estimatedDurationSec) || 0;
            if (target > 0) {
                const ratio = words(scriptText(p)) / (target * WORDS_PER_SEC);
                if (ratio < 0.7 || ratio > 1.3) lengthMismatch++;
            }
        }
        for (const [platform, c] of Object.entries<any>(p.captions || {})) {
            if (!c?.caption) continue;
            captions++;
            for (const s of TextHumanizer.findSlop(c.caption)) inc(slop, s.toLowerCase());
            const cp = toCraftPlatform(platform);
            if (cp) {
                const text = `${c.caption}\n\n${(c.hashtags || []).join(' ')}`;
                if (PlatformCopyLinter.analyze(cp, text).checks.some((k) => k.check === 'FILLER_HASHTAGS' && k.status === 'FAIL')) filler++;
            }
        }
    }
    let dup = 0, hooksInCalendars = 0;
    for (const hooks of byCalendar.values()) {
        const seen = new Set<string>();
        for (const h of hooks) { hooksInCalendars++; if (h && seen.has(h)) dup++; seen.add(h); }
    }
    return {
        pieces: rows.length,
        autopilotPieces: ap.length,
        byFormat,
        hook: {
            mean: hookEvals.length ? Math.round((hookEvals.reduce((a, e) => a + e.totalScore, 0) / hookEvals.length) * 10) / 10 : 0,
            strongPct: pct(hookEvals.filter((e) => e.grade === 'EXCELLENT' || e.grade === 'STRONG').length, hookEvals.length),
            dealbreakerPct: pct(hookEvals.filter((e) => e.dealbreaker).length, hookEvals.length),
        },
        duplicateHooksWithinCalendarPct: pct(dup, hooksInCalendars),
        topOpeners: top(openers, 15).map(([opener, count]) => ({ opener, count })),
        topSlop: top(slop, 15).map(([phrase, count]) => ({ phrase, count })),
        placeholderLeakPct: pct(placeholder, ap.length),
        reels: { n: reels, missingLoopPct: pct(missingLoop, reels), lengthMismatchPct: pct(lengthMismatch, reels) },
        topCtas: top(ctas, 10).map(([cta, count]) => ({ cta, count })),
        fillerHashtagPct: pct(filler, captions),
        needsReviewPct: pct(review, ap.length),
        criticFlagPct: pct(flag, ap.length),
        hookTypeShare: share(hookTypes, ap.length),
        psychJobShare: share(jobs, ap.length),
    };
}

function hourOf(row: CorpusRow): number | null {
    const m = /^(\d{1,2}):\d{2}/.exec(row.postingTime || '');
    return m ? Number(m[1]) : null;
}

/** One sample per published variant with metrics. Views are the value when present, otherwise likes + comments. */
export function outcomeSamples(rows: CorpusRow[]): OutcomeSample[] {
    const out: OutcomeSample[] = [];
    for (const r of rows) {
        if (!r.payload || !r.post) continue;
        const p = r.payload;
        const hook = String(p.spokenHook || '');
        const ev = HookScorer.score(hook, formatOf(r) === 'reel' ? {} : { spoken: false });
        const hour = hourOf(r);
        for (const v of r.post.variants) {
            const m = v.metrics;
            if (!m || v.publishStatus !== 'published') continue;
            const views = typeof m.views === 'number' ? m.views : null;
            const eng = typeof m.likes === 'number' || typeof m.comments === 'number' ? (m.likes || 0) + (m.comments || 0) : null;
            const basis = views !== null ? 'views' : eng !== null ? 'eng' : null;
            if (!basis) continue;
            const caption = String(p.captions?.[v.platform]?.caption || r.caption || '');
            out.push({
                group: `${r.project}:${v.platform}:${basis}`,
                value: (basis === 'views' ? views : eng) as number,
                categorical: {
                    platform: v.platform,
                    format: formatOf(r),
                    hookType: p.hookType || null,
                    psychologicalJob: p.psychologicalJob || null,
                    formula: HookScorer.classifyFormula(hook)?.name || 'none',
                    daypart: hour === null ? null : hour < 11 ? 'morning' : hour < 16 ? 'midday' : hour < 20 ? 'evening' : 'night',
                    hasSources: (p.sources || []).length ? 'yes' : 'no',
                },
                numeric: {
                    hookScore: ev.totalScore,
                    hookLength: ev.breakdown.lengthScore,
                    hookConcrete: ev.breakdown.concretenessScore,
                    hookStakes: ev.breakdown.stakesScore,
                    hookFrontLoad: ev.breakdown.frontLoadScore,
                    hookAudience: ev.breakdown.audienceScore,
                    hookWords: words(hook),
                    scriptWords: p.script ? words(scriptText(p)) : null,
                    beats: Array.isArray(p.script?.body) ? p.script.body.length : null,
                    hasLoop: p.script ? (String(p.script.retentionLoop || '').trim() ? 1 : 0) : null,
                    captionWords: words(caption),
                    hashtags: Array.isArray(p.captions?.[v.platform]?.hashtags) ? p.captions[v.platform].hashtags.length : null,
                    humanScore: caption ? TextHumanizer.detect(caption).overallScore : null,
                },
            });
        }
    }
    return out;
}
