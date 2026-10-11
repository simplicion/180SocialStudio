import {
  TranscriptWordIntelligence,
  SentenceSegment,
  SpeakerSegment,
  ClassifiedSilence,
} from "./types";
import * as crypto from "crypto";
import * as fs from "fs";

export class TranscriptIntelligenceService {
  /**
   * Parses or generates structured word-level transcript from SRT/VTT subtitles,
   * embedded metadata, or deterministic vocal timing envelope.
   */
  static parseFromTextOrSubtitles(
    subtitleContentOrText: string,
    durationSeconds: number,
    silences: ClassifiedSilence[] = []
  ): {
    words: TranscriptWordIntelligence[];
    sentences: SentenceSegment[];
    speakers: SpeakerSegment[];
  } {
    // 1. Check if content is SRT format
    if (subtitleContentOrText.includes("-->")) {
      return this.parseSrt(subtitleContentOrText);
    }

    // 2. Parse text string aligned to audible speech windows
    const rawWords = subtitleContentOrText.trim().split(/\s+/).filter(Boolean);
    if (rawWords.length === 0) {
      return { words: [], sentences: [], speakers: [] };
    }

    // Calculate non-silent speech windows
    const speechWindows: Array<{ start: number; end: number }> = [];
    let currentStart = 0;

    const sortedSilences = [...silences].sort((a, b) => a.startSeconds - b.startSeconds);
    for (const s of sortedSilences) {
      if (s.startSeconds > currentStart + 0.1) {
        speechWindows.push({ start: currentStart, end: s.startSeconds });
      }
      currentStart = s.startSeconds + s.durationSeconds;
    }
    if (currentStart < durationSeconds) {
      speechWindows.push({ start: currentStart, end: durationSeconds });
    }

    if (speechWindows.length === 0) {
      speechWindows.push({ start: 0.3, end: Math.max(1, durationSeconds - 0.3) });
    }

    const totalAudibleSec = speechWindows.reduce((sum, w) => sum + (w.end - w.start), 0);
    const avgWordDuration = Math.max(0.2, Math.min(0.6, totalAudibleSec / rawWords.length));

    const words: TranscriptWordIntelligence[] = [];
    let currentWindowIdx = 0;
    let currentWindowTime = speechWindows[0].start;

    for (let i = 0; i < rawWords.length; i++) {
      const cleanWord = rawWords[i].replace(/[^\p{L}\p{M}\p{N}'?!.,\-]/gu, "");
      const isEmphasis =
        cleanWord === cleanWord.toUpperCase() && cleanWord.length > 2 ||
        Boolean(cleanWord.match(/(!|\?)$/)) ||
        ["stop", "exact", "crucial", "secret", "never", "massive", "ultimate", "huge", "result"].includes(
          cleanWord.toLowerCase()
        );

      let wStart = currentWindowTime;
      let wEnd = currentWindowTime + avgWordDuration;

      // Advance window if past bounds
      if (wEnd > speechWindows[currentWindowIdx].end && currentWindowIdx < speechWindows.length - 1) {
        currentWindowIdx++;
        currentWindowTime = speechWindows[currentWindowIdx].start;
        wStart = currentWindowTime;
        wEnd = wStart + avgWordDuration;
      }
      currentWindowTime = wEnd + 0.05;

      words.push({
        id: `word_${i}_${crypto.randomUUID().slice(0, 6)}`,
        word: cleanWord,
        startSeconds: parseFloat(wStart.toFixed(3)),
        endSeconds: parseFloat(wEnd.toFixed(3)),
        confidence: 0.96,
        speakerId: "speaker_1",
        isEmphasis,
        emphasisScore: isEmphasis ? 0.9 : 0.2,
        energyScore: isEmphasis ? 0.85 : 0.4,
      });
    }

    const sentences = this.buildSentenceSegments(words);
    const speakers: SpeakerSegment[] = [
      {
        speakerId: "speaker_1",
        speakerName: "Primary Speaker",
        startSeconds: words[0]?.startSeconds || 0,
        endSeconds: words[words.length - 1]?.endSeconds || durationSeconds,
        dominantRole: "HOST",
      },
    ];

    return { words, sentences, speakers };
  }

  /**
   * Parses standard SubRip (SRT) format with millisecond timestamps
   */
  private static parseSrt(srtContent: string): {
    words: TranscriptWordIntelligence[];
    sentences: SentenceSegment[];
    speakers: SpeakerSegment[];
  } {
    const blocks = srtContent.replace(/\r\n/g, "\n").split(/\n\s*\n/);
    const words: TranscriptWordIntelligence[] = [];

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      if (lines.length >= 2) {
        const timeLine = lines.find((l) => l.includes("-->"));
        if (!timeLine) continue;

        const [startStr, endStr] = timeLine.split("-->").map((s) => s.trim());
        const startSec = this.timestampToSeconds(startStr);
        const endSec = this.timestampToSeconds(endStr);
        const textLines = lines.slice(lines.indexOf(timeLine) + 1).join(" ");

        const blockWords = textLines.split(/\s+/).filter(Boolean);
        const blockDuration = endSec - startSec;
        const wordDur = blockDuration / Math.max(1, blockWords.length);

        for (let j = 0; j < blockWords.length; j++) {
          const w = blockWords[j];
          const wStart = startSec + j * wordDur;
          const wEnd = wStart + wordDur * 0.9;
          const isEmphasis =
            w === w.toUpperCase() && w.length > 2 ||
            Boolean(w.match(/[!?]$/)) ||
            ["stop", "look", "important", "huge", "key"].includes(w.toLowerCase());

          words.push({
            id: `word_${words.length}_${crypto.randomUUID().slice(0, 6)}`,
            word: w,
            startSeconds: parseFloat(wStart.toFixed(3)),
            endSeconds: parseFloat(wEnd.toFixed(3)),
            confidence: 0.98,
            speakerId: "speaker_1",
            isEmphasis,
            emphasisScore: isEmphasis ? 0.92 : 0.25,
            energyScore: isEmphasis ? 0.88 : 0.45,
          });
        }
      }
    }

    const sentences = this.buildSentenceSegments(words);
    const speakers: SpeakerSegment[] = [
      {
        speakerId: "speaker_1",
        speakerName: "Primary Speaker",
        startSeconds: words[0]?.startSeconds || 0,
        endSeconds: words[words.length - 1]?.endSeconds || 10,
        dominantRole: "HOST",
      },
    ];

    return { words, sentences, speakers };
  }

  private static timestampToSeconds(timestamp: string): number {
    const parts = timestamp.replace(",", ".").split(":");
    if (parts.length === 3) {
      return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    }
    return 0;
  }

  private static buildSentenceSegments(words: TranscriptWordIntelligence[]): SentenceSegment[] {
    const sentences: SentenceSegment[] = [];
    let curWords: TranscriptWordIntelligence[] = [];

    for (const w of words) {
      curWords.push(w);
      if (Boolean(w.word.match(/[.!?]$/)) || curWords.length >= 14) {
        const text = curWords.map((cw) => cw.word).join(" ");
        const isQuestion = text.trim().endsWith("?") || Boolean(text.match(/^(what|why|how|who|where|is it|can you|did you)\b/i));
        const isClaim = Boolean(text.match(/\b(the secret is|the main reason|the best way|always|never|guaranteed)\b/i));
        const isCTA = Boolean(text.match(/\b(subscribe|link in bio|follow|click below|check out|comment)\b/i));

        sentences.push({
          id: `sent_${sentences.length}_${crypto.randomUUID().slice(0, 6)}`,
          text,
          startSeconds: curWords[0].startSeconds,
          endSeconds: curWords[curWords.length - 1].endSeconds,
          words: [...curWords],
          isQuestion,
          isClaim,
          isCallToAction: isCTA,
          informationDensity: isQuestion || isClaim ? 0.85 : 0.5,
        });

        curWords = [];
      }
    }

    if (curWords.length > 0) {
      const text = curWords.map((cw) => cw.word).join(" ");
      sentences.push({
        id: `sent_${sentences.length}_${crypto.randomUUID().slice(0, 6)}`,
        text,
        startSeconds: curWords[0].startSeconds,
        endSeconds: curWords[curWords.length - 1].endSeconds,
        words: [...curWords],
        isQuestion: false,
        isClaim: false,
        isCallToAction: false,
        informationDensity: 0.5,
      });
    }

    return sentences;
  }

  /**
   * Queries transcript at a specific timestamp
   */
  static getWordAtTime(words: TranscriptWordIntelligence[], timeSec: number): TranscriptWordIntelligence | null {
    return words.find((w) => timeSec >= w.startSeconds && timeSec <= w.endSeconds) || null;
  }

  /**
   * Queries sentence at a specific timestamp
   */
  static getSentenceAtTime(sentences: SentenceSegment[], timeSec: number): SentenceSegment | null {
    return sentences.find((s) => timeSec >= s.startSeconds && timeSec <= s.endSeconds) || null;
  }
}
