import * as path from "path";
import * as fs from "fs";
import { MediaAssetDescriptor } from "@workspace/video-contracts";
import { MediaProber } from "../prober";

export type SemanticAssetRole =
  | "A_ROLL_TALKING_HEAD"
  | "B_ROLL_CUTAWAY"
  | "SCREENCAST"
  | "AUDIO_VOICEOVER"
  | "AUDIO_BGM"
  | "AUDIO_SFX"
  | "GRAPHIC_STILL"
  | "BRAND_LOGO";

export interface ClassifiedAsset {
  asset: MediaAssetDescriptor;
  semanticRole: SemanticAssetRole;
  confidence: number;
  rationale: string;
  recommendedTrackIndex: number;
}

export interface ProjectClassificationReport {
  primaryARoll: ClassifiedAsset | null;
  supportiveAssets: ClassifiedAsset[];
  bgmTracks: ClassifiedAsset[];
  sfxTracks: ClassifiedAsset[];
  graphicOverlays: ClassifiedAsset[];
  summary: string;
}

export class AssetClassifier {
  /**
   * Automatically analyzes an arbitrary collection of 15–20+ uploaded files,
   * identifies the primary anchor video (A-Roll) versus supporting B-roll, screencasts,
   * audio tracks, and graphic overlays.
   */
  static async classifyProjectFiles(
    filePathsOrDescriptors: Array<string | MediaAssetDescriptor>
  ): Promise<ProjectClassificationReport> {
    const descriptors: MediaAssetDescriptor[] = [];

    for (const item of filePathsOrDescriptors) {
      if (typeof item === "string") {
        if (fs.existsSync(item)) {
          const probed = await MediaProber.probeFile(path.resolve(item));
          descriptors.push(probed);
        }
      } else {
        descriptors.push(item);
      }
    }

    if (descriptors.length === 0) {
      return {
        primaryARoll: null,
        supportiveAssets: [],
        bgmTracks: [],
        sfxTracks: [],
        graphicOverlays: [],
        summary: "No assets provided for classification.",
      };
    }

    const classified: ClassifiedAsset[] = [];

    for (const asset of descriptors) {
      const ext = path.extname(asset.filePath || asset.name).toLowerCase();
      const isVideo = ["mp4", "mov", "mkv", "webm", "avi"].some((e) => ext.includes(e)) || asset.mimeType.startsWith("video/");
      const isAudio = ["mp3", "wav", "aac", "m4a", "flac", "ogg"].some((e) => ext.includes(e)) || asset.mimeType.startsWith("audio/") || asset.isAudioOnly;
      const isImage = ["png", "jpg", "jpeg", "webp", "svg"].some((e) => ext.includes(e)) || asset.mimeType.startsWith("image/");

      if (isImage) {
        const isLogo = /logo|brand|icon|badge|watermark/i.test(asset.name);
        classified.push({
          asset,
          semanticRole: isLogo ? "BRAND_LOGO" : "GRAPHIC_STILL",
          confidence: 0.96,
          rationale: isLogo ? "Transparent vector/image brand identifier" : "Still graphic / photo overlay",
          recommendedTrackIndex: 20,
        });
      } else if (isAudio) {
        if (asset.durationSeconds < 3.5) {
          classified.push({
            asset,
            semanticRole: "AUDIO_SFX",
            confidence: 0.94,
            rationale: `Short high-transient sound effect (${asset.durationSeconds.toFixed(1)}s)`,
            recommendedTrackIndex: 30,
          });
        } else if (/bgm|music|beat|soundtrack|ambient|lofi|track/i.test(asset.name) || (asset.audioChannels ?? 0) >= 2) {
          classified.push({
            asset,
            semanticRole: "AUDIO_BGM",
            confidence: 0.92,
            rationale: `Continuous background music bed (${asset.durationSeconds.toFixed(1)}s, ${asset.audioChannels ?? 2}ch)`,
            recommendedTrackIndex: 25,
          });
        } else {
          classified.push({
            asset,
            semanticRole: "AUDIO_VOICEOVER",
            confidence: 0.88,
            rationale: `Primary vocal dialogue recording (${asset.durationSeconds.toFixed(1)}s)`,
            recommendedTrackIndex: 0,
          });
        }
      } else if (isVideo) {
        const isScreencast = /screen|record|demo|capture|obs|loom|walkthrough/i.test(asset.name) || (asset.fps <= 30 && asset.width >= 1920 && !asset.hasAudio);
        if (isScreencast) {
          classified.push({
            asset,
            semanticRole: "SCREENCAST",
            confidence: 0.93,
            rationale: "Software screencast / product UI recording",
            recommendedTrackIndex: 10,
          });
        } else if (asset.hasAudio && asset.durationSeconds >= 4.0) {
          classified.push({
            asset,
            semanticRole: "A_ROLL_TALKING_HEAD",
            confidence: 0.95,
            rationale: `Primary video stream containing synchronized audio track (${asset.durationSeconds.toFixed(1)}s, ${asset.width}x${asset.height})`,
            recommendedTrackIndex: 0,
          });
        } else {
          classified.push({
            asset,
            semanticRole: "B_ROLL_CUTAWAY",
            confidence: 0.89,
            rationale: `Supportive B-roll cutaway footage (${asset.durationSeconds.toFixed(1)}s)`,
            recommendedTrackIndex: 10,
          });
        }
      }
    }

    // Determine the Primary A-Roll: Longest A_ROLL_TALKING_HEAD
    const aRollCandidates = classified.filter((c) => c.semanticRole === "A_ROLL_TALKING_HEAD");
    let primaryARoll: ClassifiedAsset | null = null;

    if (aRollCandidates.length > 0) {
      primaryARoll = aRollCandidates.reduce((prev, curr) =>
        curr.asset.durationSeconds > prev.asset.durationSeconds ? curr : prev
      );
      // Re-tag secondary talking heads as alternate takes or B-Roll
      for (const cand of aRollCandidates) {
        if (cand !== primaryARoll) {
          cand.semanticRole = "B_ROLL_CUTAWAY";
          cand.rationale = `Secondary video clip / alternate take (${cand.asset.durationSeconds.toFixed(1)}s)`;
          cand.recommendedTrackIndex = 10;
        }
      }
    } else {
      // Fallback: Longest video file of any kind
      const videoCandidates = classified.filter((c) => c.asset.mimeType.startsWith("video/") || !c.asset.isAudioOnly);
      if (videoCandidates.length > 0) {
        primaryARoll = videoCandidates.reduce((prev, curr) =>
          curr.asset.durationSeconds > prev.asset.durationSeconds ? curr : prev
        );
        primaryARoll.semanticRole = "A_ROLL_TALKING_HEAD";
      }
    }

    const supportiveAssets = classified.filter(
      (c) => c !== primaryARoll && (c.semanticRole === "B_ROLL_CUTAWAY" || c.semanticRole === "SCREENCAST")
    );
    const bgmTracks = classified.filter((c) => c.semanticRole === "AUDIO_BGM");
    const sfxTracks = classified.filter((c) => c.semanticRole === "AUDIO_SFX");
    const graphicOverlays = classified.filter(
      (c) => c.semanticRole === "GRAPHIC_STILL" || c.semanticRole === "BRAND_LOGO"
    );

    const summary = `Classified ${classified.length} project assets: Primary A-Roll (${primaryARoll ? primaryARoll.asset.name : "None"}), ${supportiveAssets.length} B-roll cutaways, ${bgmTracks.length} BGM audio, ${sfxTracks.length} SFX, ${graphicOverlays.length} visual graphics.`;

    return {
      primaryARoll,
      supportiveAssets,
      bgmTracks,
      sfxTracks,
      graphicOverlays,
      summary,
    };
  }
}
