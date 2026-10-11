/**
 * Agent 8: Shooting Script Director (on demand, one video piece at a time)
 *
 * Expands a reel's script into a scene-by-scene production plan a creator can shoot without an agency: for each
 * scene the exact spoken line, on-screen text, shot type and framing, what to do on camera, B-roll, the edit cue
 * and delivery note, plus setup, props and a pre-shoot checklist.
 *
 * The LLM plans the visuals; it is not allowed to change what is said. `check` verifies that the scenes' spoken
 * lines add up to the stored script word for word, and timecodes are then computed from word counts at the
 * platform's speaking pace (never taken from the model).
 */
import { z } from 'zod';
import { CraftPlatform, PLATFORM_CRAFT, toCraftPlatform } from '../../craft/platform-specs';
import { runJsonAgent } from '../json-agent';
import { AutopilotError, AutopilotLLM, UsageMeter } from '../llm';
import type { AutopilotBrandContext, AutopilotPiece } from '../types';

export const SCENE_PURPOSES = ['hook', 'setup', 'value', 'proof', 'loop', 'cta'] as const;
export const SHOT_TYPES = ['talking_head_close', 'talking_head_medium', 'wide', 'over_shoulder', 'screen_recording', 'product_close', 'hands_demo', 'b_roll', 'text_card'] as const;

const short = (max: number) => z.string().trim().max(max).default('');

const SceneSchema = z.object({
    purpose: z.enum(SCENE_PURPOSES),
    /** Copied from the script. Empty only for a silent B-roll or text-card scene. */
    spokenLine: z.string().trim().max(600).default(''),
    onScreenText: short(120),
    shot: z.enum(SHOT_TYPES),
    framing: short(240),
    action: short(300),
    bRoll: short(300),
    editCue: short(200),
    audioCue: short(200),
    delivery: short(200),
});

export const ProductionScriptDraftSchema = z.object({
    logline: z.string().trim().min(1).max(300),
    setup: z.object({
        location: short(200),
        lighting: short(200),
        wardrobe: short(200),
        props: z.array(z.string().trim().min(1).max(120)).max(12).default([]),
    }),
    scenes: z.array(SceneSchema).min(3).max(30),
    captionStyle: short(240),
    musicMood: short(200),
    checklist: z.array(z.string().trim().min(1).max(200)).max(12).default([]),
});
export type ProductionScriptDraft = z.infer<typeof ProductionScriptDraftSchema>;

export interface ProductionScene extends z.infer<typeof SceneSchema> {
    index: number;
    timecode: string;
    startSec: number;
    durationSec: number;
    wordCount: number;
    flags: string[];
}

export interface ProductionScript {
    schema: 'production-script.v1';
    platform: CraftPlatform;
    aspect: string;
    wpm: number;
    totalSeconds: number;
    logline: string;
    setup: ProductionScriptDraft['setup'];
    scenes: ProductionScene[];
    captionStyle: string;
    musicMood: string;
    checklist: string[];
    flags: string[];
    generatedAt: string;
}

