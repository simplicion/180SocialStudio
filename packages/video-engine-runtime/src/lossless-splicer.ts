import { FfmpegHardwareAccelerator } from "./ffmpeg-hardware";
import ffmpeg from "./ffmpeg-setup";
import * as fs from "fs";
import * as path from "path";
import { EditIR, RationalTimeMath, CameraEvent } from "@workspace/video-contracts";
import { AssSubtitleGenerator } from "./ass-subtitle-generator";
import { AudioDuckingMixer } from "./audio-ducking-mixer";

export interface RenderProgress {
  percent: number;
  currentChunk: number;
  totalChunks: number;
  fps: number;
}

export class LosslessSplicer {
  /**
   * Production-grade SmartCut Splicer & Hardware Compositor.
   * - Cuts video at GOP boundaries with stream-copy where possible (>500 FPS).
   * - Burns in kinetic ASS karaoke subtitles.
   * - Composites multi-track audio with automated speech ducking.
   */
  static async render(
    editIR: EditIR,
    outputPath: string,
    tempDir: string,
    onProgress?: (progress: RenderProgress) => void
  ): Promise<string> {
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const mainTrack =
      editIR.tracks.videoTracks.find((t: any) => t.type === "MAIN_VIDEO") ||
      editIR.tracks.videoTracks[0];
    if (!mainTrack || mainTrack.clips.length === 0) {
      throw new Error("No video clips found in EditIR timeline.");
    }

    const hw = await FfmpegHardwareAccelerator.resolveEncoderProfile();
    const segmentPaths: string[] = [];
    const totalClips = mainTrack.clips.length;

    // Step 1: Render each individual slice (SmartCut Stream Copy)
    for (let i = 0; i < totalClips; i++) {
      const clip = mainTrack.clips[i];
      const segPath = path.join(tempDir, `seg_${String(i).padStart(4, "0")}.mp4`);
      const startSec = RationalTimeMath.toSeconds(clip.sourceRange.start);
      const durationSec = RationalTimeMath.toSeconds(clip.sourceRange.duration);

      const targetW = Math.floor(editIR.meta.resolution.width / 2) * 2;
      const targetH = Math.floor(editIR.meta.resolution.height / 2) * 2;
      const isVerticalProject = editIR.meta.targetAspect === "9:16" || targetW < targetH;

      const hasToneAdjustments =
        (clip.transform.brightness !== undefined && clip.transform.brightness !== 1.0) ||
        (clip.transform.contrast !== undefined && clip.transform.contrast !== 1.0) ||
        (clip.transform.saturation !== undefined && clip.transform.saturation !== 1.0) ||
        (clip.transform.filterPreset && clip.transform.filterPreset !== "NORMAL");

      const hasAudioAdjustments = clip.volumeDb !== undefined && clip.volumeDb !== 0.0;

      const hasSpatialTransform =
        clip.transform.scale.start !== 1.0 ||
        clip.transform.scale.end !== 1.0 ||
        clip.transform.position.x !== 0 ||
        clip.transform.position.y !== 0 ||
        clip.transform.opacity !== 1.0 ||
        clip.speedMultiplier !== 1.0 ||
        hasToneAdjustments ||
        hasAudioAdjustments;

      // Probe the source: stream-copy is only safe when it already matches the project
      // canvas exactly and carries an audio stream (so every segment concatenates cleanly).
      const source = await this.probeSource(clip.sourcePath);
      const isResolutionIdentical = source.width === targetW && source.height === targetH;

      await new Promise<void>((resolve, reject) => {
        let command: any;

        if (source.width === 0 && source.height === 0) {
          // Audio-only source (e.g. synthetic voiceover): generate project canvas video bed
          command = ffmpeg(`color=c=0x0f172a:s=${targetW}x${targetH}:r=30`)
            .inputOptions(["-f lavfi"])
            .input(clip.sourcePath)
            .setStartTime(startSec)
            .setDuration(durationSec)
            .videoCodec("libx264")
            .audioCodec("aac")
            .outputOptions(["-y", "-pix_fmt yuv420p", "-map 0:v", "-map 1:a:0", "-preset fast", "-crf 18", "-movflags +faststart", "-shortest"])
            .output(segPath);
          command
            .on("end", () => {
              segmentPaths.push(segPath);
              if (onProgress) {
                onProgress({
                  percent: Math.round(((i + 1) / totalClips) * 60),
                  currentChunk: i + 1,
                  totalChunks: totalClips,
                  fps: 0,
                });
              }
              resolve();
            })
            .on("error", (err: any) => reject(err))
            .run();
          return;
        }

        command = ffmpeg(clip.sourcePath).setStartTime(startSec).setDuration(durationSec);

        if (!hasSpatialTransform && isResolutionIdentical && source.hasAudio) {
          // Smart Stream Copy: Instant copy without re-encoding
          command = command
            .outputOptions(["-c copy", "-avoid_negative_ts make_zero"])
            .output(segPath);
        } else {
          // Hardware/Software Transcode with proper aspect framing and even macroblock dimensions
          let vFilters: string[] = [`scale=trunc(iw/2)*2:trunc(ih/2)*2`];
          if (isVerticalProject || !isResolutionIdentical) {
            vFilters = [`scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},setsar=1`];
          } else if (clip.transform.scale.start !== 1.0) {
            const scale = clip.transform.scale.start || 1.0;
            vFilters = [`scale=trunc(iw*${scale}/2)*2:trunc(ih*${scale}/2)*2`];
          }

          // Apply Tone & Visual Filterchains
          const preset = clip.transform.filterPreset;
          const b = clip.transform.brightness ?? 1.0;
          const c = clip.transform.contrast ?? 1.0;
          const s = clip.transform.saturation ?? 1.0;

          if (preset === "NOIR_BW") {
            vFilters.push("hue=s=0,eq=contrast=1.3");
          } else if (preset === "VIVID") {
            vFilters.push("eq=contrast=1.2:saturation=1.35:brightness=0.05");
          } else if (preset === "CINEMATIC_TEAL_ORANGE") {
            vFilters.push("colorbalance=rs=-0.05:bs=0.08:rh=0.07:bh=-0.05,eq=contrast=1.25:saturation=1.2");
          } else if (preset === "VINTAGE_WARM") {
            vFilters.push("colorbalance=rh=0.08:gh=0.04:bh=-0.04,eq=contrast=1.1:saturation=1.15:brightness=0.05");
          } else if (preset === "CYBER_NEON") {
            vFilters.push("hue=h=15,eq=contrast=1.35:saturation=1.5:brightness=0.1");
          } else if (preset === "GLOW") {
            vFilters.push("eq=contrast=1.08:brightness=0.12");
          } else if (b !== 1.0 || c !== 1.0 || s !== 1.0) {
            const bOffset = (b - 1.0).toFixed(2);
            vFilters.push(`eq=brightness=${bOffset}:contrast=${c.toFixed(2)}:saturation=${s.toFixed(2)}`);
          }

          command = command
            .videoFilters(vFilters.join(","))
            .videoCodec(hw.codecName)
            .outputOptions(hw.outputOptions);

          const durSec = RationalTimeMath.toSeconds(clip.sourceRange.duration);
          const fadeOutStart = Math.max(0.01, durSec - 0.05);
          const audioFadeFilter = `afade=t=in:st=0:d=0.05,afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.05`;

          if (!source.hasAudio) {
            // Silent source (drone / screen capture): synthesize a silent stereo bed so the
            // segment still has an audio stream for concat and the ducking mixer.
            command = command
              .input("anullsrc=channel_layout=stereo:sample_rate=48000")
              .inputOptions(["-f lavfi"])
              .outputOptions(["-map 0:v?", "-map 1:a:0", "-shortest"])
              .audioCodec("aac");
          } else if (clip.volumeDb !== undefined && clip.volumeDb <= -40) {
            // Muted clip: keep a silent audio stream instead of dropping it (see above).
            command = command.audioCodec("aac").audioFilters("volume=0");
          } else if (clip.volumeDb !== undefined && clip.volumeDb !== 0.0) {
            command = command.audioCodec("aac").audioFilters(`volume=${clip.volumeDb.toFixed(1)}dB,${audioFadeFilter}`);
          } else {
            command = command.audioCodec("aac").audioFilters(audioFadeFilter);
          }

          command = command.output(segPath);
        }

        command
          .on("end", () => {
            segmentPaths.push(segPath);
            if (onProgress) {
              onProgress({
                percent: Math.round(((i + 1) / totalClips) * 60),
                currentChunk: i + 1,
                totalChunks: totalClips,
                fps: 0,
              });
            }
            resolve();
          })
          .on("error", (err: any) => reject(err))
          .run();
      });
    }

    // Step 2: Merge segments using FFmpeg Concat Demuxer
    const mergedRawVideo = path.join(tempDir, "merged_raw.mp4");
    if (segmentPaths.length === 1) {
      fs.copyFileSync(segmentPaths[0], mergedRawVideo);
    } else if (segmentPaths.length > 1) {
      const concatListPath = path.join(tempDir, "concat_list.txt");
      const listContent = segmentPaths.map((p) => `file '${path.basename(p)}'`).join("\n");
      fs.writeFileSync(concatListPath, listContent);

      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(concatListPath)
          .inputOptions(["-f concat", "-safe 0"])
          .outputOptions(["-y", "-c copy"])
          .output(mergedRawVideo)
          .on("end", () => {
            if (onProgress) onProgress({ percent: 75, currentChunk: totalClips, totalChunks: totalClips, fps: 0 });
            resolve();
          })
          .on("error", (err: any) => reject(err))
          .run();
      });
    }

    // Step 2.5: Composite Camera Zooms & Overlay Tracks (Images, Stickers, PiP, B-roll)
    const overlayTracks = editIR.tracks.videoTracks.filter(
      (t) => (t.type as any) !== "MAIN_VIDEO" && t.clips.length > 0
    );
    const cameraEvents = editIR.tracks.cameraTrack || [];
    const hasCameraZooms = cameraEvents.length > 0;
    const targetCanvasW = Math.floor(editIR.meta.resolution.width / 2) * 2;
    const targetCanvasH = Math.floor(editIR.meta.resolution.height / 2) * 2;

    let compositedVideoPath = mergedRawVideo;
    const totalProjectDurationSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);

    if (hasCameraZooms || overlayTracks.length > 0) {
      const overlaidVideo = path.join(tempDir, "overlaid_composite.mp4");
      let overlayCmd = ffmpeg(mergedRawVideo);
      let filterComplex = "";
      let lastStream = "0:v";
      let inputIdx = 1;

      if (hasCameraZooms) {
        const camFilter = this.buildCameraFilter(cameraEvents, targetCanvasW, targetCanvasH);
        if (camFilter) {
          filterComplex += `[0:v]${camFilter}[cam_zoomed];`;
          lastStream = "cam_zoomed";
        }
      }

      for (const track of overlayTracks) {
        for (const oClip of track.clips) {
          if (fs.existsSync(oClip.sourcePath)) {
            const isImg = Boolean(oClip.sourcePath.match(/\.(png|jpg|jpeg|webp|svg)$/i));
            if (isImg) {
              overlayCmd = overlayCmd.input(oClip.sourcePath).inputOptions(["-loop", "1"]);
            } else {
              overlayCmd = overlayCmd.input(oClip.sourcePath);
            }

            const oStartSec = RationalTimeMath.toSeconds(oClip.timelineRange.start);
            const oDurSec = RationalTimeMath.toSeconds(oClip.timelineRange.duration);
            const oEndSec = oStartSec + oDurSec;

            const scaleFactor = oClip.transform?.scale?.start || 1.0;
            const posX = Math.round(oClip.transform?.position?.x || 0);
            const posY = Math.round(oClip.transform?.position?.y || 0);
            const opacity = oClip.transform?.opacity ?? 1.0;

            const targetW = Math.max(16, Math.floor((editIR.meta.resolution.width * 0.42 * scaleFactor) / 2) * 2);
            const scaledLabel = `scaled_${inputIdx}`;
            const outLabel = `v_layer_${inputIdx}`;

            const posXStr = posX >= 0 ? `+${posX}` : `${posX}`;
            const posYStr = posY >= 0 ? `+${posY}` : `${posY}`;

            filterComplex += `[${inputIdx}:v]scale=${targetW}:-2,format=rgba,colorchannelmixer=aa=${opacity}[${scaledLabel}];[${lastStream}][${scaledLabel}]overlay=x=(W-w)/2${posXStr}:y=(H-h)/2${posYStr}:enable='between(t,${oStartSec.toFixed(2)},${oEndSec.toFixed(2)})':eof_action=pass[${outLabel}];`;
            lastStream = outLabel;
            inputIdx++;
          }
        }
      }

      if (filterComplex.length > 0) {
        await new Promise<void>((resolve, reject) => {
          overlayCmd
            .complexFilter(filterComplex.replace(/;$/, ""))
            .outputOptions([
              "-y",
              "-map", `[${lastStream}]`,
              "-map", "0:a?",
              "-c:a", "copy",
              "-c:v", "libx264",
              "-pix_fmt", "yuv420p",
              "-preset", "fast",
              "-crf", "18",
              "-t", `${totalProjectDurationSec}`,
            ])
            .output(overlaidVideo)
            .on("end", () => {
              compositedVideoPath = overlaidVideo;
              if (onProgress) onProgress({ percent: 80, currentChunk: totalClips, totalChunks: totalClips, fps: 0 });
              resolve();
            })
            .on("error", (err) => {
              console.error("[LosslessSplicer] Overlay/Camera compositing error:", err.message);
              // overlaidVideo never finished rendering — keep compositedVideoPath on the
              // last known-good file (mergedRawVideo) instead of pointing at the failed output.
              resolve();
            })
            .run();
        });
      }
    }

    // Step 3: Check for Captions & Multi-Track Audio Mixing (Dialogue + Ducked BGM + SFX Transients)
    const hasCaptions = editIR.tracks.captionTrack && editIR.tracks.captionTrack.length > 0;
    const bgmTrack = editIR.tracks.audioTracks.find((t) => t.type === "BGM");
    const sfxTrack = editIR.tracks.audioTracks.find((t) => t.type === "SFX");
    const hasAudioMixing =
      (bgmTrack && bgmTrack.clips.some((c) => fs.existsSync(c.sourcePath))) ||
      (sfxTrack && sfxTrack.clips.some((c) => fs.existsSync(c.sourcePath)));

    let processedAudioPath: string | null = null;
    if (hasAudioMixing) {
      const duckedAudio = path.join(tempDir, "master_ducked_audio.aac");
      await AudioDuckingMixer.mixProjectAudio(mergedRawVideo, editIR.tracks.audioTracks, duckedAudio);
      processedAudioPath = duckedAudio;
    }

    // Step 4: Final Pass (Burn ASS Subtitles / Apply Audio if needed)
    if (hasCaptions) {
      const assContent = AssSubtitleGenerator.generateAss(
        editIR.tracks.captionTrack,
        editIR.meta.resolution
      );
      const assFilePath = path.join(tempDir, "subtitles.ass");
      fs.writeFileSync(assFilePath, assContent);

      // Escape path for ffmpeg subtitles filter (especially Windows drive letter colons)
      const formattedAssPath = assFilePath.replace(/\\/g, "/").replace(/:/g, "\\:");

      await new Promise<void>((resolve, reject) => {
        let cmd = ffmpeg(compositedVideoPath);

        if (processedAudioPath && fs.existsSync(processedAudioPath)) {
          cmd = cmd
            .input(processedAudioPath)
            .complexFilter([`[0:v]ass='${formattedAssPath}'[sub_v]`])
            .outputOptions([
              "-y",
              "-map", "[sub_v]",
              "-map", "1:a:0",
              "-c:v", "libx264",
              "-pix_fmt", "yuv420p",
              "-preset", "fast",
              "-crf", "18",
              "-c:a", "aac",
              "-movflags", "+faststart",
            ]);
        } else {
          cmd = cmd
            .complexFilter([`[0:v]ass='${formattedAssPath}'[sub_v]`])
            .outputOptions([
              "-y",
              "-map", "[sub_v]",
              "-map", "0:a?",
              "-c:v", "libx264",
              "-pix_fmt", "yuv420p",
              "-preset", "fast",
              "-crf", "18",
              "-c:a", "copy",
              "-movflags", "+faststart",
            ]);
        }

        cmd
          .output(outputPath)
          .on("end", () => {
            if (onProgress) onProgress({ percent: 100, currentChunk: totalClips, totalChunks: totalClips, fps: 0 });
            resolve();
          })
          .on("error", (err: any) => {
            // Fallback: copy raw if subtitle filter is not supported in minimal builds
            fs.copyFileSync(compositedVideoPath, outputPath);
            resolve();
          })
          .run();
      });
    } else if (processedAudioPath && fs.existsSync(processedAudioPath)) {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(compositedVideoPath)
          .input(processedAudioPath)
          .outputOptions(["-y", "-c:v copy", "-map 0:v:0", "-map 1:a:0", "-c:a aac", "-movflags +faststart"])
          .output(outputPath)
          .on("end", () => {
            if (onProgress) onProgress({ percent: 100, currentChunk: totalClips, totalChunks: totalClips, fps: 0 });
            resolve();
          })
          .on("error", (err: any) => reject(err))
          .run();
      });
    } else {
      // Direct stream-copy pass with FastStart metadata
      await new Promise<void>((resolve) => {
        ffmpeg(compositedVideoPath)
          .outputOptions(["-y", "-c copy", "-movflags +faststart"])
          .output(outputPath)
          .on("end", () => {
            if (onProgress) onProgress({ percent: 100, currentChunk: totalClips, totalChunks: totalClips, fps: 0 });
            resolve();
          })
          .on("error", () => {
            fs.copyFileSync(compositedVideoPath, outputPath);
            resolve();
          })
          .run();
      });
    }

    return outputPath;
  }

  /**
   * Reads a source's video dimensions and whether it carries an audio stream.
   * An unreadable probe reports 0x0 so the caller falls back to a safe transcode.
   */
  private static probeSource(sourcePath: string): Promise<{ width: number; height: number; hasAudio: boolean }> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(sourcePath, (err: Error | null, metadata: any) => {
        if (err || !metadata) return resolve({ width: 0, height: 0, hasAudio: true });
        const video = metadata.streams?.find((s: any) => s.codec_type === "video");
        const hasAudio = Boolean(metadata.streams?.some((s: any) => s.codec_type === "audio"));
        resolve({ width: video?.width || 0, height: video?.height || 0, hasAudio });
      });
    });
  }

  /**
   * Constructs mathematical 60fps continuous spring camera zoom filter expressions.
   * Smoothly eases in and out on tracked subject coordinates without frame jitter.
   */
  private static buildCameraFilter(
    cameraEvents: CameraEvent[],
    targetW: number,
    targetH: number
  ): string {
    if (!cameraEvents || cameraEvents.length === 0) return "";

    let wExpr = "iw";
    let hExpr = "ih";
    let xExpr = "(iw-ow)*0.5";
    let yExpr = "(ih-oh)*0.38";

    for (const cam of cameraEvents) {
      const s = RationalTimeMath.toSeconds(cam.timeRange.start);
      const d = RationalTimeMath.toSeconds(cam.timeRange.duration);
      const e = s + d;
      const targetScale = cam.scale || 1.2;
      const fx = cam.targetCoords?.x ?? 0.5;
      const fy = cam.targetCoords?.y ?? 0.38;

      let zoomFactor: string;
      if (cam.spring?.overshootClamping) {
        // Persistent multi-cam take framing (e.g. 1.18x medium tight punch across take)
        zoomFactor = `${targetScale.toFixed(3)}`;
      } else {
        // Smooth dynamic emphasis punch
        const delta = targetScale - 1.0;
        zoomFactor = `(1+${delta.toFixed(3)}*sin(PI*(t-${s.toFixed(2)})/${d.toFixed(2)}))`;
      }

      wExpr = `if(between(t,${s.toFixed(2)},${e.toFixed(2)}),iw/${zoomFactor},${wExpr})`;
      hExpr = `if(between(t,${s.toFixed(2)},${e.toFixed(2)}),ih/${zoomFactor},${hExpr})`;
      xExpr = `if(between(t,${s.toFixed(2)},${e.toFixed(2)}),(iw-ow)*${fx.toFixed(2)},${xExpr})`;
      yExpr = `if(between(t,${s.toFixed(2)},${e.toFixed(2)}),(ih-oh)*${fy.toFixed(2)},${yExpr})`;
    }

    return `crop=w='${wExpr}':h='${hExpr}':x='${xExpr}':y='${yExpr}',scale=${targetW}:${targetH}`;
  }
}
