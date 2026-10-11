/**
 * Loop Stress Test for Autopilot 4-Agent Master SOP Swarm
 * Tests 10 diverse calendar archetypes and edge cases:
 *  1. 30-day Daily 1 Reel
 *  2. 30-day Daily 1 Carousel
 *  3. 30-day Daily 1 Reel + 1 Carousel (60 pieces)
 *  4. 30-day Alternate Days (Reel & Carousel)
 *  5. 30-day Daily 2 Carousels + 1 Reel (90 pieces)
 *  6. 14-day Custom Steppers (2 reels, 0 carousels)
 *  7. 14-day Custom Steppers (0 reels, 2 carousels)
 *  8. 7-day with Dense Reference / Inspiration Notes
 *  9. 30-day with Custom Weekly Structure Directives
 * 10. 30-day with Sparse / Minimal Brand Consciousness
 *
 * Run: npx tsx --test --test-force-exit apps/backend/src/api/v1/social-media/autopilot/multi_calendar_loop.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AutopilotCalendarService, AutopilotServiceDeps } from '../../../../../../../packages/domains/social-media/src/autopilot-calendar.service';
import {
    AutopilotError, AutopilotLLM, LlmRequest, HOOK_TYPES, PSYCHOLOGICAL_JOBS, DESIGN_SYSTEMS, WebSearchProvider,
    expandAutopilotFields,
} from '../../../../../../../packages/domains/ai/src/content/autopilot';

// ------------------------------------------------------------------ in-memory db

function getPath(obj: any, path: string[]) {
    return path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function matches(row: any, where: any): boolean {
    return Object.entries(where || {}).every(([k, cond]: [string, any]) => {
        if (cond && typeof cond === 'object' && Array.isArray(cond.path)) return getPath(row[k], cond.path) === cond.equals;
        return (row[k] ?? null) === cond;
    });
}
let seq = 0;
function fakeDb(seed: { projects: any[]; accounts?: any[] }) {
    const tables: Record<string, any[]> = {
        project: seed.projects, socialAccount: seed.accounts || [], contentCalendar: [], calendarContentPiece: [], socialPost: [], socialPostVariant: [],
    };
    const clone = (v: any) => JSON.parse(JSON.stringify(v));
    const model = (name: string) => ({
        findFirst: async (a: any) => { const r = tables[name].find((x) => matches(x, a.where)); return r ? clone(r) : null; },
        findMany: async (a: any) => tables[name].filter((x) => matches(x, a.where)).map(clone),
        create: async (a: any) => { const row = { id: `${name}-${++seq}`, ...clone(a.data) }; tables[name].push(row); return clone(row); },
        createMany: async (a: any) => { for (const d of a.data) tables[name].push({ id: `${name}-${++seq}`, ...clone(d) }); return { count: a.data.length }; },
        updateMany: async (a: any) => {
            let count = 0;
            for (const r of tables[name]) if (matches(r, a.where)) { Object.assign(r, clone(a.data)); count++; }
            return { count };
        },
    });
    return { tables, db: Object.fromEntries(Object.keys(tables).map((k) => [k, model(k)])) };
}

// ------------------------------------------------------------------ fake LLM
function jsonAfter(prompt: string, marker: string) {
    const lines = prompt.split('\n');
    const i = lines.findIndex((l) => l.trim() === marker);
    return JSON.parse(lines[i + 1]);
}

function buildStrategySlots(days: number, cadence: string, reelsPerDay?: number, carouselsPerDay?: number) {
    const slots: any[] = [];
    const pillars = [
        { name: 'Core Authority', percent: 40, purpose: 'teach' },
        { name: 'Contrarian Truths', percent: 35, purpose: 'disrupt' },
        { name: 'Transformational Proof', percent: 25, purpose: 'convert' },
    ];

    for (let day = 1; day <= days; day++) {
        let dayFormats: string[] = [];
        if (cadence === 'daily_1_reel') {
            dayFormats = ['reel'];
        } else if (cadence === 'daily_1_carousel') {
            dayFormats = ['carousel'];
        } else if (cadence === 'daily_1_reel_1_carousel') {
            dayFormats = ['reel', 'carousel'];
        } else if (cadence === 'daily_2_carousels_1_reel') {
            dayFormats = ['reel', 'carousel', 'carousel'];
        } else if (cadence === 'alternate') {
            dayFormats = day % 2 === 1 ? ['reel'] : ['carousel'];
        } else {
            // custom mix
            const r = reelsPerDay ?? 1;
            const c = carouselsPerDay ?? 1;
            for (let i = 0; i < r; i++) dayFormats.push('reel');
            for (let i = 0; i < c; i++) dayFormats.push('carousel');
        }

        for (const format of dayFormats) {
            slots.push({
                day,
                platforms: format === 'reel' ? ['instagram'] : ['instagram', 'linkedin'],
                format,
                pillar: pillars[(slots.length) % pillars.length].name,
                topic: `Day ${day} ${format} Strategic Narrative`,
                angle: `Psychological angle for ${format} on day ${day}`,
                hookType: HOOK_TYPES[slots.length % HOOK_TYPES.length],
                psychologicalJob: PSYCHOLOGICAL_JOBS[slots.length % PSYCHOLOGICAL_JOBS.length],
                designSystem: DESIGN_SYSTEMS[slots.length % DESIGN_SYSTEMS.length],
                whatContentDelivers: `Actionable clarity on day ${day} for target persona.`,
                visualDirection: `High contrast 9:16 layout with kinetic kinetic text typography.`,
            });
        }
    }
    return {
        audiencePsychology: {
            coreDesires: ['Scalable organic authority', 'Consistent inbound leads'],
            corePains: ['Inconsistent posting fatigue', 'Low reel retention'],
            objections: ['Requires too much studio equipment', 'Hard to think of daily ideas'],
            triggers: ['Daily algorithm change anxieties', 'Competitor growth surges'],
        },
        positioningAngle: 'The premier AI-native creator ecosystem',
        pillars,
        cadence: [{ platform: 'instagram', postsPerWeek: 7, bestFormats: ['reel', 'carousel'] }],
        contentMix: { reel: 50, carousel: 50, static: 0, text: 0 },
        slots,
    };
}

function fakeLlm() {
    const calls: LlmRequest[] = [];
    const llm: AutopilotLLM = {
        provider: 'fake',
        async complete(req) {
            calls.push(req);
            const reply = (text: string) => ({ text, model: 'fake-swarm-1', usage: { inputTokens: Math.ceil(req.prompt.length / 4), outputTokens: Math.ceil(text.length / 4), estimated: false } });
            const role = req.role === 'regenerate' ? (req.prompt.includes('Slots:') ? 'hook_script' : 'copy') : req.role;

            if (role === 'research') {
                return reply(JSON.stringify({
                    trends: [
                        { topic: 'Short-form neuro-hooks', whyNow: 'Dopamine drops at second 3', sourceUrls: ['https://example.com/neuro'] },
                    ],
                }));
            }

            if (role === 'strategist') {
                // Determine days and cadence from prompt
                const daysMatch = req.prompt.match(/PLAN:\s*(\d+)\s*days/i);
                const days = daysMatch ? parseInt(daysMatch[1], 10) : 30;
                let cadence = 'daily_1_reel_1_carousel';
                if (req.prompt.includes('Content Cadence Preset: daily_1_reel.')) cadence = 'daily_1_reel';
                else if (req.prompt.includes('Content Cadence Preset: daily_1_carousel.')) cadence = 'daily_1_carousel';
                else if (req.prompt.includes('Content Cadence Preset: daily_2_carousels_1_reel.')) cadence = 'daily_2_carousels_1_reel';
                else if (req.prompt.includes('Content Cadence Preset: alternate.')) cadence = 'alternate';
                else if (req.prompt.includes('Content Cadence Preset: custom.')) cadence = 'custom';

                let reelsPerDay = 1;
                let carouselsPerDay = 1;
                const rMatch = req.prompt.match(/Custom Stepper Mix:\s*(\d+)\s*reels/i);
                const cMatch = req.prompt.match(/and\s*(\d+)\s*carousels/i);
                if (rMatch) reelsPerDay = parseInt(rMatch[1], 10);
                if (cMatch) carouselsPerDay = parseInt(cMatch[1], 10);

                const strategy = buildStrategySlots(days, cadence, reelsPerDay, carouselsPerDay);
                // A compliant model follows the exact per-day plan when the prompt gives one ("Day N: reel, carousel").
                const planLines = [...req.prompt.matchAll(/^Day (\d+): ([a-z, ]+)$/gm)];
                if (planLines.length) {
                    const template = strategy.slots[0];
                    strategy.slots = planLines.flatMap((m, li) => m[2].split(', ').map((format, fi) => ({
                        ...template,
                        day: Number(m[1]),
                        format,
                        platforms: format === 'reel' ? ['instagram'] : ['instagram', 'linkedin'],
                        topic: `Day ${m[1]} ${format} ${fi + 1} Strategic Narrative`,
                        hookType: HOOK_TYPES[(li + fi) % HOOK_TYPES.length],
                        psychologicalJob: PSYCHOLOGICAL_JOBS[(li * 3 + fi) % PSYCHOLOGICAL_JOBS.length],
                    })));
                }
                return reply('```json\n' + JSON.stringify(strategy) + '\n```');
            }

            if (role === 'hook_script') {
                const slots = jsonAfter(req.prompt, 'Slots:');
                return reply(JSON.stringify({
                    items: slots.map((s: any) => ({
                        slotId: s.slotId,
                        headline: `${s.topic} Headline`,
                        hookType: s.hookType || 'contrarian',
                        spokenHook: `Stop making this huge mistake with your ${s.pillar}.`,
                        onScreenHook: `The brutal truth about ${s.pillar}`,
                        psychologicalJob: s.psychologicalJob || 'belief_reversal',
                        designSystem: s.designSystem || 'editorial',
                        whatContentDelivers: s.whatContentDelivers || 'Step-by-step actionable framework',
                        visualDirection: s.visualDirection || 'Dark obsidian backdrop with bright accents',
                        ...(s.format === 'reel' ? {
                            script: {
                                hook: 'Stop making this huge mistake with your brand.',
                                body: [
                                    { beat: 'First, recognize the broken pattern.', retentionDevice: 'Pattern interrupt' },
                                    { beat: 'Second, implement the 3-tier system.', retentionDevice: 'Open loop' },
                                    { beat: 'Third, review the results weekly.' },
                                ],
                                retentionLoop: 'Watch until the end for the exact prompt.',
                                cta: 'Save this reel to execute today.',
                                estimatedDurationSec: 30,
                            },
                            shotNotes: ['Extreme close-up on mic', 'Screen recording breakdown with mouse highlight', 'Wide shot for the CTA'],
                        } : {}),
                        ...(s.format === 'carousel' ? {
                            carouselBrief: {
                                title: s.headline || 'Mastering Autopilot Systems',
                                slides: [
                                    { index: 1, role: 'hook', headline: '99% of people get this wrong', visualDirection: 'Bold oversized typography' },
                                    { index: 2, role: 'reveal', headline: 'The hidden cost of bad frameworks', visualDirection: 'Split comparison graph' },
                                    { index: 3, role: 'value', headline: 'The 3-Agent Swarm Blueprint', visualDirection: 'Step-by-step diagram' },
                                    { index: 4, role: 'proof', headline: 'Real-world application', visualDirection: 'Before / After metrics card' },
                                    { index: 5, role: 'cta', headline: 'Swipe left to save and bookmark', visualDirection: 'Clear call to action badge' },
                                ],
                            },
                        } : {}),
                    })),
                }));
            }

            if (role === 'copy') {
                const pieces = jsonAfter(req.prompt, 'Pieces:');
                return reply(JSON.stringify({
                    items: pieces.map((p: any) => ({
                        slotId: p.slotId,
                        copies: p.platforms.map((pl: string) => ({
                            platform: pl,
                            caption: `${p.headline}. Most people fail because they lack systems. Here is how to fix it immediately for ${pl}.`,
                            cta: 'Bookmark this post and share with your team.',
                            hashtags: ['#growth', '#marketing', '#creators', '#branding'],
                            postingTime: '17:00',
                        })),
                    })),
                }));
            }

            if (role === 'critic') {
                const pieces = jsonAfter(req.prompt, 'Pieces:');
                return reply(JSON.stringify({
                    items: pieces.map((p: any) => ({
                        slotId: p.slotId,
                        verdict: 'ok',
                        issues: [],
                    })),
                }));
            }

            throw new Error(`Unexpected role: ${req.role}`);
        },
    };
    return { llm, calls };
}

// ------------------------------------------------------------------ Setup helper

function createTestEnv() {
    const { db, tables } = fakeDb({
        projects: [
            {
                id: 'p-stress',
                companyId: 'co-stress',
                projectType: 'social_media',
                deletedAt: null,
                name: 'HyperScale Brand',
                description: 'AI-first growth agency',
                socialSettings: { defaultTimezone: 'UTC' },
            },
        ],
        accounts: [
            { id: 'a1', companyId: 'co-stress', projectId: 'p-stress', platform: 'instagram', isActive: true },
            { id: 'a2', companyId: 'co-stress', projectId: 'p-stress', platform: 'linkedin', isActive: true },
        ],
    });
    const { llm, calls } = fakeLlm();
    const jobs: Promise<void>[] = [];
    const deps: AutopilotServiceDeps = {
        db,
        createLLM: async () => llm,
        loadBrand: async () => ({
            profile: {
                brandType: 'company',
                brandPositioning: 'Next-gen creative engineering',
                tone: 'Bold, analytical, punchy',
                targetAudience: 'Founders & Creators',
                forbiddenWords: ['cheap', 'guaranteed'],
                defaultHashtags: ['#hyperscale'],
                standardCtas: ['Follow @hyperscale for more'],
                targetPlatforms: ['instagram', 'linkedin'],
            },
        }),
        search: null,
        schedule: (job) => jobs.push(job()),
        now: () => new Date('2026-10-01T00:00:00Z'),
        log: (event, data) => {
            if (event === 'agent_repair') console.error('AGENT_REPAIR:', JSON.stringify(data));
        },
    };
    return { service: new AutopilotCalendarService(deps), tables, calls, jobs };
}

// ------------------------------------------------------------------ Test Cases Loop

test('Loop Stress Test: 10 calendar variations across durations and cadences', async (t) => {
    const testCases = [
        {
            name: 'Case 1: 30-Day Master Calendar - Daily 1 Reel',
            input: { days: 30, contentCadence: 'daily_1_reel', targetReelDurationSec: 30 },
            expectedCount: 30,
            validatePieces: (pieces: any[]) => {
                assert.ok(pieces.every((p) => p.format === 'reel'));
                assert.ok(pieces.every((p) => p.spokenHook && p.onScreenHook));
                assert.ok(pieces.every((p) => p.script?.estimatedDurationSec === 30));
            },
        },
        {
            name: 'Case 2: 30-Day Master Calendar - Daily 1 Carousel',
            input: { days: 30, contentCadence: 'daily_1_carousel', carouselSlideCount: 5 },
            expectedCount: 30,
            validatePieces: (pieces: any[]) => {
                assert.ok(pieces.every((p) => p.format === 'carousel'));
                assert.ok(pieces.every((p) => p.carouselBrief?.slides?.length === 5));
            },
        },
        {
            name: 'Case 3: 30-Day Master Calendar - Daily 1 Reel + 1 Carousel (60 Pieces)',
            input: { days: 30, contentCadence: 'daily_1_reel_1_carousel', reelsPerDay: 1, carouselsPerDay: 1 },
            expectedCount: 60,
            validatePieces: (pieces: any[]) => {
                const reels = pieces.filter((p) => p.format === 'reel');
                const carousels = pieces.filter((p) => p.format === 'carousel');
                assert.equal(reels.length, 30);
                assert.equal(carousels.length, 30);
            },
        },
        {
            name: 'Case 4: 30-Day Master Calendar - Alternate Days (Reel & Carousel)',
            input: { days: 30, contentCadence: 'alternate' },
            expectedCount: 30,
            validatePieces: (pieces: any[]) => {
                const reels = pieces.filter((p) => p.format === 'reel');
                const carousels = pieces.filter((p) => p.format === 'carousel');
                assert.equal(reels.length, 15);
                assert.equal(carousels.length, 15);
            },
        },
        {
            name: 'Case 5: 30-Day Master Calendar - Daily 2 Carousels + 1 Reel (90 Pieces)',
            input: { days: 30, contentCadence: 'daily_2_carousels_1_reel', reelsPerDay: 1, carouselsPerDay: 2 },
            expectedCount: 90,
            validatePieces: (pieces: any[]) => {
                const reels = pieces.filter((p) => p.format === 'reel');
                const carousels = pieces.filter((p) => p.format === 'carousel');
                assert.equal(reels.length, 30);
                assert.equal(carousels.length, 60);
            },
        },
        {
            name: 'Case 6: 14-Day Custom Mix (2 Reels, 0 Carousels)',
            input: { days: 14, contentCadence: 'custom', reelsPerDay: 2, carouselsPerDay: 0 },
            expectedCount: 28,
            validatePieces: (pieces: any[]) => {
                assert.ok(pieces.every((p) => p.format === 'reel'));
            },
        },
        {
            name: 'Case 7: 14-Day Custom Mix (0 Reels, 2 Carousels)',
            input: { days: 14, contentCadence: 'custom', reelsPerDay: 0, carouselsPerDay: 2 },
            expectedCount: 28,
            validatePieces: (pieces: any[]) => {
                assert.ok(pieces.every((p) => p.format === 'carousel'));
            },
        },
        {
            name: 'Case 8: 7-Day with Dense Reference / Inspiration Notes',
            input: {
                days: 7,
                contentCadence: 'daily_1_reel',
                referenceNotes: 'Reference: Dopamine loops in video editing. Always begin with visual disruption in second 1.',
            },
            expectedCount: 7,
            validatePieces: (pieces: any[]) => {
                assert.equal(pieces.length, 7);
            },
        },
        {
            name: 'Case 9: 30-Day with Custom Weekly Structure Directives',
            input: {
                days: 30,
                contentCadence: 'daily_1_reel',
                structureDirectives: 'Week 1: Problem Awareness, Week 2: Mythbusting, Week 3: Systems, Week 4: Case Studies',
            },
            expectedCount: 30,
            validatePieces: (pieces: any[]) => {
                assert.equal(pieces.length, 30);
            },
        },
        {
            name: 'Case 10: 30-Day Edge Case - Sparse Input & Default Fallbacks',
            input: { days: 30 },
            expectedCount: 60, // default daily_1_reel_1_carousel
            validatePieces: (pieces: any[]) => {
                assert.equal(pieces.length, 60);
            },
        },
    ];

    for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        await t.test(tc.name, async () => {
            const env = createTestEnv();
            const contentMix = tc.input.contentCadence ? {
                mode: tc.input.contentCadence === 'custom' ? 'custom' : 'preset',
                preset: tc.input.contentCadence,
                dailyReels: tc.input.reelsPerDay ?? (tc.input.contentCadence === 'daily_1_carousel' ? 0 : 1),
                dailyCarousels: tc.input.carouselsPerDay ?? (tc.input.contentCadence === 'daily_1_reel' ? 0 : (tc.input.contentCadence === 'daily_2_carousels_1_reel' ? 2 : (tc.input.contentCadence === 'daily_1_carousel' ? 1 : 1))),
            } : undefined;

            const { jobId, calendarId } = await env.service.start({
                companyId: 'co-stress',
                projectId: 'p-stress',
                userId: 'u1',
                body: {
                    startDate: '2026-10-01',
                    ...tc.input,
                    contentMix,
                },
            });

            assert.ok(jobId, 'jobId must be returned');
            assert.ok(calendarId, 'calendarId must be returned');

            // Wait for all 4 agents in the swarm to finish
            await Promise.all(env.jobs);

            // Verify Job Status
            const job = await env.service.getJob({ companyId: 'co-stress', projectId: 'p-stress', jobId });
            if (job.status === 'failed') {
                console.error(`FAILED CASE [${tc.name}]:`, JSON.stringify(job, null, 2));
                const cal = env.tables.contentCalendar.find((c) => c.id === calendarId);
                console.error('CAL METADATA:', JSON.stringify(cal?.metadata, null, 2));
            }
            assert.equal(job.status, 'completed', `Job should complete without error: ${job.errorMessage}`);
            assert.equal(job.progress, 100);

            // Verify Stored Calendar
            const cal = env.tables.contentCalendar.find((c) => c.id === calendarId);
            assert.ok(cal, 'Calendar row must exist');
            assert.equal(cal.status, 'active');

            // Verify Stored Pieces
            const rows = env.tables.calendarContentPiece.filter((p) => p.calendarId === calendarId);
            assert.equal(rows.length, tc.expectedCount, `Expected ${tc.expectedCount} pieces, got ${rows.length}`);
            const pieces = rows.map((r) => expandAutopilotFields(r));

            // Verify Master SOP Fields
            for (let j = 0; j < pieces.length; j++) {
                const p = pieces[j];
                const row = rows[j];
                assert.ok(p.headline, 'Piece must have headline');
                assert.ok(row.adCopyFull || Object.keys(p.captions).length > 0, 'Piece must have native platform caption');
                assert.ok(row.hashtagsResearched, 'Piece must have hashtags');
                assert.ok(p.psychologicalJob, 'Piece must have psychologicalJob assigned');
                assert.ok(p.designSystem, 'Piece must have designSystem assigned');
                assert.ok(p.whatContentDelivers, 'Piece must have whatContentDelivers assigned');
                assert.ok(p.visualDirection, 'Piece must have visualDirection assigned');
            }

            // Run case-specific assertions
            tc.validatePieces(pieces);
        });
    }
});
