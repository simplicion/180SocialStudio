import ffmpeg from "fluent-ffmpeg";

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
  if (ffmpegInstaller && ffmpegInstaller.path) {
    ffmpeg.setFfmpegPath(ffmpegInstaller.path);
  }
} catch {
  // Fallback to system ffmpeg if available
}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ffprobeInstaller = require("@ffprobe-installer/ffprobe");
  if (ffprobeInstaller && ffprobeInstaller.path) {
    ffmpeg.setFfprobePath(ffprobeInstaller.path);
  }
} catch {
  // Fallback to system ffprobe if available
}

export default ffmpeg;
export { ffmpeg };
