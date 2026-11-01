import ffmpeg from "./ffmpeg-setup";
import * as fs from "fs";
import type { TranscriptWordIntelligence } from "@workspace/video-contracts";
import { LocalSpeechTranscriber } from "./local-speech-transcriber";
import { LocalWhisperService } from "./local-whisper";

export interface TranscriptionResult {
  durationSeconds: number;
  fullTranscript: string;
  words: TranscriptWordIntelligence[];
  language: string;
  transcriptionFailed: boolean;
}

/**
 * MediaTranscriber for 180 Social Studio & AI Director
 *
 * Implements a 100% local, offline, on-device Whisper speech-to-text intelligence runtime:
 * - ZERO external cloud API dependencies (Groq, OpenAI, or Cartesia).
 * - Runs ONNX-quantized local Whisper with word-level timestamps and acoustic emphasis scoring.
 * - Falls back seamlessly to acoustic VAD cadence analysis if speech is absent.
 * - Absolute data privacy: audio waveforms never leave the user's local machine.
 */
export class MediaTranscriber {
  static async transcribe(
    mediaPath: string,
    options: { language?: string; companyId?: string } = {}
  ): Promise<TranscriptionResult> {
    const wavPath = `${mediaPath}.${Date.now()}.stt.wav`;
    try {
      await this.extractAudioWav(mediaPath, wavPath);
      const result = await this.transcribeAudioFile(wavPath, options.language || "en");
      return { ...result, transcriptionFailed: false };
    } catch (err: any) {
      console.warn(`[MediaTranscriber] Audio extraction notice for ${mediaPath}:`, err?.message);
      return {
        durationSeconds: 0,
        fullTranscript: "",
        words: [],
        language: options.language || "en",
        transcriptionFailed: true,
      };
    } finally {
      try {
        if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
      } catch {
        // best-effort cleanup
      }
    }
  }

  private static extractAudioWav(mediaPath: string, wavPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(mediaPath)
        .noVideo()
        .audioCodec("pcm_s16le")
        .audioChannels(1)
        .audioFrequency(16000)
        .outputOptions(["-y"])
        .output(wavPath)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
  }

  private static async transcribeAudioFile(
    wavPath: string,
    language: string
  ): Promise<Omit<TranscriptionResult, "transcriptionFailed">> {
    // 1. Primary: 100% Local Whisper ONNX Speech Recognition Runtime
    try {
      const whisperResult = await LocalWhisperService.transcribeWav(wavPath, language);
      if (whisperResult && (whisperResult.words.length > 0 || whisperResult.fullTranscript.length > 0)) {
        return whisperResult;
      }
    } catch (err: any) {
      console.warn("[MediaTranscriber] Local Whisper engine notice, falling back to acoustic VAD:", err?.message);
    }

    // 2. Secondary: Acoustic Waveform Cadence & Energy Transcriber (offline fallback)
    const local = await LocalSpeechTranscriber.transcribeWav(wavPath, language);
    const words: TranscriptWordIntelligence[] = local.words.map((w, idx) => ({
      id: w.id || `w_${idx}`,
      word: w.word,
      startSeconds: w.startSeconds,
      endSeconds: w.endSeconds,
      confidence: w.confidence ?? 0.95,
      isEmphasis: Boolean(w.isEmphasis),
      emphasisScore: w.emphasisScore ?? (w.isEmphasis ? 0.85 : 0),
      energyScore: w.energyScore ?? 0.5,
    }));

    return {
      durationSeconds: local.durationSeconds,
      fullTranscript: local.fullTranscript,
      words,
      language: local.language || language,
    };
  }
}
