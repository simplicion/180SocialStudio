/**
 * Agent 7: Voice Guard (deterministic)
 *
 * Removes the machine fingerprints that are safe to remove without changing meaning (invisible characters and
 * em/en dashes) from every line a person will say or publish, then attaches the final craft report to the piece:
 * hook score and formula, human-voice score, timed beats and teleprompter text for videos, and the list of
 * things a reviewer should still fix. Stock AI words are flagged, never silently swapped, so the copy stays the
 * writer's own.
 */
import { buildTimedBeats, CraftPieceInput, reviewPieceCraft } from '../../craft/craft-review';
import { toCraftPlatform } from '../../craft/platform-specs';
import { TextHumanizer } from '../../craft/text-humanizer';
import type { AutopilotPiece } from '../types';

const clean = (text: string): string => (text ? TextHumanizer.humanize(text, { typographic: 'dashes', lexical: false }).cleanedText : text);

/** Strips invisible characters and dashes in place. Returns how many pieces changed. */
export function runVoiceGuard(pieces: AutopilotPiece[]): { cleaned: number } {
    let cleaned = 0;
    for (const p of pieces) {
        const before = JSON.stringify([p.spokenHook, p.onScreenHook, p.script, p.captions, p.carouselBrief]);
        p.spokenHook = clean(p.spokenHook);
        p.onScreenHook = clean(p.onScreenHook);
        if (p.script) {
            p.script.hook = clean(p.script.hook);
            p.script.retentionLoop = clean(p.script.retentionLoop);
            p.script.cta = clean(p.script.cta);
            p.script.body = p.script.body.map((b) => ({ ...b, beat: clean(b.beat) }));
        }
        if (p.carouselBrief) {
            p.carouselBrief.slides = p.carouselBrief.slides.map((s) => ({ ...s, headline: clean(s.headline), body: clean(s.body) }));
        }
        for (const copy of Object.values(p.captions)) {
            if (!copy) continue;
            copy.caption = clean(copy.caption);
            copy.cta = clean(copy.cta);
        }
        if (JSON.stringify([p.spokenHook, p.onScreenHook, p.script, p.captions, p.carouselBrief]) !== before) cleaned += 1;
    }
    return { cleaned };
}

/** Final scores and timing, computed from the text as it will be saved. Run after the critic. */
export function attachCraftReport(pieces: AutopilotPiece[]): void {
    for (const p of pieces) {
        const report = reviewPieceCraft({
            format: p.format,
            platforms: p.platforms,
            spokenHook: p.spokenHook,
            onScreenHook: p.onScreenHook,
            script: p.script as CraftPieceInput['script'],
            captions: p.captions,
            targetDurationSec: p.script?.estimatedDurationSec,
        });
        p.hookScore = report.hook?.totalScore;
        p.hookFormula = report.hook?.formulaName;
        p.humanScore = report.voice?.overallScore;
        p.craft = { score: report.score, blocking: report.blocking, advice: report.advice.slice(0, 12) };
        if (p.format === 'reel' && p.script) {
            const timed = buildTimedBeats(p.script as NonNullable<CraftPieceInput['script']>, {
                spokenHook: p.spokenHook,
                onScreenHook: p.onScreenHook,
                platform: toCraftPlatform(p.primaryPlatform) || undefined,
            });
            p.timedBeats = timed.beats;
            p.teleprompterScript = timed.teleprompterText;
        }
    }
}
