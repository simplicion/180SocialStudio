'use strict';

let Queue = null;
let Worker = null;
try {
    const bull = require('bullmq');
    Queue = bull.Queue;
    Worker = bull.Worker;
} catch {
    Queue = class FallbackQueue {
        name: any;
        opts: any;
        constructor(name: any, opts?: any) {
            this.name = name;
            this.opts = opts;
        }
        async add(name: any, data: any, opts?: any) {
            return { id: 'mock-' + Date.now(), name, data };
        }
        async close() {}
    };
    Worker = class FallbackWorker {
        name: any;
        processor: any;
        opts: any;
        constructor(name: any, processor: any, opts?: any) {
            this.name = name;
            this.processor = processor;
            this.opts = opts;
        }
        async close() {}
    };
}

let redis = null;
try {
    const Redis = require('ioredis');
    const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    redis = new Redis(redisUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
        enableOfflineQueue: false
    });
    redis.on('error', () => {});
} catch {
    redis = null;
}

let emailQueue = null;
let notificationQueue = null;
let automationQueue = null;
let aiQueue = null;
let fileProcessingQueue = null;

async function initQueues() {
    if (!redis || !Queue) {
        console.warn('[Queue] Skipping queue init - Redis or BullMQ not configured');
        return;
    }

    try {
        const connection = redis;

        if (redis.status !== 'ready') {
            console.log('[Queue] Waiting for Redis to be ready before initializing workers...');
            redis.once('ready', () => initQueues());
            return;
        }

        const originalWarn = console.warn;
        let evictionWarned = false;
        console.warn = (...args) => {
            const msg = args.join(' ');
            if (msg.includes('Eviction policy') || msg.includes('noeviction')) {
                if (!evictionWarned) {
                    evictionWarned = true;
                    originalWarn('[Queue] Redis eviction policy warning suppressed.');
                }
                return;
            }
            originalWarn(...args);
        };

        emailQueue = new Queue('email', { connection });
        notificationQueue = new Queue('notification', { connection });
        automationQueue = new Queue('automation', { connection });
        aiQueue = new Queue('ai', { connection });
        fileProcessingQueue = new Queue('fileProcessing', { connection });

        console.warn = originalWarn;
        console.log('BullMQ queues initialized (email, notification, automation)');
    } catch (err) {
        console.error('[Queue] Initialization failed. System using fallback mode.', err.message);
        emailQueue = null;
        notificationQueue = null;
        automationQueue = null;
        aiQueue = null;
        fileProcessingQueue = null;
    }
}

async function queueEmail({ to, subject, html, template, data, companyId, category }) {
    const targetCompanyId = companyId;
    if (!emailQueue) {
        const { EmailService } = require('./email.service');
        const { getCompanyPrisma } = require('@workspace/db');
        
        try {
            const companyPrisma = targetCompanyId ? getCompanyPrisma(targetCompanyId) : null;
            return EmailService.dispatchEmail({ 
                to, 
                subject, 
                html, 
                templateName: template, 
                templateData: data,
                category
            }, companyPrisma);
        } catch (err) {
            console.error('[Queue Fallback] Failed to send email:', err.message);
            return { success: false, error: err.message };
        }
    }
    return emailQueue.add('send', { to, subject, html, template, data, companyId: targetCompanyId, category }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
}

async function queueNotification(data, companyId) {
    const jobData = { ...data, companyId };
    if (!notificationQueue) {
        const { getCompanyPrisma } = require('@workspace/db');
        const companyPrisma = companyId ? getCompanyPrisma(companyId) : null;
        if (companyPrisma) {
            return companyPrisma.notification.create({ data });
        }
        return null;
    }
    return notificationQueue.add('create', jobData);
}

async function queueAutomation(type, data, companyId) {
    if (!automationQueue) {
        if (type === 'internal_trigger') {
            try {
                console.log('[Queue Fallback] Processing automation for company', companyId);
                return { success: true, fallback: true };
            } catch (err) {
                console.error('[Queue Fallback] Failed to process automation immediately:', err.message);
                return { success: false, error: err.message };
            }
        }
        console.warn('[Queue] Automation skipped - Queue not initialized and no direct fallback for type:', type);
        return;
    }
    return automationQueue.add('automation_task', { type, data, companyId });
}

async function queueAITask(taskType, data, companyId) {
    if (!aiQueue) {
        console.warn('[Queue] AI Queue not initialized. Cannot process ' + taskType);
        return null;
    }
    return aiQueue.add(taskType, { ...data, companyId });
}

async function queueFileTask(taskType, data, companyId) {
    if (!fileProcessingQueue) {
        console.warn('[Queue] File Processing Queue not initialized. Cannot process ' + taskType);
        return null;
    }
    return fileProcessingQueue.add(taskType, { ...data, companyId });
}

export {
    initQueues,
    queueEmail,
    queueNotification,
    queueAutomation,
    queueAITask,
    queueFileTask
};
export const getRedis = () => redis;
export const getEmailQueue = () => emailQueue;
export const getNotificationQueue = () => notificationQueue;
export const getAutomationQueue = () => automationQueue;
export const getAiQueue = () => aiQueue;
export const getFileProcessingQueue = () => fileProcessingQueue;
