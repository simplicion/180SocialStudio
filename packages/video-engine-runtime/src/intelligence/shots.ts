import { SceneDetector } from "./scenes";
import { ShotSegment } from "./types";

export class ShotAnalyzer {
  /**
   * Delegates to SceneDetector to produce discrete shot segments.
   */
  static async analyzeShots(mediaPath: string, durationSeconds: number): Promise<ShotSegment[]> {
    const res = await SceneDetector.detect(mediaPath, durationSeconds);
    return res.shots;
  }
}

export { SceneDetector };
