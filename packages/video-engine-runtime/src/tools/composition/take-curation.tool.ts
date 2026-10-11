import { z } from "zod";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { SemanticTakeCurator, CuratedTakeManifest } from "../../intelligence/semantic-take-curator";
import { ClipTranscriptionResult } from "../../intelligence/multi-take-transcriber";

export const TakeCurationInputSchema = z.object({
  transcriptions: z.array(z.any()).optional(),
  targetDurationSec: z.number().optional().default(60.0),
});

export type TakeCurationInput = z.infer<typeof TakeCurationInputSchema>;

export class TakeCurationTool extends VideoDirectorTool<TakeCurationInput, CuratedTakeManifest> {
  readonly name = "take_curator";
  readonly description = "Compares multi-take speeches, prunes bloopers and duplicate sentences, and sequences winning takes";
  readonly stage = "NARRATIVE_CURATION" as const;
  readonly inputSchema = TakeCurationInputSchema;

  async execute(input: TakeCurationInput, context: DirectorExecutionContext): Promise<CuratedTakeManifest> {
    const transcriptions: ClipTranscriptionResult[] =
      input.transcriptions || context.artifacts.get("transcriptions") || [];

    if (transcriptions.length === 0) {
      throw new Error("TakeCurationTool: No clip transcriptions available to curate.");
    }

    context.log?.(`Curating narrative story arc across ${transcriptions.length} takes...`);
    const curated = SemanticTakeCurator.curateStoryArc(transcriptions, input.targetDurationSec);
    context.artifacts.set("curatedManifest", curated);
    context.log?.(`Curated ${curated.keeperSegments.length} keeper segments. Pruned ${curated.prunedDurationSec.toFixed(1)}s of bloopers.`);
    return curated;
  }
}
