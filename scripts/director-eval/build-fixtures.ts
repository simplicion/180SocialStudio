/**
 * Builds the AI Director eval fixtures (quality-fix plan, Phase 0) as the MobileAIDirectRequest JSON a phone would
 * send, plus reference notes and machine checks. Deterministic: re-running it rewrites identical files.
 *
 *   npx tsx scripts/director-eval/build-fixtures.ts
 *
 * Each script line is spoken at ~2.6 words/s; `pauseAfterMs` inserts silence (also listed in `silences`).
 */
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

type Line = { text: string; speaker?: string; pauseAfterMs?: number };
type Word = { text: string; startMs: number; endMs: number; speaker?: string };

const WORD_MS = 380;
const GAP_MS = 70;

/** Word timings + silence ranges for a script starting at `startMs`. */
function speak(lines: Line[], startMs = 400): { words: Word[]; silences: Array<{ startMs: number; endMs: number }>; endMs: number; lineStarts: number[] } {
  const words: Word[] = [];
  const silences: Array<{ startMs: number; endMs: number }> = [];
  const lineStarts: number[] = [];
  let t = startMs;
  for (const line of lines) {
    lineStarts.push(t);
    for (const w of line.text.split(/\s+/).filter(Boolean)) {
      const len = Math.max(180, Math.min(620, WORD_MS * (0.55 + w.length / 9)));
      words.push({ text: w, startMs: Math.round(t), endMs: Math.round(t + len), ...(line.speaker ? { speaker: line.speaker } : {}) });
      t += len + GAP_MS;
    }
    const pause = line.pauseAfterMs ?? 250;
    if (pause >= 700) silences.push({ startMs: Math.round(t), endMs: Math.round(t + pause) });
    t += pause;
  }
  return { words, silences, endMs: Math.round(t), lineStarts: lineStarts.map(Math.round) };
}

/** Face samples every 500 ms around (x, y) with a small drift. */
function faces(durationMs: number, centres: Array<{ x: number; y: number; w?: number; h?: number }>, fromMs = 0, toMs = durationMs) {
  const out: Array<{ tMs: number; x: number; y: number; w: number; h: number }> = [];
  for (let t = fromMs; t <= toMs; t += 500) {
    centres.forEach((c, i) => {
      const drift = Math.sin((t / 1000 + i) * 0.7) * 0.015;
      out.push({ tMs: t, x: +(c.x + drift).toFixed(4), y: +(c.y + drift / 2).toFixed(4), w: c.w ?? 0.22, h: c.h ?? 0.3 });
    });
  }
  return out;
}

interface Fixture {
  id: string;
  title: string;
  description: string;
  request: Record<string, unknown>;
  reference: {
    /** What a skilled human editor would do (read by people and, later, the judge). */
    mustDo: string[];
    mustNotDo: string[];
    /** Machine checks the harness scores (report only in Phase 0). */
    checks: {
      /** Source ranges [startMs, endMs] that should be cut (retakes, false starts, repeats). */
      shouldCutSourceMs?: Array<[number, number]>;
      /** Source ranges that must survive (the hook, key points). */
      mustKeepSourceMs?: Array<[number, number]>;
      captions?: boolean;
      minZooms?: number;
      maxZooms?: number;
      music?: boolean;
      targetAspect?: string;
      maxDurationMs?: number;
      /** Sources (assetId) whose clips should be gone from the timeline (abandoned takes). */
      shouldDropAssets?: string[];
      /** Sources whose clips must stay. */
      mustKeepAssets?: string[];
      /** Every zoom centres within 0.2 of the main subject the ShotLog reports for that moment (Phase 2). */
      zoomsOnSubject?: boolean;
      /** The style playbook this video should get, and its targets met within tolerance (Phase 6). */
      playbook?: string;
    };
  };
}

const fixtures: Fixture[] = [];

