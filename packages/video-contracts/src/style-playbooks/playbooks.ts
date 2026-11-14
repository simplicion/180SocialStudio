import type { StylePlaybook } from "./types";

export const FAST_HYPE: StylePlaybook = {
  id: "fast_hype",
  version: "1.0.0",
  label: "fast and punchy (MrBeast / Hormozi)",
  matches: /\b(punch(y|ier)|hype|fast|energetic|high[- ]energy|viral|mr\.? ?beast|hormozi|tiktok|snappy|aggressive|exciting)\b/i,
  targets: {
    maxStaticSec: 3,
    cutsPerMin: [8, 30],
    zoomsPerMin: [2, 6],
    zoomScale: [1.15, 1.45],
    captionTemplate: "HORMOZI_BOUNCE",
    captionTemplatesOk: ["HORMOZI_BOUNCE", "MRBEAST_HYPE", "RAJ_SHAMANI_BOLD", "VARUN_MAYYA_BOX", "MUMBAI_BUBBLE"],
    brollPerMin: [2, 8],
    brollMaxShare: 0.4,
    musicDb: [-24, -16],
    sfxPerMin: [3, 12],
    pauseCutSec: 0.35,
  },
  craft: [
    "Something changes on screen at least every 3 s: a cut, a punch-in, B-roll, a title or a sticker.",
    "Hook in the first 1.5 s: open on the strongest line with a bold title and a punch-in.",
    "Cut every pause over 0.35 s and every filler; jump cuts are fine in this style.",
    "Word-by-word captions with a bright highlight on the key word; uppercase.",
    "Punch-ins (1.15-1.45x) on the punchline words; alternate tight and wide.",
    "B-roll for concrete nouns and numbers; whooshes on cutaways, pops on titles.",
  ],
  examples: [
    {
      input: "40 s talking head, 9:16, 'make it punchy'",
      ops: "removeSilences(0.35) + cleanFillers; autoCaptions(template HORMOZI_BOUNCE, highlight #FFE600, uppercase); addText hook title 0-2 s; addZoom ×3 on the punchlines (1.3x, 1.25x, 1.2x on the CTA); insertBroll ×2 on concrete nouns ('empty shop window', 'laptop sales dashboard'); addBackgroundMusic('upbeat hip hop', ducked, -20 dB); autoSoundDesign (whooshes on B-roll, pops on titles).",
    },
  ],
};

export const CALM_EDUCATIONAL: StylePlaybook = {
  id: "calm_educational",
  version: "1.0.0",
  label: "calm and clear (Ali Abdaal / Vox explainer)",
  matches: /\b(calm|clean|educational|explain\w*|tutorial|how[- ]to|lesson|ali abdaal|vox|minimal|subtle|professional|relaxed|chill)\b/i,
  targets: {
    maxStaticSec: 7,
    cutsPerMin: [2, 10],
    zoomsPerMin: [0.5, 2.5],
    zoomScale: [1.08, 1.25],
    captionTemplate: "ALI_ABDAAL_CLEAN",
    captionTemplatesOk: ["ALI_ABDAAL_CLEAN", "VOX_EXPLAINER", "DAN_KOE_MINIMAL", "KARAOKE_FROSTED"],
    brollPerMin: [1, 4],
    brollMaxShare: 0.3,
    musicDb: [-28, -20],
    sfxPerMin: [0, 3],
    pauseCutSec: 0.6,
  },
  craft: [
    "Clarity first: clean cuts that keep natural breathing room (cut pauses over 0.6 s, not every breath).",
    "Calm, readable captions (2-4 words, sentence case), never over faces or the thing being shown.",
    "Few, gentle zooms (1.08-1.25x) only where a detail must be seen; on screen recordings zoom onto the UI being used.",
    "Step titles or lower thirds for structure ('Step 1', a key number); B-roll or diagrams that explain, not decorate.",
    "Soft music well under the voice; almost no sound effects.",
  ],
  examples: [
    {
      input: "50 s 16:9 screen tutorial, 'clean this tutorial up and add captions'",
      ops: "removeSilences(0.6); cut the repeated explanation of step two (story pass); autoCaptions(template ALI_ABDAAL_CLEAN, position low, 3 words); addText 'Step 1/2/3' at each step for 2 s; addZoom ×2 (1.2x) onto the button being clicked; addBackgroundMusic('soft lo-fi', ducked, -24 dB).",
    },
  ],
};

