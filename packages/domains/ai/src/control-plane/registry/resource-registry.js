"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orbitResourceRegistry = exports.OrbitResourceRegistry = void 0;
class OrbitResourceRegistry {
    static instance;
    resources = new Map();
    domainIndex = new Map();
    static getInstance() {
        if (!OrbitResourceRegistry.instance) {
            OrbitResourceRegistry.instance = new OrbitResourceRegistry();
        }
        return OrbitResourceRegistry.instance;
    }
    /**
     * Registers a modular resource definition into the Orbit Control Plane
     */
    registerResource(resource) {
        this.resources.set(resource.kind, resource);
        if (!this.domainIndex.has(resource.domain)) {
            this.domainIndex.set(resource.domain, new Set());
        }
        this.domainIndex.get(resource.domain).add(resource.kind);
    }
    /**
     * Retrieves a resource definition by kind
     */
    getResource(kind) {
        return this.resources.get(kind);
    }
    /**
     * Checks if a resource kind is registered
     */
    hasResource(kind) {
        return this.resources.has(kind);
    }
    /**
     * Retrieves all resources belonging to a domain
     */
    getResourcesByDomain(domain) {
        const kinds = this.domainIndex.get(domain);
        if (!kinds)
            return [];
        return Array.from(kinds).map(k => this.resources.get(k)).filter(Boolean);
    }
    /**
     * Returns all registered resources across the workspace
     */
    getAllResources() {
        return Array.from(this.resources.values());
    }
    /**
     * Evaluates whether a user is authorized for a specific resource
     */
    isUserAuthorizedForResource(resource, userRole, userPermissions = []) {
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
            if (hasPermission)
                return true;
        }
        return false;
    }
    /**
     * Retrieves only authorized resources for a user
     */
    getResourcesForUser(userRole, userPermissions = []) {
        return this.getAllResources().filter(r => this.isUserAuthorizedForResource(r, userRole, userPermissions));
    }
    /**
     * Converts registered resources into standard OpenAI/Gemini Function Calling schemas
     */
    toOpenAIToolsSchemaForUser(userRole, userPermissions = []) {
        const tools = [];
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
                            required: Object.keys(res.parameters || {}).filter(k => res.parameters[k].required)
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
                            required: Object.keys(res.parameters || {}).filter(k => res.parameters[k].required)
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
exports.OrbitResourceRegistry = OrbitResourceRegistry;
exports.orbitResourceRegistry = OrbitResourceRegistry.getInstance();
