import type { TranscriptWordIntelligence } from "@workspace/video-contracts";
export interface LocalTranscriptionResult {
    durationSeconds: number;
    fullTranscript: string;
    words: TranscriptWordIntelligence[];
    language: string;
    speechRatio: number;
    silenceCount: number;
}
/**
 * Inbuilt Lightweight Local Speech & Dialogue Intelligence Engine
 *
 * Analyzes audio/video soundtracks 100% locally using ffmpeg + acoustic waveform analysis:
 * - Reads 16kHz 16-bit mono PCM audio
 * - Computes Voice Activity Detection (VAD), RMS energy, and Zero Crossing Rate (ZCR)
 * - Identifies natural speech bursts, breath pauses, and syllable/word boundaries
 * - Detects vocal emphasis and punch words based on acoustic energy peaks
 * - Extracts embedded subtitle tracks (SRT, MOV_TEXT, VTT) if present in the video container
 * - Operates with zero paid cloud dependencies, sub-50ms execution speed, and 0 cost
 */
export declare class LocalSpeechTranscriber {
    /**
     * Transcribes a 16kHz 16-bit mono PCM WAV file locally.
     */
    static transcribeWav(wavPath: string, language?: string): Promise<LocalTranscriptionResult>;
    /**
     * Inspects a media file for embedded subtitle/closed-caption streams (e.g. mov_text, srt, vtt).
     */
    static extractEmbeddedCaptions(mediaPath: string): Promise<string | null>;
    /**
     * Processes a 16kHz 16-bit mono PCM buffer (WAV or raw PCM) into structured speech intelligence.
     */
    static transcribePcmBuffer(buffer: Buffer, language?: string): LocalTranscriptionResult;
}