export const CINEMATIC_VLOG: StylePlaybook = {
  id: "cinematic_vlog",
  version: "1.0.0",
  label: "cinematic vlog",
  matches: /\b(cinematic|vlog|travel|moody|film(ic)?|aesthetic|montage|b[- ]?roll heavy|story ?telling|day in (my|the) life)\b/i,
  targets: {
    maxStaticSec: 5,
    cutsPerMin: [6, 24],
    zoomsPerMin: [0, 1.5],
    zoomScale: [1.05, 1.2],
    captionTemplate: "CINEMATIC_SUBTITLE",
    captionTemplatesOk: ["CINEMATIC_SUBTITLE", "IMAN_GADZHI_LUXE", "DAN_KOE_MINIMAL", "ALI_ABDAAL_CLEAN"],
    brollPerMin: [0, 3],
    brollMaxShare: 0.25,
    musicDb: [-20, -12],
    sfxPerMin: [1, 6],
    pauseCutSec: 0.8,
  },
  craft: [
    "The creator's own footage IS the B-roll: keep the visual shots, do not cut silences that carry pictures.",
    "Music leads: a bed that fits the mood, cuts landing on the beat, the voice ducks it.",
    "Few or no zooms; slow, gentle ones only (1.05-1.2x).",
    "Small, elegant subtitles; a colour grade that ties the shots together.",
    "Ambient and transition sounds (whoosh, swell) on scene changes, not on every line.",
  ],
  examples: [
    {
      input: "40 s travel vlog, many handheld shots, little speech, 'make it a punchy travel vlog with music'",
      ops: "removeSilences(0.8) only where nothing visual happens; addBackgroundMusic('upbeat travel acoustic', ducked, -16 dB); cuts on the beat; autoCaptions(template CINEMATIC_SUBTITLE) on the voice lines; applyFilter warm film grade; addTransition crossfades between locations; autoSoundDesign (whooshes on scene changes).",
    },
  ],
};

export const PODCAST_CLIP: StylePlaybook = {
  id: "podcast_clip",
  version: "1.0.0",
  label: "podcast / interview clip",
  matches: /\b(podcast|interview|conversation|guest|host|two speakers|panel|q ?& ?a)\b/i,
  targets: {
    maxStaticSec: 6,
    cutsPerMin: [3, 14],
    zoomsPerMin: [1, 4],
    zoomScale: [1.1, 1.3],
    captionTemplate: "KARAOKE_FROSTED",
    captionTemplatesOk: ["KARAOKE_FROSTED", "HORMOZI_BOUNCE", "RAJ_SHAMANI_BOLD", "ALI_ABDAAL_CLEAN"],
    brollPerMin: [0, 2],
    brollMaxShare: 0.15,
    musicDb: [-30, -22],
    sfxPerMin: [0, 2],
    pauseCutSec: 0.5,
  },
  craft: [
    "Follow whoever is speaking (reframe track on 9:16); cut the gap between question and answer.",
    "Open on the guest's strongest line; never cut an answer mid-sentence.",
    "Bold karaoke captions; label speakers when it helps.",
    "Punch-ins on emotional or surprising lines (1.1-1.3x); little B-roll, the faces are the content.",
    "Music very low or none; no sound-effect clutter.",
  ],
  examples: [
    {
      input: "60 s two-speaker 16:9 interview, 'vertical clip for shorts with captions'",
      ops: "reframeSubject(9:16, mode track); removeSilences(0.5) on the question/answer gaps; autoCaptions(template KARAOKE_FROSTED); addZoom ×2 (1.2x) on the guest's punchlines; addText hook title from the guest's first line, 0-2 s.",
    },
  ],
};

export const STYLE_PLAYBOOKS: StylePlaybook[] = [FAST_HYPE, CALM_EDUCATIONAL, CINEMATIC_VLOG, PODCAST_CLIP];