// 1. Talking head, 45 s, one speaker, a false start, fillers and two long pauses.
{
  const lines: Line[] = [
    { text: "So the biggest mistake people make with their first business is", pauseAfterMs: 300 },
    { text: "sorry let me start that again", pauseAfterMs: 1200 },
    { text: "The biggest mistake people make with their first business is waiting until the product is perfect", pauseAfterMs: 400 },
    { text: "um I waited eight months and lost my first three customers because of it", pauseAfterMs: 1800 },
    { text: "Here is what I do now instead", pauseAfterMs: 300 },
    { text: "I ship something small every week and I let the customers tell me what is broken", pauseAfterMs: 400 },
    { text: "like literally I send them a link and ask what is the one thing that annoyed you", pauseAfterMs: 1600 },
    { text: "That one question got me more useful feedback than six months of building alone", pauseAfterMs: 400 },
    { text: "So if you are sitting on an idea ship the ugly version this week", pauseAfterMs: 300 },
    { text: "follow for more lessons from building in public", pauseAfterMs: 600 },
  ];
  const s = speak(lines);
  const durationMs = Math.max(45000, s.endMs + 400);
  fixtures.push({
    id: "talking-head-45s",
    title: "Talking head, 45 s",
    description: "Single founder to camera (portrait). False start at the top, fillers, two long pauses, clear CTA.",
    request: {
      prompt: "edit this for reels",
      media: {
        assetId: "primary", durationMs, width: 1080, height: 1920, fps: 30,
        transcript: { words: s.words }, silences: s.silences,
        faces: faces(durationMs, [{ x: 0.5, y: 0.36, w: 0.3, h: 0.24 }]),
        scenesMs: [], labels: [{ startMs: 0, endMs: durationMs, labels: ["person", "room", "sitting"] }],
        loudness: { integratedLufs: -19.5, truePeakDb: -2.1 },
      },
    },
    reference: {
      mustDo: [
        "Drop the false start ('So the biggest mistake ... is' + 'sorry let me start that again') so the video opens on the clean take.",
        "Hook = 'The biggest mistake people make with their first business...' in the first 1.5 s.",
        "Remove the long pauses and the 'um' / 'like' fillers without clipping words.",
        "Word-level captions in a punchy style, kept clear of the face.",
        "1-3 punch-in zooms on the face on emphasis lines ('eight months', 'one question').",
      ],
      mustNotDo: ["Cut the CTA", "Add B-roll that covers the speaker for most of the video", "Zoom off-face"],
      checks: {
        shouldCutSourceMs: [[s.lineStarts[0], s.lineStarts[2] - 100]],
        mustKeepSourceMs: [[s.lineStarts[2], s.lineStarts[3]], [s.lineStarts[9], s.lineStarts[9] + 1500]],
        captions: true, minZooms: 1, maxZooms: 4, maxDurationMs: s.endMs - 3500,
      },
    },
  });
}

// 2. Interview, two speakers (landscape), diarized.
{
  const lines: Line[] = [
    { text: "What was the moment you knew the company was going to work", speaker: "A", pauseAfterMs: 900 },
    { text: "Honestly it was a Tuesday night when a stranger emailed us to say our app saved her small bakery", speaker: "B", pauseAfterMs: 500 },
    { text: "She had been doing her orders on paper for eleven years", speaker: "B", pauseAfterMs: 400 },
    { text: "Wow and what did you do with that email", speaker: "A", pauseAfterMs: 600 },
    { text: "We printed it and put it on the wall and every hard week we read it again", speaker: "B", pauseAfterMs: 1400 },
    { text: "uh what would you tell a founder who is in a hard week right now", speaker: "A", pauseAfterMs: 700 },
    { text: "Find your one customer who loves you and talk to them every single week", speaker: "B", pauseAfterMs: 400 },
    { text: "they are the reason to keep going and they will tell you what to build next", speaker: "B", pauseAfterMs: 600 },
  ];
  const s = speak(lines);
  const durationMs = s.endMs + 500;
  fixtures.push({
    id: "interview-two-speakers",
    title: "Interview, two speakers",
    description: "Host (A, left) and guest (B, right) in one wide 16:9 shot; transcript has speaker labels.",
    request: {
      prompt: "turn this into a vertical clip for shorts with captions",
      media: {
        assetId: "primary", durationMs, width: 1920, height: 1080, fps: 30,
        transcript: { words: s.words }, silences: s.silences,
        faces: faces(durationMs, [{ x: 0.3, y: 0.4, w: 0.12, h: 0.22 }, { x: 0.7, y: 0.4, w: 0.12, h: 0.22 }]),
        labels: [{ startMs: 0, endMs: durationMs, labels: ["person", "chair", "studio"] }],
        loudness: { integratedLufs: -21, truePeakDb: -3 },
      },
    },
    reference: {
      mustDo: [
        "Reframe to 9:16 and follow whoever is speaking (left face for A, right face for B).",
        "Open on the guest's strongest line (the bakery story) or the host's question as a hook.",
        "Captions; ideally styled per speaker.",
        "Tighten the pauses between question and answer.",
      ],
      mustNotDo: ["Cut an answer mid-sentence", "Keep a centre crop that shows neither face", "Zoom on empty space between the two"],
      checks: { captions: true, targetAspect: "9:16", mustKeepSourceMs: [[s.lineStarts[1], s.lineStarts[2]]] },
    },
  });
}

