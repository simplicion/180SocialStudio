import { z } from "zod";
import { EditIRSchema } from "./edit-ir.schema";

/**
 * Production Stage Hierarchy
 */
export const ProductionStageSchema = z.enum([
  "INGESTION_AND_TELEMETRY",
  "NARRATIVE_CURATION",
  "TIMELINE_COMPOSITION",
  "ATTENTION_AND_CAPTIONING",
  "CRITIC_QA_AUDIT",
  "MASTER_EXPORT",
]);

export type ProductionStage = z.infer<typeof ProductionStageSchema>;

/**
 * Task Execution Status
 */
export const TaskStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "SKIPPED",
]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/**
 * Individual Discrete Task in a Production Plan
 */
export const ProductionTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  stage: ProductionStageSchema,
  toolName: z.string(),
  toolInput: z.record(z.any()),
  dependencies: z.array(z.string()).default([]),
  status: TaskStatusSchema.default("PENDING"),
  progressPercent: z.number().min(0).max(100).default(0),
  resultArtifact: z.record(z.any()).optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
});

export type ProductionTask = z.infer<typeof ProductionTaskSchema>;

/**
 * Complete DAG Production Plan
 */
export const ProductionPlanSchema = z.object({
  id: z.string(),
  title: z.string(),
  userPrompt: z.string(),
  targetAspect: z.enum(["16:9", "9:16", "1:1", "4:5"]).default("9:16"),
  directorPreset: z.string().default("HORMOZI_VIRAL"),
  tasks: z.array(ProductionTaskSchema),
  status: TaskStatusSchema.default("PENDING"),
  currentTaskId: z.string().optional(),
  companyId: z.string().optional(),
  userId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  summary: z.string().optional(),
});

export type ProductionPlan = z.infer<typeof ProductionPlanSchema>;

/**
 * Tool Contract Specification
 */
export interface DirectorToolDescriptor {
  name: string;
  description: string;
  stage: ProductionStage;
  inputParameters: Record<string, any>;
  outputSchema?: Record<string, any>;
}
