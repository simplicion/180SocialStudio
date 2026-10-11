import { SpringConfig } from "@workspace/video-contracts";

export interface SpringState {
  position: number;
  velocity: number;
}

export class SpringPhysicsSolver {
  /**
   * Solves an analytical 2nd-order damped harmonic oscillator differential equation:
   *   m * x''(t) + c * x'(t) + k * (x(t) - target) = 0
   *
   * Provides exact, deterministic position and velocity at any arbitrary time `t` (in seconds)
   * without numerical Euler instability or frame-rate dependency.
   */
  static evaluate(
    t: number, // Elapsed time in seconds since spring start
    from: number,
    to: number,
    config: SpringConfig = { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
    initialVelocity: number = 0
  ): SpringState {
    if (t <= 0) {
      return { position: from, velocity: initialVelocity };
    }

    const { stiffness: k, damping: c, mass: m, overshootClamping } = config;
    const x0 = from - to; // Offset from equilibrium
    const v0 = initialVelocity;

    const w0 = Math.sqrt(k / m); // Natural undamped angular frequency
    const zeta = c / (2 * Math.sqrt(k * m)); // Damping ratio

    let position = 0;
    let velocity = 0;

    if (zeta < 1.0) {
      // 1. Underdamped (Oscillatory bounce)
      const wd = w0 * Math.sqrt(1 - zeta * zeta); // Damped frequency
      const decay = Math.exp(-zeta * w0 * t);
      const A = x0;
      const B = (v0 + zeta * w0 * x0) / wd;

      position = to + decay * (A * Math.cos(wd * t) + B * Math.sin(wd * t));
      velocity =
        decay *
        (-zeta * w0 * (A * Math.cos(wd * t) + B * Math.sin(wd * t)) +
          wd * (-A * Math.sin(wd * t) + B * Math.cos(wd * t)));
    } else if (Math.abs(zeta - 1.0) < 1e-5) {
      // 2. Critically Damped (Fastest convergence without overshoot)
      const decay = Math.exp(-w0 * t);
      const A = x0;
      const B = v0 + w0 * x0;

      position = to + decay * (A + B * t);
      velocity = decay * (B - w0 * (A + B * t));
    } else {
      // 3. Overdamped (Slow exponential decay)
      const s1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
      const s2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
      const C2 = (v0 - s1 * x0) / (s2 - s1);
      const C1 = x0 - C2;

      position = to + C1 * Math.exp(s1 * t) + C2 * Math.exp(s2 * t);
      velocity = C1 * s1 * Math.exp(s1 * t) + C2 * s2 * Math.exp(s2 * t);
    }

    // Optional overshoot clamping
    if (overshootClamping) {
      if ((from < to && position > to) || (from > to && position < to)) {
        position = to;
        velocity = 0;
      }
    }

    return { position, velocity };
  }
}
