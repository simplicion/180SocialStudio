"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ffmpeg = void 0;
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
exports.ffmpeg = fluent_ffmpeg_1.default;
// Ported from packages/video-engine-runtime/src/ffmpeg-setup.ts so packages/domains/ai
// does not take on a dependency on that (currently unwired) standalone package.
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
    if (ffmpegInstaller && ffmpegInstaller.path) {
        fluent_ffmpeg_1.default.setFfmpegPath(ffmpegInstaller.path);
    }
}
catch {
    // Fallback to system ffmpeg if available
}
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
    if (ffprobeInstaller && ffprobeInstaller.path) {
        fluent_ffmpeg_1.default.setFfprobePath(ffprobeInstaller.path);
    }
}
catch {
    // Fallback to system ffprobe if available
}
exports.default = fluent_ffmpeg_1.default;
