import ffmpeg from "./ffmpeg-setup";
import * as path from "path";
import * as fs from "fs";
import { AudioTrack, AudioDuckingConfig, RationalTimeMath } from "@workspace/video-contracts";

export class AudioDuckingMixer {
  /**
   * High-level multi-track filtergraph builder
   */
  static buildFilterGraph(
    tracks: AudioTrack[],
    options: { duckThresholdDb?: number; attenuationDb?: number; attackMs?: number; releaseMs?: number } = {}
  ): string {
    const dialogueTrack = tracks.find((t) => t.type === "PRIMARY_VOICE" || (t.type as any) === "DIALOGUE");
    const bgmTrack = tracks.find((t) => t.type === "BGM");

    if (dialogueTrack && bgmTrack) {
      return this.buildDuckingFiltergraph(0, 1, {
        enabled: true,
        thresholdDb: options.duckThresholdDb ?? -24.0,
        duckAmountDb: options.attenuationDb ?? -18.0,
        attackMs: options.attackMs ?? 120,
        releaseMs: options.releaseMs ?? 350,
        holdMs: 100,
      });
    } else if (bgmTrack) {
      const vol = Math.pow(10, (bgmTrack.volumeDb ?? 0) / 20);
      return `[0:a]aformat=channel_layouts=stereo:sample_rates=48000,volume=${vol.toFixed(2)}[out_audio]`;
    } else if (dialogueTrack) {
      const vol = Math.pow(10, (dialogueTrack.volumeDb ?? 0) / 20);
      return `[0:a]aformat=channel_layouts=stereo:sample_rates=48000,volume=${vol.toFixed(2)}[out_audio]`;
    }

    return `[0:a]aformat=channel_layouts=stereo:sample_rates=48000,volume=1.0[out_audio]`;
  }

  /**
   * Generates an FFmpeg complex filter string to dynamically duck Background Music
   * whenever Dialogue audio exceeds the specified volume threshold.
   */
  static buildDuckingFiltergraph(
    dialogueInputIndex: number,
    bgmInputIndex: number,
    config: AudioDuckingConfig = {
      enabled: true,
      thresholdDb: -24.0,
      duckAmountDb: -18.0,
      attackMs: 120,
      releaseMs: 350,
      holdMs: 100,
    }
  ): string {
    const thresholdLin = Math.pow(10, config.thresholdDb / 20);
    const ratio = Math.abs(config.duckAmountDb) / 4;

    return (
      `[${bgmInputIndex}:a]aformat=channel_layouts=stereo:sample_rates=48000[bgm_fmt];` +
      `[${dialogueInputIndex}:a]aformat=channel_layouts=stereo:sample_rates=48000,asplit=2[dia_sc][dia_mix];` +
      `[bgm_fmt][dia_sc]sidechaincompress=threshold=${thresholdLin.toFixed(
        4
      )}:ratio=${ratio.toFixed(2)}:attack=${config.attackMs}:release=${config.releaseMs}[ducked_bgm];` +
      `[dia_mix][ducked_bgm]amix=inputs=2:duration=first[out_audio]`
    );
  }

