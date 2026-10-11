import { MediaAssetDescriptor, RationalTimeMath } from "@workspace/video-contracts";

export type CameraAngleRole = "HOST_CLOSEUP" | "GUEST_CLOSEUP" | "WIDE_TWO_SHOT" | "SCREENCAST";

export interface CameraStreamInput {
  streamId: string;
  asset: MediaAssetDescriptor;
  role: CameraAngleRole;
  speakerId: "HOST" | "GUEST" | "BOTH" | "NONE";
}

export interface SpeakerTurn {
  speakerId: "HOST" | "GUEST" | "BOTH";
  startTimeSec: number;
  endTimeSec: number;
  wordCount: number;
  hasEmotionalPeak?: boolean;
}

export interface CameraSwitchDecision {
  id: string;
  streamId: string;
  role: CameraAngleRole;
  startTimeSec: number;
  durationSec: number;
  cutType: "HARD_CUT" | "J_CUT_ANTICIPATION" | "L_CUT_REACTION" | "WIDE_RESET";
  audioLeadMs?: number;
  dialogueTrailMs?: number;
  rationale: string;
}

export interface MultiCamEditPlan {
  totalDurationSec: number;
  switches: CameraSwitchDecision[];
  hostScreenTimePercent: number;
  guestScreenTimePercent: number;
  wideScreenTimePercent: number;
  reactionCutCount: number;
  summary: string;
}

