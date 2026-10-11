import { ResourceDefinition } from '../control-plane/types/resource.types';
import { AIToolDefinition } from '../tools/ai-tool-registry';
/**
 * Task Resource Definition
 */
export declare const taskResource: ResourceDefinition;
/**
 * Project Resource Definition
 */
export declare const projectResource: ResourceDefinition;
export declare const createTaskTool: AIToolDefinition;
export declare const batchCreateTasksTool: AIToolDefinition;
export declare const createProjectTool: AIToolDefinition;
export declare const getProjectHealthTool: AIToolDefinition;
export declare const getMyTasksTool: AIToolDefinition;
export declare const updateTaskStatusTool: AIToolDefinition;
export declare const deleteProjectTool: AIToolDefinition;
export declare const deleteTaskTool: AIToolDefinition;
export declare const createMilestoneTool: AIToolDefinition;
export declare const logProjectTimesheetTool: AIToolDefinition;
export declare const logMyTimesheetTool: AIToolDefinition;
