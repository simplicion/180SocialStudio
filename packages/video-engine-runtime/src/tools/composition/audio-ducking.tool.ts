import { z } from "zod";
import crypto from "crypto";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { EditIR, RationalTimeMath } from "@workspace/video-contracts";

export const AudioDuckingInputSchema = z.object({
  bgmPath: z.string().optional(),
  duckDb: z.number().default(-14.0),
  attackMs: z.number().default(120),
  releaseMs: z.number().default(350),
});

export type AudioDuckingInput = z.infer<typeof AudioDuckingInputSchema>;

export class AudioDuckingTool extends VideoDirectorTool<AudioDuckingInput, any[]> {
  readonly name = "audio_ducking_mixer";
  readonly description = "Composites BGM and voice tracks with speech-activated ducking";
  readonly stage = "TIMELINE_COMPOSITION" as const;
  readonly inputSchema = AudioDuckingInputSchema;

  async execute(input: AudioDuckingInput, context: DirectorExecutionContext): Promise<any[]> {
    const editIR: EditIR | undefined = context.artifacts.get("editIR");
    if (!editIR) {
      throw new Error("AudioDuckingTool: EditIR not found in execution context.");
    }

    // Preserve existing non-BGM tracks (such as SFX transient tracks from MotionOverlayTool)
    const existingOtherTracks = (editIR.tracks.audioTracks || []).filter((t: any) => t.type !== "BGM");
    const audioTracks: any[] = [...existingOtherTracks];
    const totalDurationSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);

    const sourcedBgm = context.artifacts.get("sourced_bgm_track");
    const effectiveBgmPath = input.bgmPath || sourcedBgm?.filePath;
    const bgmVolumeDb = sourcedBgm?.volumeDb ?? -18.0;

    if (effectiveBgmPath) {
      context.log?.(`[AudioDuckingTool] Attaching BGM track: ${effectiveBgmPath} at ${bgmVolumeDb}dB with sidechain ducking.`);
      audioTracks.push({
        id: crypto.randomUUID(),
        type: "BGM",
        volumeDb: bgmVolumeDb,
        duckWithSpeech: true,
        duckingConfig: {
          duckDb: input.duckDb ?? -18.0,
          attackMs: input.attackMs,
          releaseMs: input.releaseMs,
        },
        clips: [
          {
            id: crypto.randomUUID(),
            assetId: "bgm_track_1",
            sourcePath: effectiveBgmPath,
            timelineRange: {
              start: RationalTimeMath.fromSeconds(0),
              duration: editIR.meta.totalDuration,
            },
            timelineStart: 0,
            duration: totalDurationSec,
          },
        ],
      });
    }

    editIR.tracks.audioTracks = audioTracks;
    context.log?.(`Configured ${audioTracks.length} audio track(s) (including ${existingOtherTracks.length} SFX/aux track(s)) with speech ducking.`);
    return audioTracks;
  }
}
