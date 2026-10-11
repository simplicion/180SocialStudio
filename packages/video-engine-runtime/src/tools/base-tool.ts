import { z } from "zod";
import { ProductionStage } from "@workspace/video-contracts";

export interface DirectorExecutionContext {
  projectId: string;
  tempDir: string;
  artifacts: Map<string, any>;
  companyId?: string;
  userId?: string;
  onProgress?: (percent: number, message: string) => void;
  log?: (message: string) => void;
}

export abstract class VideoDirectorTool<TInput = any, TOutput = any> {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly stage: ProductionStage;
  abstract readonly inputSchema: z.ZodType<TInput, any, any>;

  abstract execute(input: TInput, context: DirectorExecutionContext): Promise<TOutput>;

  /**
   * Safe execution with schema validation and error wrapping
   */
  async run(rawInput: unknown, context: DirectorExecutionContext): Promise<TOutput> {
    const parsed = this.inputSchema.parse(rawInput);
    context.log?.(`[Tool:${this.name}] Starting execution in stage ${this.stage}...`);
    const startTime = Date.now();
    try {
      const result = await this.execute(parsed, context);
      const elapsed = Date.now() - startTime;
      context.log?.(`[Tool:${this.name}] Completed successfully in ${elapsed}ms`);
      return result;
    } catch (err: any) {
      context.log?.(`[Tool:${this.name}] Execution error: ${err.message}`);
      throw err;
    }
  }
}
