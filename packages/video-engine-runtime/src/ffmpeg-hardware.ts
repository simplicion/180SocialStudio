import ffmpeg from "./ffmpeg-setup";

export interface HardwareEncoderProfile {
  codecName: string;
  isHardwareAccelerated: boolean;
  outputOptions: string[];
}

let cachedProfile: HardwareEncoderProfile | null = null;
let probePromise: Promise<HardwareEncoderProfile> | null = null;

export class FfmpegHardwareAccelerator {
  /**
   * Discovers and tests hardware acceleration capabilities on the host.
   * Priority:
   * 1. NVIDIA NVENC (`h264_nvenc`)
   * 2. Apple VideoToolbox (`h264_videotoolbox`)
   * 3. Intel QuickSync (`h264_qsv`)
   * 4. AMD AMF (`h264_amf`)
   * 5. High-efficiency software fallback (`libx264`)
   */
  static async resolveEncoderProfile(): Promise<HardwareEncoderProfile> {
    if (cachedProfile) return cachedProfile;
    if (probePromise) return probePromise;

    probePromise = (async () => {
      const candidates: Array<{ codec: string; testOptions: string[]; productionOptions: string[] }> = [
        {
          codec: "h264_nvenc",
          testOptions: ["-f null", "-vframes 1", "-y"],
          productionOptions: ["-y", "-pix_fmt yuv420p", "-preset p4", "-cq 20", "-movflags +faststart"],
        },
        {
          codec: "h264_videotoolbox",
          testOptions: ["-f null", "-vframes 1", "-y"],
          productionOptions: ["-y", "-pix_fmt yuv420p", "-q:v 60", "-movflags +faststart"],
        },
        {
          codec: "h264_qsv",
          testOptions: ["-f null", "-vframes 1", "-y"],
          productionOptions: ["-y", "-pix_fmt yuv420p", "-global_quality 20", "-preset fast", "-movflags +faststart"],
        },
        {
          codec: "h264_amf",
          testOptions: ["-f null", "-vframes 1", "-y"],
          productionOptions: ["-y", "-pix_fmt yuv420p", "-quality speed", "-rc cqp", "-qp_i 20", "-movflags +faststart"],
        },
      ];

      for (const candidate of candidates) {
        const supported = await this.testEncoder(candidate.codec, candidate.testOptions);
        if (supported) {
          cachedProfile = {
            codecName: candidate.codec,
            isHardwareAccelerated: true,
            outputOptions: candidate.productionOptions,
          };
          return cachedProfile;
        }
      }

      // Safe, universal CPU fallback
      cachedProfile = {
        codecName: "libx264",
        isHardwareAccelerated: false,
        outputOptions: ["-y", "-pix_fmt yuv420p", "-preset fast", "-crf 18", "-movflags +faststart"],
      };
      return cachedProfile;
    })();

    return probePromise;
  }

  /**
   * Tests whether an encoder actually runs on the system with current drivers.
   */
  private static testEncoder(codec: string, testOptions: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        ffmpeg()
          .input("color=c=black:s=64x64:d=0.04")
          .inputOptions(["-f lavfi"])
          .videoCodec(codec)
          .outputOptions(testOptions)
          .output(process.platform === "win32" ? "NUL" : "/dev/null")
          .on("end", () => resolve(true))
          .on("error", () => resolve(false))
          .run();
      } catch {
        resolve(false);
      }
    });
  }
}

