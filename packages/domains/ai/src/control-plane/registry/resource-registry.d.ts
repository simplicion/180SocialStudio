import { ResourceDefinition } from '../types/resource.types';
export declare class OrbitResourceRegistry {
    private static instance;
    private resources;
    private domainIndex;
    static getInstance(): OrbitResourceRegistry;
    /**
     * Registers a modular resource definition into the Orbit Control Plane
     */
    registerResource(resource: ResourceDefinition): void;
    /**
     * Retrieves a resource definition by kind
     */
    getResource(kind: string): ResourceDefinition | undefined;
    /**
     * Checks if a resource kind is registered
     */
    hasResource(kind: string): boolean;
    /**
     * Retrieves all resources belonging to a domain
     */
    getResourcesByDomain(domain: string): ResourceDefinition[];
    /**
     * Returns all registered resources across the workspace
     */
    getAllResources(): ResourceDefinition[];
    /**
     * Evaluates whether a user is authorized for a specific resource
     */
    isUserAuthorizedForResource(resource: ResourceDefinition, userRole?: string, userPermissions?: string[]): boolean;
    /**
     * Retrieves only authorized resources for a user
     */
    getResourcesForUser(userRole?: string, userPermissions?: string[]): ResourceDefinition[];
    /**
     * Converts registered resources into standard OpenAI/Gemini Function Calling schemas
     */
    toOpenAIToolsSchemaForUser(userRole?: string, userPermissions?: string[]): any[];
}
export declare const orbitResourceRegistry: OrbitResourceRegistry;