// 3. Vlog with motion: many shots, little speech.
{
  const lines: Line[] = [
    { text: "Okay we just landed in Lisbon and the light here is unreal", pauseAfterMs: 5200 },
    { text: "First stop pastel de nata obviously", pauseAfterMs: 6400 },
    { text: "This is the best one I have ever had no contest", pauseAfterMs: 7000 },
    { text: "Sunset at the viewpoint this is why we came", pauseAfterMs: 6000 },
    { text: "See you tomorrow", pauseAfterMs: 2000 },
  ];
  const s = speak(lines, 800);
  const durationMs = Math.max(40000, s.endMs);
  const scenesMs = [3100, 6300, 8800, 11500, 14200, 16900, 19800, 22400, 25100, 27900, 30600, 33200, 36000, 38100];
  const labelSets = [["airport", "person"], ["street", "tram"], ["street", "building"], ["food", "pastry"], ["food", "cafe"], ["person", "food"], ["street", "people"], ["sky", "city"], ["sunset", "sky"], ["person", "sunset"], ["city", "night"], ["hotel", "room"], ["person", "room"], ["night", "street"], ["person"]];
  const bounds = [0, ...scenesMs, durationMs];
  fixtures.push({
    id: "vlog-motion",
    title: "Travel vlog with motion",
    description: "Handheld travel vlog: a cut every ~2.7 s, short voice lines, the creator in frame only in some shots.",
    request: {
      prompt: "make it a punchy travel vlog with music",
      media: {
        assetId: "primary", durationMs, width: 1080, height: 1920, fps: 30,
        transcript: { words: s.words }, silences: s.silences,
        faces: [...faces(durationMs, [{ x: 0.5, y: 0.4 }], 0, 3000), ...faces(durationMs, [{ x: 0.45, y: 0.42 }], 14200, 16900), ...faces(durationMs, [{ x: 0.55, y: 0.38 }], 33200, 36000)],
        scenesMs,
        labels: bounds.slice(0, -1).map((b, i) => ({ startMs: b, endMs: bounds[i + 1], labels: labelSets[i % labelSets.length] })),
        loudness: { integratedLufs: -24, truePeakDb: -4 },
      },
    },
    reference: {
      mustDo: [
        "Upbeat music bed, ducked under the voice lines.",
        "Keep the visual shots (the footage is the B-roll); do not cut long silences that carry visuals.",
        "Captions on the voice lines only.",
        "Transitions or cuts on the beat; a quick-cut pace.",
      ],
      mustNotDo: ["Remove silences so aggressively the visuals disappear", "Face zooms on shots without a face", "Stock B-roll over the creator's own travel footage"],
      checks: { music: true, maxZooms: 3, mustKeepSourceMs: [[19800, 25100]] },
    },
  });
}

