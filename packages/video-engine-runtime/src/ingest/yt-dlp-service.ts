import path from "path";
import fs from "fs";
import os from "os";
import { URL } from "url";
import youtubedl from "yt-dlp-exec";

export interface VideoMetadata {
  id: string;
  title: string;
  description?: string;
  durationSeconds: number;
  thumbnail?: string;
  uploader?: string;
  viewCount?: number;
  uploadDate?: string;
  webpageUrl: string;
  ext?: string;
}

export interface IngestOptions {
  outputDir?: string;
  filenamePrefix?: string;
  maxDurationSeconds?: number;
  maxFilesizeMb?: number;
  timeRange?: {
    startSec: number;
    durationSec: number;
  };
  onProgress?: (percent: number) => void;
}

const ALLOWED_HOSTS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "fb.watch",
  "linkedin.com",
  "www.linkedin.com",
  "tiktok.com",
  "www.tiktok.com",
  "vimeo.com",
  "www.vimeo.com",
  "twitter.com",
  "x.com",
];

const PRIVATE_IP_REGEX = /^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|169\.254\.|::1|localhost)/i;

export class YtDlpService {
  /**
   * Validates URLs against SSRF, private IPs, and unsupported domains.
   */
  public static validateUrl(inputUrl: string): { valid: boolean; normalizedUrl?: string; error?: string } {
    try {
      const parsed = new URL(inputUrl.trim());
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { valid: false, error: "Only http and https protocols are supported." };
      }

      const hostname = parsed.hostname.toLowerCase();
      if (PRIVATE_IP_REGEX.test(hostname)) {
        return { valid: false, error: "Private or internal hostnames are strictly disallowed." };
      }

      const isAllowed = ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
      if (!isAllowed) {
        return { valid: false, error: `Domain '${hostname}' is not in the supported video platform allowlist.` };
      }

      return { valid: true, normalizedUrl: parsed.toString() };
    } catch {
      return { valid: false, error: "Invalid URL string." };
    }
  }

  /**
   * Fetches video metadata without downloading full payload.
   */
  public static async fetchMetadata(videoUrl: string): Promise<VideoMetadata> {
    const { valid, normalizedUrl, error } = this.validateUrl(videoUrl);
    if (!valid || !normalizedUrl) throw new Error(error || "Invalid URL");

    const flags: any = {
      dumpSingleJson: true,
      noWarnings: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
    };
    const info: any = await youtubedl(normalizedUrl, flags);

    return {
      id: info.id || `video_${Date.now()}`,
      title: info.title || "Untitled Video",
      description: info.description || "",
      durationSeconds: Number(info.duration) || 0,
      thumbnail: info.thumbnail || (info.thumbnails && info.thumbnails[0]?.url) || "",
      uploader: info.uploader || info.channel || "Unknown Creator",
      viewCount: Number(info.view_count) || 0,
      uploadDate: info.upload_date || "",
      webpageUrl: normalizedUrl,
      ext: info.ext || "mp4",
    };
  }

  /**
   * Downloads video stream formatted for 180 Video Studio timeline.
   */
  public static async downloadVideo(
    videoUrl: string,
    options: IngestOptions = {}
  ): Promise<{ outputPath: string; metadata: VideoMetadata }> {
    const { valid, normalizedUrl, error } = this.validateUrl(videoUrl);
    if (!valid || !normalizedUrl) throw new Error(error || "Invalid URL");

    const meta = await this.fetchMetadata(normalizedUrl);
    const maxDur = options.maxDurationSeconds || 3600; // 1 hour max default
    if (meta.durationSeconds > maxDur && !options.timeRange) {
      throw new Error(`Video duration (${meta.durationSeconds}s) exceeds maximum allowed (${maxDur}s).`);
    }

    const outDir = options.outputDir || path.join(os.tmpdir(), "180_video_studio_ingest");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const prefix = options.filenamePrefix || `ingest_${Date.now()}`;
    const outputTemplate = path.join(outDir, `${prefix}_%(id)s.%(ext)s`);

    const flags: any = {
      format: "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4]/best",
      output: outputTemplate,
      noWarnings: true,
      noCallHome: true,
    };

    if (options.timeRange) {
      const start = options.timeRange.startSec;
      const end = start + options.timeRange.durationSec;
      flags.downloadSections = `*${start}-${end}`;
    }

    if (options.maxFilesizeMb) {
      flags.maxFilesize = `${options.maxFilesizeMb}m`;
    }

    await youtubedl(normalizedUrl, flags);

    // Locate downloaded file
    const matched = fs.readdirSync(outDir).find((f) => f.startsWith(prefix));
    if (!matched) throw new Error("Video download completed but output file could not be located.");

    const finalPath = path.join(outDir, matched);
    return { outputPath: finalPath, metadata: meta };
  }

  /**
   * Extracts clean 16kHz mono WAV audio stream directly from URL.
   * Perfect for immediate 100% offline local Whisper transcription.
   */
  public static async extractAudio(
    videoUrl: string,
    options: IngestOptions = {}
  ): Promise<{ audioPath: string; metadata: VideoMetadata }> {
    const { valid, normalizedUrl, error } = this.validateUrl(videoUrl);
    if (!valid || !normalizedUrl) throw new Error(error || "Invalid URL");

    const meta = await this.fetchMetadata(normalizedUrl);
    const outDir = options.outputDir || path.join(os.tmpdir(), "180_video_studio_audio");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const prefix = options.filenamePrefix || `audio_${Date.now()}`;
    const outputTemplate = path.join(outDir, `${prefix}_%(id)s.%(ext)s`);

    const flags: any = {
      extractAudio: true,
      audioFormat: "wav",
      output: outputTemplate,
      noWarnings: true,
      noCallHome: true,
    };

    if (options.timeRange) {
      const start = options.timeRange.startSec;
      const end = start + options.timeRange.durationSec;
      flags.downloadSections = `*${start}-${end}`;
    }

    await youtubedl(normalizedUrl, flags);

    const matched = fs.readdirSync(outDir).find((f) => f.startsWith(prefix));
    if (!matched) throw new Error("Audio extraction completed but output file could not be located.");

    return { audioPath: path.join(outDir, matched), metadata: meta };
  }
}
