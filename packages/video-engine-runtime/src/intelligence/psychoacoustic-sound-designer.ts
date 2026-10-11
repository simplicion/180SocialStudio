export interface AudioStemLayer {
  layerId: string;
  name: string;
  type: "DIALOGUE" | "ROOM_TONE" | "BGM_POCKETED" | "FOLEY_TRANSIENT" | "SUB_BASS_DROP";
  baseVolumeDb: number;
  duckWithSpeech: boolean;
  duckingDb?: number;
  eqFilters: string[];
  transientCues: Array<{
    timestampSec: number;
    durationSec: number;
    type: "WHOOSH" | "SUB_DROP" | "UI_POP";
    gainDb: number;
  }>;
  rationale: string;
}

export interface PsychoacousticSoundStage {
  layers: AudioStemLayer[];
  integratedLoudnessTargetLufs: number;
  frequencyPocketRangeHz: { low: number; high: number };
  roomToneFloorDb: number;
  totalTransientTriggers: number;
  summary: string;
}

export class PsychoacousticSoundDesigner {
  /**
   * Constructs the broadcast 4-layer psychoacoustic sound stage with vocal presence EQ,
   * continuous room tone acoustic floor, frequency-pocketed sidechained BGM, and sub-bass transients.
   */
  static designSoundStage(
    totalDurationSec: number,
    highEmphasisMoments: number[] = [],
    visualTransitionMoments: number[] = []
  ): PsychoacousticSoundStage {
    const foleyTransients: Array<{ timestampSec: number; durationSec: number; type: "WHOOSH" | "SUB_DROP" | "UI_POP"; gainDb: number }> = [];

    // 1. Sub-Bass Drops (50Hz) under high-emphasis thesis moments
    for (const ts of highEmphasisMoments) {
      if (ts > 0.5 && ts + 1.5 <= totalDurationSec) {
        foleyTransients.push({
          timestampSec: ts,
          durationSec: 1.2,
          type: "SUB_DROP",
          gainDb: -6.0,
        });
      }
    }

    // 2. Organic Whoosh Risers pre-rolled 80ms before visual transitions
    for (const ts of visualTransitionMoments) {
      if (ts > 0.2 && ts + 0.8 <= totalDurationSec) {
        foleyTransients.push({
          timestampSec: Math.max(0, ts - 0.08),
          durationSec: 0.8,
          type: "WHOOSH",
          gainDb: -12.0,
        });
      }
    }

    const layers: AudioStemLayer[] = [
      // Layer 1: Primary Dialogue (Presence + De-esser)
      {
        layerId: "audio_layer_1_dialogue",
        name: "Dialogue Master Presence",
        type: "DIALOGUE",
        baseVolumeDb: 0.0,
        duckWithSpeech: false,
        eqFilters: [
          "highpass=f=80",
          "equalizer=f=3000:t=q:w=1.5:g=2.5", // Presence boost
          "equalizer=f=7200:t=q:w=2.0:g=-3.0", // Sibilance control
        ],
        transientCues: [],
        rationale: "Clean high-presence vocal clarity with 80Hz rumble cut and 3kHz intelligibility boost",
      },
      // Layer 2: Room Tone Acoustic Floor
      {
        layerId: "audio_layer_2_room_tone",
        name: "Continuous Room Tone Bed",
        type: "ROOM_TONE",
        baseVolumeDb: -44.0,
        duckWithSpeech: false,
        eqFilters: ["lowpass=f=4000", "highpass=f=120"],
        transientCues: [],
        rationale: "Maintains -44dB acoustic bed to prevent unnatural digital silence dropouts between cuts",
      },
      // Layer 3: Frequency-Pocketed BGM
      {
        layerId: "audio_layer_3_bgm",
        name: "Frequency-Pocketed Music Bed",
        type: "BGM_POCKETED",
        baseVolumeDb: -14.0,
        duckWithSpeech: true,
        duckingDb: -18.0,
        eqFilters: [
          "equalizer=f=2200:t=q:w=2.0:g=-4.0", // Frequency pocket for human voice
          "highpass=f=60",
        ],
        transientCues: [],
        rationale: "Music notched at 2.2kHz and sidechain-ducked by -18dB so vocals never fight instruments",
      },
      // Layer 4: Micro-Foley & Sub-Drops
      {
        layerId: "audio_layer_4_foley",
        name: "Psychoacoustic Transients & Sub-Drops",
        type: "FOLEY_TRANSIENT",
        baseVolumeDb: 0.0,
        duckWithSpeech: false,
        eqFilters: [],
        transientCues: foleyTransients,
        rationale: "Visceral sub-bass drops on thesis statements and pre-rolled whoosh risers on visual cuts",
      },
    ];

    const summary = `Psychoacoustic Stage: Built 4-layer audio architecture with -16 LUFS vocal target, 2.2kHz BGM pocketing, -44dB room tone floor, and ${foleyTransients.length} synchronized psychoacoustic transient cues.`;

    return {
      layers,
      integratedLoudnessTargetLufs: -16.0,
      frequencyPocketRangeHz: { low: 1500, high: 3200 },
      roomToneFloorDb: -44.0,
      totalTransientTriggers: foleyTransients.length,
      summary,
    };
  }
}
