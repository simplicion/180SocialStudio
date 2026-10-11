import { TimeRange, RationalTimeMath } from "./time";
import { Transform } from "./edit-ir.schema";

export class ContentAddressedKeyGenerator {
  /**
   * Alias for computeCacheKey accepting flexible params
   */
  static computeKey(params: {
    sourceHash: string;
    timeRange: TimeRange | { start: number; duration: number };
    effectParams?: any;
    transform?: Transform;
    effects?: string[];
    engineVersion?: string;
  }): string {
    const startSec =
      typeof params.timeRange.start === "object" && params.timeRange.start !== null && "timescale" in params.timeRange.start
        ? RationalTimeMath.toSeconds(params.timeRange.start as any)
        : (params.timeRange.start as number);

    const durSec =
      typeof params.timeRange.duration === "object" && params.timeRange.duration !== null && "timescale" in params.timeRange.duration
        ? RationalTimeMath.toSeconds(params.timeRange.duration as any)
        : (params.timeRange.duration as number);

    return this.computeCacheKey({
      sourceHash: params.sourceHash,
      timeRange: {
        start: RationalTimeMath.fromSeconds(startSec),
        duration: RationalTimeMath.fromSeconds(durSec),
      },
      transform: params.transform,
      effects: params.effects || (params.effectParams ? [JSON.stringify(params.effectParams)] : []),
      engineVersion: params.engineVersion,
    });
  }

  /**
   * Computes a deterministic SHA-256 / Murmur-like content-addressed cache key
   * according to ADR-010.
   */
  static computeCacheKey(params: {
    sourceHash: string;
    timeRange: TimeRange;
    transform?: Transform;
    effects?: string[];
    engineVersion?: string;
  }): string {
    const startSec = RationalTimeMath.toSeconds(params.timeRange.start);
    const durSec = RationalTimeMath.toSeconds(params.timeRange.duration);
    const version = params.engineVersion || "0.1.0";

    const payload = JSON.stringify({
      src: params.sourceHash,
      start: startSec.toFixed(4),
      dur: durSec.toFixed(4),
      tf: params.transform || null,
      fx: params.effects || [],
      v: version,
    });

    // Simple fast universal hash for strings
    let hash = 5381;
    for (let i = 0; i < payload.length; i++) {
      hash = ((hash << 5) + hash) + payload.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }

    return `cac_${Math.abs(hash).toString(16)}_${params.sourceHash.slice(0, 8)}`;
  }
}
