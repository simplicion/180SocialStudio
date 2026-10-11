import { z } from "zod";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { TelemetryExtractor } from "../../telemetry-extractor";
import { MediaTelemetryManifest } from "@workspace/video-contracts";

export const SilenceDetectorInputSchema = z.object({
  mediaPath: z.string(),
  silenceThresholdDb: z.number().optional().default(-35.0),
  minSilenceDurationSec: z.number().optional().default(0.4),
});

export type SilenceDetectorInput = z.infer<typeof SilenceDetectorInputSchema>;

export class SilenceDetectorTool extends VideoDirectorTool<SilenceDetectorInput, MediaTelemetryManifest> {
  readonly name = "silence_detector";
  readonly description = "Extracts deterministic audio silence gaps, energy peaks, and candidate jump-cut boundaries";
  readonly stage = "INGESTION_AND_TELEMETRY" as const;
  readonly inputSchema = SilenceDetectorInputSchema;

  async execute(input: SilenceDetectorInput, context: DirectorExecutionContext): Promise<MediaTelemetryManifest> {
    context.log?.(`Detecting silence & cadence for: ${input.mediaPath}`);
    const telemetry = await TelemetryExtractor.extract(input.mediaPath, context.tempDir);
    context.artifacts.set("telemetry", telemetry);
    return telemetry;
  }
}
