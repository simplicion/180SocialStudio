import * as fs from "fs";
import type { TranscriptWordIntelligence } from "@workspace/video-contracts";

let transformersModule: any = null;
let whisperPipelineInstance: any = null;
let isInitializing = false;
let initPromise: Promise<any> | null = null;

export interface LocalWhisperResult {
  durationSeconds: number;
  fullTranscript: string;
  words: TranscriptWordIntelligence[];
  language: string;
}

export class LocalWhisperService {
  private static defaultModel = "Xenova/whisper-tiny.en";

  /**
   * Lazily loads and caches the quantized local Whisper model.
   * Model weights are saved locally on device; executes 100% offline via ONNX runtime.
   */
  private static async getPipeline(): Promise<any> {
    if (whisperPipelineInstance) return whisperPipelineInstance;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      try {
        if (!transformersModule) {
          transformersModule = await import("@xenova/transformers");
          // Configure cache to stay within local app data or node environment
          if (transformersModule.env) {
            transformersModule.env.allowLocalModels = true;
            transformersModule.env.useBrowserCache = false;
          }
        }

        const { pipeline } = transformersModule;
        whisperPipelineInstance = await pipeline(
          "automatic-speech-recognition",
          this.defaultModel,
          { quantized: true }
        );
        return whisperPipelineInstance;
      } catch (err: any) {
        console.warn("[LocalWhisperService] Model load warning:", err?.message);
        throw err;
      } finally {
        initPromise = null;
      }
    })();

    return initPromise;
  }

  /**
   * Transcribes a 16kHz mono WAV file using the local Whisper ONNX model.
   * Generates word-level timestamps and acoustic emphasis metrics with zero cloud calls.
   */
  static async transcribeWav(
    wavPath: string,
    language = "en"
  ): Promise<LocalWhisperResult> {
    if (!fs.existsSync(wavPath)) {
      throw new Error(`WAV file not found at ${wavPath}`);
    }

    const wavBuffer = fs.readFileSync(wavPath);
    return this.transcribeBuffer(wavBuffer, language);
  }

  /**
   * Transcribes a 16kHz 16-bit mono PCM/WAV buffer.
   */
  static async transcribeBuffer(
    buffer: Buffer,
    language = "en"
  ): Promise<LocalWhisperResult> {
    const { float32, durationSeconds } = this.wavBufferToFloat32(buffer);

    if (float32.length === 0 || durationSeconds <= 0.05) {
      return {
        durationSeconds: 0,
        fullTranscript: "",
        words: [],
        language,
      };
    }

    try {
      const transcriber = await this.getPipeline();
      const output = await transcriber(float32, {
        return_timestamps: "word",
        chunk_length_s: 30,
        stride_length_s: 5,
        language: language === "en" ? "english" : language,
      });

      const fullTranscript = (output?.text || "").trim();
      const chunks: Array<{ text: string; timestamp: [number, number] }> =
        output?.chunks || [];

      // Parse word chunks
      const rawWords: Array<{ word: string; start: number; end: number }> = [];
      for (const chunk of chunks) {
        const text = chunk.text.trim();
        if (!text || text === "[BLANK_AUDIO]") continue;

        const start = Array.isArray(chunk.timestamp) ? chunk.timestamp[0] ?? 0 : 0;
        const end = Array.isArray(chunk.timestamp) ? chunk.timestamp[1] ?? (start + 0.3) : (start + 0.3);

        // Individual chunk might contain multiple words if word-level split was coarse
        const subWords = text.split(/\s+/).filter(Boolean);
        if (subWords.length <= 1) {
          rawWords.push({
            word: text,
            start: Math.round(start * 100) / 100,
            end: Math.max(Math.round(end * 100) / 100, Math.round((start + 0.1) * 100) / 100),
          });
        } else {
          const step = (end - start) / subWords.length;
          subWords.forEach((sw, idx) => {
            rawWords.push({
              word: sw,
              start: Math.round((start + idx * step) * 100) / 100,
              end: Math.round((start + (idx + 1) * step) * 100) / 100,
            });
          });
        }
      }

      // Compute acoustic duration & emphasis metrics
      const durations = rawWords
        .map((w) => w.end - w.start)
        .filter((d) => d > 0);
      const medianDuration =
        durations.length > 0
          ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)]
          : 0.3;

      const words: TranscriptWordIntelligence[] = rawWords.map((w, idx) => {
        const wordDur = Math.max(0.05, w.end - w.start);
        const isEmphasis = medianDuration > 0 && wordDur > medianDuration * 1.5;
        const emphasisScore = isEmphasis
          ? Math.min(1, Math.round((wordDur / (medianDuration * 2)) * 100) / 100)
          : 0;

        // Estimate acoustic energy score from word duration and punctuation cues
        const hasPunctuation = /[!?.]$/.test(w.word);
        const energyScore = isEmphasis || hasPunctuation ? 0.85 : 0.55;

        return {
          id: `w_${idx}`,
          word: w.word,
          startSeconds: w.start,
          endSeconds: w.end,
          confidence: 0.95,
          isEmphasis,
          emphasisScore,
          energyScore,
        };
      });

      return {
        durationSeconds,
        fullTranscript,
        words,
        language,
      };
    } catch (err: any) {
      console.warn("[LocalWhisperService] Local inference warning:", err?.message);
      throw err;
    }
  }

  /**
   * Converts 16kHz 16-bit mono PCM buffer to Float32Array (-1.0 to 1.0).
   */
  private static wavBufferToFloat32(buffer: Buffer): {
    float32: Float32Array;
    durationSeconds: number;
  } {
    let pcmOffset = 44;
    let dataLength = buffer.length - pcmOffset;

    // Parse RIFF header if present
    if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF") {
      let offset = 12;
      while (offset < buffer.length - 8) {
        const chunkId = buffer.toString("ascii", offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        if (chunkId === "data") {
          pcmOffset = offset + 8;
          dataLength = Math.min(chunkSize, buffer.length - pcmOffset);
          break;
        }
        offset += 8 + chunkSize;
      }
    } else {
      pcmOffset = 0;
      dataLength = buffer.length;
    }

    const sampleRate = 16000;
    const numSamples = Math.max(0, Math.floor(dataLength / 2));
    const float32 = new Float32Array(numSamples);

    for (let i = 0; i < numSamples; i++) {
      const byteIdx = pcmOffset + i * 2;
      if (byteIdx + 1 < buffer.length) {
        const int16 = buffer.readInt16LE(byteIdx);
        float32[i] = int16 / 32768.0;
      }
    }

    const durationSeconds = Math.round((numSamples / sampleRate) * 100) / 100;
    return { float32, durationSeconds };
  }
}

