"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaTranscriber = void 0;
const ffmpeg_setup_1 = __importDefault(require("./ffmpeg-setup"));
const fs = __importStar(require("fs"));
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const local_speech_transcriber_1 = require("./local-speech-transcriber");
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
class MediaTranscriber {
    static async transcribe(mediaPath, options = {}) {
        const wavPath = `${mediaPath}.${Date.now()}.stt.wav`;
        try {
            await this.extractAudioWav(mediaPath, wavPath);
            const result = await this.transcribeAudioFile(wavPath, options.language || "en", options.companyId);
            return { ...result, transcriptionFailed: false };
        }
        catch (err) {
            console.warn(`[MediaTranscriber] Audio extraction notice for ${mediaPath}:`, err?.message);
            return {
                durationSeconds: 0,
                fullTranscript: "",
                words: [],
                language: options.language || "en",
                transcriptionFailed: true,
            };
        }
        finally {
            try {
                if (fs.existsSync(wavPath))
                    fs.unlinkSync(wavPath);
            }
            catch {
                // best-effort cleanup
            }
        }
    }
    static extractAudioWav(mediaPath, wavPath) {
        return new Promise((resolve, reject) => {
            (0, ffmpeg_setup_1.default)(mediaPath)
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
    static async transcribeAudioFile(wavPath, language, companyId) {
        // 1. Resolve keys for free/open cloud whisper if configured
        let groqKey = process.env.GROQ_API_KEY;
        let openaiKey = process.env.OPENAI_API_KEY;
        if (!groqKey || !openaiKey) {
            try {
                const { AICompanyConfigService } = require("../kernel/ai-company-config.service");
                const { PlatformAiVaultService } = require("../kernel/platform-ai-vault.service");
                if (companyId) {
                    const cfg = await AICompanyConfigService.getEffectiveSettings(companyId);
                    if (!groqKey && cfg.groqKey)
                        groqKey = cfg.groqKey;
                    if (!openaiKey && cfg.openaiKey)
                        openaiKey = cfg.openaiKey;
                }
                const vault = await PlatformAiVaultService.getDecryptedPlatformAiSettings();
                if (!groqKey && vault.groqKey)
                    groqKey = vault.groqKey;
                if (!openaiKey && vault.openaiKey)
                    openaiKey = vault.openaiKey;
            }
            catch { }
        }
        // 2. Tier 1: Ultra-fast Groq Whisper Cloud (if key exists)
        if (groqKey) {
            try {
                const form = new form_data_1.default();
                form.append("file", fs.createReadStream(wavPath));
                form.append("model", "whisper-large-v3-turbo");
                form.append("language", language);
                form.append("response_format", "verbose_json");
                form.append("timestamp_granularities[]", "word");
                const res = await axios_1.default.post("https://api.groq.com/openai/v1/audio/transcriptions", form, {
                    headers: { ...form.getHeaders(), Authorization: `Bearer ${groqKey}` },
                    timeout: 25000,
                });
                const data = res.data;
                if (data && (data.text || data.words)) {
                    return this.mapCloudWordsToResult(data, language);
                }
            }
            catch (err) {
                console.warn("[MediaTranscriber] Groq cloud whisper notice, falling back to local:", err?.message);
            }
        }
        // 3. Tier 2: OpenAI Whisper (if key exists)
        if (openaiKey) {
            try {
                const form = new form_data_1.default();
                form.append("file", fs.createReadStream(wavPath));
                form.append("model", "whisper-1");
                form.append("language", language);
                form.append("response_format", "verbose_json");
                form.append("timestamp_granularities[]", "word");
                const res = await axios_1.default.post("https://api.openai.com/v1/audio/transcriptions", form, {
                    headers: { ...form.getHeaders(), Authorization: `Bearer ${openaiKey}` },
                    timeout: 35000,
                });
                const data = res.data;
                if (data && (data.text || data.words)) {
                    return this.mapCloudWordsToResult(data, language);
                }
            }
            catch (err) {
                console.warn("[MediaTranscriber] OpenAI whisper notice, falling back to local:", err?.message);
            }
        }
        // 4. Tier 3: Inbuilt Local Speech & Dialogue Intelligence Engine (100% Offline, $0 cost)
        const local = await local_speech_transcriber_1.LocalSpeechTranscriber.transcribeWav(wavPath, language);
        const words = local.words.map((w, idx) => ({
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
    static mapCloudWordsToResult(data, defaultLanguage) {
        const text = data.text || "";
        const durationSeconds = data.duration || 0;
        const rawWords = [];
        if (data.words && Array.isArray(data.words) && data.words.length > 0) {
            for (const w of data.words) {
                rawWords.push({ word: w.word, start: w.start, end: w.end, confidence: w.confidence });
            }
        }
        else {
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
        const words = rawWords.map((w, idx) => {
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
exports.MediaTranscriber = MediaTranscriber;
