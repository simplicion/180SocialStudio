import { z } from "zod";
import { VideoDirectorTool, DirectorExecutionContext } from "../base-tool";
import { VideoCritiqueReport, EditIR, VideoCriticService } from "@workspace/video-contracts";

export const CriticAuditInputSchema = z.object({
  minAcceptableScore: z.number().default(70),
});

export type CriticAuditInput = z.infer<typeof CriticAuditInputSchema>;

export class CriticAuditTool extends VideoDirectorTool<CriticAuditInput, VideoCritiqueReport> {
  readonly name = "critic_retention_audit";
  readonly description = "Audits EditIR AST against viral retention heuristics and safe margin constraints";
  readonly stage = "CRITIC_QA_AUDIT" as const;
  readonly inputSchema = CriticAuditInputSchema;

  async execute(input: CriticAuditInput, context: DirectorExecutionContext): Promise<VideoCritiqueReport> {
    const editIR: EditIR | undefined = context.artifacts.get("editIR");
    if (!editIR) {
      throw new Error("CriticAuditTool: EditIR not found in execution context.");
    }

    context.log?.(`Running AI Critic Retention QA on EditIR timeline...`);
    const report = VideoCriticService.analyze(editIR);
    context.artifacts.set("criticReport", report);

    context.log?.(`Critic Score: ${report.overallScore}/100 | Predicted Retention: ${report.retentionPrediction}% | Issues: ${report.issues.length}`);
    return report;
  }
}
