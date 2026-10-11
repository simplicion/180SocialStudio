import { z } from "zod";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { EditIR, RationalTimeMath, VideoClip, AudioTrack } from "@workspace/video-contracts";
import { SourcedVisualAsset } from "../sourcing/asset-search.tool";
import { SourcedSfxTrack } from "../sourcing/sfx-search.tool";

export const MotionOverlayInputSchema = z.object({
  scaleFactor: z.number().optional(),
  enableSfx: z.boolean().optional(),
});

export type MotionOverlayInput = z.infer<typeof MotionOverlayInputSchema>;

export interface MotionOverlayOutput {
  overlayCount: number;
  sfxClipCount: number;
  editIR: EditIR;
}

export class MotionOverlayTool extends VideoDirectorTool<MotionOverlayInput, MotionOverlayOutput> {
  readonly name = "motion_overlay";
  readonly description = "Composites transparent visual diagrams, caution stickers, and 3D icons onto the timeline with spring physics and aligned audio SFX cues.";
  readonly stage = "TIMELINE_COMPOSITION" as const;
  readonly inputSchema = MotionOverlayInputSchema;

  async execute(input: MotionOverlayInput, context: DirectorExecutionContext): Promise<MotionOverlayOutput> {
    context.log?.("[MotionOverlayTool] Integrating motion overlays and sound effects into EditIR...");

    const editIR: EditIR = context.artifacts.get("editIR") || context.artifacts.get("edit_ir");
    if (!editIR) {
      throw new Error("MotionOverlayTool: EditIR not found in context artifacts.");
    }

    const sourcedAssets: SourcedVisualAsset[] = context.artifacts.get("sourced_visual_assets") || [];
    const sfxCatalog: Record<string, SourcedSfxTrack> = context.artifacts.get("sfx_catalog") || {};
    const enableSfx = input.enableSfx ?? true;

    const overlayClips: VideoClip[] = [];
    const sfxClips: any[] = [];

    const canvasW = editIR.meta.resolution.width;
    const canvasH = editIR.meta.resolution.height;
    const isVertical = editIR.meta.targetAspect === "9:16" || canvasW < canvasH;

    for (let i = 0; i < sourcedAssets.length; i++) {
      const asset = sourcedAssets[i];
      const startSec = asset.timestampSec;
      const durationSec = asset.durationSec;

      let posX = 0;
      let posY = isVertical ? -560 : -220;

      if (asset.position === "UPPER_RIGHT") {
        posX = isVertical ? 270 : 380;
        posY = isVertical ? -560 : -220;
      } else if (asset.position === "UPPER_LEFT") {
        posX = isVertical ? -270 : -380;
        posY = isVertical ? -560 : -220;
      } else if (asset.position === "CENTER_RIGHT") {
        posX = isVertical ? 300 : 400;
        posY = -180;
      }

      const clipId = `overlay_clip_${i + 1}_${asset.assetId}`;

      overlayClips.push({
        id: clipId,
        assetId: asset.assetId,
        sourcePath: asset.localCachedPngPath,
        sourceRange: {
          start: RationalTimeMath.fromSeconds(0),
          duration: RationalTimeMath.fromSeconds(durationSec),
        },
        timelineRange: {
          start: RationalTimeMath.fromSeconds(startSec),
          duration: RationalTimeMath.fromSeconds(durationSec),
        },
        transform: {
          scale: {
            start: input.scaleFactor || (isVertical ? 0.85 : 0.75),
            end: input.scaleFactor || (isVertical ? 0.85 : 0.75),
            easing: "spring",
          },
          position: {
            x: posX,
            y: posY,
          },
          anchor: { x: 0.5, y: 0.5 },
          rotationDeg: 0,
          opacity: 1.0,
        },
        speedMultiplier: 1.0,
        effects: ["SPRING_POP_IN"],
      });

      // Pair with SFX
      if (enableSfx && asset.sfxType && sfxCatalog[asset.sfxType]) {
        const sfxTrack = sfxCatalog[asset.sfxType];
        sfxClips.push({
          id: `sfx_clip_${i + 1}_${asset.sfxType.toLowerCase()}`,
          sourcePath: sfxTrack.filePath,
          sourceRange: {
            start: RationalTimeMath.fromSeconds(0),
            duration: RationalTimeMath.fromSeconds(sfxTrack.durationMs / 1000),
          },
          timelineRange: {
            start: RationalTimeMath.fromSeconds(startSec),
            duration: RationalTimeMath.fromSeconds(sfxTrack.durationMs / 1000),
          },
          volumeDb: -3.0,
        });
      }
    }

    // Add Overlay Video Track
    if (overlayClips.length > 0) {
      editIR.tracks.videoTracks.push({
        id: "track_sticker_overlays",
        type: "STICKER_OVERLAY",
        zIndex: 10,
        clips: overlayClips,
      });
    }

    // Add SFX Audio Track
    if (sfxClips.length > 0) {
      const sfxAudioTrack: AudioTrack = {
        id: "track_sfx_transients",
        type: "SFX",
        volumeDb: -3.0,
        duckWithSpeech: false,
        clips: sfxClips,
      };
      editIR.tracks.audioTracks.push(sfxAudioTrack);
    }

    context.artifacts.set("editIR", editIR);
    context.artifacts.set("edit_ir", editIR);
    context.log?.(
      `[MotionOverlayTool] Attached ${overlayClips.length} motion graphic overlay(s) and ${sfxClips.length} acoustic SFX trigger(s).`
    );

    return {
      overlayCount: overlayClips.length,
      sfxClipCount: sfxClips.length,
      editIR,
    };
  }
}
