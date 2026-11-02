/**
 * Pairwise LLM judge: compares two eval runs piece-by-piece (same fixture, same slot) with a model that did not
 * write either. Each pair is judged twice with A/B swapped, so position bias cancels out; a pair counts as a win
 * only when both orderings agree, otherwise it is a tie.
 *
 *   pnpm tsx packages/domains/ai/evals/judge-pairwise.ts <baseline.raw.json> <candidate.raw.json> [--max 30]
 *
 * Merge rule (see plan): the candidate must win >= 55% of decided pairs.
 */
import * as fs from 'fs';
import { z } from 'zod';
import { extractJson } from '../src/content/autopilot/json-agent';
import type { AutopilotPiece } from '../src/content/autopilot/types';
import { EVAL_FIXTURES } from './fixtures/brands';
import { judgeComplete } from './lib/llm-from-env';

type Raw = { fixtureId: string; ok: boolean; pieces: AutopilotPiece[] }[];

const VerdictSchema = z.object({
    winner: z.enum(['A', 'B', 'tie']),
    criteria: z.object({ scrollStop: z.enum(['A', 'B', 'tie']), audienceSpecific: z.enum(['A', 'B', 'tie']), trendRelevance: z.enum(['A', 'B', 'tie']), brandVoice: z.enum(['A', 'B', 'tie']), valueDelivered: z.enum(['A', 'B', 'tie']) }),
    reason: z.string(),
});

export function pieceForJudge(p: AutopilotPiece): string {
    const caption = Object.entries(p.captions).map(([pl, c]) => `${pl}: ${c?.caption || ''}`).join('\n');
    const body = p.script?.body?.map((b: any, i: number) => `${i + 1}. ${b.beat || b.text || ''}`).join('\n') || '';
    const slides = p.carouselBrief?.slides?.map((s: any, i: number) => `${i + 1}. ${s.headline || ''} — ${s.body || ''}`).join('\n') || '';
    return [`Format: ${p.format}`, `Topic: ${p.topic}`, `Spoken hook: ${p.spokenHook}`, `On-screen: ${p.onScreenHook}`, body && `Script:\n${body}`, slides && `Slides:\n${slides}`, p.script?.cta && `CTA: ${p.script.cta}`, `Caption:\n${caption}`].filter(Boolean).join('\n');
}

async function judgeOnce(brandBlock: string, a: string, b: string) {
    const text = await judgeComplete(
        'You are a senior short-form content editor judging two drafts for the same brand and slot. Judge only what is written. Return JSON only.',
        [brandBlock, '', '=== DRAFT A ===', a, '', '=== DRAFT B ===', b, '',
            'For each criterion pick A, B or tie: scrollStop (would the target audience stop scrolling), audienceSpecific (written for THIS audience, not generic),',
            'trendRelevance (timely and grounded, without invented facts), brandVoice (matches tone, avoids forbidden words), valueDelivered (viewer learns or can do something).',
            'Then an overall winner. Return {"winner":"A|B|tie","criteria":{"scrollStop":"","audienceSpecific":"","trendRelevance":"","brandVoice":"","valueDelivered":""},"reason":"one sentence"}'].join('\n'),
    );
    return VerdictSchema.parse(extractJson(text));
}

async function main() {
    const [basePath, candPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    if (!basePath || !candPath) throw new Error('usage: judge-pairwise.ts <baseline.raw.json> <candidate.raw.json> [--max N]');
    const maxIdx = process.argv.indexOf('--max');
    const max = maxIdx > -1 ? Number(process.argv[maxIdx + 1]) || 30 : 30;
    const base: Raw = JSON.parse(fs.readFileSync(basePath, 'utf8'));
    const cand: Raw = JSON.parse(fs.readFileSync(candPath, 'utf8'));

    const pairs: { fixtureId: string; a: AutopilotPiece; b: AutopilotPiece }[] = [];
    for (const bf of base) {
        const cf = cand.find((c) => c.fixtureId === bf.fixtureId);
        if (!cf) continue;
        const byDay = new Map(cf.pieces.map((p) => [p.slotId, p]));
        for (const p of bf.pieces) {
            const q = byDay.get(p.slotId);
            if (q) pairs.push({ fixtureId: bf.fixtureId, a: p, b: q });
        }
    }
    const sample = pairs.slice(0, max);
    let wins = 0, losses = 0, ties = 0;
    const crit: Record<string, { cand: number; base: number }> = {};
    for (const pair of sample) {
        const fx = EVAL_FIXTURES.find((f) => f.id === pair.fixtureId)!;
        const brandBlock = `Brand:\n${fx.brand.promptContext}`;
        // Baseline as A then as B; the candidate wins only when both orderings say so.
        const first = await judgeOnce(brandBlock, pieceForJudge(pair.a), pieceForJudge(pair.b));
        const second = await judgeOnce(brandBlock, pieceForJudge(pair.b), pieceForJudge(pair.a));
        const candFirst = first.winner === 'B', candSecond = second.winner === 'A';
        const baseFirst = first.winner === 'A', baseSecond = second.winner === 'B';
        if (candFirst && candSecond) wins++; else if (baseFirst && baseSecond) losses++; else ties++;
        for (const k of Object.keys(first.criteria) as (keyof typeof first.criteria)[]) {
            const c = (crit[k] ||= { cand: 0, base: 0 });
            if (first.criteria[k] === 'B' && second.criteria[k] === 'A') c.cand++;
            if (first.criteria[k] === 'A' && second.criteria[k] === 'B') c.base++;
        }
        process.stdout.write('.');
    }
    const decided = wins + losses;
    const winRate = decided ? Math.round((wins / decided) * 1000) / 10 : 0;
    console.log(`\n\nPairs judged: ${sample.length} (of ${pairs.length})  candidate wins ${wins} · baseline wins ${losses} · ties ${ties}`);
    console.log(`Candidate win rate on decided pairs: ${winRate}%  → ${winRate >= 55 ? 'PASS (>= 55%)' : 'FAIL (< 55%)'}`);
    for (const [k, v] of Object.entries(crit)) console.log(`  ${k}: candidate ${v.cand} · baseline ${v.base}`);
    if (winRate < 55) process.exitCode = 1;
}

if (require.main === module) {
    main().catch((e) => { console.error(e); process.exit(2); });
}
