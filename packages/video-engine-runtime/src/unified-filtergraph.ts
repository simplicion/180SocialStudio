import ffmpeg from "./ffmpeg-setup";
import * as fs from "fs";
import { FfmpegHardwareAccelerator } from "./ffmpeg-hardware";

export interface VideoClipSegment {
  sourcePath: string;
  startSec: number;
  durationSec: number;
  volumeDb?: number;
}

export interface MotionGraphicOverlayItem {
  assetPath: string;
  timelineStartSec: number;
  durationSec: number;
  position?: "lower_third" | "center" | "top_right";
}

export interface BackgroundMusicTrack {
  audioPath: string;
  volumeDb?: number;
  duckUnderSpeech?: boolean;
  duckRatio?: number;
  fadeInSec?: number;
  fadeOutSec?: number;
}

export interface UnifiedFiltergraphOptions {
  canvas: { width: number; height: number };
  clips: VideoClipSegment[];
  colorFilter?: { contrast?: number; brightness?: number; saturation?: number };
  motionCards?: MotionGraphicOverlayItem[];
  backgroundMusic?: BackgroundMusicTrack;
}

export class UnifiedFiltergraphCompiler {
  /**
   * Compiles video cuts, color grading, HyperFrames overlays, and sidechain-ducked
   * background music into one single-pass FFmpeg DAG filtergraph string.
   */
  static compile(options: UnifiedFiltergraphOptions): {
    filterComplex: string;
    videoOutLabel: string;
    audioOutLabel: string;
    extraInputs: Array<{ path: string; isLoop?: boolean }>;
  } {
    const { canvas, clips, colorFilter, motionCards = [], backgroundMusic } = options;
    const filterParts: string[] = [];
    const extraInputs: Array<{ path: string; isLoop?: boolean }> = [];

    const targetW = Math.floor(canvas.width / 2) * 2;
    const targetH = Math.floor(canvas.height / 2) * 2;

    // 1. Video trimming & concatenation
    const vLabels: string[] = [];
    const aLabels: string[] = [];

    clips.forEach((clip, idx) => {
      const vLabel = `v_seg_${idx}`;
      const aLabel = `a_seg_${idx}`;
      const endSec = clip.startSec + clip.durationSec;

      filterParts.push(
        `[${idx}:v]trim=start=${clip.startSec.toFixed(3)}:end=${endSec.toFixed(3)},setpts=PTS-STARTPTS,scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1[${vLabel}]`
      );
      filterParts.push(
        `[${idx}:a]atrim=start=${clip.startSec.toFixed(3)}:end=${endSec.toFixed(3)},asetpts=PTS-STARTPTS[${aLabel}]`
      );
      vLabels.push(`[${vLabel}]`);
      aLabels.push(`[${aLabel}]`);
    });

    const vConcatLabel = `v_concat`;
    const aConcatLabel = `a_concat`;
    filterParts.push(`${vLabels.join("")}concat=n=${clips.length}:v=1:a=0[${vConcatLabel}]`);
    filterParts.push(`${aLabels.join("")}concat=n=${clips.length}:v=0:a=1[${aConcatLabel}]`);

    let currentV = vConcatLabel;

    // 2. Color grading
    if (colorFilter && (colorFilter.contrast || colorFilter.brightness || colorFilter.saturation)) {
      const c = colorFilter.contrast ?? 1.0;
      const b = colorFilter.brightness ?? 0.0;
      const s = colorFilter.saturation ?? 1.0;
      const colorLabel = `v_color`;
      filterParts.push(`[${currentV}]eq=contrast=${c.toFixed(2)}:brightness=${b.toFixed(2)}:saturation=${s.toFixed(2)}[${colorLabel}]`);
      currentV = colorLabel;
    }

    // 3. Motion Graphic Overlays (HyperFrames Cards)
    let nextInputIdx = clips.length;
    motionCards.forEach((card, idx) => {
      extraInputs.push({ path: card.assetPath, isLoop: true });
      const cardInputIdx = nextInputIdx++;
      const endSec = card.timelineStartSec + card.durationSec;
      const overlayOut = `v_mg_${idx}`;

      const pos = card.position || "lower_third";
      let xExpr = `(W-w)/2`;
      let yExpr = `H-h-120`;
      if (pos === "center") yExpr = `(H-h)/2`;
      if (pos === "top_right") {
        xExpr = `W-w-40`;
        yExpr = `120`;
      }

      filterParts.push(
        `[${currentV}][${cardInputIdx}:v]overlay=x='${xExpr}':y='${yExpr}':enable='between(t,${card.timelineStartSec.toFixed(2)},${endSec.toFixed(2)})':eof_action=pass[${overlayOut}]`
      );
      currentV = overlayOut;
    });

    // 4. Audio Ducking with Sidechain Compressor
    let finalAudio = aConcatLabel;
    if (backgroundMusic && fs.existsSync(backgroundMusic.audioPath)) {
      const bgmInputIdx = nextInputIdx++;
      extraInputs.push({ path: backgroundMusic.audioPath, isLoop: false });

      const bgmVolume = backgroundMusic.volumeDb !== undefined
        ? Math.pow(10, backgroundMusic.volumeDb / 20).toFixed(2)
        : "0.20";

      const bgmRaw = `bgm_raw`;
      const bgmDucked = `bgm_ducked`;
      const aMixed = `a_mixed`;

      filterParts.push(`[${bgmInputIdx}:a]volume=${bgmVolume}[${bgmRaw}]`);

      if (backgroundMusic.duckUnderSpeech !== false) {
        // High-production sidechain compression: Speech signal triggers dynamic volume attenuation of the music bed
        const ratio = backgroundMusic.duckRatio || 4;
        filterParts.push(
          `[${bgmRaw}][${aConcatLabel}]sidechaincompress=threshold=0.12:ratio=${ratio}:attack=20:release=300[${bgmDucked}]`
        );
        filterParts.push(`[${bgmDucked}][${aConcatLabel}]amix=inputs=2:duration=first[${aMixed}]`);
      } else {
        filterParts.push(`[${bgmRaw}][${aConcatLabel}]amix=inputs=2:duration=first[${aMixed}]`);
      }

      finalAudio = aMixed;
    }

    return {
      filterComplex: filterParts.join(";"),
      videoOutLabel: currentV,
      audioOutLabel: finalAudio,
      extraInputs,
    };
  }

