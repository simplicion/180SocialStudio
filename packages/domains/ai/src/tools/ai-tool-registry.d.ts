import { AIRole } from '../control-plane/types/resource.types';
export { AIRole };
export interface ToolParameter {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    required?: boolean;
    enum?: string[];
}
export interface AIToolExecutionContext {
    companyId?: string;
    userId?: string;
    userRole?: string;
    userPermissions?: string[];
}
export interface AIToolDefinition {
    name: string;
    description: string;
    category?: 'hrms' | 'crm' | 'documents' | 'forms' | 'website' | 'projects' | 'finance' | 'communications' | 'social' | 'servicedesk' | 'knowledge' | 'guide' | 'self_service';
    allowedRoles?: AIRole[];
    requiredPermissions?: string[];
    isSelfServiceOnly?: boolean;
    parameters: Record<string, ToolParameter>;
    execute: (args: any, context: AIToolExecutionContext) => Promise<any>;
}
export declare class AIToolRegistry {
    private static instance;
    private tools;
    static getInstance(): AIToolRegistry;
    /**
     * Registers a new deterministic tool
     */
    registerTool(tool: AIToolDefinition): void;
    /**
     * Retrieves a tool by name
     */
    getTool(name: string): AIToolDefinition | undefined;
    /**
     * Checks whether a tool is registered
     */
    hasTool(name: string): boolean;
    /**
     * Determines whether a given user role & permission set has authorization to execute a tool
     */
    isUserAuthorizedForTool(tool: AIToolDefinition, userRole?: string, userPermissions?: string[]): boolean;
    /**
     * Retrieves only the subset of tools authorized for the specified user
     */
    getToolsForUser(userRole?: string, userPermissions?: string[]): AIToolDefinition[];
    /**
     * Executes a registered tool by name with strict zero-trust authorization enforcement
     */
    executeTool(name: string, args: any, context: AIToolExecutionContext): Promise<any>;
    /**
     * Returns all registered tools (system level)
     */
    getAllTools(): AIToolDefinition[];
    /**
     * Exports user-scoped tools into OpenAI / Gemini / Claude compatible function calling schema specifications
     */
    toOpenAIToolsSchemaForUser(userRole?: string, userPermissions?: string[]): any[];
    /**
     * Exports all tools into OpenAI / Gemini / Claude schema
     */
    toOpenAIToolsSchema(): any[];
    /**
     * Generates a markdown summary of authorized tools for dynamic system prompt injection
     */
    toSystemPromptDescriptionForUser(userRole?: string, userPermissions?: string[]): string;
    /**
     * Generates a full markdown summary of all tools
     */
    toSystemPromptDescription(): string;
}
export declare const aiToolRegistry: AIToolRegistry;
