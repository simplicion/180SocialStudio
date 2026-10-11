import ffmpeg from "./ffmpeg-setup";
import * as fs from "fs";
import axios from "axios";
import FormData from "form-data";
import type { TranscriptWordIntelligence } from "@workspace/video-contracts";
import { LocalSpeechTranscriber } from "./local-speech-transcriber";

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
 * Implements an inbuilt, lightweight, 100% local speech-to-text & acoustic intelligence
 * engine with optional zero-latency cloud fallback (Groq Whisper / OpenAI Whisper):
 * - ZERO Cartesia STT dependency: Cartesia is dedicated solely to Voiceforce telephony.
 * - Inbuilt Local Acoustic Transcriber runs locally via ffmpeg + VAD waveform analysis.
 * - Extracts spoken cadence, utterance pauses, syllable boundaries, and vocal punch words.
 * - Operates reliably without requiring paid cloud STT credits.
 */
export class MediaTranscriber {
  static async transcribe(
    mediaPath: string,
    options: { language?: string; companyId?: string } = {}
  ): Promise<TranscriptionResult> {
    const wavPath = `${mediaPath}.${Date.now()}.stt.wav`;
    try {
      await this.extractAudioWav(mediaPath, wavPath);
      const result = await this.transcribeAudioFile(wavPath, options.language || "en", options.companyId);
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
    language: string,
    companyId?: string
  ): Promise<Omit<TranscriptionResult, "transcriptionFailed">> {
    // 1. Resolve keys for free/open cloud whisper if configured
    let groqKey = process.env.GROQ_API_KEY;
    let openaiKey = process.env.OPENAI_API_KEY;

    if (!groqKey || !openaiKey) {
      try {
        const { AICompanyConfigService } = require("../kernel/ai-company-config.service");
        const { PlatformAiVaultService } = require("../kernel/platform-ai-vault.service");
        if (companyId) {
          const cfg = await AICompanyConfigService.getEffectiveSettings(companyId);
          if (!groqKey && cfg.groqKey) groqKey = cfg.groqKey;
          if (!openaiKey && cfg.openaiKey) openaiKey = cfg.openaiKey;
        }
        const vault = await PlatformAiVaultService.getDecryptedPlatformAiSettings();
        if (!groqKey && vault.groqKey) groqKey = vault.groqKey;
        if (!openaiKey && vault.openaiKey) openaiKey = vault.openaiKey;
      } catch {}
    }

    // 2. Tier 1: Ultra-fast Groq Whisper Cloud (if key exists)
    if (groqKey) {
      try {
        const form = new FormData();
        form.append("file", fs.createReadStream(wavPath));
        form.append("model", "whisper-large-v3-turbo");
        form.append("language", language);
        form.append("response_format", "verbose_json");
        form.append("timestamp_granularities[]", "word");

        const res = await axios.post("https://api.groq.com/openai/v1/audio/transcriptions", form, {
          headers: { ...form.getHeaders(), Authorization: `Bearer ${groqKey}` },
          timeout: 25000,
        });

        const data = res.data;
        if (data && (data.text || data.words)) {
          return this.mapCloudWordsToResult(data, language);
        }
      } catch (err: any) {
        console.warn("[MediaTranscriber] Groq cloud whisper notice, falling back to local:", err?.message);
      }
    }

    // 3. Tier 2: OpenAI Whisper (if key exists)
    if (openaiKey) {
      try {
        const form = new FormData();
        form.append("file", fs.createReadStream(wavPath));
        form.append("model", "whisper-1");
        form.append("language", language);
        form.append("response_format", "verbose_json");
        form.append("timestamp_granularities[]", "word");

        const res = await axios.post("https://api.openai.com/v1/audio/transcriptions", form, {
          headers: { ...form.getHeaders(), Authorization: `Bearer ${openaiKey}` },
          timeout: 35000,
        });

        const data = res.data;
        if (data && (data.text || data.words)) {
          return this.mapCloudWordsToResult(data, language);
        }
      } catch (err: any) {
        console.warn("[MediaTranscriber] OpenAI whisper notice, falling back to local:", err?.message);
      }
    }

    // 4. Tier 3: Inbuilt Local Speech & Dialogue Intelligence Engine (100% Offline, $0 cost)
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

  private static mapCloudWordsToResult(
    data: any,
    defaultLanguage: string
  ): Omit<TranscriptionResult, "transcriptionFailed"> {
    const text: string = data.text || "";
    const durationSeconds = data.duration || 0;
    const rawWords: Array<{ word: string; start: number; end: number; confidence?: number }> = [];

    if (data.words && Array.isArray(data.words) && data.words.length > 0) {
      for (const w of data.words) {
        rawWords.push({ word: w.word, start: w.start, end: w.end, confidence: w.confidence });
      }
    } else {
      const tokens = text.trim().split(/\s+/).filter(Boolean);
      if (tokens.length > 0 && durationSeconds > 0) {
        const wordDur = Math.max(0.25, Math.min(0.55, (durationSeconds - 0.6) / tokens.length));
        let cur = 0.3;
        for (const token of tokens) {
          rawWords.push({ word: token, start: cur, end: cur + wordDur * 0.85 });
          cur += wordDur;
        }
      }
    }

    const durations = rawWords.map((w) => w.end - w.start).filter((d) => d > 0);
    const medianDuration = durations.length > 0 ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)] : 0;

    const words: TranscriptWordIntelligence[] = rawWords.map((w, idx) => {
      const wordDuration = w.end - w.start;
      const isEmphasis = medianDuration > 0 && wordDuration > medianDuration * 1.6;
      return {
        id: `w_${idx}`,
        word: w.word,
        startSeconds: w.start,
        endSeconds: w.end,
        confidence: w.confidence ?? 0.95,
        isEmphasis,
        emphasisScore: isEmphasis ? Math.min(1, wordDuration / (medianDuration * 2)) : 0,
        energyScore: 0.5,
      };
    });

    return {
      durationSeconds,
      fullTranscript: text,
      words,
      language: data.language || defaultLanguage,
    };
  }
}