  /**
   * Executes hardware-accelerated single-pass rendering in a unified command.
   */
  static async renderSinglePass(
    outputPath: string,
    options: UnifiedFiltergraphOptions,
    onProgress?: (percent: number) => void
  ): Promise<string> {
    const { filterComplex, videoOutLabel, audioOutLabel, extraInputs } = this.compile(options);
    const hw = await FfmpegHardwareAccelerator.resolveEncoderProfile();

    return new Promise((resolve, reject) => {
      let cmd = ffmpeg();

      // Base clip inputs
      options.clips.forEach((c) => {
        cmd = cmd.input(c.sourcePath);
      });

      // Extra inputs (overlays, music)
      extraInputs.forEach((extra) => {
        if (extra.isLoop) {
          cmd = cmd.input(extra.path).inputOptions(["-loop 1"]);
        } else {
          cmd = cmd.input(extra.path);
        }
      });

      cmd
        .complexFilter(filterComplex)
        .outputOptions([
          "-y",
          "-map", `[${videoOutLabel}]`,
          "-map", `[${audioOutLabel}]`,
          "-c:v", hw.codecName,
          ...hw.outputOptions.filter((o) => !o.startsWith("-c:v")),
          "-c:a", "aac",
          "-b:a", "192k",
          "-movflags", "+faststart",
        ])
        .output(outputPath)
        .on("progress", (p) => {
          if (onProgress && p.percent) onProgress(p.percent);
        })
        .on("end", () => resolve(outputPath))
        .on("error", (err) => reject(err))
        .run();
    });
  }
}

