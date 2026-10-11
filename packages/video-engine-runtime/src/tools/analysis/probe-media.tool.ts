import { z } from "zod";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { MediaProber } from "../../prober";
import { MediaAssetDescriptor } from "@workspace/video-contracts";

export const ProbeMediaInputSchema = z.object({
  filePaths: z.array(z.string()),
});

export type ProbeMediaInput = z.infer<typeof ProbeMediaInputSchema>;

export class ProbeMediaTool extends VideoDirectorTool<ProbeMediaInput, MediaAssetDescriptor[]> {
  readonly name = "probe_media";
  readonly description = "Probes video/audio streams, dimensions, duration, FPS, and codecs via FFprobe";
  readonly stage = "INGESTION_AND_TELEMETRY" as const;
  readonly inputSchema = ProbeMediaInputSchema;

  async execute(input: ProbeMediaInput, context: DirectorExecutionContext): Promise<MediaAssetDescriptor[]> {
    const descriptors: MediaAssetDescriptor[] = [];
    for (let i = 0; i < input.filePaths.length; i++) {
      const p = input.filePaths[i];
      context.log?.(`Probing file [${i + 1}/${input.filePaths.length}]: ${p}`);
      const desc = await MediaProber.probeFile(p);
      descriptors.push(desc);
      context.onProgress?.(
        Math.round(((i + 1) / input.filePaths.length) * 100),
        `Probed ${desc.name}`
      );
    }
    context.artifacts.set("mediaDescriptors", descriptors);
    return descriptors;
  }
}
