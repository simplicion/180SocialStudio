import { z } from "zod";
import crypto from "crypto";
import * as path from "path";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { EditIR, RationalTimeMath, VideoClip } from "@workspace/video-contracts";
import { CuratedTakeManifest } from "../../intelligence/semantic-take-curator";

type VideoTrack = EditIR["tracks"]["videoTracks"][number];

export const TimelineAssemblyInputSchema = z.object({
  targetAspect: z.enum(["16:9", "9:16", "1:1"]).default("9:16"),
  directorPreset: z.string().default("HORMOZI_VIRAL"),
  pacingMultiplier: z.number().default(1.25),
});

export type TimelineAssemblyInput = z.infer<typeof TimelineAssemblyInputSchema>;

export class TimelineAssemblyTool extends VideoDirectorTool<TimelineAssemblyInput, EditIR> {
  readonly name = "timeline_assembler";
  readonly description = "Compiles keeper source ranges into a sequential multi-track EditIR AST with proper aspect framing";
  readonly stage = "TIMELINE_COMPOSITION" as const;
  readonly inputSchema = TimelineAssemblyInputSchema;

  async execute(input: TimelineAssemblyInput, context: DirectorExecutionContext): Promise<EditIR> {
    const curated: CuratedTakeManifest | undefined = context.artifacts.get("curatedManifest");
    const isVertical = input.targetAspect === "9:16";
    const resolution = isVertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
    const projectId = context.projectId || crypto.randomUUID();

    const videoClips: VideoClip[] = [];
    let timelineSec = 0;

    const segments = (curated as any)?.keeperSegments || (curated as any)?.segments || [];
    if (segments.length > 0) {
      for (const seg of segments) {
        const clipDurSec = seg.durationSec ?? (seg.sourceEndSec - seg.sourceStartSec);
        const clipStartSec = timelineSec;
        const sourcePath = seg.clipPath || seg.sourcePath || "";
        const assetId = seg.id || seg.assetId || crypto.randomUUID();

        videoClips.push({
          id: crypto.randomUUID(),
          assetId,
          sourcePath,
          sourceRange: {
            start: RationalTimeMath.fromSeconds(seg.sourceStartSec || 0),
            duration: RationalTimeMath.fromSeconds(clipDurSec),
          },
          timelineRange: {
            start: RationalTimeMath.fromSeconds(clipStartSec),
            duration: RationalTimeMath.fromSeconds(clipDurSec),
          },
          transform: {
            scale: { start: 1.0, end: 1.0, easing: "spring" },
            position: { x: 0.0, y: 0.0 },
            anchor: { x: 0.5, y: 0.5 },
            rotationDeg: 0,
            opacity: 1.0,
          },
          speedMultiplier: 1.0,
          effects: [],
        });

        timelineSec += clipDurSec;
      }
    } else {
      // Zero-Footage Autonomous Video Production Mode
      const voiceover: any = context.artifacts.get("synthesized_voiceover");
      const sourcedBroll: any[] = context.artifacts.get("sourced_broll_clips") || [];

      if (voiceover) {
        const voiceDuration = Math.max(3.0, voiceover.durationSec || 10.0);
        timelineSec = voiceDuration;

        if (sourcedBroll.length > 0) {
          const clipDur = voiceDuration / sourcedBroll.length;
          let curTime = 0;
          for (let i = 0; i < sourcedBroll.length; i++) {
            const b = sourcedBroll[i];
            const dur = Math.min(clipDur, Math.max(1.5, b.durationSec || clipDur));
            videoClips.push({
              id: crypto.randomUUID(),
              assetId: b.clipId,
              sourcePath: b.localCachedVideoPath,
              sourceRange: {
                start: RationalTimeMath.fromSeconds(0),
                duration: RationalTimeMath.fromSeconds(dur),
              },
              timelineRange: {
                start: RationalTimeMath.fromSeconds(curTime),
                duration: RationalTimeMath.fromSeconds(dur),
              },
              transform: {
                scale: { start: 1.0, end: 1.05, easing: "spring" },
                position: { x: 0.0, y: 0.0 },
                anchor: { x: 0.5, y: 0.5 },
                rotationDeg: 0,
                opacity: 1.0,
              },
              speedMultiplier: 1.0,
              effects: [],
            });
            curTime += dur;
          }
        } else {
          // Fallback visual clip if no stock footage retrieved
          videoClips.push({
            id: crypto.randomUUID(),
            assetId: "bg_canvas_generator",
            sourcePath: path.join(context.tempDir, "bg_canvas.mp4"),
            sourceRange: {
              start: RationalTimeMath.fromSeconds(0),
              duration: RationalTimeMath.fromSeconds(voiceDuration),
            },
            timelineRange: {
              start: RationalTimeMath.fromSeconds(0),
              duration: RationalTimeMath.fromSeconds(voiceDuration),
            },
            transform: {
              scale: { start: 1.0, end: 1.0, easing: "spring" },
              position: { x: 0.0, y: 0.0 },
              anchor: { x: 0.5, y: 0.5 },
              rotationDeg: 0,
              opacity: 1.0,
            },
            speedMultiplier: 1.0,
            effects: [],
          });
        }
      }
    }

    const videoTracks: VideoTrack[] = [
      {
        id: crypto.randomUUID(),
        type: "MAIN_VIDEO",
        zIndex: 0,
        clips: videoClips,
      },
    ];

    // Contextual B-Roll Overlay Assembly (for projects with raw talking-head takes)
    const sourcedBroll: any[] = context.artifacts.get("sourced_broll_clips") || [];
    if (segments.length > 0 && sourcedBroll.length > 0 && timelineSec > 3.0 && videoClips.length > 0) {
      const brollClips: VideoClip[] = [];
      const intervalSec = Math.max(3.0, timelineSec / (sourcedBroll.length + 1));
      let currentBrollTime = intervalSec;

      for (let i = 0; i < sourcedBroll.length && currentBrollTime < timelineSec - 1.0; i++) {
        const b = sourcedBroll[i];
        const clipDuration = Math.min(3.0, Math.max(1.5, b.durationSec || 3.0));
        brollClips.push({
          id: crypto.randomUUID(),
          assetId: b.clipId,
          sourcePath: b.localCachedVideoPath,
          sourceRange: {
            start: RationalTimeMath.fromSeconds(0),
            duration: RationalTimeMath.fromSeconds(clipDuration),
          },
          timelineRange: {
            start: RationalTimeMath.fromSeconds(currentBrollTime),
            duration: RationalTimeMath.fromSeconds(clipDuration),
          },
          transform: {
            scale: { start: 1.0, end: 1.04, easing: "spring" },
            position: { x: 0.0, y: 0.0 },
            anchor: { x: 0.5, y: 0.5 },
            rotationDeg: 0,
            opacity: 1.0,
          },
          speedMultiplier: 1.0,
          effects: [],
        });
        currentBrollTime += intervalSec;
      }

      if (brollClips.length > 0) {
        videoTracks.push({
          id: crypto.randomUUID(),
          type: "B_ROLL_OVERLAY",
          zIndex: 10,
          clips: brollClips,
        });
        context.log?.(`[TimelineAssemblyTool] Integrated ${brollClips.length} Pexels B-Roll cutaways onto B_ROLL_OVERLAY track.`);
      }
    }

    // Audio Tracks Construction (Voiceover + Ducked BGM)
    const audioTracks: any[] = [];
    const voiceover: any = context.artifacts.get("synthesized_voiceover");
    if (voiceover?.voiceoverPath && timelineSec > 0) {
      audioTracks.push({
        id: crypto.randomUUID(),
        type: "PRIMARY_VOICE",
        volume: 1.0,
        duckWithSpeech: false,
        clips: [
          {
            id: crypto.randomUUID(),
            assetId: "voiceover_primary",
            sourcePath: voiceover.voiceoverPath,
            sourceRange: {
              start: RationalTimeMath.fromSeconds(0),
              duration: RationalTimeMath.fromSeconds(timelineSec),
            },
            timelineRange: {
              start: RationalTimeMath.fromSeconds(0),
              duration: RationalTimeMath.fromSeconds(timelineSec),
            },
            volume: 1.0,
            speedMultiplier: 1.0,
          },
        ],
      });
    }

    const bgmTrack: any = context.artifacts.get("sourced_bgm_track");
    if (bgmTrack?.filePath && timelineSec > 0) {
      audioTracks.push({
        id: crypto.randomUUID(),
        type: "BACKGROUND_MUSIC",
        volume: 0.25,
        duckWithSpeech: true,
        duckingConfig: {
          duckDb: bgmTrack.volumeDb ?? -18.0,
          attackMs: 120,
          releaseMs: 350,
        },
        clips: [
          {
            id: crypto.randomUUID(),
            assetId: bgmTrack.id || "bgm_primary",
            sourcePath: bgmTrack.filePath,
            sourceRange: {
              start: RationalTimeMath.fromSeconds(0),
              duration: RationalTimeMath.fromSeconds(timelineSec),
            },
            timelineRange: {
              start: RationalTimeMath.fromSeconds(0),
              duration: RationalTimeMath.fromSeconds(timelineSec),
            },
            volume: 0.25,
            speedMultiplier: 1.0,
          },
        ],
      });
    }

    const editIR: EditIR = {
      version: "1.0.0",
      meta: {
        projectId,
        title: "Autonomous AI Production",
        targetAspect: input.targetAspect,
        resolution,
        fps: { numerator: 30, denominator: 1 },
        totalDuration: RationalTimeMath.fromSeconds(timelineSec),
      },
      directorStyle: {
        preset: input.directorPreset as any,
        pacingMultiplier: input.pacingMultiplier,
        zoomAggressiveness: 0.6,
        brollFrequencySeconds: 15.0,
      },
      tracks: {
        videoTracks,
        cameraTrack: [],
        captionTrack: [],
        audioTracks,
      },
    };

    context.artifacts.set("editIR", editIR);
    context.log?.(`Assembled timeline with ${videoClips.length} clips, ${videoTracks.length} video tracks, and ${audioTracks.length} audio tracks. Total duration: ${timelineSec.toFixed(1)}s`);
    return editIR;
  }
}