// 4. Tutorial / screen recording: no face, on-screen text, a repeated explanation.
{
  const lines: Line[] = [
    { text: "In this video I will show you how to set up automatic backups in three steps", pauseAfterMs: 600 },
    { text: "Step one open settings and click on the backup tab", pauseAfterMs: 1400 },
    { text: "Step two choose a folder where your backups will be saved", pauseAfterMs: 500 },
    { text: "so basically you pick a folder where all the backups go and that is the folder they get saved in", pauseAfterMs: 1600 },
    { text: "Step three turn on the daily schedule and press save", pauseAfterMs: 500 },
    { text: "That is it your files are now backed up every night", pauseAfterMs: 400 },
    { text: "If this helped leave a comment with what I should cover next", pauseAfterMs: 800 },
  ];
  const s = speak(lines);
  const durationMs = s.endMs + 400;
  fixtures.push({
    id: "tutorial-screen",
    title: "Tutorial, screen recording",
    description: "16:9 screen capture, no face. Step two is explained twice; OCR shows the UI labels.",
    request: {
      prompt: "clean this tutorial up and add captions",
      media: {
        assetId: "primary", durationMs, width: 1920, height: 1080, fps: 30,
        transcript: { words: s.words }, silences: s.silences, faces: [],
        scenesMs: [s.lineStarts[1], s.lineStarts[2], s.lineStarts[4], s.lineStarts[5]],
        ocr: [
          { startMs: s.lineStarts[1], endMs: s.lineStarts[2], text: "Settings > Backup" },
          { startMs: s.lineStarts[2], endMs: s.lineStarts[4], text: "Choose folder" },
          { startMs: s.lineStarts[4], endMs: s.lineStarts[5], text: "Daily schedule  [Save]" },
        ],
        labels: [{ startMs: 0, endMs: durationMs, labels: ["screenshot", "text", "software"] }],
        loudness: { integratedLufs: -18, truePeakDb: -1.5 },
      },
    },
    reference: {
      mustDo: [
        "Drop the repeated explanation of step two ('so basically you pick a folder ...').",
        "Remove the long pauses between steps.",
        "Captions that do not cover the UI being explained (bottom or top band).",
        "Optional step titles ('Step 1', 'Step 2', 'Step 3'); zooms only onto the UI area being discussed.",
      ],
      mustNotDo: ["Face zooms (there is no face)", "Reframe to 9:16 (cuts off the UI) unless asked", "Cut any of the three steps"],
      checks: {
        shouldCutSourceMs: [[s.lineStarts[3], s.lineStarts[4] - 200]],
        mustKeepSourceMs: [[s.lineStarts[1], s.lineStarts[2]], [s.lineStarts[2], s.lineStarts[3]], [s.lineStarts[4], s.lineStarts[5]]],
        captions: true, targetAspect: "16:9",
      },
    },
  });
}

// 5. Multi-clip: three takes of the same intro, best one is the last.
{
  const takes: Record<string, Line[]> = {
    take1: [{ text: "Hey everyone welcome back today we are going to talk about um", pauseAfterMs: 1500 }, { text: "wait no hold on", pauseAfterMs: 1500 }],
    take2: [{ text: "Hey everyone welcome back today we are talking about the three apps I use every day", pauseAfterMs: 400 }, { text: "uh and actually one of them is", pauseAfterMs: 2000 }],
    take3: [
      { text: "Hey everyone today I am showing you the three apps I open every single morning", pauseAfterMs: 500 },
      { text: "number one is my calendar because it decides my whole day", pauseAfterMs: 500 },
      { text: "number two is a notes app for every idea I have", pauseAfterMs: 500 },
      { text: "and number three is a timer so I actually finish things", pauseAfterMs: 800 },
    ],
  };
  const spoken = Object.fromEntries(Object.entries(takes).map(([id, l]) => [id, speak(l)]));
  const dur = Object.fromEntries(Object.entries(spoken).map(([id, s]) => [id, s.endMs + 300]));
  const ids = ["take1", "take2", "take3"];
  let t = 0;
  const clips = ids.map((assetId, i) => {
    const c = { id: `c${i}`, assetId, sourceStartMs: 0, sourceEndMs: dur[assetId], timelineStartMs: t, timelineEndMs: t + dur[assetId], speed: 1, volumeDb: 0, crop: null, filter: null, transitionIn: null };
    t += dur[assetId];
    return c;
  });
  const descriptor = (assetId: string) => ({
    assetId, durationMs: dur[assetId], width: 1080, height: 1920, fps: 30,
    transcript: { words: spoken[assetId].words }, silences: spoken[assetId].silences,
    faces: faces(dur[assetId], [{ x: 0.5, y: 0.38, w: 0.28, h: 0.22 }]),
    loudness: { integratedLufs: -20, truePeakDb: -2.5 },
  });
  fixtures.push({
    id: "multi-clip",
    title: "Multi-clip, three takes",
    description: "Three clips on the timeline: two abandoned takes of the intro, then the full good take.",
    request: {
      prompt: "edit this into a tight reel",
      media: descriptor("take1"),
      mediaList: [descriptor("take2"), descriptor("take3")],
      currentEditIR: {
        schemaVersion: "mobile-editir/1", projectId: "eval-multi-clip",
        canvas: { aspect: "9:16", width: 1080, height: 1920, fps: 30, background: "#000000" },
        durationMs: t,
        sources: ids.map((assetId) => ({ assetId, durationMs: dur[assetId], width: 1080, height: 1920 })),
        clips, overlays: [], captions: [], zooms: [],
        audio: { originalTrack: { volumeDb: 0 }, music: [], speechRangesMs: [] },
      },
    },
    reference: {
      mustDo: [
        "Remove take 1 and take 2 (abandoned intros); keep take 3 whole.",
        "Captions; a punch-in on 'number one / two / three'.",
        "Optional numbered titles for the three apps.",
      ],
      mustNotDo: ["Keep both 'Hey everyone' intros", "Cut a list item from take 3"],
      checks: { captions: true, minZooms: 1, maxDurationMs: dur.take3 + 1500, shouldDropAssets: ["take1", "take2"], mustKeepAssets: ["take3"] },
    },
  });
}

