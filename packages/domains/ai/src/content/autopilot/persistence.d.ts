import type { AutopilotPiece } from './types';
export declare const AUTOPILOT_PIECE_SCHEMA = "autopilot.v1";
export declare function pieceToRow(piece: AutopilotPiece, calendarId: string, companyId: string): {
    calendarId: string;
    companyId: string;
    weekNumber: number;
    dateScheduled: Date;
    platform: "instagram" | "facebook" | "tiktok" | "youtube" | "linkedin" | "x";
    contentType: string;
    pillar: string;
    headline: string;
    adCopyFull: string;
    videoScriptOrHooks: string;
    callToAction: any;
    hashtagsResearched: string;
    visualAssetsBrief: string;
    postingTimeTz: string;
    notes: string;
    status: "ready" | "needs_review";
};
/** Parses the autopilot payload out of a stored row, or returns null for legacy rows. */
export declare function readAutopilotPayload(row: {
    videoScriptOrHooks?: unknown;
}): Record<string, any> | null;
/** Adds the autopilot fields at the top level of an API piece so clients do not parse the JSON column. */
export declare function expandAutopilotFields<T extends Record<string, any>>(row: T): T & Record<string, unknown>;
/** Rebuilds an AutopilotPiece from a stored row (for regeneration). */
export declare function rowToPiece(row: any): AutopilotPiece | null;
