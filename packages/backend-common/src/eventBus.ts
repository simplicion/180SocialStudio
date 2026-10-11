import { EventEmitter } from 'events';

/**
 * Global EventBus — singleton event emitter for domain events.
 *
 * Domains SHOULD emit events through this bus rather than requiring
 * controller-level wiring.  Listeners are registered at boot-time
 * (in `apps/backend`) so the domain layer stays decoupled from
 * infrastructure (email, queues, webhooks, etc.).
 */
class GlobalEventBus extends EventEmitter {}

export const eventBus = new GlobalEventBus();
