import ffmpeg from "./ffmpeg-setup";
import * as crypto from "crypto";
import type { ShotSegment, SceneSegment } from "@workspace/video-contracts";

/**
 * Real ffmpeg-based scene-cut detection, generalized from
 * packages/video-engine-runtime/src/intelligence/scenes.ts.
 *
 * Unlike that version, this does NOT fabricate shotType/brightness/dominantSubjects/
 * motionScore/transitionScore from duration heuristics — those fields are left unset
 * so MediaIntelligenceGraphSchema's honest defaults (e.g. shotType: "UNKNOWN") apply
 * instead of a confident-looking but invented classification.
 */
export class SceneDetector {
  static async detect(
    mediaPath: string,
    totalDurationSeconds: number
  ): Promise<{ shots: ShotSegment[]; scenes: SceneSegment[] }> {
    const cutTimestamps: number[] = [0];

    await new Promise<void>((resolve) => {
      ffmpeg(mediaPath)
        .videoFilters("select='gt(scene,0.35)',showinfo")
        .format("null")
        .output("-")
        .on("stderr", (line: string) => {
          const ptsMatch = line.match(/pts_time:([0-9.]+)/);
          if (ptsMatch) {
            const time = parseFloat(ptsMatch[1]);
            if (time > 0.4 && time < totalDurationSeconds - 0.3) {
              const lastCut = cutTimestamps[cutTimestamps.length - 1];
              if (time - lastCut >= 0.5) {
                cutTimestamps.push(parseFloat(time.toFixed(3)));
              }
            }
          }
        })
        .on("end", () => resolve())
        .on("error", () => resolve()) // No scene-cut data is safer than throwing mid-plan
        .run();
    });

    cutTimestamps.push(parseFloat(totalDurationSeconds.toFixed(3)));

    const shots: ShotSegment[] = [];
    for (let i = 0; i < cutTimestamps.length - 1; i++) {
      const start = cutTimestamps[i];
      const end = cutTimestamps[i + 1];
      if (end <= start) continue;
      shots.push({
        id: `shot_${i}_${crypto.randomUUID().slice(0, 6)}`,
        startSeconds: start,
        endSeconds: end,
      } as ShotSegment);
    }

    const scenes: SceneSegment[] = [];
    let curSceneShots: ShotSegment[] = [];
    let curSceneStart = 0;

    for (const shot of shots) {
      curSceneShots.push(shot);
      if (shot.endSeconds - curSceneStart >= 20 || shot === shots[shots.length - 1]) {
        scenes.push({
          id: `scene_${scenes.length}_${crypto.randomUUID().slice(0, 6)}`,
          startSeconds: curSceneStart,
          endSeconds: shot.endSeconds,
          shots: [...curSceneShots],
        } as SceneSegment);
        curSceneStart = shot.endSeconds;
        curSceneShots = [];
      }
    }

    return { shots, scenes };
  }
}
