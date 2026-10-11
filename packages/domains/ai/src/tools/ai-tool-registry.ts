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
    isSelfServiceOnly?: boolean; // if true, mutation is strictly locked to context.userId
    parameters: Record<string, ToolParameter>;
    execute: (args: any, context: AIToolExecutionContext) => Promise<any>;
}

export class AIToolRegistry {
    private static instance: AIToolRegistry;
    private tools: Map<string, AIToolDefinition> = new Map();

    public static getInstance(): AIToolRegistry {
        if (!AIToolRegistry.instance) {
            AIToolRegistry.instance = new AIToolRegistry();
        }
        return AIToolRegistry.instance;
    }

    /**
     * Registers a new deterministic tool
     */
    registerTool(tool: AIToolDefinition) {
        this.tools.set(tool.name, tool);
    }

    /**
     * Retrieves a tool by name
     */
    getTool(name: string): AIToolDefinition | undefined {
        return this.tools.get(name);
    }

    /**
     * Checks whether a tool is registered
     */
    hasTool(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * Determines whether a given user role & permission set has authorization to execute a tool
     */
    isUserAuthorizedForTool(tool: AIToolDefinition, userRole?: string, userPermissions: string[] = []): boolean {
        const normalizedRole = (userRole || 'employee').toLowerCase();
        
        // 1. Root Admin has master execution access across all tools
        if (normalizedRole === 'admin') {
            return true;
        }

        // 2. Open tools available to all employees (self-service, guides, general search)
        const allowedRoles = tool.allowedRoles || ['all'];
        if (allowedRoles.includes('all') || allowedRoles.includes('employee')) {
            return true;
        }

        // 3. Permission-based access (e.g. employee with assigned departmental permission pack like HR or Finance)
        if (tool.requiredPermissions && tool.requiredPermissions.length > 0) {
            const hasRequired = tool.requiredPermissions.some(p => userPermissions.includes(p));
            if (hasRequired) return true;
        }

        return false;
    }

    /**
     * Retrieves only the subset of tools authorized for the specified user
     */
    getToolsForUser(userRole?: string, userPermissions: string[] = []): AIToolDefinition[] {
        return Array.from(this.tools.values()).filter(tool =>
            this.isUserAuthorizedForTool(tool, userRole, userPermissions)
        );
    }

    /**
     * Executes a registered tool by name with strict zero-trust authorization enforcement
     */
    async executeTool(name: string, args: any, context: AIToolExecutionContext): Promise<any> {
        const tool = this.tools.get(name);
        if (!tool) {
            return { success: false, message: `Tool "${name}" is not registered in AI Tool Registry.` };
        }

        // Zero-Trust Role Guard: Server-side non-bypassable verification
        const isAuthorized = this.isUserAuthorizedForTool(tool, context.userRole, context.userPermissions);
        if (!isAuthorized) {
            console.warn(`[AIToolRegistry] ⛔ UNAUTHORIZED ACCESS BLOCKED: User ${context.userId} (Role: ${context.userRole || 'employee'}) attempted to execute admin tool "${name}".`);
            return {
                success: false,
                unauthorized: true,
                blockedTool: name,
                requiredClearance: tool.allowedRoles || ['admin'],
                message: `🔒 **Administrative Action Restricted**\n\nYou do not have sufficient permissions to execute **"${name}"**. This action requires workspace administrator clearance.\n\nIf you need assistance, please contact your workspace administrator or explore our self-service guides.`
            };
        }

        // Self-Service Parameter Isolation: Force target entity to be the caller
        if (tool.isSelfServiceOnly && context.userId) {
            args = { ...args, userId: context.userId, employeeId: context.userId };
        }

        return await tool.execute(args, context);
    }

    /**
     * Returns all registered tools (system level)
     */
    getAllTools(): AIToolDefinition[] {
        return Array.from(this.tools.values());
    }

    /**
     * Exports user-scoped tools into OpenAI / Gemini / Claude compatible function calling schema specifications
     */
    toOpenAIToolsSchemaForUser(userRole?: string, userPermissions: string[] = []): any[] {
        return this.getToolsForUser(userRole, userPermissions).map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: {
                    type: 'object',
                    properties: t.parameters,
                    required: Object.keys(t.parameters).filter(k => t.parameters[k].required)
                }
            }
        }));
    }

    /**
     * Exports all tools into OpenAI / Gemini / Claude schema
     */
    toOpenAIToolsSchema(): any[] {
        return this.getAllTools().map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: {
                    type: 'object',
                    properties: t.parameters,
                    required: Object.keys(t.parameters).filter(k => t.parameters[k].required)
                }
            }
        }));
    }

    /**
     * Generates a markdown summary of authorized tools for dynamic system prompt injection
     */
    toSystemPromptDescriptionForUser(userRole?: string, userPermissions: string[] = []): string {
        return this.getToolsForUser(userRole, userPermissions).map(t => {
            const params = Object.entries(t.parameters)
                .map(([k, v]) => `${k} (${v.type}${v.required ? ', required' : ''}): ${v.description}`)
                .join('; ');
            return `- **${t.name}**: ${t.description} | Params: [${params || 'none'}]`;
        }).join('\n');
    }

    /**
     * Generates a full markdown summary of all tools
     */
    toSystemPromptDescription(): string {
        return this.getAllTools().map(t => {
            const params = Object.entries(t.parameters)
                .map(([k, v]) => `${k} (${v.type}${v.required ? ', required' : ''}): ${v.description}`)
                .join('; ');
            return `- **${t.name}**: ${t.description} | Params: [${params || 'none'}]`;
        }).join('\n');
    }
}

export const aiToolRegistry = AIToolRegistry.getInstance();

try {
    const { registerAllBuiltInTools } = require('./builtin-tools');
    if (typeof registerAllBuiltInTools === 'function') {
        registerAllBuiltInTools(aiToolRegistry);
    }
} catch (e) {}
