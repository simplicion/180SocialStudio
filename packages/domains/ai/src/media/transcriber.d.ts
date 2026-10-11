import type { TranscriptWordIntelligence } from "@workspace/video-contracts";
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
export declare class MediaTranscriber {
    static transcribe(mediaPath: string, options?: {
        language?: string;
        companyId?: string;
    }): Promise<TranscriptionResult>;
    private static extractAudioWav;
    private static transcribeAudioFile;
    private static mapCloudWordsToResult;
}
