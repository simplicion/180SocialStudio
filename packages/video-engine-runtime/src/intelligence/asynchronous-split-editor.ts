import { VideoClip, AudioTrack, RationalTimeMath } from "@workspace/video-contracts";
import { CameraSwitchDecision } from "./multicam-director-engine";
import crypto from "crypto";

export interface SplitEditOutput {
  videoClips: VideoClip[];
  audioClips: any[];
  totalJCutLeadsMs: number;
  totalLCutTrailsMs: number;
  summary: string;
}

export class AsynchronousSplitEditor {
  /**
   * Compiles multi-cam switch decisions into asynchronous J-Cut and L-Cut clip nodes.
   * Unlinks audio and video edit points so audio leads incoming speakers by ~150ms
   * and dialogue trails over listener reaction shots by ~800ms.
   */
  static compileSplitEdits(
    switches: CameraSwitchDecision[],
    assetMap: Record<string, { filePath: string; durationSeconds: number }>
  ): SplitEditOutput {
    const videoClips: VideoClip[] = [];
    const audioClips: any[] = [];
    let totalJCutLeadsMs = 0;
    let totalLCutTrailsMs = 0;

    for (let i = 0; i < switches.length; i++) {
      const sw = switches[i];
      const asset = assetMap[sw.streamId] || { filePath: `stream_${sw.streamId}.mp4`, durationSeconds: sw.durationSec };

      // Calculate Video Clip Range
      const videoClip: VideoClip = {
        id: crypto.randomUUID(),
        assetId: sw.streamId,
        sourcePath: asset.filePath,
        sourceRange: {
          start: RationalTimeMath.fromSeconds(sw.startTimeSec),
          duration: RationalTimeMath.fromSeconds(sw.durationSec),
        },
        timelineRange: {
          start: RationalTimeMath.fromSeconds(sw.startTimeSec),
          duration: RationalTimeMath.fromSeconds(sw.durationSec),
        },
        transform: {
          scale: { start: 1.0, end: 1.0, easing: "linear" },
          position: { x: 0.0, y: 0.0 },
          anchor: { x: 0.5, y: 0.5 },
          rotationDeg: 0,
          opacity: 1.0,
        },
        speedMultiplier: 1.0,
        effects: [],
      };
      videoClips.push(videoClip);

      // Calculate Audio Clip Range (Asynchronous Split Edits)
      let audioStartSec = sw.startTimeSec;
      let audioDurSec = sw.durationSec;

      if (sw.cutType === "J_CUT_ANTICIPATION" && sw.audioLeadMs) {
        const leadSec = sw.audioLeadMs / 1000;
        audioStartSec = Math.max(0, sw.startTimeSec - leadSec);
        audioDurSec = sw.durationSec + leadSec;
        totalJCutLeadsMs += sw.audioLeadMs;
      } else if (sw.cutType === "L_CUT_REACTION" && sw.dialogueTrailMs) {
        const trailSec = sw.dialogueTrailMs / 1000;
        // In an L-cut, the previous speaker's audio continues over the listener
        audioDurSec = sw.durationSec + trailSec;
        totalLCutTrailsMs += sw.dialogueTrailMs;
      }

      audioClips.push({
        id: crypto.randomUUID(),
        assetId: sw.streamId,
        sourcePath: asset.filePath,
        sourceStart: sw.startTimeSec,
        timelineStart: audioStartSec,
        duration: audioDurSec,
        crossfadeMs: 25,
      });
    }

    const summary = `Compiled ${videoClips.length} video clips and ${audioClips.length} asynchronous split-audio nodes (${totalJCutLeadsMs}ms total J-cut anticipation lead, ${totalLCutTrailsMs}ms total L-cut dialogue trail).`;

    return {
      videoClips,
      audioClips,
      totalJCutLeadsMs,
      totalLCutTrailsMs,
      summary,
    };
  }
}
