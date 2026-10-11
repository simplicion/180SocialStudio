import { EditIR, TimelineContext, DirectorState, UserConstraints } from "@workspace/video-contracts";
export interface ResolveContextParams {
    editIR: EditIR;
    selectedClipId?: string | null;
    selectedRange?: {
        startSec: number;
        endSec: number;
        trackIds: string[];
        clipIds: string[];
    };
    playheadSec?: number;
    userConstraints?: Partial<UserConstraints>;
    directorState?: Partial<DirectorState>;
}
export declare class ContextResolver {
    /**
     * Compiles compact, token-efficient timeline context without sending huge video payloads.
     */
    static resolveTimelineContext(params: ResolveContextParams): TimelineContext;
    /**
     * Resolves conversational references and state updates across turns.
     */
    static updateDirectorState(currentState: DirectorState | undefined, userPrompt: string, appliedOps?: string[]): DirectorState;
}
