"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orbitEventBus = exports.OrbitEventBus = void 0;
const capability_resolver_1 = require("../registry/capability-resolver");
class OrbitEventBus {
    static instance;
    subscribers = new Map();
    eventHistory = [];
    static getInstance() {
        if (!OrbitEventBus.instance) {
            OrbitEventBus.instance = new OrbitEventBus();
            OrbitEventBus.instance.registerDefaultObservers();
        }
        return OrbitEventBus.instance;
    }
    /**
     * Subscribes a handler to a specific event type or wildcard pattern (e.g. 'orbit.task.*', '*')
     */
    subscribe(pattern, handler) {
        if (!this.subscribers.has(pattern)) {
            this.subscribers.set(pattern, new Set());
        }
        this.subscribers.get(pattern).add(handler);
    }
    /**
     * Publishes a normalized domain event and triggers all matching subscribers safely
     */
    async publish(event) {
        this.eventHistory.push(event);
        if (this.eventHistory.length > 500) {
            this.eventHistory.shift();
        }
        const handlersToInvoke = [];
        // Exact match
        if (this.subscribers.has(event.type)) {
            this.subscribers.get(event.type).forEach(h => handlersToInvoke.push(h));
        }
        // Wildcard match (e.g. 'orbit.task.*')
        const prefix = event.type.split('.').slice(0, 2).join('.') + '.*';
        if (this.subscribers.has(prefix)) {
            this.subscribers.get(prefix).forEach(h => handlersToInvoke.push(h));
        }
        // Global wildcard '*'
        if (this.subscribers.has('*')) {
            this.subscribers.get('*').forEach(h => handlersToInvoke.push(h));
        }
        // Execute all handlers safely with async error isolation
        await Promise.all(handlersToInvoke.map(async (h) => {
            try {
                await h(event);
            }
            catch (err) {
                // Silently isolate subscriber error
            }
        }));
    }
    /**
     * Registers built-in proactive autonomous workspace observer handlers
     */
    registerDefaultObservers() {
        // Observer 1: Auto Lead Nurture & High Value Alert
        this.subscribe('orbit.lead.created', async (event) => {
            if (event.payload?.dealValue && Number(event.payload.dealValue) >= 5000) {
                const context = { companyId: event.companyId, userId: event.userId, userRole: 'admin' };
                await capability_resolver_1.OrbitCapabilityResolver.execute('task.create', {
                    title: `VIP Sales Follow-up: ${event.payload.name || 'New Deal'} ($${event.payload.dealValue})`,
                    priority: 'high',
                    description: 'Autonomous follow-up task triggered by Orbit Control Plane.'
                }, context);
            }
        });
        // Observer 2: Form Submission Evaluation
        this.subscribe('orbit.form.submitted', async (event) => {
            const context = { companyId: event.companyId, userId: event.userId, userRole: 'admin' };
            await capability_resolver_1.OrbitCapabilityResolver.execute('lead.create', {
                name: event.payload?.name || 'Form Lead',
                email: event.payload?.email,
                phone: event.payload?.phone,
                status: 'lead'
            }, context).catch(() => { });
        });
        // Observer 3: Overdue Invoice Autonomous Task Creation
        this.subscribe('orbit.invoice.overdue', async (event) => {
            const context = { companyId: event.companyId, userId: event.userId, userRole: 'admin' };
            await capability_resolver_1.OrbitCapabilityResolver.execute('task.create', {
                title: `Accounts Receivable Alert: Follow up on Invoice #${event.payload?.invoiceNumber || event.payload?.id}`,
                priority: 'high',
                description: `Invoice has passed due date for client ${event.payload?.clientName || 'Client'}. Amount: $${event.payload?.total || '0'}`
            }, context).catch(() => { });
        });
    }
    /**
     * Returns recent event history for auditing and state replay
     */
    getEventHistory() {
        return [...this.eventHistory];
    }
}
exports.OrbitEventBus = OrbitEventBus;
exports.orbitEventBus = OrbitEventBus.getInstance();
