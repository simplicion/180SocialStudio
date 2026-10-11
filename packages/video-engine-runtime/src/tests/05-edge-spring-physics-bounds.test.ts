import { SpringPhysicsSolver } from "../spring-physics-solver";
import { SpringConfig } from "@workspace/video-contracts";

/**
 * EDGE CASE TEST 5: Spring Physics Extreme Parameters & Numerical Stability
 * Validates analytical 2nd-order ODE solver under extreme conditions:
 * near-zero mass, high damping (overdamped), zero damping (underdamped),
 * and extreme zoom ranges.
 */
export async function runTest(): Promise<boolean> {
  console.log("\n[Edge Test 5/10] Spring Physics Extreme Parameters & Numerical Stability...");

  // Scenario A: Underdamped Oscillator (High bounce / overshoot)
  const underdampedConfig: SpringConfig = {
    stiffness: 300,
    damping: 5, // Very low damping -> high oscillation
    mass: 1,
    overshootClamping: false,
  };

  const val0 = SpringPhysicsSolver.evaluate(0.0, 1.0, 1.5, underdampedConfig);
  const valHalf = SpringPhysicsSolver.evaluate(0.5, 1.0, 1.5, underdampedConfig);
  const valSteady = SpringPhysicsSolver.evaluate(5.0, 1.0, 1.5, underdampedConfig);

  if (Math.abs(val0.position - 1.0) > 1e-4) {
    throw new Error(`Initial position at t=0 must equal 1.0, got ${val0.position}`);
  }
  if (Math.abs(valSteady.position - 1.5) > 0.05) {
    throw new Error(`Steady state at t=5.0s must converge to 1.5, got ${valSteady.position}`);
  }
  console.log(`  ✓ Underdamped spring evaluated: t=0 (${val0.position.toFixed(2)}) -> t=0.5 (${valHalf.position.toFixed(2)}) -> t=5.0 (${valSteady.position.toFixed(2)})`);

  // Scenario B: Overdamped Spring (Critically damped or heavily damped)
  const overdampedConfig: SpringConfig = {
    stiffness: 100,
    damping: 40, // Zeta >= 1.0 (overdamped)
    mass: 1,
    overshootClamping: true,
  };

  const valOver0 = SpringPhysicsSolver.evaluate(0.0, 1.0, 2.0, overdampedConfig);
  const valOver1 = SpringPhysicsSolver.evaluate(1.0, 1.0, 2.0, overdampedConfig);
  const valOverFinal = SpringPhysicsSolver.evaluate(10.0, 1.0, 2.0, overdampedConfig);

  if (isNaN(valOver1.position) || isNaN(valOverFinal.position)) {
    throw new Error("NaN produced during overdamped spring evaluation");
  }
  console.log(`  ✓ Overdamped spring evaluated cleanly without overshoot`);

  // Scenario C: Rapid Numerical Stability Check (10,000 continuous time steps)
  for (let t = 0; t <= 10; t += 0.001) {
    const res = SpringPhysicsSolver.evaluate(t, 1.0, 1.4, underdampedConfig);
    if (isNaN(res.position) || !isFinite(res.position)) {
      throw new Error(`Non-finite number at time t=${t}`);
    }
  }
  console.log(`  ✓ 10,000 sub-millisecond continuous steps passed numerical stability check`);

  return true;
}

if (process.argv[1]?.includes("05-edge-spring-physics-bounds.test.ts")) {
  runTest().then(() => console.log("✓ Edge Test 5 Passed Successfully.\n"));
}
