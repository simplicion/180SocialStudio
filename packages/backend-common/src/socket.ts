export type EmitSocketFunction = (companyId: string, event: string, payload: any) => void;

let socketProvider: EmitSocketFunction | null = null;

/**
 * Registers the actual Socket provider (typically called at app boot).
 * @param provider The provider function to emit a socket event
 */
export function registerSocketProvider(provider: EmitSocketFunction) {
    socketProvider = provider;
}

/**
 * Triggers a socket event to a specific company room.
 * Resolves safely even if no provider is registered.
 */
export function emitSocket(companyId: string, event: string, payload: any): void {
    if (socketProvider) {
        try {
            socketProvider(companyId, event, payload);
        } catch (err) {
            console.error('Error emitting socket event:', err);
        }
    } else {
        console.warn('socketProvider not registered, ignoring emitSocket call:', { companyId, event });
    }
}
