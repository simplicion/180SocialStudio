export type EmitSocketFunction = (companyId: string, event: string, payload: any) => void;
/**
 * Registers the actual Socket provider (typically called at app boot).
 * @param provider The provider function to emit a socket event
 */
export declare function registerSocketProvider(provider: EmitSocketFunction): void;
/**
 * Triggers a socket event to a specific company room.
 * Resolves safely even if no provider is registered.
 */
export declare function emitSocket(companyId: string, event: string, payload: any): void;
