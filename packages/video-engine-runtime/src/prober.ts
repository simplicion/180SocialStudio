import ffmpeg from "./ffmpeg-setup";
import { MediaAssetDescriptor } from "@workspace/video-contracts";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

export interface ExtendedMediaAssetDescriptor extends MediaAssetDescriptor {
  isVfr?: boolean;
  audioChannels?: number;
  audioSampleRate?: number;
  isAudioOnly?: boolean;
}

export class MediaProber {
  static async probeFile(filePath: string): Promise<ExtendedMediaAssetDescriptor> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Media file not found: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    if (stats.isDirectory()) {
      throw new Error(`MediaProber: Expected a file path but received a directory: ${filePath}`);
    }

    // Memory-safe chunked streaming hash (handles 100MB, 500MB, 1GB, 5GB+ with 0 MB memory overhead)
    const sha256Hash = await new Promise<string>((resolveHash, rejectHash) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolveHash(hash.digest("hex")));
      stream.on("error", (err) => rejectHash(err));
    });

    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err: Error | null, metadata: any) => {
        if (err) {
          return reject(err);
        }

        const videoStream = metadata.streams?.find((s: any) => s.codec_type === "video");
        const audioStream = metadata.streams?.find((s: any) => s.codec_type === "audio");

        const ext = path.extname(filePath).toLowerCase();
        const isAudioOnly = !videoStream && !!audioStream;

        let mimeType = "video/mp4";
        if (isAudioOnly) {
          if (ext === ".mp3") mimeType = "audio/mpeg";
          else if (ext === ".wav") mimeType = "audio/wav";
          else if (ext === ".m4a" || ext === ".aac") mimeType = "audio/mp4";
          else if (ext === ".ogg") mimeType = "audio/ogg";
          else mimeType = "audio/mpeg";
        } else {
          if (ext === ".mov") mimeType = "video/quicktime";
          else if (ext === ".webm") mimeType = "video/webm";
          else if (ext === ".mkv") mimeType = "video/x-matroska";
          else mimeType = "video/mp4";
        }

        const width = videoStream?.width || (isAudioOnly ? 0 : 1920);
        const height = videoStream?.height || (isAudioOnly ? 0 : 1080);
        const durationSeconds = metadata.format?.duration ? parseFloat(metadata.format.duration) : 0;

        let fps = isAudioOnly ? 0 : 30;
        let isVfr = false;

        if (videoStream?.r_frame_rate) {
          const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
          if (num && den) fps = num / den;

          if (videoStream.avg_frame_rate) {
            const [avgNum, avgDen] = videoStream.avg_frame_rate.split("/").map(Number);
            if (avgNum && avgDen) {
              const avgFps = avgNum / avgDen;
              if (Math.abs(avgFps - fps) > 0.05) {
                isVfr = true;
              }
            }
          }
        }

        const audioChannels = audioStream?.channels ? parseInt(audioStream.channels, 10) : undefined;
        const audioSampleRate = audioStream?.sample_rate ? parseInt(audioStream.sample_rate, 10) : undefined;

        const descriptor: ExtendedMediaAssetDescriptor = {
          id: crypto.randomUUID(),
          name: filePath.split(/[\/\\]/).pop() || "unknown",
          filePath,
          fileSizeBytes: stats.size,
          mimeType,
          durationSeconds,
          width,
          height,
          fps: parseFloat(fps.toFixed(3)),
          hasAudio: !!audioStream,
          codecVideo: videoStream?.codec_name,
          codecAudio: audioStream?.codec_name,
          sha256Hash,
          isVfr,
          audioChannels,
          audioSampleRate,
          isAudioOnly,
        };

        resolve(descriptor);
      });
    });
  }
}
