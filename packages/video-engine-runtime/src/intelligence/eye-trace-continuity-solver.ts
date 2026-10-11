export interface FocalPoint {
  x: number; // 0.0 to 1.0 normalized
  y: number; // 0.0 to 1.0 normalized
  confidence: number;
  subjectType: "FACE" | "OBJECT" | "GRAPHIC";
}

export interface CutBoundary {
  cutTimestampSec: number;
  outgoingFocalPoint: FocalPoint;
  incomingFocalPoint: FocalPoint;
}

export interface EyeTraceCorrection {
  cutTimestampSec: number;
  rawDriftPercent: number;
  requiresCorrection: boolean;
  correctiveOffset: {
    x: number; // Normalized pan adjustment
    y: number; // Normalized tilt adjustment
  };
  correctedFocalPoint: FocalPoint;
  rationale: string;
}

export interface EyeTraceAnalysisReport {
  totalCutsAnalyzed: number;
  cutsWithIdealContinuity: number;
  cutsCorrected: number;
  averageDriftPercent: number;
  corrections: EyeTraceCorrection[];
  summary: string;
}

export class EyeTraceContinuitySolver {
  private static readonly MAX_PERMISSIBLE_SACCADIC_DRIFT = 0.08; // 8% of frame dimension

  /**
   * Evaluates saccadic eye-trace across cut boundaries and computes corrective
   * spatial framing translations to keep the viewer's gaze anchored effortlessly.
   */
  static solveContinuity(cutBoundaries: CutBoundary[]): EyeTraceAnalysisReport {
    const corrections: EyeTraceCorrection[] = [];
    let totalDrift = 0;
    let idealCount = 0;
    let correctedCount = 0;

    for (const b of cutBoundaries) {
      const dx = b.incomingFocalPoint.x - b.outgoingFocalPoint.x;
      const dy = b.incomingFocalPoint.y - b.outgoingFocalPoint.y;
      const drift = Math.sqrt(dx * dx + dy * dy);
      totalDrift += drift;

      if (drift <= this.MAX_PERMISSIBLE_SACCADIC_DRIFT) {
        idealCount++;
        corrections.push({
          cutTimestampSec: b.cutTimestampSec,
          rawDriftPercent: Math.round(drift * 100),
          requiresCorrection: false,
          correctiveOffset: { x: 0, y: 0 },
          correctedFocalPoint: { ...b.incomingFocalPoint },
          rationale: `Natural saccadic alignment: focal drift is only ${(drift * 100).toFixed(1)}% (within 8% limit)`,
        });
      } else {
        correctedCount++;
        // Calculate framing pan to bring incoming focal point within 6% of outgoing
        const targetX = b.outgoingFocalPoint.x + Math.sign(dx) * 0.05;
        const targetY = b.outgoingFocalPoint.y + Math.sign(dy) * 0.05;
        const offsetX = targetX - b.incomingFocalPoint.x;
        const offsetY = targetY - b.incomingFocalPoint.y;

        corrections.push({
          cutTimestampSec: b.cutTimestampSec,
          rawDriftPercent: Math.round(drift * 100),
          requiresCorrection: true,
          correctiveOffset: {
            x: Math.round(offsetX * 1000) / 1000,
            y: Math.round(offsetY * 1000) / 1000,
          },
          correctedFocalPoint: {
            x: b.incomingFocalPoint.x + offsetX,
            y: b.incomingFocalPoint.y + offsetY,
            confidence: b.incomingFocalPoint.confidence,
            subjectType: b.incomingFocalPoint.subjectType,
          },
          rationale: `Saccadic drift of ${(drift * 100).toFixed(1)}% exceeded 8% threshold. Applied ${Math.round(offsetX * 100)}% pan offset for eye-trace continuity.`,
        });
      }
    }

    const avgDrift = cutBoundaries.length > 0 ? Math.round((totalDrift / cutBoundaries.length) * 100) : 0;
    const summary = `Eye-Trace Analysis: Analyzed ${cutBoundaries.length} cuts (Average drift: ${avgDrift}%). ${idealCount} naturally aligned, ${correctedCount} corrected for seamless visual continuity.`;

    return {
      totalCutsAnalyzed: cutBoundaries.length,
      cutsWithIdealContinuity: idealCount,
      cutsCorrected: correctedCount,
      averageDriftPercent: avgDrift,
      corrections,
      summary,
    };
  }
}
