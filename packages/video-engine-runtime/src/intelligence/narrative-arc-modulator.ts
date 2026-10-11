export type NarrativePhaseType =
  | "HOOK"
  | "CONTEXT_EXPANSION"
  | "ESCALATION_CONFLICT"
  | "CLIMAX_EPIPHANY"
  | "RESOLUTION_AUTHORITY";

export interface NarrativePhaseSegment {
  phase: NarrativePhaseType;
  startTimeSec: number;
  endTimeSec: number;
  durationSec: number;
  pacingMultiplier: number;
  targetCutFrequencySec: number;
  cameraZoomScale: number;
  brollDensity: "HIGH" | "MEDIUM" | "LOW";
  audioTensionScore: number; // 0.0 to 1.0
  subDropEnabled: boolean;
  editorialDirective: string;
}

export interface NarrativeArcPlan {
  totalDurationSec: number;
  phases: NarrativePhaseSegment[];
  summary: string;
}

export class NarrativeArcModulator {
  /**
   * Modulates cognitive pacing, cut frequency, camera dynamism, and acoustic tension
   * across 5 classical storytelling phases to prevent viewer fatigue and maximize retention.
   */
  static modulateArc(totalDurationSec: number): NarrativeArcPlan {
    const hookEnd = Math.min(Math.max(3.0, totalDurationSec * 0.08), 15.0);
    const contextEnd = hookEnd + Math.max(5.0, totalDurationSec * 0.17);
    const escalationEnd = contextEnd + Math.max(10.0, totalDurationSec * 0.50);
    const climaxEnd = escalationEnd + Math.max(5.0, totalDurationSec * 0.15);
    const resolutionEnd = totalDurationSec;

    const phases: NarrativePhaseSegment[] = [
      // 1. Hook (High energy, immediate curiosity gap)
      {
        phase: "HOOK",
        startTimeSec: 0,
        endTimeSec: hookEnd,
        durationSec: hookEnd,
        pacingMultiplier: 1.35,
        targetCutFrequencySec: 2.2,
        cameraZoomScale: 1.30,
        brollDensity: "HIGH",
        audioTensionScore: 0.85,
        subDropEnabled: true,
        editorialDirective: "High cognitive density, fast visual hooks, tight punchy captions, immediate stakes.",
      },
      // 2. Context Expansion (Calm breathing room, setting the premise)
      {
        phase: "CONTEXT_EXPANSION",
        startTimeSec: hookEnd,
        endTimeSec: contextEnd,
        durationSec: contextEnd - hookEnd,
        pacingMultiplier: 0.95,
        targetCutFrequencySec: 5.5,
        cameraZoomScale: 1.12,
        brollDensity: "LOW",
        audioTensionScore: 0.35,
        subDropEnabled: false,
        editorialDirective: "Wide breathing room, relaxed cut cadence, clear premise articulation, clean typography.",
      },
      // 3. Escalation & Conflict (Alternating thesis & proof points)
      {
        phase: "ESCALATION_CONFLICT",
        startTimeSec: contextEnd,
        endTimeSec: escalationEnd,
        durationSec: escalationEnd - contextEnd,
        pacingMultiplier: 1.20,
        targetCutFrequencySec: 3.5,
        cameraZoomScale: 1.22,
        brollDensity: "MEDIUM",
        audioTensionScore: 0.70,
        subDropEnabled: true,
        editorialDirective: "Alternating A-roll and B-roll proof points, rising musical tension, rhythmic zooms.",
      },
      // 4. Climax & Epiphany (Peak emotional/intellectual payoff)
      {
        phase: "CLIMAX_EPIPHANY",
        startTimeSec: escalationEnd,
        endTimeSec: climaxEnd,
        durationSec: climaxEnd - escalationEnd,
        pacingMultiplier: 1.40,
        targetCutFrequencySec: 2.0,
        cameraZoomScale: 1.35,
        brollDensity: "HIGH",
        audioTensionScore: 1.0,
        subDropEnabled: true,
        editorialDirective: "Peak visual and sonic crescendo, high-contrast karaoke highlights, punchy emphasis.",
      },
      // 5. Resolution & Authority (Harmonious takeaway and closing call to action)
      {
        phase: "RESOLUTION_AUTHORITY",
        startTimeSec: climaxEnd,
        endTimeSec: resolutionEnd,
        durationSec: resolutionEnd - climaxEnd,
        pacingMultiplier: 1.0,
        targetCutFrequencySec: 4.5,
        cameraZoomScale: 1.15,
        brollDensity: "LOW",
        audioTensionScore: 0.40,
        subDropEnabled: false,
        editorialDirective: "Harmonious resolution, calm grounding authority, clean final CTA badge placement.",
      },
    ];

    const summary = `Narrative Arc Modulation: Structured ${totalDurationSec.toFixed(1)}s into 5 cognitive phases (Hook: ${hookEnd.toFixed(1)}s, Context: ${(contextEnd - hookEnd).toFixed(1)}s, Escalation: ${(escalationEnd - contextEnd).toFixed(1)}s, Climax: ${(climaxEnd - escalationEnd).toFixed(1)}s, Resolution: ${(resolutionEnd - climaxEnd).toFixed(1)}s).`;

    return {
      totalDurationSec,
      phases,
      summary,
    };
  }
}
