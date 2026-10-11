export type AIRole = 'admin' | 'employee' | 'all';

export interface OrbitExecutionContext {
    companyId?: string;
    userId?: string;
    userRole?: string;
    userPermissions?: string[];
    sessionId?: string;
    metadata?: Record<string, any>;
}

export interface ResourceParameter {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    description: string;
    required?: boolean;
    enum?: string[];
    default?: any;
}

export interface VerificationResult {
    verified: boolean;
    actualState?: any;
    discrepancy?: string;
    retrySuggested?: boolean;
}

export interface ResourceLifecycleCapabilities<TState = any> {
    /**
     * Inspects / queries existing resources of this kind
     */
    read?: (query: any, context: OrbitExecutionContext) => Promise<any>;

    /**
     * Deterministically creates a new resource instance
     */
    create?: (spec: any, context: OrbitExecutionContext) => Promise<any>;

    /**
     * Updates an existing resource with a delta
     */
    update?: (id: string, delta: any, context: OrbitExecutionContext) => Promise<any>;

    /**
     * Deletes a resource with multi-tenant isolation
     */
    delete?: (id: string, context: OrbitExecutionContext) => Promise<any>;

    /**
     * Verifies that the resource exists and matches desired attributes
     */
    verify?: (id: string, desiredState: Partial<TState>, context: OrbitExecutionContext) => Promise<VerificationResult>;

    /**
     * Domain-specific custom actions (e.g. 'assign', 'publish', 'send_invoice', 'reschedule')
     */
    customActions?: Record<string, (idOrArgs: any, payload: any, context: OrbitExecutionContext) => Promise<any>>;
}

export interface ResourceDefinition<TState = any> {
    /**
     * Unique resource kind identifier (e.g. 'task', 'project', 'lead', 'form', 'website')
     */
    kind: string;

    /**
     * SaaS domain package owner (e.g. 'projects-and-tasks', 'crm-and-sales', 'finance')
     */
    domain: string;

    /**
     * Human and LLM readable description
     */
    description: string;

    /**
     * Authorization clearance
     */
    allowedRoles?: AIRole[];
    requiredPermissions?: string[];
    isSelfServiceOnly?: boolean;

    /**
     * Schema & relationship definition
     */
    schema?: {
        identityKeys: string[];
        stateFields: Record<string, string>;
        relationships?: Record<string, { targetKind: string; type: 'one-to-one' | 'one-to-many' | 'many-to-one' }>;
    };

    /**
     * Supported parameters for operations
     */
    parameters?: Record<string, ResourceParameter>;

    /**
     * Lifecycle and custom operational capabilities
     */
    capabilities: ResourceLifecycleCapabilities<TState>;
}
