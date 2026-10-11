import * as path from "path";
import * as fs from "fs";
import { ProductionPlan, ProductionTask } from "@workspace/video-contracts";
import { ProductionPlanner, PlannerInputOptions } from "./production-planner";
import { PlanExecutor, PlanExecutorOptions } from "./plan-executor";
import "../tools";

export interface DirectorAgentRunOptions {
  userPrompt: string;
  inputFilesOrDirectory: string | string[];
  outputPath: string;
  targetAspect?: "16:9" | "9:16" | "1:1";
  customStyleKey?: string;
  tempDir?: string;
  companyId?: string;
  userId?: string;
  onPlanGenerated?: (plan: ProductionPlan) => void;
  onTaskStart?: (task: ProductionTask) => void;
  onTaskProgress?: (task: ProductionTask, percent: number, message: string) => void;
  onTaskComplete?: (task: ProductionTask, result: any) => void;
}

export class DirectorAgent {
  /**
   * Autonomous AI Video Director Agent:
   * Tier 1 (Planner) -> Tier 2 (Worker Tools) -> Critic Verification -> Final Export
   */
  static async directProject(options: DirectorAgentRunOptions): Promise<{
    plan: ProductionPlan;
    masterExportPath: string;
  }> {
    let filePaths: string[] = [];

    if (typeof options.inputFilesOrDirectory === "string") {
      if (fs.existsSync(options.inputFilesOrDirectory) && fs.statSync(options.inputFilesOrDirectory).isDirectory()) {
        const entries = fs.readdirSync(options.inputFilesOrDirectory);
        filePaths = entries
          .filter((e) => !e.startsWith("."))
          .map((e) => path.join(options.inputFilesOrDirectory as string, e))
          .filter((p) => {
            try {
              return fs.existsSync(p) && fs.statSync(p).isFile();
            } catch {
              return false;
            }
          });
      } else if (fs.existsSync(options.inputFilesOrDirectory)) {
        filePaths = [options.inputFilesOrDirectory];
      }
    } else if (Array.isArray(options.inputFilesOrDirectory)) {
      filePaths = options.inputFilesOrDirectory.filter((f) => {
        try {
          return fs.existsSync(f) && fs.statSync(f).isFile();
        } catch {
          return false;
        }
      });
    }

    if (filePaths.length === 0) {
      throw new Error("DirectorAgent: No valid input media files found.");
    }

    const outputPath = path.resolve(options.outputPath);
    const tempDir = options.tempDir || path.join(path.dirname(outputPath), ".director_agent_tmp");

    // Tier 1: Plan Generation
    const plannerOptions: PlannerInputOptions = {
      userPrompt: options.userPrompt,
      inputFiles: filePaths,
      outputPath,
      targetAspect: options.targetAspect,
      customStyleKey: options.customStyleKey,
      companyId: options.companyId,
      userId: options.userId,
    };

    const plan = ProductionPlanner.createPlan(plannerOptions);
    options.onPlanGenerated?.(plan);

    // Tier 2: Plan Execution via Discrete Worker Tools
    const executorOptions: PlanExecutorOptions = {
      tempDir,
      onTaskStart: options.onTaskStart,
      onTaskProgress: options.onTaskProgress,
      onTaskComplete: options.onTaskComplete,
      onTaskError: (task, err) => {
        console.error(`[DirectorAgent] Error in task ${task.id}: ${err.message}`);
      },
    };

    const executedPlan = await PlanExecutor.executePlan(plan, executorOptions);

    return {
      plan: executedPlan,
      masterExportPath: outputPath,
    };
  }
}