export class MultiCamDirectorEngine {
  /**
   * Master Multi-Cam Conversational Director:
   * Translates multi-angle podcast or interview footage into an emotionally coherent,
   * broadcast-grade edit utilizing active speaker focus, listener reaction cutaways,
   * wide resets, and asynchronous J/L-cuts.
   */
  static directMultiCamProject(
    streams: CameraStreamInput[],
    speakerTurns: SpeakerTurn[],
    totalDurationSec: number
  ): MultiCamEditPlan {
    const switches: CameraSwitchDecision[] = [];

    const hostStream = streams.find((s) => s.role === "HOST_CLOSEUP") || streams[0];
    const guestStream = streams.find((s) => s.role === "GUEST_CLOSEUP") || streams[1] || streams[0];
    const wideStream = streams.find((s) => s.role === "WIDE_TWO_SHOT") || streams[0];

    let lastSwitchTime = 0;
    let reactionCutCount = 0;

    for (let i = 0; i < speakerTurns.length; i++) {
      const turn = speakerTurns[i];
      const nextTurn = speakerTurns[i + 1];
      const turnDuration = turn.endTimeSec - turn.startTimeSec;

      // 1. Crosstalk / Simultaneous Speech -> Wide Two-Shot
      if (turn.speakerId === "BOTH") {
        switches.push({
          id: `switch_${switches.length + 1}`,
          streamId: wideStream.streamId,
          role: "WIDE_TWO_SHOT",
          startTimeSec: turn.startTimeSec,
          durationSec: turnDuration,
          cutType: "WIDE_RESET",
          rationale: `Simultaneous crosstalk / shared reaction at ${turn.startTimeSec.toFixed(1)}s`,
        });
        lastSwitchTime = turn.endTimeSec;
        continue;
      }

      // 2. Active Speaker Angle
      const primaryStream = turn.speakerId === "HOST" ? hostStream : guestStream;
      const listenerStream = turn.speakerId === "HOST" ? guestStream : hostStream;

      // 3. J-Cut: If starting a new speaker turn, lead audio by 150ms
      const isNewSpeaker = i === 0 || speakerTurns[i - 1].speakerId !== turn.speakerId;
      const audioLeadMs = isNewSpeaker && turn.startTimeSec > 0.5 ? 150 : 0;

      // 4. If the turn is long (>4.5s) or has an emotional peak, insert an L-Cut Listener Reaction Shot
      if (turnDuration >= 4.5 || turn.hasEmotionalPeak) {
        const speakerInitialDur = Math.min(turnDuration * 0.55, 3.5);
        const reactionStart = turn.startTimeSec + speakerInitialDur;
        const reactionDur = Math.min(2.0, turn.endTimeSec - reactionStart);

        // First Segment: On Speaker
        switches.push({
          id: `switch_${switches.length + 1}`,
          streamId: primaryStream.streamId,
          role: primaryStream.role,
          startTimeSec: turn.startTimeSec,
          durationSec: speakerInitialDur,
          cutType: audioLeadMs > 0 ? "J_CUT_ANTICIPATION" : "HARD_CUT",
          audioLeadMs,
          rationale: `Active speaker (${turn.speakerId}) initial argument delivery at ${turn.startTimeSec.toFixed(1)}s`,
        });

        // Second Segment: L-Cut to Listener Reaction (Speaker dialogue trails over listener's face)
        if (reactionDur >= 1.0) {
          switches.push({
            id: `switch_${switches.length + 1}`,
            streamId: listenerStream.streamId,
            role: listenerStream.role,
            startTimeSec: reactionStart,
            durationSec: reactionDur,
            cutType: "L_CUT_REACTION",
            dialogueTrailMs: 800,
            rationale: `L-Cut listener reaction shot on ${listenerStream.speakerId} while ${turn.speakerId}'s voice continues at ${reactionStart.toFixed(1)}s`,
          });
          reactionCutCount++;
        }

        // Third Segment (if remaining duration): Cut back to speaker or wide
        const remainingTime = turn.endTimeSec - (reactionStart + reactionDur);
        if (remainingTime >= 1.2) {
          switches.push({
            id: `switch_${switches.length + 1}`,
            streamId: primaryStream.streamId,
            role: primaryStream.role,
            startTimeSec: reactionStart + reactionDur,
            durationSec: remainingTime,
            cutType: "HARD_CUT",
            rationale: `Return to active speaker (${turn.speakerId}) conclusion at ${(reactionStart + reactionDur).toFixed(1)}s`,
          });
        }
      } else {
        // Standard conversational speaker turn
        switches.push({
          id: `switch_${switches.length + 1}`,
          streamId: primaryStream.streamId,
          role: primaryStream.role,
          startTimeSec: turn.startTimeSec,
          durationSec: turnDuration,
          cutType: audioLeadMs > 0 ? "J_CUT_ANTICIPATION" : "HARD_CUT",
          audioLeadMs,
          rationale: `Conversational switch to active speaker (${turn.speakerId}) at ${turn.startTimeSec.toFixed(1)}s`,
        });
      }

      lastSwitchTime = turn.endTimeSec;

      // 5. Check for Natural Topic Transition / Long Pause -> Wide Angle Reset
      if (nextTurn && nextTurn.startTimeSec - turn.endTimeSec >= 0.8) {
        const gapStart = turn.endTimeSec;
        const gapDur = nextTurn.startTimeSec - gapStart;
        switches.push({
          id: `switch_${switches.length + 1}`,
          streamId: wideStream.streamId,
          role: "WIDE_TWO_SHOT",
          startTimeSec: gapStart,
          durationSec: gapDur,
          cutType: "WIDE_RESET",
          rationale: `Conversational reset / wide room establishing breath at ${gapStart.toFixed(1)}s`,
        });
        lastSwitchTime = nextTurn.startTimeSec;
      }
    }

    // Fill any trailing time to end of project with wide room shot
    if (lastSwitchTime < totalDurationSec) {
      switches.push({
        id: `switch_${switches.length + 1}`,
        streamId: wideStream.streamId,
        role: "WIDE_TWO_SHOT",
        startTimeSec: lastSwitchTime,
        durationSec: totalDurationSec - lastSwitchTime,
        cutType: "WIDE_RESET",
        rationale: `Outro wide room establishing shot`,
      });
    }

    // Calculate Screen Time Percentages
    let hostDuration = 0;
    let guestDuration = 0;
    let wideDuration = 0;

    for (const sw of switches) {
      if (sw.role === "HOST_CLOSEUP") hostDuration += sw.durationSec;
      else if (sw.role === "GUEST_CLOSEUP") guestDuration += sw.durationSec;
      else if (sw.role === "WIDE_TWO_SHOT") wideDuration += sw.durationSec;
    }

    const hostScreenTimePercent = Math.round((hostDuration / totalDurationSec) * 100);
    const guestScreenTimePercent = Math.round((guestDuration / totalDurationSec) * 100);
    const wideScreenTimePercent = Math.round((wideDuration / totalDurationSec) * 100);

    const summary = `Multi-Cam Direction: Generated ${switches.length} dynamic camera switches across ${totalDurationSec.toFixed(1)}s (Host: ${hostScreenTimePercent}%, Guest: ${guestScreenTimePercent}%, Wide: ${wideScreenTimePercent}%, Reaction Cuts: ${reactionCutCount}).`;

    return {
      totalDurationSec,
      switches,
      hostScreenTimePercent,
      guestScreenTimePercent,
      wideScreenTimePercent,
      reactionCutCount,
      summary,
    };
  }
}
