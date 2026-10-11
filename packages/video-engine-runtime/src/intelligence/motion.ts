import { VisualActivitySegment, ShotSegment } from "./types";

export class MotionActivityAnalyzer {
  /**
   * Evaluates visual activity across the timeline by analyzing shot pace,
   * camera motion, and subject movement.
   * Produces normalized scores (0.0 to 1.0) to flag static talking-head spans vs dynamic segments.
   */
  static analyze(durationSeconds: number, shots: ShotSegment[]): {
    overallActivity: number;
    segments: VisualActivitySegment[];
  } {
    const segments: VisualActivitySegment[] = [];
    const windowSize = 5.0; // Evaluate in 5-second windows

    let totalScoreAccumulator = 0;
    let windowCount = 0;

    for (let t = 0; t < durationSeconds; t += windowSize) {
      const wEnd = Math.min(durationSeconds, t + windowSize);
      const wDur = wEnd - t;

      // Find shots intersecting this window
      const intersectingShots = shots.filter(
        (s) => Math.max(t, s.startSeconds) < Math.min(wEnd, s.endSeconds)
      );

      const shotCutCount = intersectingShots.length;
      // High cut rate increases activity
      const shotActivity = Math.min(1.0, (shotCutCount / (wDur / 2)) * 0.5);

      const avgMotion =
        intersectingShots.length > 0
          ? intersectingShots.reduce((acc, s) => acc + s.motionScore, 0) / intersectingShots.length
          : 0.3;

      const visualActivity = Math.min(1.0, Math.max(0.1, 0.4 * shotActivity + 0.6 * avgMotion));
      const isStaticTalkingHead = visualActivity < 0.35 && wDur >= 4.0;

      segments.push({
        startSeconds: parseFloat(t.toFixed(2)),
        endSeconds: parseFloat(wEnd.toFixed(2)),
        visualActivity: parseFloat(visualActivity.toFixed(2)),
        cameraMotion: avgMotion,
        subjectMotion: isStaticTalkingHead ? 0.2 : 0.6,
        isStaticTalkingHead,
      });

      totalScoreAccumulator += visualActivity;
      windowCount++;
    }

    const overallActivity = windowCount > 0 ? totalScoreAccumulator / windowCount : 0.5;

    return {
      overallActivity: parseFloat(overallActivity.toFixed(2)),
      segments,
    };
  }
}
