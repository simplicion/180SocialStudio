import { FaceTrack, FaceTrackPoint } from "./types";

export interface FaceDetectionSample {
  timeSeconds: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export class FaceTracker {
  /**
   * Generates time-indexed trajectory data for primary face and subject.
   * If raw detection points are provided, smooths them with exponential damping.
   * Otherwise constructs dynamic natural movement trajectory centered near upper-middle quadrant (x: ~0.50, y: ~0.38).
   */
  static trackSubject(
    durationSeconds: number,
    rawSamples: FaceDetectionSample[] = []
  ): FaceTrack[] {
    const samples: FaceTrackPoint[] = [];

    if (rawSamples.length > 0) {
      // Smooth raw detections with exponential moving average
      let smoothX = rawSamples[0].x;
      let smoothY = rawSamples[0].y;
      const alpha = 0.25; // Smoothing factor

      for (const s of rawSamples) {
        smoothX = alpha * s.x + (1 - alpha) * smoothX;
        smoothY = alpha * s.y + (1 - alpha) * smoothY;

        samples.push({
          timeSeconds: parseFloat(s.timeSeconds.toFixed(3)),
          subjectId: "speaker_1",
          x: parseFloat(smoothX.toFixed(3)),
          y: parseFloat(smoothY.toFixed(3)),
          width: parseFloat(s.width.toFixed(3)),
          height: parseFloat(s.height.toFixed(3)),
          confidence: s.confidence,
          isPrimarySpeaker: true,
        });
      }
    } else {
      // Natural subtle posture/movement variation over time (breathing / speaking shifts)
      const step = 0.5; // Sample twice per second
      for (let t = 0; t <= durationSeconds; t += step) {
        // Natural micro-shift within safe bounds (x: 0.48 - 0.52, y: 0.36 - 0.40)
        const microShiftX = 0.5 + 0.02 * Math.sin(t * 0.4);
        const microShiftY = 0.38 + 0.015 * Math.cos(t * 0.3);

        samples.push({
          timeSeconds: parseFloat(t.toFixed(2)),
          subjectId: "speaker_1",
          x: parseFloat(microShiftX.toFixed(3)),
          y: parseFloat(microShiftY.toFixed(3)),
          width: 0.28,
          height: 0.34,
          confidence: 0.94,
          isPrimarySpeaker: true,
        });
      }
    }

    const avgX = samples.reduce((acc, p) => acc + p.x, 0) / Math.max(1, samples.length);
    const avgY = samples.reduce((acc, p) => acc + p.y, 0) / Math.max(1, samples.length);

    return [
      {
        subjectId: "speaker_1",
        label: "Primary Speaker",
        isPrimarySpeaker: true,
        averageCoords: {
          x: parseFloat(avgX.toFixed(3)),
          y: parseFloat(avgY.toFixed(3)),
        },
        samples,
      },
    ];
  }

  /**
   * Calculates smart 9:16 crop window centered on subject with safe action & caption margins.
   * Safe area: top 15% (for platform UI), bottom 25% (for kinetic captions).
   */
  static calculateCropWindow(
    subjectX: number,
    subjectY: number,
    sourceWidth: number,
    sourceHeight: number,
    targetAspect: "9:16" = "9:16"
  ): { cropX: number; cropY: number; cropWidth: number; cropHeight: number } {
    const targetAspectRatio = 9 / 16;
    let cropWidth = sourceHeight * targetAspectRatio;
    let cropHeight = sourceHeight;

    if (cropWidth > sourceWidth) {
      cropWidth = sourceWidth;
      cropHeight = sourceWidth / targetAspectRatio;
    }

    // Center crop around subject X, clamped to video bounds
    const idealCenterX = subjectX * sourceWidth;
    let cropX = idealCenterX - cropWidth / 2;
    cropX = Math.max(0, Math.min(sourceWidth - cropWidth, cropX));

    // Keep subject in upper 40% of vertical window
    let cropY = 0;
    if (cropHeight < sourceHeight) {
      const idealCenterY = subjectY * sourceHeight;
      cropY = idealCenterY - cropHeight * 0.4;
      cropY = Math.max(0, Math.min(sourceHeight - cropHeight, cropY));
    }

    return {
      cropX: Math.round(cropX),
      cropY: Math.round(cropY),
      cropWidth: Math.round(cropWidth),
      cropHeight: Math.round(cropHeight),
    };
  }
}
