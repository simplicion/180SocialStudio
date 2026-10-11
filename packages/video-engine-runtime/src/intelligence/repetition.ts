import { SentenceSegment, RepetitionCandidate } from "./types";
import * as crypto from "crypto";

export class RepetitionAnalyzer {
  /**
   * Compares adjacent and nearby sentence segments to detect semantic and textual repetitions,
   * restarted thoughts, and redundant takes.
   */
  static detect(sentences: SentenceSegment[], similarityThreshold = 0.6): RepetitionCandidate[] {
    const candidates: RepetitionCandidate[] = [];

    for (let i = 0; i < sentences.length; i++) {
      const s1 = sentences[i];
      const tokens1 = this.tokenize(s1.text);
      if (tokens1.size < 3) continue;

      // Check the next 3 sentences for near-duplicate retakes
      const maxLookahead = Math.min(sentences.length, i + 4);
      for (let j = i + 1; j < maxLookahead; j++) {
        const s2 = sentences[j];
        const tokens2 = this.tokenize(s2.text);
        if (tokens2.size < 3) continue;

        const similarity = this.jaccardSimilarity(tokens1, tokens2);

        if (similarity >= similarityThreshold) {
          // If s2 is longer and more complete, recommend retaining SECOND; otherwise FIRST
          const s2Completeness = s2.words.length >= s1.words.length;
          const recommendedRetain = s2Completeness ? "SECOND" : "FIRST";

          candidates.push({
            id: `rep_${crypto.randomUUID().slice(0, 8)}`,
            firstSegment: {
              startSeconds: s1.startSeconds,
              endSeconds: s1.endSeconds,
              text: s1.text,
            },
            secondSegment: {
              startSeconds: s2.startSeconds,
              endSeconds: s2.endSeconds,
              text: s2.text,
            },
            similarity: parseFloat(similarity.toFixed(2)),
            reason: `Semantic overlap of ${Math.round(similarity * 100)}% suggests a re-take or redundant restatement.`,
            recommendedRetain,
            confidence: Math.min(0.95, similarity + 0.1),
          });
        }
      }
    }

    return candidates;
  }

  private static tokenize(text: string): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, "")
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return new Set(words);
  }

  private static jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    let intersectionCount = 0;
    for (const item of setA) {
      if (setB.has(item)) intersectionCount++;
    }
    const unionCount = setA.size + setB.size - intersectionCount;
    return unionCount === 0 ? 0 : intersectionCount / unionCount;
  }
}
