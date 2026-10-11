import { EditIR, VideoClip, AudioTrack } from "./edit-ir.schema";
import { RationalTime, RationalTimeMath, TimeRange } from "./time";

function generateUUID(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface OtioRationalTime {
  value: number;
  rate: number;
}

export interface OtioTimeRange {
  start_time: OtioRationalTime;
  duration: OtioRationalTime;
}

export interface OtioItem {
  OTIO_SCHEMA: string;
  name: string;
  source_range?: OtioTimeRange;
  media_reference?: {
    OTIO_SCHEMA: string;
    target_url: string;
    available_range?: OtioTimeRange;
  };
  metadata?: Record<string, any>;
}

export interface OtioTrack {
  OTIO_SCHEMA: "Track.1";
  name: string;
  kind: "Video" | "Audio";
  children: OtioItem[];
}

export interface OtioStack {
  OTIO_SCHEMA: "Stack.1";
  name: string;
  children: OtioTrack[];
}

export interface OtioTimeline {
  OTIO_SCHEMA: "Timeline.1";
  name: string;
  global_start_time?: OtioRationalTime;
  tracks: OtioStack;
  metadata?: Record<string, any>;
}

export class OtioAdapter {
  /**
   * Serializes a native EditIR AST into standard OpenTimelineIO JSON string.
   */
  static toOtioJson(editIR: EditIR): string {
    const otio = this.toOtio(editIR);
    return JSON.stringify(otio, null, 2);
  }

  /**
   * Deserializes standard OpenTimelineIO JSON string into a native EditIR AST.
   */
  static fromOtioJson(jsonString: string): EditIR {
    const parsed = JSON.parse(jsonString);
    return this.fromOtio(parsed);
  }

  /**
   * Serializes a native EditIR AST into standard OpenTimelineIO JSON format.
   * Compatible with DaVinci Resolve, Final Cut Pro, and Adobe Premiere OTIO importers.
   */
  static toOtio(editIR: EditIR): OtioTimeline {
    const otioTracks: OtioTrack[] = [];

    // 1. Convert Video Tracks
    editIR.tracks.videoTracks.forEach((vt, vIdx) => {
      const children: OtioItem[] = vt.clips.map((c) => {
        const startSec = RationalTimeMath.toSeconds(c.sourceRange.start);
        const durationSec = RationalTimeMath.toSeconds(c.sourceRange.duration);
        const fps = editIR.meta.fps.numerator / editIR.meta.fps.denominator;

        return {
          OTIO_SCHEMA: "Clip.1",
          name: c.sourcePath.split(/[\/\\]/).pop() || `Clip_${c.id}`,
          source_range: {
            start_time: { value: Math.round(startSec * fps), rate: fps },
            duration: { value: Math.round(durationSec * fps), rate: fps },
          },
          media_reference: {
            OTIO_SCHEMA: "ExternalReference.1",
            target_url: `file://${c.sourcePath.replace(/\\/g, "/")}`,
          },
          metadata: {
            "180workspace": {
              clipId: c.id,
              assetId: c.assetId,
              transform: c.transform,
              speedMultiplier: c.speedMultiplier,
            },
          },
        };
      });

      otioTracks.push({
        OTIO_SCHEMA: "Track.1",
        name: `Video_${vIdx + 1}`,
        kind: "Video",
        children,
      });
    });

    // 2. Convert Audio Tracks
    editIR.tracks.audioTracks.forEach((at, aIdx) => {
      const children: OtioItem[] = at.clips.map((c) => {
        const startSec = RationalTimeMath.toSeconds(c.sourceRange.start);
        const durationSec = RationalTimeMath.toSeconds(c.sourceRange.duration);
        const sampleRate = 48000;

        return {
          OTIO_SCHEMA: "Clip.1",
          name: c.sourcePath.split(/[\/\\]/).pop() || `Audio_${c.id}`,
          source_range: {
            start_time: { value: Math.round(startSec * sampleRate), rate: sampleRate },
            duration: { value: Math.round(durationSec * sampleRate), rate: sampleRate },
          },
          media_reference: {
            OTIO_SCHEMA: "ExternalReference.1",
            target_url: `file://${c.sourcePath.replace(/\\/g, "/")}`,
          },
          metadata: {
            "180workspace": {
              audioClipId: c.id,
              volumeDb: c.volumeDb,
            },
          },
        };
      });

      otioTracks.push({
        OTIO_SCHEMA: "Track.1",
        name: `Audio_${aIdx + 1}_${at.type}`,
        kind: "Audio",
        children,
      });
    });

    return {
      OTIO_SCHEMA: "Timeline.1",
      name: editIR.meta.title || "180 Workspace Export",
      global_start_time: { value: 0, rate: editIR.meta.fps.numerator / editIR.meta.fps.denominator },
      tracks: {
        OTIO_SCHEMA: "Stack.1",
        name: "Tracks",
        children: otioTracks,
      },
      metadata: {
        "180workspace": {
          projectId: editIR.meta.projectId,
          version: editIR.version,
          targetAspect: editIR.meta.targetAspect,
          resolution: editIR.meta.resolution,
          cameraTrack: editIR.tracks.cameraTrack,
          captionTrack: editIR.tracks.captionTrack,
          directorStyle: editIR.directorStyle,
        },
      },
    };
  }

  /**
   * Deserializes an OpenTimelineIO structure into a native EditIR AST.
   */
  static fromOtio(otio: OtioTimeline): EditIR {
    const meta180 = otio.metadata?.["180workspace"] || {};
    const fpsRate = otio.global_start_time?.rate || 30;

    let totalDurationSec = 0;
    const videoTracks: any[] = [];
    const audioTracks: AudioTrack[] = [];

    otio.tracks.children.forEach((track, tIdx) => {
      if (track.kind === "Video") {
        let currentTimelineTimeSec = 0;
        const clips: VideoClip[] = [];

        track.children.forEach((item) => {
          if (item.OTIO_SCHEMA === "Clip.1" && item.source_range) {
            const startSec = item.source_range.start_time.value / item.source_range.start_time.rate;
            const durationSec = item.source_range.duration.value / item.source_range.duration.rate;
            const targetUrl = item.media_reference?.target_url || "";
            const filePath = targetUrl.replace(/^file:\/\//, "");

            const meta = item.metadata?.["180workspace"] || {};

            clips.push({
              id: meta.clipId || generateUUID(),
              assetId: meta.assetId || `asset_${clips.length + 1}`,
              sourcePath: filePath,
              sourceRange: {
                start: RationalTimeMath.fromSeconds(startSec),
                duration: RationalTimeMath.fromSeconds(durationSec),
              },
              timelineRange: {
                start: RationalTimeMath.fromSeconds(currentTimelineTimeSec),
                duration: RationalTimeMath.fromSeconds(durationSec),
              },
              transform: meta.transform || {
                scale: { start: 1.0, end: 1.0, easing: "spring" },
                position: { x: 0.0, y: 0.0 },
                anchor: { x: 0.5, y: 0.5 },
                rotationDeg: 0,
                opacity: 1.0,
              },
              speedMultiplier: meta.speedMultiplier || 1.0,
              effects: [],
            });

            currentTimelineTimeSec += durationSec;
          }
        });

        if (currentTimelineTimeSec > totalDurationSec) {
          totalDurationSec = currentTimelineTimeSec;
        }

        videoTracks.push({
          id: generateUUID(),
          type: tIdx === 0 ? "MAIN_VIDEO" : "B_ROLL_OVERLAY",
          zIndex: tIdx,
          clips,
        });
      } else if (track.kind === "Audio") {
        audioTracks.push({
          id: generateUUID(),
          type: "PRIMARY_VOICE",
          volumeDb: 0.0,
          duckWithSpeech: false,
          clips: [],
        });
      }
    });

    if (videoTracks.length === 0) {
      videoTracks.push({
        id: generateUUID(),
        type: "MAIN_VIDEO",
        zIndex: 0,
        clips: [],
      });
    }

    return {
      version: "1.0.0",
      meta: {
        projectId: meta180.projectId || generateUUID(),
        title: otio.name || "Imported OTIO Project",
        targetAspect: meta180.targetAspect || "16:9",
        resolution: meta180.resolution || { width: 1920, height: 1080 },
        fps: { numerator: Math.round(fpsRate), denominator: 1 },
        totalDuration: RationalTimeMath.fromSeconds(totalDurationSec),
      },
      directorStyle: meta180.directorStyle || {
        preset: "MRBEAST_FAST",
        pacingMultiplier: 1.0,
        zoomAggressiveness: 0.5,
        brollFrequencySeconds: 15.0,
      },
      tracks: {
        videoTracks,
        cameraTrack: meta180.cameraTrack || [],
        captionTrack: meta180.captionTrack || [],
        audioTracks,
      },
    };
  }
}
