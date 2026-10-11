"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSocketProvider = registerSocketProvider;
exports.emitSocket = emitSocket;
let socketProvider = null;
/**
 * Registers the actual Socket provider (typically called at app boot).
 * @param provider The provider function to emit a socket event
 */
function registerSocketProvider(provider) {
    socketProvider = provider;
}
/**
 * Triggers a socket event to a specific company room.
 * Resolves safely even if no provider is registered.
 */
function emitSocket(companyId, event, payload) {
    if (socketProvider) {
        try {
            socketProvider(companyId, event, payload);
        }
        catch (err) {
            console.error('Error emitting socket event:', err);
        }
    }
    else {
        console.warn('socketProvider not registered, ignoring emitSocket call:', { companyId, event });
    }
}
