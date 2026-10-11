import { TranscriptWordIntelligence, FillerCandidate } from "./types";
import * as crypto from "crypto";

const COMMON_FILLERS = new Set([
  "um",
  "uh",
  "er",
  "ah",
  "like",
  "basically",
  "actually",
  "literally",
  "you know",
  "sort of",
  "kind of",
]);

export class FillerAnalyzer {
  /**
   * Scans transcript words and identifies vocal filler words and stuttered false starts.
   * Classifies each candidate as REMOVE_FILLER, REMOVE_FALSE_START, or KEEP_FILLER_FOR_NATURALNESS.
   */
  static detect(words: TranscriptWordIntelligence[]): FillerCandidate[] {
    const candidates: FillerCandidate[] = [];

    for (let i = 0; i < words.length; i++) {
      const current = words[i];
      const lower = current.word.toLowerCase().replace(/[^\p{L}\p{M}]/gu, "");

      // 1. Single-word vocal fillers (um, uh, er)
      if (["um", "uh", "er", "ah"].includes(lower)) {
        candidates.push({
          id: `filler_${crypto.randomUUID().slice(0, 8)}`,
          word: current.word,
          startSeconds: current.startSeconds,
          endSeconds: current.endSeconds,
          candidateAction: "REMOVE_FILLER",
          confidence: 0.96,
          surroundingContext: this.getContext(words, i),
        });
        continue;
      }

      // 2. Multi-word phrase fillers (e.g. "you know")
      if (lower === "you" && i < words.length - 1) {
        const nextLower = words[i + 1].word.toLowerCase().replace(/[^\p{L}\p{M}]/gu, "");
        if (nextLower === "know") {
          candidates.push({
            id: `filler_${crypto.randomUUID().slice(0, 8)}`,
            word: "you know",
            startSeconds: current.startSeconds,
            endSeconds: words[i + 1].endSeconds,
            candidateAction: "REMOVE_FILLER",
            confidence: 0.9,
            surroundingContext: this.getContext(words, i, 2),
          });
          i++; // skip next word
          continue;
        }
      }

      // 3. Conversational connective fillers ("basically", "actually", "like")
      if (["basically", "actually", "literally"].includes(lower)) {
        // If it starts a sentence or clause, it might be a filler
        const isStartOfClause = i === 0 || words[i - 1].word.endsWith(".") || words[i - 1].word.endsWith(",");
        candidates.push({
          id: `filler_${crypto.randomUUID().slice(0, 8)}`,
          word: current.word,
          startSeconds: current.startSeconds,
          endSeconds: current.endSeconds,
          candidateAction: isStartOfClause ? "REMOVE_FILLER" : "KEEP_FILLER_FOR_NATURALNESS",
          confidence: 0.82,
          surroundingContext: this.getContext(words, i),
        });
        continue;
      }

      // 4. Repeated adjacent word stutters ("the the", "I I")
      if (i < words.length - 1) {
        const nextLower = words[i + 1].word.toLowerCase().replace(/[^\p{L}\p{M}]/gu, "");
        if (lower === nextLower && lower.length > 0) {
          candidates.push({
            id: `filler_${crypto.randomUUID().slice(0, 8)}`,
            word: current.word,
            startSeconds: current.startSeconds,
            endSeconds: current.endSeconds,
            candidateAction: "REMOVE_FALSE_START",
            confidence: 0.94,
            surroundingContext: this.getContext(words, i, 2),
          });
        }
      }
    }

    return candidates;
  }

  private static getContext(words: TranscriptWordIntelligence[], index: number, span: number = 1): string {
    const start = Math.max(0, index - 3);
    const end = Math.min(words.length, index + span + 3);
    return words.slice(start, end).map((w) => w.word).join(" ");
  }
}