// ── Vision (Phase 2): the ShotLog the phone would send with consent, i.e. what the vision pass returns ──────────

type Box = { x: number; y: number; w: number; h: number };
type Seg = { from: number; to: number; desc: string; subjects: Array<{ label: string; box: Box; primary?: boolean }>; framing?: string; broll?: number; quality?: string[]; text?: string; energy?: string; motion?: string };

function shotLog(assetId: string, durationMs: number, segs: Seg[]) {
  const shots: any[] = [];
  for (const g of segs) {
    const n = Math.max(1, Math.ceil((g.to - g.from) / 8000));
    for (let k = 0; k < n; k++) {
      shots.push({
        startMs: Math.round(g.from + ((g.to - g.from) * k) / n),
        endMs: Math.round(g.from + ((g.to - g.from) * (k + 1)) / n),
        description: g.desc,
        subjects: g.subjects,
        framing: g.framing ?? "medium",
        cameraMotion: g.motion ?? "static",
        quality: g.quality ?? [],
        ...(g.text ? { onScreenText: g.text } : {}),
        brollSuitability: g.broll ?? 0.2,
        energy: g.energy ?? "medium",
      });
    }
  }
  return { version: "shotlog/1", assetId, sourceHash: `eval-${assetId}-${durationMs}`, durationMs, model: "eval/fixture", frameCount: Math.min(60, Math.ceil(durationMs / 2000)), shots };
}

