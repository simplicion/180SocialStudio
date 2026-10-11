import { EditIR, MediaTelemetryManifest, EditCommand } from "@workspace/video-contracts";
export interface QualityIssue {
    id: string;
    severity: "CRITICAL" | "WARNING" | "SUGGESTION";
    category: "PACING" | "VISUAL" | "AUDIO" | "SUBTITLE";
    title: string;
    description: string;
    timeRangeSec: {
        start: number;
        duration: number;
    };
    autoFixAvailable: boolean;
    suggestedAction?: string;
}
export interface VideoCritiqueReport {
    overallScore: number;
    retentionPrediction: number;
    issues: QualityIssue[];
    recommendedRepairs: EditCommand[];
}
export declare class VideoCriticService {
    /**
     * Autonomous Video QA & Critic Engine.
     * Performs deep heuristic analysis on EditIR AST and deterministic telemetry
     * to catch dead air, jarring cuts, subtitle collisions, and unpaced segments.
     */
    static analyze(editIR: EditIR, telemetry?: MediaTelemetryManifest): VideoCritiqueReport;
}
export declare const videoCriticService: VideoCriticService;
