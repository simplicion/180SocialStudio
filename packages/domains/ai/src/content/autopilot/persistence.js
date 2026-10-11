"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTOPILOT_PIECE_SCHEMA = void 0;
exports.pieceToRow = pieceToRow;
exports.readAutopilotPayload = readAutopilotPayload;
exports.expandAutopilotFields = expandAutopilotFields;
exports.rowToPiece = rowToPiece;
/**
 * Maps autopilot pieces to CalendarContentPiece rows without schema changes.
 * The structured piece lives as JSON in `videoScriptOrHooks` (schema "autopilot.v1"), which also carries the
 * legacy keys (hookVariations / teleprompterScript / carouselSlides) the existing web drawer reads.
 */
const schemas_1 = require("./schemas");
const platform_rules_1 = require("./platform-rules");
const pipeline_1 = require("./pipeline");
exports.AUTOPILOT_PIECE_SCHEMA = 'autopilot.v1';
const LEGACY_HOOK_KEY = {
    pattern_interrupt: 'patternInterrupt',
    curiosity_gap: 'curiosityGap',
    contrarian: 'boldContrarian',
    relatable_pain: 'relatablePain',
    story: 'storyLead',
};
const CONTENT_TYPE = { reel: 'Reel', carousel: 'Carousel', static: 'Post', text: 'Text' };
function pieceToRow(piece, calendarId, companyId) {
    const primary = piece.captions[piece.primaryPlatform];
    const postingTime = primary?.postingTime || '09:00';
    const payload = {
        schema: exports.AUTOPILOT_PIECE_SCHEMA,
        slotId: piece.slotId,
        day: piece.day,
        date: piece.date,
        format: piece.format,
        platforms: piece.platforms,
        topic: piece.topic,
        angle: piece.angle,
        hookType: piece.hookType,
        spokenHook: piece.spokenHook,
        onScreenHook: piece.onScreenHook,
        script: piece.script || null,
        shotNotes: piece.shotNotes || [],
        carouselBrief: piece.carouselBrief || null,
        visualBrief: piece.visualBrief || '',
        captions: piece.captions,
        timezone: piece.timezone,
        sources: piece.sources,
        critic: piece.critic,
        psychologicalJob: piece.psychologicalJob || null,
        designSystem: piece.designSystem || null,
        visualDirection: piece.visualDirection || piece.visualBrief || null,
        whatContentDelivers: piece.whatContentDelivers || null,
        // legacy keys for the existing web drawer
        hookVariations: { [LEGACY_HOOK_KEY[piece.hookType]]: piece.spokenHook },
        ...(piece.script ? {
            teleprompterScript: {
                hook: piece.script.hook,
                problem: piece.script.body[0]?.beat || '',
                solution: piece.script.body.slice(1).map((b) => b.beat).join(' '),
                actionSteps: [],
                retentionLoop: piece.script.retentionLoop,
                callToAction: piece.script.cta,
            },
        } : {}),
        ...(piece.carouselBrief ? {
            carouselSlides: piece.carouselBrief.slides.map((s) => ({ slide: s.index, type: s.role, title: s.headline, body: s.body })),
        } : {}),
        ...(piece.timedBeats ? { timedBeats: piece.timedBeats } : {}),
        ...(piece.teleprompterScript ? { teleprompterText: piece.teleprompterScript } : {}),
        ...(piece.hookScore ? { hookScore: piece.hookScore } : {}),
        ...(piece.hookFormula ? { hookFormula: piece.hookFormula } : {}),
        ...(piece.humanScore ? { humanScore: piece.humanScore } : {}),
        ...(piece.craft ? { craft: piece.craft } : {}),
        ...(piece.productionScript ? { productionScript: piece.productionScript } : {}),
    };
    const notes = [
        piece.psychologicalJob ? `Psychological Job: ${piece.psychologicalJob}` : '',
        piece.sources.length ? `Sources: ${piece.sources.join(' ')}` : '',
        piece.critic.issues.length ? `Critic (${piece.critic.verdict}): ${piece.critic.issues.join('; ')}` : '',
    ].filter(Boolean).join('\n');
    return {
        calendarId,
        companyId,
        weekNumber: piece.weekNumber,
        dateScheduled: (0, pipeline_1.zonedTimeToUtc)(piece.date, postingTime, piece.timezone),
        platform: piece.primaryPlatform,
        contentType: CONTENT_TYPE[piece.format] || 'Post',
        pillar: piece.pillar,
        headline: piece.headline,
        adCopyFull: primary ? (0, platform_rules_1.composeCaption)(primary.caption, primary.hashtags) : '',
        videoScriptOrHooks: JSON.stringify(payload),
        callToAction: primary?.cta || piece.script?.cta || '',
        hashtagsResearched: JSON.stringify(primary?.hashtags || []),
        visualAssetsBrief: piece.visualDirection || piece.visualBrief || (piece.shotNotes || []).join('\n'),
        postingTimeTz: `${postingTime} ${piece.timezone}`,
        notes,
        status: piece.status,
    };
}
/** Parses the autopilot payload out of a stored row, or returns null for legacy rows. */
function readAutopilotPayload(row) {
    const raw = row?.videoScriptOrHooks;
    let obj = null;
    if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        try {
            obj = JSON.parse(raw);
        }
        catch {
            obj = null;
        }
    }
    else if (raw && typeof raw === 'object') {
        obj = raw;
    }
    return obj && obj.schema === exports.AUTOPILOT_PIECE_SCHEMA ? obj : null;
}
/** Adds the autopilot fields at the top level of an API piece so clients do not parse the JSON column. */
function expandAutopilotFields(row) {
    const a = readAutopilotPayload(row);
    if (!a)
        return { ...row, autopilot: false, hasScript: false };
    return {
        ...row,
        autopilot: true,
        slotId: a.slotId,
        format: a.format,
        platforms: a.platforms,
        hookType: schemas_1.HOOK_TYPES.includes(a.hookType) ? a.hookType : null,
        psychologicalJob: a.psychologicalJob || null,
        designSystem: a.designSystem || null,
        visualDirection: a.visualDirection || null,
        whatContentDelivers: a.whatContentDelivers || null,
        spokenHook: a.spokenHook,
        onScreenHook: a.onScreenHook,
        script: a.script || null,
        hasScript: !!a.script,
        shotNotes: a.shotNotes || [],
        carouselBrief: a.carouselBrief || null,
        captions: a.captions || {},
        sources: a.sources || [],
        critic: a.critic || null,
        hookScore: a.hookScore ?? null,
        hookFormula: a.hookFormula || null,
        humanScore: a.humanScore ?? null,
        craft: a.craft || null,
        timedBeats: a.timedBeats || [],
        teleprompterText: a.teleprompterText || null,
        productionScript: a.productionScript || null,
        postingTime: row.postingTimeTz || '',
    };
}
/** Rebuilds an AutopilotPiece from a stored row (for regeneration). */
function rowToPiece(row) {
    const a = readAutopilotPayload(row);
    if (!a)
        return null;
    return {
        slotId: a.slotId,
        day: a.day,
        date: a.date,
        weekNumber: row.weekNumber || Math.ceil(a.day / 7),
        platforms: a.platforms,
        primaryPlatform: a.platforms[0],
        format: a.format,
        pillar: row.pillar,
        topic: a.topic,
        angle: a.angle,
        headline: row.headline,
        hookType: a.hookType,
        spokenHook: a.spokenHook,
        onScreenHook: a.onScreenHook,
        script: a.script || undefined,
        shotNotes: a.shotNotes,
        carouselBrief: a.carouselBrief || undefined,
        visualBrief: a.visualBrief,
        captions: a.captions || {},
        timezone: a.timezone,
        sources: a.sources || [],
        critic: a.critic || { verdict: 'ok', issues: [] },
        status: row.status === 'needs_review' ? 'needs_review' : 'ready',
    };
}