  /**
   * Mixes Dialogue, Ducked BGM, and all timeline SFX transients into a single master stereo AAC track.
   */
  static async mixProjectAudio(
    dialoguePath: string,
    tracks: AudioTrack[],
    outputPath: string,
    config?: AudioDuckingConfig
  ): Promise<string> {
    const bgmTrack = tracks.find((t) => t.type === "BGM");
    const bgmClip = bgmTrack?.clips[0];
    const sfxTrack = tracks.find((t) => t.type === "SFX");
    const sfxClips = sfxTrack?.clips || [];

    // Only feed inputs that actually carry an audio stream; `[n:a]` on a video-only file
    // fails the whole graph with "Stream specifier ':a' matches no streams".
    const dialogue = await this.probeAudio(dialoguePath);
    const hasBgm = Boolean(bgmClip && fs.existsSync(bgmClip.sourcePath) && (await this.probeAudio(bgmClip.sourcePath)).hasAudio);
    const validSfxClips: typeof sfxClips = [];
    for (const c of sfxClips) {
      if (fs.existsSync(c.sourcePath) && (await this.probeAudio(c.sourcePath)).hasAudio) validSfxClips.push(c);
    }

    if (!hasBgm && validSfxClips.length === 0 && dialogue.hasAudio) {
      if (dialoguePath !== outputPath) {
        fs.copyFileSync(dialoguePath, outputPath);
      }
      return outputPath;
    }

    // Silent dialogue source (e.g. drone B-roll): substitute a silent stereo bed of the same
    // length as input 0 so ducking/mixing still runs and the output length follows the video.
    let cmd = dialogue.hasAudio
      ? ffmpeg(dialoguePath)
      : ffmpeg()
          .input("anullsrc=channel_layout=stereo:sample_rate=48000")
          .inputOptions(["-f lavfi", "-t", `${dialogue.durationSeconds > 0 ? dialogue.durationSeconds : 1}`]);
    let inputIdx = 1;
    let bgmIdx = -1;
    const sfxIndices: { idx: number; delayMs: number; volumeDb: number }[] = [];

    if (hasBgm) {
      cmd = cmd.input(bgmClip!.sourcePath);
      bgmIdx = inputIdx++;
    }

    for (const sfx of validSfxClips) {
      cmd = cmd.input(sfx.sourcePath);
      const delayMs = Math.max(0, Math.round(RationalTimeMath.toSeconds(sfx.timelineRange.start) * 1000));
      sfxIndices.push({ idx: inputIdx++, delayMs, volumeDb: sfx.volumeDb ?? -3.0 });
    }

    let filterComplex = "";
    let mixInputs: string[] = [];

    if (hasBgm) {
      const thresholdLin = Math.pow(10, (config?.thresholdDb ?? -24.0) / 20);
      const ratio = Math.abs(config?.duckAmountDb ?? -18.0) / 4;
      filterComplex +=
        `[${bgmIdx}:a]aformat=channel_layouts=stereo:sample_rates=48000[bgm_fmt];` +
        `[0:a]aformat=channel_layouts=stereo:sample_rates=48000,highpass=f=75,equalizer=f=3200:width_type=o:w=1.2:g=2.0,asplit=2[dia_sc][dia_mix];` +
        `[bgm_fmt][dia_sc]sidechaincompress=threshold=${thresholdLin.toFixed(
          4
        )}:ratio=${ratio.toFixed(2)}:attack=${config?.attackMs ?? 120}:release=${config?.releaseMs ?? 350}[ducked_bgm];`;
      mixInputs.push("[dia_mix]", "[ducked_bgm]");
    } else {
      filterComplex += `[0:a]aformat=channel_layouts=stereo:sample_rates=48000,highpass=f=75,equalizer=f=3200:width_type=o:w=1.2:g=2.0[dia_mix];`;
      mixInputs.push("[dia_mix]");
    }

    for (let i = 0; i < sfxIndices.length; i++) {
      const s = sfxIndices[i];
      const label = `sfx_delayed_${i}`;
      const volLinear = Math.pow(10, s.volumeDb / 20).toFixed(2);
      filterComplex += `[${s.idx}:a]aformat=channel_layouts=stereo:sample_rates=48000,volume=${volLinear},adelay=${s.delayMs}|${s.delayMs}[${label}];`;
      mixInputs.push(`[${label}]`);
    }

    filterComplex += `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0[out_audio]`;

    return new Promise((resolve, reject) => {
      cmd
        .complexFilter(filterComplex, ["out_audio"])
        .audioCodec("aac")
        .audioBitrate("256k")
        .output(outputPath)
        .on("end", () => resolve(outputPath))
        .on("error", (err: any) => {
          console.warn("[AudioDuckingMixer] Fallback mix due to error:", err.message);
          // Fallback to simple dialogue copy
          try {
            fs.copyFileSync(dialoguePath, outputPath);
            resolve(outputPath);
          } catch (e) {
            reject(err);
          }
        })
        .run();
    });
  }

  /**
   * Reports whether a file has an audio stream, plus its container duration.
   */
  private static probeAudio(filePath: string): Promise<{ hasAudio: boolean; durationSeconds: number }> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err: Error | null, metadata: any) => {
        if (err || !metadata) return resolve({ hasAudio: false, durationSeconds: 0 });
        const hasAudio = Boolean(metadata.streams?.some((s: any) => s.codec_type === "audio"));
        const durationSeconds = metadata.format?.duration ? parseFloat(metadata.format.duration) : 0;
        resolve({ hasAudio, durationSeconds });
      });
    });
  }

  /**
   * Backwards compatible 2-track mixer
   */
  static async mixTracks(
    dialoguePath: string,
    bgmPath: string | null,
    outputPath: string,
    config?: AudioDuckingConfig
  ): Promise<string> {
    if (!bgmPath) return this.mixProjectAudio(dialoguePath, [], outputPath, config);
    return this.mixProjectAudio(
      dialoguePath,
      [
        {
          id: "bgm_track",
          type: "BGM",
          volumeDb: 0,
          duckWithSpeech: true,
          clips: [
            {
              id: "bgm_clip_1",
              sourcePath: bgmPath,
              sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(60) },
              timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(60) },
              volumeDb: 0,
            },
          ],
        },
      ],
      outputPath,
      config
    );
  }
}
