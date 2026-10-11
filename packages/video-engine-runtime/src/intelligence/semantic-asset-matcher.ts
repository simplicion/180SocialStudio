import { ClassifiedAsset, ProjectClassificationReport } from "./asset-classifier";
import { ResolvedDirectorStyle } from "@workspace/video-contracts";
import { TranscriptWord } from "./types";

export interface MatchedOverlayCue {
  id: string;
  assetId: string;
  sourcePath: string;
  type: "B_ROLL_CUTAWAY" | "SCREENCAST" | "BRAND_BADGE" | "GRAPHIC_STILL" | "SFX_CUE";
  startTimeSec: number;
  durationSec: number;
  position: {
    x: number; // 0..1 normalized
    y: number; // 0..1 normalized
    width?: number;
    height?: number;
  };
  transition: "fade" | "slide_up" | "spring_pop" | "cut";
  matchedKeywords: string[];
  rationale: string;
}

export interface SemanticMatchResult {
  cues: MatchedOverlayCue[];
  sfxCues: MatchedOverlayCue[];
  summary: string;
}

export class SemanticAssetMatcher {
  /**
   * Matches spoken dialogue events with supportive project assets (B-Roll, screencasts,
   * brand badges, SFX risers) based on semantic proximity, timeline rhythm, and platform safe zones.
   */
  static matchAssetsToTranscript(
    transcript: TranscriptWord[],
    report: ProjectClassificationReport,
    style: ResolvedDirectorStyle,
    totalDurationSec: number
  ): SemanticMatchResult {
    const cues: MatchedOverlayCue[] = [];
    const sfxCues: MatchedOverlayCue[] = [];

    if (!transcript || transcript.length === 0) {
      // If no transcript, distribute supportive assets evenly according to style rhythm
      let curTime = 2.0;
      for (const supp of report.supportiveAssets) {
        if (curTime + 2.5 <= totalDurationSec) {
          cues.push({
            id: `cue_${cues.length + 1}`,
            assetId: supp.asset.id,
            sourcePath: supp.asset.filePath,
            type: supp.semanticRole === "SCREENCAST" ? "SCREENCAST" : "B_ROLL_CUTAWAY",
            startTimeSec: curTime,
            durationSec: Math.min(3.0, totalDurationSec - curTime),
            position: { x: 0.5, y: 0.5, width: 1.0, height: 1.0 },
            transition: "fade",
            matchedKeywords: ["rhythm_distribution"],
            rationale: `Evenly spaced cutaway at ${curTime.toFixed(1)}s based on ${style.presetKey} rhythm`,
          });
          curTime += style.brollFrequencySeconds;
        }
      }
      return {
        cues,
        sfxCues,
        summary: `Distributed ${cues.length} cutaway cues across timeline.`,
      };
    }

    let lastCueEndTime = 0;
    const minSpacingSec = Math.max(3.0, style.brollFrequencySeconds * 0.6);

    // 1. Spoken Brand / Entity Matching (Logos & Badges)
    for (const graphic of report.graphicOverlays) {
      const cleanAssetName = graphic.asset.name.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, " ");
      const assetKeywords = cleanAssetName.split(/\s+/).filter((w) => w.length > 2);

      // Search transcript for keyword occurrences
      for (const tWord of transcript) {
        const wordClean = tWord.word.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
        const isMatch = assetKeywords.some((k) => wordClean.includes(k) || k.includes(wordClean));

        if (isMatch && tWord.startSeconds >= lastCueEndTime + 1.0 && tWord.startSeconds + 2.0 <= totalDurationSec) {
          const cueStart = Math.max(0, tWord.startSeconds - 0.2);
          const cueDuration = Math.min(3.0, totalDurationSec - cueStart);

          cues.push({
            id: `brand_cue_${cues.length + 1}`,
            assetId: graphic.asset.id,
            sourcePath: graphic.asset.filePath,
            type: "BRAND_BADGE",
            startTimeSec: cueStart,
            durationSec: cueDuration,
            position: {
              x: 0.5,
              y: style.targetAspect === "9:16" ? 0.22 : 0.18, // Placed cleanly in upper safe zone
            },
            transition: "spring_pop",
            matchedKeywords: [wordClean],
            rationale: `Spoken brand mention "${tWord.word}" at ${tWord.startSeconds.toFixed(1)}s triggers badge overlay`,
          });

          lastCueEndTime = cueStart + cueDuration;
          break; // Avoid duplicate placement for the same asset
        }
      }
    }

