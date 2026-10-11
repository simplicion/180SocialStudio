import {
  SentenceSegment,
  ShotSegment,
  HighlightSegment,
  HookCandidate,
} from "./types";
import * as crypto from "crypto";

export class HighlightScorer {
  /**
   * Calculates multi-dimensional retention and highlight potential scores
   * across temporal segments of the media.
   */
  static scoreSegments(
    sentences: SentenceSegment[],
    shots: ShotSegment[]
  ): HighlightSegment[] {
    const highlights: HighlightSegment[] = [];

    for (let i = 0; i < sentences.length; i++) {
      const sent = sentences[i];
      const duration = sent.endSeconds - sent.startSeconds;
      if (duration < 1.0) continue;

      // Calculate component scores
      const hookScore = sent.isQuestion ? 0.92 : sent.isClaim ? 0.88 : i === 0 ? 0.8 : 0.45;
      const informationScore = sent.informationDensity;
      const emotionScore = sent.isQuestion || sent.isClaim ? 0.8 : 0.4;

      // Find intersecting shots for visual interest
      const intersecting = shots.filter(
        (s) => Math.max(sent.startSeconds, s.startSeconds) < Math.min(sent.endSeconds, s.endSeconds)
      );
      const visualInterestScore =
        intersecting.length > 0
          ? intersecting.reduce((acc, s) => acc + s.visualActivity, 0) / intersecting.length
          : 0.5;

      const speechEnergy = sent.isClaim ? 0.85 : 0.6;
      const audioEnergy = speechEnergy * 0.9;
      const noveltyScore = i < 3 ? 0.85 : 0.6;
      const repetitionScore = 0.1;
      const deadAirScore = 0.05;
      const brollPotential = sent.isClaim || sent.informationDensity > 0.6 ? 0.85 : 0.3;

      // Weighted composite score (analytical signal, not virality guarantee)
      const retentionCandidateScore =
        0.3 * hookScore +
        0.25 * informationScore +
        0.2 * visualInterestScore +
        0.15 * speechEnergy +
        0.1 * noveltyScore;

      highlights.push({
        id: `hl_${crypto.randomUUID().slice(0, 8)}`,
        startSeconds: sent.startSeconds,
        endSeconds: sent.endSeconds,
        durationSeconds: parseFloat(duration.toFixed(2)),
        hookScore: parseFloat(hookScore.toFixed(2)),
        informationScore: parseFloat(informationScore.toFixed(2)),
        emotionScore: parseFloat(emotionScore.toFixed(2)),
        visualInterestScore: parseFloat(visualInterestScore.toFixed(2)),
        speechEnergy: parseFloat(speechEnergy.toFixed(2)),
        audioEnergy: parseFloat(audioEnergy.toFixed(2)),
        noveltyScore: parseFloat(noveltyScore.toFixed(2)),
        repetitionScore: parseFloat(repetitionScore.toFixed(2)),
        deadAirScore: parseFloat(deadAirScore.toFixed(2)),
        brollPotential: parseFloat(brollPotential.toFixed(2)),
        retentionCandidateScore: parseFloat(retentionCandidateScore.toFixed(2)),
        summary: sent.text,
      });
    }

    return highlights.sort((a, b) => b.retentionCandidateScore - a.retentionCandidateScore);
  }
}

export { HookDetector } from "./hooks";
