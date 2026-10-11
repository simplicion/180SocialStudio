/**
 * Turns real `ffprobe -print_format json -show_format -show_streams` output into the editor's asset descriptor.
 * Pure (no IPC, no DOM) so it can be tested against canned and real ffprobe output.
 *
 * This replaces the previous bridge stub that returned the same fake metadata (12 s, 1920x1080, 30 fps) for every file.
 */

import type { MediaAssetDescriptor } from "@workspace/video-contracts";

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|svg)$/i;
const AUDIO_EXT = /\.(mp3|wav|aac|m4a|flac|ogg)$/i;

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", webm: "video/webm", avi: "video/x-msvideo",
  mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac", m4a: "audio/mp4", flac: "audio/flac", ogg: "audio/ogg",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml",
};

export interface FfprobeJson {
  format?: { duration?: string; size?: string; format_name?: string };
  streams?: Array<Record<string, any>>;
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function mimeFor(path: string): string {
  const ext = (baseName(path).split(".").pop() || "").toLowerCase();
  return MIME_BY_EXT[ext] || "application/octet-stream";
}

/** "30000/1001" -> 29.97; returns undefined for "0/0" or garbage. */
export function parseRate(rate: unknown): number | undefined {
  if (typeof rate !== "string") return undefined;
  const [n, d] = rate.split("/").map(Number);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n === 0) return undefined;
  return n / d;
}

/** Phone videos store portrait footage as landscape pixels plus a rotation flag: the displayed size is swapped. */
function rotationOf(stream: Record<string, any>): number {
  const tag = Number(stream.tags?.rotate);
  if (Number.isFinite(tag) && tag !== 0) return ((tag % 360) + 360) % 360;
  const side = (stream.side_data_list as Array<Record<string, any>> | undefined)?.find((s) => s.rotation !== undefined);
  const r = Number(side?.rotation);
  return Number.isFinite(r) ? ((r % 360) + 360) % 360 : 0;
}

export function descriptorFromFfprobe(json: FfprobeJson, nativePath: string, playbackUrl: string, assetId: string): MediaAssetDescriptor {
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && Number(s.disposition?.attached_pic) !== 1);
  const audio = streams.find((s) => s.codec_type === "audio");
  const name = baseName(nativePath);
  const isImage = IMAGE_EXT.test(name);
  const isAudioOnly = !video && !!audio;

  let width = 0;
  let height = 0;
  if (video) {
    width = Number(video.width) || 0;
    height = Number(video.height) || 0;
    const rot = rotationOf(video);
    if (rot === 90 || rot === 270) [width, height] = [height, width];
  }

  const formatDuration = parseFloat(json.format?.duration ?? "");
  const streamDuration = parseFloat(video?.duration ?? audio?.duration ?? "");
  let durationSeconds = Number.isFinite(formatDuration) && formatDuration > 0 ? formatDuration : Number.isFinite(streamDuration) ? streamDuration : 0;
  if (isImage || durationSeconds <= 0) durationSeconds = isImage ? 5 : Math.max(durationSeconds, 0);

  const avg = parseRate(video?.avg_frame_rate);
  const raw = parseRate(video?.r_frame_rate);
  const fps = isImage || !video ? 30 : Math.round(((avg ?? raw ?? 30) + Number.EPSILON) * 1000) / 1000;
  const isVfr = !!(avg && raw && Math.abs(avg - raw) / raw > 0.01);

  const size = Number(json.format?.size);
  const fileSizeBytes = Number.isFinite(size) ? Math.round(size) : 0;

  return {
    id: assetId,
    name,
    filePath: playbackUrl,
    fileSizeBytes,
    mimeType: mimeFor(name) !== "application/octet-stream" ? mimeFor(name) : isAudioOnly ? "audio/mpeg" : "video/mp4",
    durationSeconds,
    width,
    height,
    fps,
    hasAudio: !!audio && !isImage,
    audioChannels: audio ? Number(audio.channels) || undefined : undefined,
    audioSampleRate: audio ? Number(audio.sample_rate) || undefined : undefined,
    isAudioOnly: isAudioOnly || AUDIO_EXT.test(name) || undefined,
    isVfr: isVfr || undefined,
    codecVideo: video?.codec_name,
    codecAudio: audio?.codec_name,
    // Not a content hash (hashing multi-GB files in the UI is not viable): a cheap change-detection token.
    sha256Hash: `probe:${fileSizeBytes}:${durationSeconds.toFixed(3)}:${width}x${height}`,
  };
}
