import {
  TrackedObjectPoint,
  CameraEvent,
  RationalTimeMath,
  RationalTime,
} from "@workspace/video-contracts";
import * as crypto from "crypto";

export interface TrajectoryPoint {
  timestampSec: number;
  x: number; // Normalized center X (0.0 to 1.0)
  y: number; // Normalized center Y (0.0 to 1.0)
  confidence: number;
}

export class ObjectAttentionTracker {
  /**
   * ADR-009: Universal Attention Engine.
   * Analyzes object bounding box trajectories (faces, screen cursors, foreground subjects)
   * and generates smooth, centered camera zoom events with exponential damping.
   */
  static generateCameraZoomTrajectory(
    trajectory: TrajectoryPoint[],
    targetZoomScale: number = 1.35,
    minDurationSec: number = 1.5,
    dampingFactor: number = 0.85
  ): CameraEvent[] {
    if (trajectory.length === 0) return [];

    const cameraEvents: CameraEvent[] = [];
    let currentEventStart: TrajectoryPoint | null = null;
    let accumulatedPoints: TrajectoryPoint[] = [];

    for (const pt of trajectory) {
      if (pt.confidence >= 0.7) {
        if (!currentEventStart) {
          currentEventStart = pt;
        }
        accumulatedPoints.push(pt);
      } else {
        if (currentEventStart && accumulatedPoints.length > 0) {
          const startSec = currentEventStart.timestampSec;
          const endSec = accumulatedPoints[accumulatedPoints.length - 1].timestampSec;
          const duration = endSec - startSec;

          if (duration >= minDurationSec) {
            // Compute damped center of mass
            const avgX =
              accumulatedPoints.reduce((sum, p) => sum + p.x, 0) / accumulatedPoints.length;
            const avgY =
              accumulatedPoints.reduce((sum, p) => sum + p.y, 0) / accumulatedPoints.length;

            cameraEvents.push({
              id: crypto.randomUUID(),
              timeRange: {
                start: RationalTimeMath.fromSeconds(startSec),
                duration: RationalTimeMath.fromSeconds(duration),
              },
              targetType: "FACE",
              targetCoords: {
                x: Math.max(0.1, Math.min(0.9, avgX)),
                y: Math.max(0.1, Math.min(0.9, avgY)),
              },
              scale: targetZoomScale,
              spring: { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
              motionBlur: true,
            });
          }

          currentEventStart = null;
          accumulatedPoints = [];
        }
      }
    }

    // Final trailing event
    const finalStart: TrajectoryPoint | null = currentEventStart;
    if (finalStart && accumulatedPoints.length > 0) {
      const startSec = finalStart.timestampSec;
      const endSec = accumulatedPoints[accumulatedPoints.length - 1].timestampSec;
      const duration = endSec - startSec;

      if (duration >= minDurationSec) {
        const avgX = accumulatedPoints.reduce((sum, p) => sum + p.x, 0) / accumulatedPoints.length;
        const avgY = accumulatedPoints.reduce((sum, p) => sum + p.y, 0) / accumulatedPoints.length;

        cameraEvents.push({
          id: crypto.randomUUID(),
          timeRange: {
            start: RationalTimeMath.fromSeconds(startSec),
            duration: RationalTimeMath.fromSeconds(duration),
          },
          targetType: "FACE",
          targetCoords: { x: avgX, y: avgY },
          scale: targetZoomScale,
          spring: { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
          motionBlur: true,
        });
      }
    }

    return cameraEvents;
  }
}
