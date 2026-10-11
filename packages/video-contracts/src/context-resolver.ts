import { EditIR } from "./edit-ir.schema";
import { TimelineContext, DirectorState, UserConstraints } from "./creative-plan.schema";
import { RationalTimeMath } from "./time";

export interface ResolveContextParams {
  editIR: EditIR;
  selectedClipId?: string | null;
  selectedRange?: { startSec: number; endSec: number; trackIds: string[]; clipIds: string[] };
  playheadSec?: number;
  userConstraints?: Partial<UserConstraints>;
  directorState?: Partial<DirectorState>;
}

export class ContextResolver {
  /**
   * Compiles compact, token-efficient timeline context without sending huge video payloads.
   */
  static resolveTimelineContext(params: ResolveContextParams): TimelineContext {
    const { editIR, selectedClipId, selectedRange, playheadSec, userConstraints, directorState } = params;

    const totalDurationSec = RationalTimeMath.toSeconds(editIR.meta.totalDuration);
    const mainTrack = editIR.tracks.videoTracks[0];
    const clips = mainTrack ? mainTrack.clips : [];

    const assetIds = Array.from(new Set(clips.map((c) => c.assetId)));

    const constraints: UserConstraints = {
      doNotRemoveIntro: userConstraints?.doNotRemoveIntro ?? false,
      keepEnding: userConstraints?.keepEnding ?? false,
      protectedTimeRanges: userConstraints?.protectedTimeRanges ?? [],
      doNotAddMusic: userConstraints?.doNotAddMusic ?? false,
      useUploadedBrollOnly: userConstraints?.useUploadedBrollOnly ?? true,
      lockedTrackIds: userConstraints?.lockedTrackIds ?? [],
      preserveVoiceAudio: userConstraints?.preserveVoiceAudio ?? true,
      lockedTracks: userConstraints?.lockedTracks ?? [],
    };

    return {
      projectDurationSec: parseFloat(totalDurationSec.toFixed(2)),
      tracksCount: editIR.tracks.videoTracks.length + editIR.tracks.audioTracks.length + 2,
      clipsCount: clips.length,
      assetIds,
      selectedRange,
      selectedClipId: selectedClipId || null,
      currentAspect: editIR.meta.targetAspect,
      currentResolution: editIR.meta.resolution,
      currentPlayheadSec: playheadSec ?? 0,
      existingCaptionsCount: editIR.tracks.captionTrack.length,
      existingEffects: [],
      existingAudioTracks: editIR.tracks.audioTracks.map((t) => t.type),
      lockedTrackIds: constraints.lockedTrackIds,
      userConstraints: constraints,
      directorPreferences: directorState?.preferences || {},
    };
  }

  /**
   * Resolves conversational references and state updates across turns.
   */
  static updateDirectorState(
    currentState: DirectorState | undefined,
    userPrompt: string,
    appliedOps: string[] = []
  ): DirectorState {
    const base: DirectorState = currentState || {
      intent: {
        platform: "general",
        aspectRatio: "16:9",
        resolution: { width: 1920, height: 1080 },
        stylePreset: "CUSTOM",
        energy: "medium",
        pacing: "dynamic",
        captionStyle: "HORMOZI_BOUNCE",
        audioStyle: "VOICE_PRIORITY_DUCKED",
        visualStyle: "CLEAN_ATTENTION",
      },
      preferences: {},
      constraints: {
        doNotRemoveIntro: false,
        keepEnding: false,
        protectedTimeRanges: [],
        doNotAddMusic: false,
        useUploadedBrollOnly: true,
        lockedTrackIds: [],
        preserveVoiceAudio: true,
        lockedTracks: [],
      },
      priorDecisions: [],
      currentStyle: "CUSTOM",
      currentTarget: "general",
      appliedOperations: [],
    };

    const lower = userPrompt.toLowerCase();

    if (lower.includes("don't remove the intro") || lower.includes("keep the intro") || lower.includes("don't touch the intro")) {
      base.constraints.doNotRemoveIntro = true;
      base.priorDecisions.push("User explicitly locked the intro from cuts.");
    }
    if (lower.includes("keep the ending") || lower.includes("don't remove the ending")) {
      base.constraints.keepEnding = true;
      base.priorDecisions.push("User explicitly locked the ending.");
    }
    if (lower.includes("don't add music") || lower.includes("no music")) {
      base.constraints.doNotAddMusic = true;
    }

    if (appliedOps.length > 0) {
      base.appliedOperations.push(...appliedOps);
    }

    return base;
  }
}