const words = (text: string): string[] => (text.toLowerCase().match(/[\p{L}\p{N}$%']+/gu) || []);
/** Seconds a silent scene (B-roll / text card) holds on screen. */
const SILENT_SCENE_SEC = 1.5;

function scriptLines(piece: AutopilotPiece): string[] {
    const s = piece.script!;
    return [s.hook || piece.spokenHook, ...s.body.map((b) => b.beat), s.retentionLoop, s.cta].map((l) => (l || '').trim()).filter(Boolean);
}

function timecodeOf(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(1).padStart(4, '0')}`;
}

/** Deterministic timing + pacing flags for a validated draft. */
export function timeProductionScript(draft: ProductionScriptDraft, platform: CraftPlatform, now = new Date()): ProductionScript {
    const spec = PLATFORM_CRAFT[platform];
    const wps = spec.video.wpm / 60;
    const flags: string[] = [];
    let clock = 0;
    const scenes: ProductionScene[] = draft.scenes.map((scene, i) => {
        const wordCount = words(scene.spokenLine).length;
        const durationSec = wordCount ? Math.round((wordCount / wps) * 10) / 10 : SILENT_SCENE_SEC;
        const sceneFlags: string[] = [];
        if (i === 0 && durationSec > spec.video.hookWindowSec) sceneFlags.push(`Hook takes ${durationSec}s; ${spec.label} gives you ${spec.video.hookWindowSec}s.`);
        if (i > 0 && durationSec > 4 && !scene.editCue && !scene.bRoll) sceneFlags.push(`${durationSec}s with no cut, B-roll or text pop. Add a visual change.`);
        if (scene.onScreenText.split(/\s+/).filter(Boolean).length > 8) sceneFlags.push('On-screen text is over 8 words; it will not be read in time.');
        const out: ProductionScene = {
            ...scene, index: i + 1, timecode: timecodeOf(clock), startSec: Math.round(clock * 10) / 10, durationSec, wordCount, flags: sceneFlags,
        };
        flags.push(...sceneFlags.map((f) => `Scene ${i + 1}: ${f}`));
        clock += durationSec;
        return out;
    });
    const totalSeconds = Math.round(clock * 10) / 10;
    if (totalSeconds > spec.video.maxSec) flags.push(`Runs ${totalSeconds}s; ${spec.label} short video allows ${spec.video.maxSec}s.`);
    return {
        schema: 'production-script.v1',
        platform,
        aspect: spec.video.aspect,
        wpm: spec.video.wpm,
        totalSeconds,
        logline: draft.logline,
        setup: draft.setup,
        scenes,
        captionStyle: draft.captionStyle,
        musicMood: draft.musicMood,
        checklist: draft.checklist,
        flags,
        generatedAt: now.toISOString(),
    };
}

export async function runProductionScriptAgent(params: {
    llm: AutopilotLLM;
    brand: AutopilotBrandContext;
    piece: AutopilotPiece;
    meter?: UsageMeter;
    log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<ProductionScript> {
    const { piece, brand } = params;
    if (piece.format !== 'reel' || !piece.script?.body?.length) {
        throw new AutopilotError('INVALID_INPUT', 'A shooting script needs a video piece with a script');
    }
    const platform = toCraftPlatform(piece.primaryPlatform) || 'instagram';
    const spec = PLATFORM_CRAFT[platform];
    const lines = scriptLines(piece);
    const expected = words(lines.join(' ')).join(' ');

    const { value } = await runJsonAgent({
        llm: params.llm,
        role: 'production_script',
        meter: params.meter,
        log: params.log,
        maxTokens: Math.min(7000, 1400 + lines.length * 420),
        schema: ProductionScriptDraftSchema,
        system: 'You are a short-form video director. You turn a finished script into a shot-by-shot plan one person can film on a phone. You plan visuals; you never change the words.',
        prompt: [
            brand.promptContext,
            '',
            `Platform: ${spec.label}, ${spec.video.aspect}. A visual change is needed at least every 4 seconds; the hook must land inside ${spec.video.hookWindowSec} seconds.`,
            `Piece: ${piece.headline}. Topic: ${piece.topic}. Angle: ${piece.angle}.`,
            piece.visualDirection ? `Visual direction: ${piece.visualDirection}` : '',
            piece.shotNotes?.length ? `Writer's shot notes: ${piece.shotNotes.join(' | ')}` : '',
            `On-screen hook (scene 1 text): ${piece.onScreenHook}`,
            '',
            'Script lines, in order (this is exactly what is said):',
            ...lines.map((l, i) => `${i + 1}. ${l}`),
            '',
            'Build the shooting script:',
            '- scenes: cover every script line in order. spokenLine must be copied word for word from the script; you may split one long line across two scenes at a natural pause, but never reword, add or drop words.',
            '- A scene with no speech (B-roll or text card) has an empty spokenLine.',
            `- purpose: one of ${SCENE_PURPOSES.join(', ')}. shot: one of ${SHOT_TYPES.join(', ')}.`,
            '- framing: where the subject sits in frame and the camera distance/angle. action: what the person physically does.',
            '- bRoll: a specific cutaway the creator can film or find (leave empty if none). editCue: the cut, zoom, text pop or transition at the start of the scene.',
            '- audioCue: music change or sound effect (empty if none). delivery: tone, pace or emphasis word.',
            '- onScreenText: 6 words or fewer, empty when no text is needed.',
            '- setup: location, lighting, wardrobe and props that this creator can realistically arrange alone, consistent with the brand.',
            '- captionStyle and musicMood: one line each. checklist: 4-8 things to check before pressing record.',
            'Do not invent statistics, prices, client names or results.',
            '',
            'Return JSON only: {"logline":"","setup":{"location":"","lighting":"","wardrobe":"","props":[]},"scenes":[{"purpose":"hook","spokenLine":"","onScreenText":"","shot":"talking_head_close","framing":"","action":"","bRoll":"","editCue":"","audioCue":"","delivery":""}],"captionStyle":"","musicMood":"","checklist":[]}',
        ].filter((l) => l !== '').join('\n'),
        check: (draft) => {
            const got = words(draft.scenes.map((s) => s.spokenLine).join(' ')).join(' ');
            return got === expected ? [] : ['The spokenLine values, joined in order, must equal the script lines word for word. Do not reword, add or drop any spoken words.'];
        },
    });
    return timeProductionScript(value, platform);
}
