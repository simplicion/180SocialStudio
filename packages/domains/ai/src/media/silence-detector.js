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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SilenceAnalyzer = void 0;
const ffmpeg_setup_1 = __importDefault(require("./ffmpeg-setup"));
const crypto = __importStar(require("crypto"));
const video_contracts_1 = require("@workspace/video-contracts");
/**
 * Real ffmpeg-based silence detection + classification, generalized from
 * packages/video-engine-runtime/src/intelligence/silence.ts.
 *
 * Difference from that version: `averageDecibels` is no longer fabricated as
 * `noiseThreshold - 5` (an invented number, not a measurement). Instead it is the
 * source file's actual measured mean volume (via ffmpeg's `volumedetect` filter,
 * one pass, shared across all intervals) — a real, if track-wide rather than
 * per-interval, loudness reading.
 */
class SilenceAnalyzer {
    static async detect(mediaPath, totalDurationSeconds, options = {}) {
        const noiseThreshold = options.noiseThresholdDb ?? -35;
        const minDuration = options.minDurationSeconds ?? 0.3;
        const [rawIntervals, measuredMeanDb] = await Promise.all([
            this.detectSilenceIntervals(mediaPath, totalDurationSeconds, noiseThreshold, minDuration),
            this.measureMeanVolumeDb(mediaPath),
        ]);
        const classified = [];
        for (const { start, duration } of rawIntervals) {
            const end = start + duration;
            let classification;
            let recommendation;
            let confidence = 0.95;
            let contextReason = "";
            if (start < 0.25) {
                classification = "START_SILENCE";
                recommendation = "REMOVE";
                confidence = 0.98;
                contextReason = "Introductory dead air hurts initial retention hook.";
            }
            else if (end >= totalDurationSeconds - 0.5) {
                classification = "END_SILENCE";
                recommendation = "REMOVE";
                confidence = 0.98;
                contextReason = "Trailing silence after dialogue should be trimmed.";
            }
            else if (duration < 0.45) {
                classification = "SHORT_NATURAL_PAUSE";
                recommendation = "KEEP";
                confidence = 0.9;
                contextReason = "Natural speech breathing pause; keeping preserves natural vocal rhythm.";
            }
            else if (duration > 0.6) {
                classification = "DEAD_AIR";
                recommendation = "REMOVE";
                confidence = 0.95;
                contextReason = `Unnatural silence of ${duration.toFixed(2)}s causes retention drop; candidate for ripple cut.`;
            }
            else {
                classification = "DRAMATIC_PAUSE";
                recommendation = "POTENTIALLY_KEEP";
                confidence = 0.8;
                contextReason = "Borderline pause; keep if speech carries emotional emphasis, otherwise trim.";
            }
            classified.push({
                id: `silence_${crypto.randomUUID().slice(0, 8)}`,
                timeRange: {
                    start: video_contracts_1.RationalTimeMath.fromSeconds(start),
                    duration: video_contracts_1.RationalTimeMath.fromSeconds(duration),
                },
                startSeconds: start,
                durationSeconds: duration,
                averageDecibels: measuredMeanDb ?? noiseThreshold,
                classification,
                recommendation,
                confidence,
                contextReason,
            });
        }
        return classified;
    }
    static async detectSilenceIntervals(mediaPath, totalDurationSeconds, noiseThreshold, minDuration) {
        const rawIntervals = [];
        await new Promise((resolve) => {
            let currentStart = null;
            (0, ffmpeg_setup_1.default)(mediaPath)
                .audioFilters(`silencedetect=noise=${noiseThreshold}dB:d=${minDuration}`)
                .format("null")
                .output("-")
                .on("stderr", (line) => {
                const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
                if (startMatch) {
                    currentStart = parseFloat(startMatch[1]);
                }
                const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
                if (endMatch && currentStart !== null) {
                    const end = parseFloat(endMatch[1]);
                    const duration = parseFloat(endMatch[2]);
                    rawIntervals.push({ start: currentStart, duration });
                    currentStart = null;
                }
            })
                .on("end", () => {
                if (currentStart !== null && totalDurationSeconds > currentStart) {
                    const trailingDuration = totalDurationSeconds - currentStart;
                    if (trailingDuration >= minDuration) {
                        rawIntervals.push({ start: currentStart, duration: trailingDuration });
                    }
                }
                resolve();
            })
                .on("error", () => resolve()) // e.g. media has no audio track — no silence data is safer than throwing
                .run();
        });
        return rawIntervals;
    }
    static async measureMeanVolumeDb(mediaPath) {
        return new Promise((resolve) => {
            let meanDb = null;
            (0, ffmpeg_setup_1.default)(mediaPath)
                .audioFilters("volumedetect")
                .format("null")
                .output("-")
                .on("stderr", (line) => {
                const match = line.match(/mean_volume:\s*(-?[0-9.]+)\s*dB/);
                if (match)
                    meanDb = parseFloat(match[1]);
            })
                .on("end", () => resolve(meanDb))
                .on("error", () => resolve(null))
                .run();
        });
    }
}
exports.SilenceAnalyzer = SilenceAnalyzer;