    // 2. B-Roll & Screencast Matching
    for (const broll of report.supportiveAssets) {
      const cleanAssetName = broll.asset.name.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, " ");
      const assetKeywords = cleanAssetName.split(/\s+/).filter((w) => w.length > 2);

      // Look for semantic overlap or emphasis peaks
      let bestMatchWord: TranscriptWord | null = null;
      for (const tWord of transcript) {
        const wordClean = tWord.word.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
        if (assetKeywords.some((k) => wordClean.includes(k) || k.includes(wordClean))) {
          bestMatchWord = tWord;
          break;
        }
      }

      // If no explicit word match, align with first available high-emphasis or rhythm slot
      if (!bestMatchWord) {
        const targetTime = lastCueEndTime + minSpacingSec;
        bestMatchWord = transcript.find((w) => w.startSeconds >= targetTime) || null;
      }

      if (bestMatchWord && bestMatchWord.startSeconds + 2.0 <= totalDurationSec) {
        const cueStart = bestMatchWord.startSeconds;
        const cueDuration = Math.min(3.5, totalDurationSec - cueStart);

        cues.push({
          id: `cutaway_cue_${cues.length + 1}`,
          assetId: broll.asset.id,
          sourcePath: broll.asset.filePath,
          type: broll.semanticRole === "SCREENCAST" ? "SCREENCAST" : "B_ROLL_CUTAWAY",
          startTimeSec: cueStart,
          durationSec: cueDuration,
          position: { x: 0.5, y: 0.5, width: 1.0, height: 1.0 },
          transition: "fade",
          matchedKeywords: [bestMatchWord.word],
          rationale: `Contextual cutaway aligned with dialogue phrase "${bestMatchWord.word}" at ${cueStart.toFixed(1)}s`,
        });

        lastCueEndTime = cueStart + cueDuration;
      }
    }

    // 3. Sound Effect Transient Punctuation (Whooshes / Pops on visual entries)
    if (style.soundDesignEnabled && report.sfxTracks.length > 0) {
      for (const cue of cues) {
        const sfx = report.sfxTracks[sfxCues.length % report.sfxTracks.length];
        sfxCues.push({
          id: `sfx_cue_${sfxCues.length + 1}`,
          assetId: sfx.asset.id,
          sourcePath: sfx.asset.filePath,
          type: "SFX_CUE",
          startTimeSec: Math.max(0, cue.startTimeSec - 0.08), // Pre-roll whoosh 80ms before visual entry
          durationSec: Math.min(sfx.asset.durationSeconds || 1.2, 2.0),
          position: { x: 0, y: 0 },
          transition: "cut",
          matchedKeywords: cue.matchedKeywords,
          rationale: `Punctuation sound effect on visual cue entry (${cue.type}) at ${cue.startTimeSec.toFixed(1)}s`,
        });
      }
    }

    const summary = `Semantic matching resolved ${cues.length} visual overlay cues (${cues.filter((c) => c.type === "BRAND_BADGE").length} brand badges, ${cues.filter((c) => c.type === "B_ROLL_CUTAWAY" || c.type === "SCREENCAST").length} B-roll cutaways) and ${sfxCues.length} synchronized SFX punctuation cues.`;

    return {
      cues,
      sfxCues,
      summary,
    };
  }
}
