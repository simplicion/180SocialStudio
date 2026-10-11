import { z } from "zod";

/**
 * Exact Rational Time representation.
 * Eliminates floating-point rounding errors and audio/video desynchronization.
 */
export const RationalTimeSchema = z.object({
  value: z.number().int().describe("Numerator in timescale units"),
  timescale: z.number().int().positive().describe("Units per second (e.g. 48000 for audio, 60000 for 60fps)"),
});

export type RationalTime = z.infer<typeof RationalTimeSchema>;

export const TimeRangeSchema = z.object({
  start: RationalTimeSchema,
  duration: RationalTimeSchema,
});

export type TimeRange = z.infer<typeof TimeRangeSchema>;

export const FrameRateSchema = z.object({
  numerator: z.number().int().positive(),
  denominator: z.number().int().positive(),
});

export type FrameRate = z.infer<typeof FrameRateSchema>;

/**
 * Rational arithmetic utilities
 */
export class RationalTimeMath {
  /**
   * Converts a float seconds timestamp to exact RationalTime
   */
  static fromSeconds(seconds: number, timescale: number = 48000): RationalTime {
    return {
      value: Math.round(seconds * timescale),
      timescale,
    };
  }

  /**
   * Converts RationalTime to floating-point seconds
   */
  static toSeconds(time: RationalTime): number {
    if (time.timescale === 0) return 0;
    return time.value / time.timescale;
  }

  /**
   * Converts frame index at specific frame rate to exact RationalTime without float rounding
   */
  static fromFrames(frameIndex: number, fps: FrameRate, targetTimescale?: number): RationalTime {
    // Exact fractional representation: (frameIndex * fps.denominator) / fps.numerator
    const rawTime: RationalTime = {
      value: frameIndex * fps.denominator,
      timescale: fps.numerator,
    };

    if (targetTimescale && targetTimescale !== fps.numerator) {
      const common = this.lcm(rawTime.timescale, targetTimescale);
      const scaledVal = rawTime.value * (common / rawTime.timescale);
      return this.simplify({ value: scaledVal, timescale: common });
    }

    return this.simplify(rawTime);
  }

  /**
   * Converts RationalTime to frame number using exact integer division
   */
  static toFrames(time: RationalTime, fps: FrameRate): number {
    if (time.timescale === 0 || fps.denominator === 0) return 0;
    const num = BigInt(time.value) * BigInt(fps.numerator);
    const den = BigInt(time.timescale) * BigInt(fps.denominator);
    if (den === BigInt(0)) return 0;
    return Number(num / den);
  }

  /**
   * Adds two RationalTimes, finding common timescale
   */
  static add(a: RationalTime, b: RationalTime): RationalTime {
    if (a.timescale === b.timescale) {
      return { value: a.value + b.value, timescale: a.timescale };
    }
    const commonScale = this.lcm(a.timescale, b.timescale);
    const valA = a.value * (commonScale / a.timescale);
    const valB = b.value * (commonScale / b.timescale);
    return this.simplify({ value: valA + valB, timescale: commonScale });
  }

  /**
   * Subtracts b from a: a - b
   */
  static sub(a: RationalTime, b: RationalTime): RationalTime {
    if (a.timescale === b.timescale) {
      return { value: a.value - b.value, timescale: a.timescale };
    }
    const commonScale = this.lcm(a.timescale, b.timescale);
    const valA = a.value * (commonScale / a.timescale);
    const valB = b.value * (commonScale / b.timescale);
    return this.simplify({ value: valA - valB, timescale: commonScale });
  }

  /**
   * Multiplies RationalTime by a numeric factor
   */
  static mul(time: RationalTime, factor: number): RationalTime {
    return this.simplify({
      value: Math.round(time.value * factor),
      timescale: time.timescale,
    });
  }

  /**
   * Compares two RationalTimes: -1 if a < b, 0 if a === b, 1 if a > b
   */
  static compare(a: RationalTime, b: RationalTime): number {
    const diff = this.sub(a, b);
    if (diff.value === 0) return 0;
    return diff.value > 0 ? 1 : -1;
  }

  /**
   * Clamps RationalTime between min and max
   */
  static clamp(time: RationalTime, min: RationalTime, max: RationalTime): RationalTime {
    if (this.compare(time, min) < 0) return min;
    if (this.compare(time, max) > 0) return max;
    return time;
  }

  /**
   * Checks if RationalTime is zero
   */
  static isZero(time: RationalTime): boolean {
    return time.value === 0;
  }

  /**
   * Simplifies rational fraction using GCD
   */
  static simplify(time: RationalTime): RationalTime {
    if (time.value === 0) {
      return { value: 0, timescale: time.timescale || 48000 };
    }
    const divisor = this.gcd(Math.abs(time.value), time.timescale);
    return {
      value: time.value / divisor,
      timescale: time.timescale / divisor,
    };
  }

  private static gcd(a: number, b: number): number {
    return b === 0 ? a : this.gcd(b, a % b);
  }

  private static lcm(a: number, b: number): number {
    if (a === 0 || b === 0) return 0;
    return Math.abs((a * b) / this.gcd(a, b));
  }
}
