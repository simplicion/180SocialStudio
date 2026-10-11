import ffmpeg from "../ffmpeg-setup";
import * as fs from "fs";
import { ShotSegment, SceneSegment } from "./types";
import * as crypto from "crypto";

export class SceneDetector {
  /**
   * Executes FFmpeg scene change detection to discover visual cut boundaries.
   * Converts detected cuts into discrete ShotSegments and groups them into SceneSegments.
   */
  static async detect(mediaPath: string, totalDurationSeconds: number): Promise<{
    shots: ShotSegment[];
    scenes: SceneSegment[];
  }> {
    if (!fs.existsSync(mediaPath)) {
      return { shots: [], scenes: [] };
    }

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
              // Deduplicate cuts closer than 0.5s
              const lastCut = cutTimestamps[cutTimestamps.length - 1];
              if (time - lastCut >= 0.5) {
                cutTimestamps.push(parseFloat(time.toFixed(3)));
              }
            }
          }
        })
        .on("end", () => resolve())
        .on("error", () => resolve()) // Fallback gracefully
        .run();
    });

    cutTimestamps.push(parseFloat(totalDurationSeconds.toFixed(3)));

    const shots: ShotSegment[] = [];
    for (let i = 0; i < cutTimestamps.length - 1; i++) {
      const start = cutTimestamps[i];
      const end = cutTimestamps[i + 1];
      const duration = end - start;

      // Estimate shot type and activity from duration and cut density
      const shotType = duration < 3.0 ? "CLOSE_UP" : duration < 7.0 ? "MEDIUM_SHOT" : "WIDE_SHOT";
      const visualActivity = Math.min(1.0, 0.4 + (1.0 / Math.max(1, duration)) * 0.4);

      shots.push({
        id: `shot_${i}_${crypto.randomUUID().slice(0, 6)}`,
        startSeconds: start,
        endSeconds: end,
        shotType,
        visualActivity: parseFloat(visualActivity.toFixed(2)),
        cameraMovement: duration > 8.0 ? "STATIC" : "PAN",
        dominantSubjects: ["primary_subject"],
        brightness: 0.6,
        motionScore: parseFloat(visualActivity.toFixed(2)),
        transitionScore: i === 0 ? 1.0 : 0.85,
        semanticSummary: `Shot ${i + 1}: ${shotType.toLowerCase().replace("_", " ")} (${duration.toFixed(1)}s)`,
      });
    }

    // Group shots into scenes (e.g. cluster every 15-30s or major visual shifts)
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
          topic: `Scene ${scenes.length + 1}`,
          visualSummary: `${curSceneShots.length} shots spanning ${(shot.endSeconds - curSceneStart).toFixed(1)}s`,
        });
        curSceneStart = shot.endSeconds;
        curSceneShots = [];
      }
    }

    return { shots, scenes };
  }
}
