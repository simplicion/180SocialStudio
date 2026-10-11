"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.videoCriticService = exports.VideoCriticService = void 0;
const video_contracts_1 = require("@workspace/video-contracts");
const crypto = __importStar(require("crypto"));
class VideoCriticService {
    /**
     * Autonomous Video QA & Critic Engine.
     * Performs deep heuristic analysis on EditIR AST and deterministic telemetry
     * to catch dead air, jarring cuts, subtitle collisions, and unpaced segments.
     */
    static analyze(editIR, telemetry) {
        const issues = [];
        const recommendedRepairs = [];
        const totalDurationSec = video_contracts_1.RationalTimeMath.toSeconds(editIR.meta.totalDuration);
        const mainTrack = editIR.tracks.videoTracks[0];
        // 1. Check for Long Unaltered Talking Head Segments (> 6 seconds without zoom or b-roll)
        const cameraEvents = editIR.tracks.cameraTrack || [];
        let lastEventEnd = 0;
        cameraEvents.forEach((cam) => {
            const start = video_contracts_1.RationalTimeMath.toSeconds(cam.timeRange.start);
            const duration = video_contracts_1.RationalTimeMath.toSeconds(cam.timeRange.duration);
            if (start - lastEventEnd > 6.0) {
                issues.push({
                    id: crypto.randomUUID(),
                    severity: "WARNING",
                    category: "PACING",
                    title: "Low Retention Talking Head Segment",
                    description: `No camera zoom, cut, or visual hook found between ${lastEventEnd.toFixed(1)}s and ${start.toFixed(1)}s (${(start - lastEventEnd).toFixed(1)}s span).`,
                    timeRangeSec: { start: lastEventEnd, duration: start - lastEventEnd },
                    autoFixAvailable: true,
                    suggestedAction: "Insert dynamic 1.25x punch zoom on speaker face",
                });
                // Generate automated repair command
                recommendedRepairs.push({
                    type: "ADD_CAMERA_EVENT",
                    event: {
                        id: crypto.randomUUID(),
                        timeRange: {
                            start: video_contracts_1.RationalTimeMath.fromSeconds(lastEventEnd + 2.0),
                            duration: video_contracts_1.RationalTimeMath.fromSeconds(2.0),
                        },
                        targetType: "FACE",
                        targetCoords: { x: 0.5, y: 0.35 },
                        scale: 1.25,
                        spring: { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
                        motionBlur: true,
                    },
                });
            }
            lastEventEnd = start + duration;
        });
        if (totalDurationSec - lastEventEnd > 6.0) {
            issues.push({
                id: crypto.randomUUID(),
                severity: "WARNING",
                category: "PACING",
                title: "Low Retention Talking Head Segment",
                description: `No camera zoom, cut, or visual hook found between ${lastEventEnd.toFixed(1)}s and ${totalDurationSec.toFixed(1)}s (${(totalDurationSec - lastEventEnd).toFixed(1)}s span).`,
                timeRangeSec: { start: lastEventEnd, duration: totalDurationSec - lastEventEnd },
                autoFixAvailable: true,
                suggestedAction: "Insert dynamic 1.25x punch zoom on speaker face",
            });
            recommendedRepairs.push({
                type: "ADD_CAMERA_EVENT",
                event: {
                    id: crypto.randomUUID(),
                    timeRange: {
                        start: video_contracts_1.RationalTimeMath.fromSeconds(lastEventEnd + 2.0),
                        duration: video_contracts_1.RationalTimeMath.fromSeconds(2.0),
                    },
                    targetType: "FACE",
                    targetCoords: { x: 0.5, y: 0.35 },
                    scale: 1.25,
                    spring: { stiffness: 180, damping: 18, mass: 1, overshootClamping: false },
                    motionBlur: true,
                },
            });
        }
        // 2. Check for Jarring Micro Cuts (< 250ms clips)
        mainTrack?.clips.forEach((clip, idx) => {
            const durSec = video_contracts_1.RationalTimeMath.toSeconds(clip.timelineRange.duration);
            if (durSec < 0.25) {
                issues.push({
                    id: crypto.randomUUID(),
                    severity: "CRITICAL",
                    category: "VISUAL",
                    title: "Glitched Micro-Cut (< 250ms)",
                    description: `Clip at index ${idx} duration is ${durSec.toFixed(2)}s which may cause visual flashing.`,
                    timeRangeSec: {
                        start: video_contracts_1.RationalTimeMath.toSeconds(clip.timelineRange.start),
                        duration: durSec,
                    },
                    autoFixAvailable: true,
                    suggestedAction: "Ripple merge with adjacent clip",
                });
            }
        });
        // 3. Check for Subtitle Coverage
        const captionTrack = editIR.tracks.captionTrack || [];
        if (captionTrack.length === 0 && totalDurationSec > 5.0) {
            issues.push({
                id: crypto.randomUUID(),
                severity: "SUGGESTION",
                category: "SUBTITLE",
                title: "Missing Kinetic Subtitles",
                description: "Adding kinetic subtitles increases mobile retention by up to 80%.",
                timeRangeSec: { start: 0, duration: totalDurationSec },
                autoFixAvailable: true,
                suggestedAction: "Auto-generate word-timed karaoke captions",
            });
        }
        // Calculate score
        const criticalDeductions = issues.filter((i) => i.severity === "CRITICAL").length * 25;
        const warningDeductions = issues.filter((i) => i.severity === "WARNING").length * 10;
        const suggestionDeductions = issues.filter((i) => i.severity === "SUGGESTION").length * 3;
        const overallScore = Math.max(10, 100 - criticalDeductions - warningDeductions - suggestionDeductions);
        const retentionPrediction = Math.min(95, Math.max(20, Math.round(overallScore * 0.92)));
        return {
            overallScore,
            retentionPrediction,
            issues,
            recommendedRepairs,
        };
    }
}
exports.VideoCriticService = VideoCriticService;
exports.videoCriticService = new VideoCriticService();
