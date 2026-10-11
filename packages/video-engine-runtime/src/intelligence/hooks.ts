import { SentenceSegment, HookCandidate } from "./types";
import * as crypto from "crypto";

export class HookDetector {
  /**
   * Identifies and ranks candidate opening hooks from questions, curiosity gaps,
   * strong claims, and high-energy statements.
   */
  static detect(sentences: SentenceSegment[]): HookCandidate[] {
    const candidates: HookCandidate[] = [];

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const text = s.text.trim();
      const lower = text.toLowerCase();

      // 1. Question hook ("What if...", "Why does...", "Have you ever...")
      if (s.isQuestion) {
        candidates.push({
          id: `hook_${crypto.randomUUID().slice(0, 8)}`,
          startSeconds: s.startSeconds,
          endSeconds: s.endSeconds,
          transcriptSnippet: text,
          hookType: "QUESTION",
          hookScore: 0.94,
          rationale: "Direct audience question creates immediate curiosity gap.",
          suggestedAction: i === 0 ? "RETAIN_IN_PLACE" : "USE_AS_START",
        });
        continue;
      }

      // 2. Strong claim / bold statement
      if (s.isClaim) {
        candidates.push({
          id: `hook_${crypto.randomUUID().slice(0, 8)}`,
          startSeconds: s.startSeconds,
          endSeconds: s.endSeconds,
          transcriptSnippet: text,
          hookType: "STRONG_CLAIM",
          hookScore: 0.89,
          rationale: "Strong, definitive claim immediately anchors viewer interest.",
          suggestedAction: i === 0 ? "RETAIN_IN_PLACE" : "USE_AS_START",
        });
        continue;
      }

      // 3. Curiosity gap triggers
      if (
        lower.includes("secret") ||
        lower.includes("mistake") ||
        lower.includes("nobody tells you") ||
        lower.includes("truth about")
      ) {
        candidates.push({
          id: `hook_${crypto.randomUUID().slice(0, 8)}`,
          startSeconds: s.startSeconds,
          endSeconds: s.endSeconds,
          transcriptSnippet: text,
          hookType: "CURIOSITY_GAP",
          hookScore: 0.91,
          rationale: "Curiosity gap keyword provokes strong completion desire.",
          suggestedAction: i === 0 ? "RETAIN_IN_PLACE" : "USE_AS_START",
        });
        continue;
      }

      // 4. Opening statement candidate (first 5 seconds)
      if (i === 0 && text.length > 5) {
        candidates.push({
          id: `hook_${crypto.randomUUID().slice(0, 8)}`,
          startSeconds: s.startSeconds,
          endSeconds: s.endSeconds,
          transcriptSnippet: text,
          hookType: "OPENING_STATEMENT",
          hookScore: 0.75,
          rationale: "Current introductory statement.",
          suggestedAction: "RETAIN_IN_PLACE",
        });
      }
    }

    return candidates.sort((a, b) => b.hookScore - a.hookScore);
  }

  /**
   * Alias for detect to support rankHooks signature.
   */
  static rankHooks(sentences: SentenceSegment[]): HookCandidate[] {
    return this.detect(sentences);
  }
}