const PERSON: Box = { x: 0.35, y: 0.12, w: 0.3, h: 0.48 };
function addVision(f: Fixture) {
  const media = f.request.media as any;
  const list = (f.request.mediaList as any[]) ?? [];
  const d = media.durationMs as number;
  if (f.id === "talking-head-45s") {
    media.shotLog = shotLog("primary", d, [{ from: 0, to: d, desc: "a founder talking to camera at a desk in a warm, slightly dim home office", subjects: [{ label: "founder", box: PERSON, primary: true }, { label: "laptop", box: { x: 0.6, y: 0.66, w: 0.3, h: 0.18 } }], quality: ["dark"] }]);
    f.reference.checks.zoomsOnSubject = true;
  } else if (f.id === "interview-two-speakers") {
    media.shotLog = shotLog("primary", d, [{ from: 0, to: d, desc: "two people in chairs in a podcast studio, host on the left, guest on the right, microphones between them", framing: "wide", broll: 0.4, subjects: [{ label: "guest", box: { x: 0.62, y: 0.22, w: 0.18, h: 0.5 }, primary: true }, { label: "host", box: { x: 0.2, y: 0.22, w: 0.18, h: 0.5 } }] }]);
  } else if (f.id === "vlog-motion") {
    const cuts = [0, ...(media.scenesMs as number[]), d];
    const looks: Array<Omit<Seg, "from" | "to">> = [
      { desc: "the creator taking a selfie in an airport arrivals hall", subjects: [{ label: "creator", box: { x: 0.3, y: 0.15, w: 0.4, h: 0.45 }, primary: true }], framing: "close", broll: 0.2, motion: "handheld" },
      { desc: "a yellow tram on a steep cobbled street in sunlight", subjects: [{ label: "tram", box: { x: 0.2, y: 0.35, w: 0.6, h: 0.4 }, primary: true }], framing: "wide", broll: 0.9, motion: "pan", energy: "high" },
      { desc: "pastel-coloured old buildings with tiled facades", subjects: [{ label: "building", box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, primary: true }], framing: "wide", broll: 0.9 },
      { desc: "close-up of a custard tart with cinnamon on a plate", subjects: [{ label: "pastel de nata", box: { x: 0.3, y: 0.4, w: 0.4, h: 0.25 }, primary: true }], framing: "extreme_close", broll: 0.8 },
      { desc: "a busy cafe counter with tarts in a glass display", subjects: [{ label: "display case", box: { x: 0.15, y: 0.4, w: 0.7, h: 0.35 }, primary: true }], framing: "medium", broll: 0.8, quality: ["blur"], motion: "handheld" },
    ];
    media.shotLog = shotLog("primary", d, cuts.slice(0, -1).map((from, i) => ({ from, to: cuts[i + 1], ...looks[i % looks.length] })));
  } else if (f.id === "tutorial-screen") {
    const cuts = [0, ...(media.scenesMs as number[]), d];
    const looks: Array<Omit<Seg, "from" | "to">> = [
      { desc: "a desktop with the app's home window open", subjects: [{ label: "app window", box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, primary: true }], text: "Backup Pro" },
      { desc: "the settings window with the Backup tab selected in the sidebar", subjects: [{ label: "Backup tab", box: { x: 0.04, y: 0.3, w: 0.14, h: 0.06 }, primary: true }, { label: "settings panel", box: { x: 0.22, y: 0.1, w: 0.7, h: 0.8 } }], text: "Settings > Backup" },
      { desc: "a folder picker dialog with the Choose folder button", subjects: [{ label: "Choose folder button", box: { x: 0.66, y: 0.72, w: 0.18, h: 0.07 }, primary: true }], text: "Choose folder" },
      { desc: "the schedule section with a Daily toggle switched on and a Save button", subjects: [{ label: "Save button", box: { x: 0.78, y: 0.84, w: 0.1, h: 0.06 }, primary: true }, { label: "Daily toggle", box: { x: 0.3, y: 0.4, w: 0.12, h: 0.05 } }], text: "Daily schedule  [Save]" },
      { desc: "a green confirmation banner saying backups are on", subjects: [{ label: "confirmation banner", box: { x: 0.3, y: 0.05, w: 0.4, h: 0.08 }, primary: true }] },
    ];
    media.shotLog = shotLog("primary", d, cuts.slice(0, -1).map((from, i) => ({ from, to: cuts[i + 1], framing: "screen", broll: 0.1, energy: "low", ...looks[i % looks.length] })));
    f.reference.checks.zoomsOnSubject = true;
  } else if (f.id === "multi-clip") {
    for (const m of [media, ...list]) {
      m.shotLog = shotLog(m.assetId, m.durationMs, [{ from: 0, to: m.durationMs, desc: "the creator talking to camera in a bright kitchen", subjects: [{ label: "creator", box: { x: 0.36, y: 0.14, w: 0.28, h: 0.44 }, primary: true }] }]);
    }
    f.reference.checks.zoomsOnSubject = true;
  }
}
for (const f of fixtures) addVision(f);
const PLAYBOOKS: Record<string, string> = {
  "talking-head-45s": "fast_hype",
  "interview-two-speakers": "podcast_clip",
  "vlog-motion": "cinematic_vlog",
  "tutorial-screen": "calm_educational",
  "multi-clip": "fast_hype",
};
for (const f of fixtures) f.reference.checks.playbook = PLAYBOOKS[f.id];

const dir = join(__dirname, "fixtures");
mkdirSync(dir, { recursive: true });
for (const f of fixtures) writeFileSync(join(dir, `${f.id}.json`), JSON.stringify(f, null, 2) + "\n");
console.log(`wrote ${fixtures.length} fixtures to ${dir}`);
