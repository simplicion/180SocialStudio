import { ResourceDefinition, OrbitExecutionContext, AIRole } from '../types/resource.types';

export class OrbitResourceRegistry {
    private static instance: OrbitResourceRegistry;
    private resources: Map<string, ResourceDefinition> = new Map();
    private domainIndex: Map<string, Set<string>> = new Map();

    public static getInstance(): OrbitResourceRegistry {
        if (!OrbitResourceRegistry.instance) {
            OrbitResourceRegistry.instance = new OrbitResourceRegistry();
        }
        return OrbitResourceRegistry.instance;
    }

    /**
     * Registers a modular resource definition into the Orbit Control Plane
     */
    registerResource(resource: ResourceDefinition): void {
        this.resources.set(resource.kind, resource);

        if (!this.domainIndex.has(resource.domain)) {
            this.domainIndex.set(resource.domain, new Set());
        }
        this.domainIndex.get(resource.domain)!.add(resource.kind);
    }

    /**
     * Retrieves a resource definition by kind
     */
    getResource(kind: string): ResourceDefinition | undefined {
        return this.resources.get(kind);
    }

    /**
     * Checks if a resource kind is registered
     */
    hasResource(kind: string): boolean {
        return this.resources.has(kind);
    }

    /**
     * Retrieves all resources belonging to a domain
     */
    getResourcesByDomain(domain: string): ResourceDefinition[] {
        const kinds = this.domainIndex.get(domain);
        if (!kinds) return [];
        return Array.from(kinds).map(k => this.resources.get(k)!).filter(Boolean);
    }

    /**
     * Returns all registered resources across the workspace
     */
    getAllResources(): ResourceDefinition[] {
        return Array.from(this.resources.values());
    }

    /**
     * Evaluates whether a user is authorized for a specific resource
     */
    isUserAuthorizedForResource(resource: ResourceDefinition, userRole?: string, userPermissions: string[] = []): boolean {
        const normalizedRole = (userRole || 'employee').toLowerCase();

        // 1. Admin has global clearance
        if (normalizedRole === 'admin' || normalizedRole === 'superadmin') {
            return true;
        }

        // 2. Open resources for all employees
        const allowedRoles = resource.allowedRoles || ['all'];
        if (allowedRoles.includes('all') || allowedRoles.includes('employee')) {
            return true;
        }

        // 3. Check granular departmental permission packs
        if (resource.requiredPermissions && resource.requiredPermissions.length > 0) {
            const hasPermission = resource.requiredPermissions.some(p => userPermissions.includes(p));
            if (hasPermission) return true;
        }

        return false;
    }

    /**
     * Retrieves only authorized resources for a user
     */
    getResourcesForUser(userRole?: string, userPermissions: string[] = []): ResourceDefinition[] {
        return this.getAllResources().filter(r =>
            this.isUserAuthorizedForResource(r, userRole, userPermissions)
        );
    }

    /**
     * Converts registered resources into standard OpenAI/Gemini Function Calling schemas
     */
    toOpenAIToolsSchemaForUser(userRole?: string, userPermissions: string[] = []): any[] {
        const tools: any[] = [];
        const authorized = this.getResourcesForUser(userRole, userPermissions);

        for (const res of authorized) {
            // Lifecycle capabilities as tools
            if (res.capabilities.read) {
                tools.push({
                    type: 'function',
                    function: {
                        name: `${res.kind}_read`,
                        description: `Query and inspect ${res.kind} records. ${res.description}`,
                        parameters: {
                            type: 'object',
                            properties: res.parameters || {},
                            required: Object.keys(res.parameters || {}).filter(k => res.parameters![k].required)
                        }
                    }
                });
            }

            if (res.capabilities.create) {
                tools.push({
                    type: 'function',
                    function: {
                        name: `${res.kind}_create`,
                        description: `Create a new ${res.kind}. ${res.description}`,
                        parameters: {
                            type: 'object',
                            properties: res.parameters || {},
                            required: Object.keys(res.parameters || {}).filter(k => res.parameters![k].required)
                        }
                    }
                });
            }

            if (res.capabilities.customActions) {
                for (const [actionName, _handler] of Object.entries(res.capabilities.customActions)) {
                    tools.push({
                        type: 'function',
                        function: {
                            name: `${res.kind}_${actionName}`,
                            description: `Execute ${actionName} on ${res.kind}.`,
                            parameters: {
                                type: 'object',
                                properties: res.parameters || {}
                            }
                        }
                    });
                }
            }
        }

        return tools;
    }
}

export const orbitResourceRegistry = OrbitResourceRegistry.getInstance();
