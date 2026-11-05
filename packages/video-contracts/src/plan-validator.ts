import {
  CreativeEditPlan,
  CreativeEditPlanSchema,
  CreativeOperation,
} from "./creative-plan.schema";
import { EditIR } from "./edit-ir.schema";
import { MediaAssetDescriptor } from "./project.schema";
import { constraintTimelineFromEditIR, constraintViolation, mergeDirectorConstraints } from "./director-constraints";

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  validatedPlan?: CreativeEditPlan;
  /** Operations rejected because of the creator's constraints (also in `errors`, prefixed "Operation #i"). */
  violations: string[];
}

export class CreativePlanValidator {
  /**
   * Validates a CreativeEditPlan against schema, asset registry, timeline bounds,
   * track permissions, and explicit user constraints.
   */
  static validate(
    plan: any,
    currentEditIR: EditIR,
    availableAssets: MediaAssetDescriptor[] = []
  ): PlanValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 1. Strict Schema Validation
    const parseResult = CreativeEditPlanSchema.safeParse(plan);
    if (!parseResult.success) {
      return {
        valid: false,
        errors: parseResult.error.errors.map((e) => `Schema error at ${e.path.join(".")}: ${e.message}`),
        warnings: [],
        violations: [],
      };
    }

    const validatedPlan = parseResult.data;
    const knownAssetIds = new Set(availableAssets.map((a) => a.id));
    const lockedTrackIds = new Set(validatedPlan.constraints.lockedTrackIds || []);
    const violations: string[] = [];
    // Preservation locks: protected ranges (seconds) + locked track kinds, enforced for every timed/track op.
    const locks = mergeDirectorConstraints(null, {
      lockedRanges: (validatedPlan.constraints.protectedTimeRanges || []).map((r) => [Math.round(r.startSec * 1000), Math.round((r.startSec + r.durationSec) * 1000)] as [number, number]),
      lockedTracks: validatedPlan.constraints.lockedTracks || [],
    });
    const lockTimeline = locks.lockedRanges.length || locks.lockedTracks.length ? constraintTimelineFromEditIR(currentEditIR) : null;

    // 2. Validate Operations
    for (let i = 0; i < validatedPlan.operations.length; i++) {
      const op = validatedPlan.operations[i];

      // Check track locking
      if ("trackId" in op && op.trackId && lockedTrackIds.has(op.trackId)) {
        errors.push(`Operation #${i} (${op.type}) attempts to modify locked track ${op.trackId}`);
      }

      // Check asset references for B-roll or replacement
      if (op.type === "insertBroll" || op.type === "addImage") {
        const isStock = op.type === "insertBroll" && (!!op.stockQuery || !!op.sourceUrl || op.assetId === "stock");
        if (!isStock && knownAssetIds.size > 0 && !knownAssetIds.has(op.assetId)) {
          errors.push(`Operation #${i} (${op.type}) references unknown assetId "${op.assetId}"`);
        }
      }

      // Check timestamps sanity
      if ("startSec" in op && typeof op.startSec === "number" && op.startSec < 0) {
        errors.push(`Operation #${i} (${op.type}) has negative startSec: ${op.startSec}`);
      }
      if ("durationSec" in op && typeof op.durationSec === "number" && op.durationSec <= 0) {
        errors.push(`Operation #${i} (${op.type}) has non-positive durationSec: ${op.durationSec}`);
      }

      // 3. User Constraints Enforcement
      if (validatedPlan.constraints.doNotRemoveIntro && op.type === "removeRange") {
        if (op.startSec < 5.0) {
          errors.push(`Operation #${i} (removeRange at ${op.startSec}s) violates constraint 'doNotRemoveIntro'`);
        }
      }

      if (validatedPlan.constraints.protectedTimeRanges && validatedPlan.constraints.protectedTimeRanges.length > 0) {
        const anyOp = op as any;
        const opStart = typeof anyOp.startSec === 'number' ? anyOp.startSec : (typeof anyOp.timelineStartSec === 'number' ? anyOp.timelineStartSec : null);
        const opDur = typeof anyOp.durationSec === 'number' ? anyOp.durationSec : null;
        if (opStart !== null && opDur !== null) {
          const opEnd = opStart + opDur;
          for (const range of validatedPlan.constraints.protectedTimeRanges) {
            const rStart = Number(range.startSec);
            const rEnd = rStart + Number(range.durationSec);
            if (opStart < rEnd && opEnd > rStart) {
              errors.push(`Operation #${i} (${op.type} from ${opStart}s to ${opEnd}s) intersects protected time range (${rStart}s - ${rEnd}s)`);
            }
          }
        }
      }

      // Protected ranges and locked tracks (director-constraints.ts)
      if (lockTimeline) {
        const why = constraintViolation(op, locks, lockTimeline);
        if (why) {
          violations.push(why);
          errors.push(`Operation #${i} (${op.type}) violates constraint: ${why}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      validatedPlan: errors.length === 0 ? validatedPlan : undefined,
      violations,
    };
  }
}
