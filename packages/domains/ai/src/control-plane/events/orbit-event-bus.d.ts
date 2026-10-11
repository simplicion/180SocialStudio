export interface OrbitDomainEvent {
    id: string;
    type: string;
    companyId: string;
    userId?: string;
    payload: any;
    timestamp: string;
}
export type OrbitEventHandler = (event: OrbitDomainEvent) => Promise<void> | void;
export declare class OrbitEventBus {
    private static instance;
    private subscribers;
    private eventHistory;
    static getInstance(): OrbitEventBus;
    /**
     * Subscribes a handler to a specific event type or wildcard pattern (e.g. 'orbit.task.*', '*')
     */
    subscribe(pattern: string, handler: OrbitEventHandler): void;
    /**
     * Publishes a normalized domain event and triggers all matching subscribers safely
     */
    publish(event: OrbitDomainEvent): Promise<void>;
    /**
     * Registers built-in proactive autonomous workspace observer handlers
     */
    private registerDefaultObservers;
    /**
     * Returns recent event history for auditing and state replay
     */
    getEventHistory(): OrbitDomainEvent[];
}
export declare const orbitEventBus: OrbitEventBus;
