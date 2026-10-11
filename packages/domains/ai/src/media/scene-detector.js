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
exports.SceneDetector = void 0;
const ffmpeg_setup_1 = __importDefault(require("./ffmpeg-setup"));
const crypto = __importStar(require("crypto"));
/**
 * Real ffmpeg-based scene-cut detection, generalized from
 * packages/video-engine-runtime/src/intelligence/scenes.ts.
 *
 * Unlike that version, this does NOT fabricate shotType/brightness/dominantSubjects/
 * motionScore/transitionScore from duration heuristics — those fields are left unset
 * so MediaIntelligenceGraphSchema's honest defaults (e.g. shotType: "UNKNOWN") apply
 * instead of a confident-looking but invented classification.
 */
class SceneDetector {
    static async detect(mediaPath, totalDurationSeconds) {
        const cutTimestamps = [0];
        await new Promise((resolve) => {
            (0, ffmpeg_setup_1.default)(mediaPath)
                .videoFilters("select='gt(scene,0.35)',showinfo")
                .format("null")
                .output("-")
                .on("stderr", (line) => {
                const ptsMatch = line.match(/pts_time:([0-9.]+)/);
                if (ptsMatch) {
                    const time = parseFloat(ptsMatch[1]);
                    if (time > 0.4 && time < totalDurationSeconds - 0.3) {
                        const lastCut = cutTimestamps[cutTimestamps.length - 1];
                        if (time - lastCut >= 0.5) {
                            cutTimestamps.push(parseFloat(time.toFixed(3)));
                        }
                    }
                }
            })
                .on("end", () => resolve())
                .on("error", () => resolve()) // No scene-cut data is safer than throwing mid-plan
                .run();
        });
        cutTimestamps.push(parseFloat(totalDurationSeconds.toFixed(3)));
        const shots = [];
        for (let i = 0; i < cutTimestamps.length - 1; i++) {
            const start = cutTimestamps[i];
            const end = cutTimestamps[i + 1];
            if (end <= start)
                continue;
            shots.push({
                id: `shot_${i}_${crypto.randomUUID().slice(0, 6)}`,
                startSeconds: start,
                endSeconds: end,
            });
        }
        const scenes = [];
        let curSceneShots = [];
        let curSceneStart = 0;
        for (const shot of shots) {
            curSceneShots.push(shot);
            if (shot.endSeconds - curSceneStart >= 20 || shot === shots[shots.length - 1]) {
                scenes.push({
                    id: `scene_${scenes.length}_${crypto.randomUUID().slice(0, 6)}`,
                    startSeconds: curSceneStart,
                    endSeconds: shot.endSeconds,
                    shots: [...curSceneShots],
                });
                curSceneStart = shot.endSeconds;
                curSceneShots = [];
            }
        }
        return { shots, scenes };
    }
}
exports.SceneDetector = SceneDetector;
