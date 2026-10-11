"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PLANNED_SLOTS = void 0;
exports.planCadence = planCadence;
exports.describePlan = describePlan;
exports.planMismatches = planMismatches;
/**
 * Deterministic cadence: which days get which formats, computed from the creator's content mix before any AI runs.
 * The strategist fills these exact slots with topics; it does not decide how many pieces exist. This is what makes
 * "2 carousels + 1 reel every day" or "alternate days: reel, carousel, reel, …" produce exactly that.
 */
const llm_1 = require("./llm");
const platform_rules_1 = require("./platform-rules");
/** Upper bound of the strategy schema; a plan above it cannot be produced in one run. */
exports.MAX_PLANNED_SLOTS = 120;
/**
 * Slots for [days] days from [mix], or null when no mix was given (then the strategist plans one slot per day and
 * picks each format). Formats none of the [platforms] support are refused instead of being silently swapped.
 */
function planCadence(days, mix, platforms) {
    if (!mix)
        return null;
    const alternate = mix.mode === 'alternate' || mix.preset === 'alternate';
    const reels = Math.max(0, Math.floor(mix.dailyReels ?? 0));
    const carousels = Math.max(0, Math.floor(mix.dailyCarousels ?? 0));
    if (reels + carousels === 0 && !alternate)
        throw new llm_1.AutopilotError('INVALID_INPUT', 'The content mix needs at least one reel or carousel per posting day.');
    const supports = (f) => platforms.some((p) => platform_rules_1.PLATFORM_RULES[p].formats.includes(f));
    const wantsReels = reels > 0 || alternate;
    const wantsCarousels = carousels > 0 || alternate;
    if (wantsReels && !supports('reel'))
        throw new llm_1.AutopilotError('INVALID_INPUT', `None of the selected platforms (${platforms.join(', ')}) publishes reels.`);
    if (wantsCarousels && !supports('carousel'))
        throw new llm_1.AutopilotError('INVALID_INPUT', `None of the selected platforms (${platforms.join(', ')}) publishes carousels.`);
    const slots = [];
    for (let day = 1; day <= days; day++) {
        // "alternate": reels on odd days, carousels on even days (each in its daily count, at least one).
        const r = alternate ? (day % 2 === 1 ? Math.max(1, reels) : 0) : reels;
        const c = alternate ? (day % 2 === 0 ? Math.max(1, carousels) : 0) : carousels;
        for (let i = 0; i < r; i++)
            slots.push({ day, format: 'reel' });
        for (let i = 0; i < c; i++)
            slots.push({ day, format: 'carousel' });
    }
    if (slots.length > exports.MAX_PLANNED_SLOTS) {
        throw new llm_1.AutopilotError('INVALID_INPUT', `This mix makes ${slots.length} pieces; one calendar can hold ${exports.MAX_PLANNED_SLOTS}. Choose fewer pieces per day or a shorter calendar.`);
    }
    return slots;
}
/** Compact prompt text: "Day 1: reel, carousel, carousel" per posting day. */
function describePlan(plan) {
    const byDay = new Map();
    for (const s of plan)
        byDay.set(s.day, [...(byDay.get(s.day) || []), s.format]);
    return Array.from(byDay, ([day, formats]) => `Day ${day}: ${formats.join(', ')}`).join('\n');
}
/** Differences between the plan and the strategist's slots, as repair instructions. Empty = exact match. */
function planMismatches(plan, slots) {
    const key = (d, f) => `${d}:${f}`;
    const want = new Map();
    const got = new Map();
    for (const s of plan)
        want.set(key(s.day, s.format), (want.get(key(s.day, s.format)) || 0) + 1);
    for (const s of slots)
        got.set(key(s.day, s.format), (got.get(key(s.day, s.format)) || 0) + 1);
    const problems = [];
    for (const [k, n] of want) {
        const have = got.get(k) || 0;
        if (have !== n) {
            const [d, f] = k.split(':');
            problems.push(`Day ${d} needs exactly ${n} ${f} slot(s); you returned ${have}`);
        }
    }
    for (const [k, n] of got) {
        if (!want.has(k)) {
            const [d, f] = k.split(':');
            problems.push(`Day ${d} must not have ${f} slots (remove ${n})`);
        }
    }
    return problems.slice(0, 20);
}
