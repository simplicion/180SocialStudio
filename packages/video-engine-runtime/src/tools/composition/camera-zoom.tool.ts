import { z } from "zod";
import crypto from "crypto";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { CameraEvent, EditIR, RationalTimeMath } from "@workspace/video-contracts";
import { CuratedTakeManifest } from "../../intelligence/semantic-take-curator";

export const CameraZoomInputSchema = z.object({
  zoomScale: z.number().default(1.3),
  frequencySeconds: z.number().default(6.0),
  stiffness: z.number().default(180),
  damping: z.number().default(18),
});

export type CameraZoomInput = z.infer<typeof CameraZoomInputSchema>;

export class CameraZoomTool extends VideoDirectorTool<CameraZoomInput, CameraEvent[]> {
  readonly name = "camera_zoom_solver";
  readonly description = "Calculates mathematical spring-physics camera zooms at cut boundaries and high-retention emphasis moments";
  readonly stage = "ATTENTION_AND_CAPTIONING" as const;
  readonly inputSchema = CameraZoomInputSchema;

  async execute(input: CameraZoomInput, context: DirectorExecutionContext): Promise<CameraEvent[]> {
    const editIR: EditIR | undefined = context.artifacts.get("editIR");
    const curated: CuratedTakeManifest | undefined = context.artifacts.get("curatedManifest");

    if (!editIR) {
      throw new Error("CameraZoomTool: EditIR not found in execution context.");
    }

    const cameraEvents: CameraEvent[] = [];
    const totalDurationSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);

    if (curated && curated.keeperSegments.length > 0) {
      let timelineSec = 0;
      for (let idx = 0; idx < curated.keeperSegments.length; idx++) {
        const seg = curated.keeperSegments[idx];

        // 1. Multi-Cam Take Focal Alternation (eliminates jump cuts between talking head takes)
        // Segment 0 (Hook): 1.0x Wide establish
        // Segment 1 (Myth): 1.18x Punch to medium-tight
        // Segment 2 (Science): 1.08x slight push with left-offset to give room for right-quadrant diagram
        // Segment 3 (Relief): 1.16x Centered medium punch
        // Segment 4 (Warning CTA): 1.26x Close-up for maximum eye contact & urgency
        let takeScale = 1.0;
        let targetX = 0.5;
        let targetY = 0.38;

        if (idx === 1) {
          takeScale = 1.18;
          targetX = 0.5;
          targetY = 0.38;
        } else if (idx === 2) {
          takeScale = 1.08;
          targetX = 0.44; // Give breathing room for anatomical diagram on upper right
          targetY = 0.38;
        } else if (idx === 3) {
          takeScale = 1.16;
          targetX = 0.5;
          targetY = 0.38;
        } else if (idx >= 4) {
          takeScale = 1.26;
          targetX = 0.5;
          targetY = 0.36; // Slightly higher framing for dramatic close-up
        }

        if (takeScale > 1.0) {
          cameraEvents.push({
            id: `cam_take_${idx + 1}_multicam`,
            timeRange: {
              start: RationalTimeMath.fromSeconds(timelineSec),
              duration: RationalTimeMath.fromSeconds(seg.durationSec),
            },
            targetType: "FACE",
            targetCoords: { x: targetX, y: targetY },
            scale: takeScale,
            spring: {
              stiffness: input.stiffness,
              damping: input.damping,
              mass: 1,
              overshootClamping: true, // Persistent take framing
            },
            motionBlur: false,
          });
        }

        // 2. High-Retention Mid-Take Emphasis Punch (for longer explanation segments > 9s)
        if (seg.durationSec >= 9.0) {
          const punchStart = timelineSec + Math.min(3.5, seg.durationSec * 0.35);
          const punchDur = 2.4;
          cameraEvents.push({
            id: `cam_punch_${idx + 1}_emphasis`,
            timeRange: {
              start: RationalTimeMath.fromSeconds(punchStart),
              duration: RationalTimeMath.fromSeconds(punchDur),
            },
            targetType: "FACE",
            targetCoords: { x: targetX, y: targetY },
            scale: Math.min(1.35, takeScale + 0.15),
            spring: {
              stiffness: 220,
              damping: 20,
              mass: 1,
              overshootClamping: false, // Bell-curve dynamic spring punch
            },
            motionBlur: true,
          });
        }

        timelineSec += seg.durationSec;
      }
    } else {
      for (let t = 1.5; t < totalDurationSec - 1.0; t += input.frequencySeconds) {
        cameraEvents.push({
          id: crypto.randomUUID(),
          timeRange: {
            start: RationalTimeMath.fromSeconds(t),
            duration: RationalTimeMath.fromSeconds(Math.min(2.5, totalDurationSec - t)),
          },
          targetType: "FACE",
          targetCoords: { x: 0.5, y: 0.38 },
          scale: input.zoomScale,
          spring: {
            stiffness: input.stiffness,
            damping: input.damping,
            mass: 1,
            overshootClamping: false,
          },
          motionBlur: true,
        });
      }
    }

    editIR.tracks.cameraTrack = cameraEvents;
    context.log?.(`Generated ${cameraEvents.length} multi-cam focal length shifts and retention punch zooms.`);
    return cameraEvents;
  }
}
