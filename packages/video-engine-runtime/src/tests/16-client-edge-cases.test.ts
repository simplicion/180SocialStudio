import * as fs from "fs";
import * as path from "path";
import ffmpeg from "../ffmpeg-setup";
import { MediaProber } from "../prober";
import { SilenceAnalyzer } from "../intelligence/silence";
import { TranscriptIntelligenceService } from "../intelligence/transcript";
import { AudioDuckingMixer } from "../audio-ducking-mixer";
import { LosslessSplicer } from "../lossless-splicer";
import {
  EditIR,
  EditIRCompiler,
  RationalTimeMath,
  CreativeEditPlan,
} from "@workspace/video-contracts";

export async function runClientEdgeCasesTest(): Promise<boolean> {
  console.log("\n[Test 16] Senior Engineer Client Video Edge-Case Suite...");
  const tempDir = path.join(process.cwd(), "temp_edge_test_16");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  let allPassed = true;

  try {
    // ------------------------------------------------------------------
    // Edge Case 1: Mono Lavalier Speech vs Stereo BGM Sidechain Ducking
    // ------------------------------------------------------------------
    console.log("  [1/6] Testing Mono Lavalier Voice + Stereo BGM Audio Ducking...");
    const monoVoicePath = path.join(tempDir, "mono_voice.wav");
    const stereoBgmPath = path.join(tempDir, "stereo_bgm.wav");
    const duckedMasterPath = path.join(tempDir, "ducked_master.aac");

    // Generate 3s Mono (1 channel) voice tone
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input("sine=frequency=1000:duration=3")
        .inputOptions(["-f lavfi"])
        .audioChannels(1)
        .audioFrequency(48000)
        .output(monoVoicePath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    // Generate 3s Stereo (2 channels) BGM tone
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input("sine=frequency=300:duration=3")
        .inputOptions(["-f lavfi"])
        .audioChannels(2)
        .audioFrequency(48000)
        .output(stereoBgmPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    await AudioDuckingMixer.mixTracks(monoVoicePath, stereoBgmPath, duckedMasterPath);

    // Verify probed output is 2-channel stereo 48kHz
    const duckedProbe = await MediaProber.probeFile(duckedMasterPath);
    if (!duckedProbe.hasAudio || duckedProbe.audioChannels !== 2) {
      console.error(`  ❌ Failed: Expected 2 audio channels, got ${duckedProbe.audioChannels}`);
      allPassed = false;
    } else {
      console.log(`  ✓ Mono/Stereo mixed to 48kHz stereo master without channel conflict (${duckedProbe.audioChannels} channels)`);
    }

    // ------------------------------------------------------------------
    // Edge Case 2: Silent Video (Drone/B-Roll) Ingestion & Ducking Bypass
    // ------------------------------------------------------------------
    console.log("  [2/6] Testing Silent Video (No Audio Track) Pipeline...");
    const silentVideoPath = path.join(tempDir, "silent_drone.mp4");
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input("color=c=blue:s=640x360:d=2:r=30")
        .inputOptions(["-f lavfi"])
        .videoCodec("libx264")
        .outputOptions(["-pix_fmt yuv420p", "-an"]) // No audio
        .output(silentVideoPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    const silentProbe = await MediaProber.probeFile(silentVideoPath);
    if (silentProbe.hasAudio) {
      console.error("  ❌ Failed: Video should not have audio");
      allPassed = false;
    } else {
      console.log("  ✓ Silent video correctly probed: hasAudio = false");
    }

    const silencesOnSilent = await SilenceAnalyzer.detect(silentVideoPath, 2.0);
    if (silencesOnSilent.length !== 0) {
      console.error("  ❌ Failed: SilenceAnalyzer should return empty array for audio-less media");
      allPassed = false;
    } else {
      console.log("  ✓ SilenceAnalyzer handled audio-less media gracefully (0 errors, returned [])");
    }

    const silentBgmOut = path.join(tempDir, "silent_bgm_out.aac");
    await AudioDuckingMixer.mixTracks(silentVideoPath, stereoBgmPath, silentBgmOut);
    // The error path copies the (video-only) input verbatim, so existence alone proves nothing:
    // the output must be a real stereo audio stream with no video.
    const silentBgmProbe = fs.existsSync(silentBgmOut) ? await MediaProber.probeFile(silentBgmOut) : null;
    if (!silentBgmProbe || !silentBgmProbe.hasAudio || silentBgmProbe.audioChannels !== 2 || silentBgmProbe.codecVideo) {
      console.error(`  ❌ Failed: AudioDuckingMixer did not produce a stereo audio mix for audio-less dialogue (${JSON.stringify(silentBgmProbe && { hasAudio: silentBgmProbe.hasAudio, ch: silentBgmProbe.audioChannels, v: silentBgmProbe.codecVideo })})`);
      allPassed = false;
    } else {
      console.log("  ✓ AudioDuckingMixer substituted a silent bed for audio-less dialogue and mixed BGM to stereo");
    }

    // ------------------------------------------------------------------
    // Edge Case 3: Trailing Silence Extending to EOF
    // ------------------------------------------------------------------
    console.log("  [3/6] Testing Trailing Silence Flushed at EOF...");
    const trailingSilencePath = path.join(tempDir, "trailing_silence.wav");
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input("aevalsrc=exprs='sin(800*2*PI*t)*gt(1,t)':s=48000:d=3")
        .inputOptions(["-f lavfi"])
        .audioCodec("pcm_s16le")
        .output(trailingSilencePath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });

    const detectedSilences = await SilenceAnalyzer.detect(trailingSilencePath, 3.0);
    const endSilence = detectedSilences.find((s) => s.classification === "END_SILENCE");
    if (!endSilence) {
      console.error("  ❌ Failed: Trailing silence extending to EOF was not detected");
      allPassed = false;
    } else {
      console.log(`  ✓ EOF silence flushed and classified as END_SILENCE (start: ${endSilence.startSeconds.toFixed(1)}s, dur: ${endSilence.durationSeconds.toFixed(1)}s)`);
    }

    // ------------------------------------------------------------------
    // Edge Case 4: Multilingual International Transcript Characters
    // ------------------------------------------------------------------
    console.log("  [4/6] Testing Multilingual & Accented Script Transcript Parsing...");
    const internationalText = "¡Hola! El niño comió café en París con un señor muy simpático. Größe!";
    const transcriptResult = TranscriptIntelligenceService.parseFromTextOrSubtitles(internationalText, 5.0);

    const words = transcriptResult.words.map((w) => w.word);
    const hasAccents = words.some((w) => w.includes("niño") || w.includes("café") || w.includes("París") || w.includes("Größe"));

    if (!hasAccents) {
      console.error("  ❌ Failed: Accented international characters were stripped");
      allPassed = false;
    } else {
      console.log(`  ✓ Multilingual letters preserved: "${words.slice(0, 7).join(" ")}..."`);
    }

    // Devanagari vowel signs are combining marks (\p{M}); stripping them corrupts Hindi words.
    const hindiWords = TranscriptIntelligenceService.parseFromTextOrSubtitles("नमस्ते दुनिया", 2.0).words.map((w) => w.word);
    if (hindiWords[0] !== "नमस्ते" || hindiWords[1] !== "दुनिया") {
      console.error(`  ❌ Failed: Devanagari combining marks were stripped (got "${hindiWords.join(" ")}")`);
      allPassed = false;
    } else {
      console.log(`  ✓ Devanagari script preserved with combining vowel signs: "${hindiWords.join(" ")}"`);
    }

    // ------------------------------------------------------------------
    // Edge Case 5: Multi-Track Ripple Synchronization
    // ------------------------------------------------------------------
    console.log("  [5/6] Testing Multi-Track Ripple Delete (B-Roll & Audio SFX)...");
    const mockEditIR: EditIR = {
      version: "1.0.0",
      meta: {
        projectId: "test_proj_edge_16",
        title: "Multi-Track Ripple Test",
        targetAspect: "16:9",
        resolution: { width: 1920, height: 1080 },
        fps: { numerator: 30, denominator: 1 },
        totalDuration: RationalTimeMath.fromSeconds(20.0),
      },
      directorStyle: {
        preset: "CUSTOM",
        pacingMultiplier: 1.0,
        zoomAggressiveness: 0.5,
        brollFrequencySeconds: 15.0,
      },
      tracks: {
        videoTracks: [
          {
            id: "vtrack_main",
            type: "MAIN_VIDEO",
            zIndex: 0,
            clips: [
              {
                id: "clip_main_1",
                assetId: "asset_1",
                sourcePath: "video1.mp4",
                sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(10) },
                timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(10) },
                transform: { scale: { start: 1, end: 1, easing: "spring" }, position: { x: 0, y: 0 }, anchor: { x: 0.5, y: 0.5 }, rotationDeg: 0, opacity: 1 },
                speedMultiplier: 1.0,
                effects: [],
              },
              {
                id: "clip_main_2",
                assetId: "asset_2",
                sourcePath: "video2.mp4",
                sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(10) },
                timelineRange: { start: RationalTimeMath.fromSeconds(10), duration: RationalTimeMath.fromSeconds(10) },
                transform: { scale: { start: 1, end: 1, easing: "spring" }, position: { x: 0, y: 0 }, anchor: { x: 0.5, y: 0.5 }, rotationDeg: 0, opacity: 1 },
                speedMultiplier: 1.0,
                effects: [],
              },
            ],
          },
          {
            id: "vtrack_broll",
            type: "B_ROLL_OVERLAY",
            zIndex: 10,
            clips: [
              {
                id: "clip_broll_1",
                assetId: "broll_asset",
                sourcePath: "broll.mp4",
                sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(4) },
                timelineRange: { start: RationalTimeMath.fromSeconds(14), duration: RationalTimeMath.fromSeconds(4) },
                transform: { scale: { start: 1, end: 1, easing: "spring" }, position: { x: 0, y: 0 }, anchor: { x: 0.5, y: 0.5 }, rotationDeg: 0, opacity: 1 },
                speedMultiplier: 1.0,
                effects: [],
              },
            ],
          },
        ],
        cameraTrack: [],
        captionTrack: [],
        audioTracks: [
          {
            id: "atrack_sfx",
            type: "SFX",
            volumeDb: 0,
            duckWithSpeech: false,
            clips: [
              {
                id: "sfx_clip_1",
                sourcePath: "whoosh.wav",
                sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(2) },
                timelineRange: { start: RationalTimeMath.fromSeconds(12), duration: RationalTimeMath.fromSeconds(2) },
                volumeDb: 0,
              },
            ],
          },
        ],
      },
    };

    // Remove 4 seconds from the first clip (from 2.0s to 6.0s) with ripple: true
    const plan: CreativeEditPlan = {
      version: "1.0.0",
      intent: {
        platform: "general",
        aspectRatio: "16:9",
        resolution: { width: 1920, height: 1080 },
        stylePreset: "CUSTOM",
        energy: "medium",
        pacing: "dynamic",
        captionStyle: "HORMOZI_BOUNCE",
        audioStyle: "VOICE_PRIORITY_DUCKED",
        visualStyle: "CLEAN_ATTENTION",
      },
      constraints: {
        doNotRemoveIntro: false,
        keepEnding: false,
        protectedTimeRanges: [],
        doNotAddMusic: false,
        useUploadedBrollOnly: true,
        lockedTrackIds: [],
        preserveVoiceAudio: true,
      },
      selectedSegments: [],
      removedSegments: [],
      reorderedSegments: [],
      brollPlan: [],
      captionPlan: [],
      operations: [
        {
          type: "removeRange",
          startSec: 2.0,
          durationSec: 4.0,
          ripple: true,
          reason: "Trim dead air",
        },
      ],
      confidence: 0.95,
      explanation: "Trimmed 4 seconds dead air with multi-track ripple.",
      requiresConfirmation: false,
    };

    const compRes = EditIRCompiler.compile(mockEditIR, plan, []);
    const rippledBrollStart = RationalTimeMath.toSeconds(compRes.updatedEditIR.tracks.videoTracks[1].clips[0].timelineRange.start);
    const rippledSfxStart = RationalTimeMath.toSeconds(compRes.updatedEditIR.tracks.audioTracks[0].clips[0].timelineRange.start);

    // Initial B-Roll was at 14s; after 4s ripple, it should be at 10s
    // Initial SFX was at 12s; after 4s ripple, it should be at 8s
    if (rippledBrollStart !== 10.0 || rippledSfxStart !== 8.0) {
      console.error(`  ❌ Failed: Expected B-Roll at 10.0s (got ${rippledBrollStart}s) and SFX at 8.0s (got ${rippledSfxStart}s)`);
      allPassed = false;
    } else {
      console.log(`  ✓ Multi-track ripple shift confirmed: B-Roll shifted 14s -> ${rippledBrollStart}s, SFX shifted 12s -> ${rippledSfxStart}s`);
    }

    // ------------------------------------------------------------------
    // Edge Case 6: FastStart MP4 Metadata Verification
    // ------------------------------------------------------------------
    console.log("  [6/6] Testing FastStart MP4 Metadata (+faststart)...");
    const faststartVideoPath = path.join(tempDir, "faststart_test.mp4");

    const exportEditIR: EditIR = {
      version: "1.0.0",
      meta: {
        projectId: "test_faststart",
        title: "FastStart Test",
        targetAspect: "16:9",
        // Source is 640x360: the project canvas differs, so the splicer must reframe (not stream-copy)
        resolution: { width: 1280, height: 720 },
        fps: { numerator: 30, denominator: 1 },
        totalDuration: RationalTimeMath.fromSeconds(2.0),
      },
      directorStyle: {
        preset: "CUSTOM",
        pacingMultiplier: 1.0,
        zoomAggressiveness: 0.5,
        brollFrequencySeconds: 15.0,
      },
      tracks: {
        videoTracks: [
          {
            id: "vtrack_main",
            type: "MAIN_VIDEO",
            zIndex: 0,
            clips: [
              {
                id: "clip_silent_1",
                assetId: "asset_silent",
                sourcePath: silentVideoPath,
                sourceRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(2) },
                timelineRange: { start: RationalTimeMath.fromSeconds(0), duration: RationalTimeMath.fromSeconds(2) },
                transform: { scale: { start: 1, end: 1, easing: "spring" }, position: { x: 0, y: 0 }, anchor: { x: 0.5, y: 0.5 }, rotationDeg: 0, opacity: 1 },
                speedMultiplier: 1.0,
                effects: [],
              },
            ],
          },
        ],
        cameraTrack: [],
        captionTrack: [],
        audioTracks: [],
      },
    };

    await LosslessSplicer.render(exportEditIR, faststartVideoPath, path.join(tempDir, "lossless_temp"));

    // Check that 'moov' atom appears before 'mdat' atom in first 16KB of file
    const fileBuf = fs.readFileSync(faststartVideoPath);
    const moovPos = fileBuf.indexOf("moov");
    const mdatPos = fileBuf.indexOf("mdat");

    if (moovPos === -1 || (mdatPos !== -1 && moovPos > mdatPos)) {
      console.error(`  ❌ Failed: FastStart moov atom not placed at start of file (moov: ${moovPos}, mdat: ${mdatPos})`);
      allPassed = false;
    } else {
      console.log(`  ✓ FastStart metadata verified: 'moov' atom at offset ${moovPos} (before 'mdat' at ${mdatPos}) for instant streaming`);
    }

    const exportProbe = await MediaProber.probeFile(faststartVideoPath);
    if (exportProbe.width !== 1280 || exportProbe.height !== 720 || !exportProbe.hasAudio) {
      console.error(`  ❌ Failed: Expected 1280x720 export with an audio stream, got ${exportProbe.width}x${exportProbe.height} hasAudio=${exportProbe.hasAudio}`);
      allPassed = false;
    } else {
      console.log("  ✓ 640x360 silent source reframed to the 1280x720 project canvas with a silent stereo track");
    }

  } catch (err: any) {
    console.error("  ❌ Unexpected error during client edge cases test:", err);
    allPassed = false;
  } finally {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors on locked files
    }
  }

  if (allPassed) {
    console.log("  🎉 All 6 client video edge cases successfully verified!");
  }
  return allPassed;
}

if (require.main === module) {
  runClientEdgeCasesTest().then((passed) => {
    process.exit(passed ? 0 : 1);
  });
}
