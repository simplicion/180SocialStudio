import { z } from "zod";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { EditIR } from "@workspace/video-contracts";
import { LosslessSplicer } from "../../lossless-splicer";

export const LosslessRenderInputSchema = z.object({
  outputPath: z.string(),
});

export type LosslessRenderInput = z.infer<typeof LosslessRenderInputSchema>;

export class LosslessRenderTool extends VideoDirectorTool<LosslessRenderInput, string> {
  readonly name = "lossless_splicer_render";
  readonly description = "Executes hardware-accelerated single-pass SmartCut video render and subtitle burn";
  readonly stage = "MASTER_EXPORT" as const;
  readonly inputSchema = LosslessRenderInputSchema;

  async execute(input: LosslessRenderInput, context: DirectorExecutionContext): Promise<string> {
    const editIR: EditIR | undefined = context.artifacts.get("editIR");
    if (!editIR) {
      throw new Error("LosslessRenderTool: EditIR not found in execution context.");
    }

    context.log?.(`Rendering master export to: ${input.outputPath}`);
    await LosslessSplicer.render(editIR, input.outputPath, context.tempDir, (progress) => {
      context.onProgress?.(
        progress.percent,
        `Rendering Chunk ${progress.currentChunk}/${progress.totalChunks} (${progress.percent}%)`
      );
    });

    context.log?.(`✓ Master render successfully written to: ${input.outputPath}`);
    return input.outputPath;
  }
}
