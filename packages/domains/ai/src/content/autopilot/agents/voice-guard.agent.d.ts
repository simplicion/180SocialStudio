import type { AutopilotPiece } from '../types';
/** Strips invisible characters and dashes in place. Returns how many pieces changed. */
export declare function runVoiceGuard(pieces: AutopilotPiece[]): {
    cleaned: number;
};
/** Final scores and timing, computed from the text as it will be saved. Run after the critic. */
export declare function attachCraftReport(pieces: AutopilotPiece[]): void;
