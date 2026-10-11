import assert from "node:assert";
import {
  EyeTraceContinuitySolver,
  CutBoundary,
} from "../intelligence/eye-trace-continuity-solver";
import { NarrativeArcModulator } from "../intelligence/narrative-arc-modulator";

export async function runTest() {
  // 1. Eye-Trace Continuity Test
  const mockCutBoundaries: CutBoundary[] = [
    // Cut 1: Natural alignment (Drift < 8%)
    {
      cutTimestampSec: 3.5,
      outgoingFocalPoint: { x: 0.50, y: 0.38, confidence: 0.95, subjectType: "FACE" },
      incomingFocalPoint: { x: 0.52, y: 0.40, confidence: 0.92, subjectType: "FACE" },
    },
    // Cut 2: Extreme drift (Drift = 35% -> Requires corrective pan translation)
    {
      cutTimestampSec: 7.2,
      outgoingFocalPoint: { x: 0.25, y: 0.35, confidence: 0.90, subjectType: "FACE" },
      incomingFocalPoint: { x: 0.60, y: 0.35, confidence: 0.94, subjectType: "FACE" },
    },
  ];

  const eyeReport = EyeTraceContinuitySolver.solveContinuity(mockCutBoundaries);

  assert.strictEqual(eyeReport.totalCutsAnalyzed, 2);
  assert.strictEqual(eyeReport.cutsWithIdealContinuity, 1);
  assert.strictEqual(eyeReport.cutsCorrected, 1);
  assert.ok(eyeReport.corrections[1].requiresCorrection, "Extreme drift cut must be corrected");
  assert.ok(eyeReport.corrections[1].correctiveOffset.x !== 0, "Pan offset must be non-zero");

  // 2. Narrative Arc Modulation Test
  const arcPlan = NarrativeArcModulator.modulateArc(600.0); // 10 minute video

  assert.strictEqual(arcPlan.phases.length, 5, "Must contain exactly 5 narrative phases");
  assert.strictEqual(arcPlan.phases[0].phase, "HOOK");
  assert.strictEqual(arcPlan.phases[0].pacingMultiplier, 1.35);
  assert.strictEqual(arcPlan.phases[1].phase, "CONTEXT_EXPANSION");
  assert.strictEqual(arcPlan.phases[1].pacingMultiplier, 0.95);
  assert.strictEqual(arcPlan.phases[3].phase, "CLIMAX_EPIPHANY");
  assert.strictEqual(arcPlan.phases[3].pacingMultiplier, 1.40);
  assert.strictEqual(arcPlan.phases[4].phase, "RESOLUTION_AUTHORITY");

  console.log("  ✔ Test 24 Passed: Saccadic Eye-Trace Continuity Solver & 5-Phase Narrative Arc Modulator.");
}
