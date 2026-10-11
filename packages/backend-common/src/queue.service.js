'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFileProcessingQueue = exports.getAiQueue = exports.getAutomationQueue = exports.getNotificationQueue = exports.getEmailQueue = exports.getRedis = void 0;
exports.initQueues = initQueues;
exports.queueEmail = queueEmail;
exports.queueNotification = queueNotification;
exports.queueAutomation = queueAutomation;
exports.queueAITask = queueAITask;
exports.queueFileTask = queueFileTask;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
const redis = new ioredis_1.default(redisUrl, { maxRetriesPerRequest: null });
let emailQueue = null;
let notificationQueue = null;
let automationQueue = null;
let aiQueue = null;
let fileProcessingQueue = null;
async function initQueues() {
    if (!redis) {
        console.warn('[Queue] Skipping queue init â€” Redis not configured');
        return;
    }
    try {
        const connection = redis;
        // Verify connection is ready before starting workers
        if (redis.status !== 'ready') {
            console.log('[Queue] Waiting for Redis to be ready before initializing workers...');
            redis.once('ready', () => initQueues());
            return;
        }
        // Suppress BullMQ's repetitive eviction policy warning in development
        // (Render's free Redis uses allkeys-lru which can't be changed)
        const originalWarn = console.warn;
        let evictionWarned = false;
        console.warn = (...args) => {
            const msg = args.join(' ');
            if (msg.includes('Eviction policy') || msg.includes('noeviction')) {
                if (!evictionWarned) {
                    evictionWarned = true;
                    originalWarn('[Queue] âš ï¸  Redis eviction policy is allkeys-lru (should be noeviction). This is a known Render free-tier limitation. Queue jobs may be evicted under memory pressure.');
                }
                return;
            }
            originalWarn(...args);
        };
        emailQueue = new bullmq_1.Queue('email', { connection });
        notificationQueue = new bullmq_1.Queue('notification', { connection });
        automationQueue = new bullmq_1.Queue('automation', { connection });
        aiQueue = new bullmq_1.Queue('ai', { connection });
        fileProcessingQueue = new bullmq_1.Queue('fileProcessing', { connection });
        // Restore original console.warn
        console.warn = originalWarn;
        // ─── Workers (Moved to apps/worker) ──────────────────────────────
        console.log('✅ BullMQ queues initialized (email, notification, automation)');
    }
    catch (err) {
        console.error('â Œ [Queue] Initialization failed. System using fallback mode.', err.message);
        emailQueue = null;
        notificationQueue = null;
        automationQueue = null;
        aiQueue = null;
        fileProcessingQueue = null;
    }
}
/**
 * Add an email job to the queue
 */
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
        }
        catch (err) {
            console.error('[Queue Fallback] Failed to send email:', err.message);
            return { success: false, error: err.message };
        }
    }
    return emailQueue.add('send', { to, subject, html, template, data, companyId: targetCompanyId, category }, { attempts: 3, backoff: { type: 'exponential', delay: 2000 } });
}
/**
 * Add a notification job to the queue
 */
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
/**
 * Trigger an n8n automation via queue
 */
async function queueAutomation(type, data, companyId) {
    if (!automationQueue) {
        if (type === 'internal_trigger') {
            try {
                const { getCompanyPrisma } = require('@workspace/db');
                const AutomationService = require('../../../apps/backend/src/platform-core/platform-communications/services/automation.service');
                const companyPrisma = companyId ? getCompanyPrisma(companyId) : null;
                console.log(`[Queue Fallback] Processing automation [${data.eventType}] immediately for company ${companyId}`);
                return await AutomationService.processTrigger(data, companyPrisma);
            }
            catch (err) {
                console.error('[Queue Fallback] Failed to process automation immediately:', err.message);
                return { success: false, error: err.message };
            }
        }
        console.warn('[Queue] Automation skipped — Queue not initialized and no direct fallback for type:', type);
        return;
    }
    return automationQueue.add('automation_task', { type, data, companyId });
}
/**
 * Add an AI task to the queue
 */
async function queueAITask(taskType, data, companyId) {
    if (!aiQueue) {
        console.warn(`[Queue] AI Queue not initialized. Cannot process ${taskType}.`);
        return null;
    }
    return aiQueue.add(taskType, { ...data, companyId });
}
/**
 * Add a file processing task to the queue
 */
async function queueFileTask(taskType, data, companyId) {
    if (!fileProcessingQueue) {
        console.warn(`[Queue] File Processing Queue not initialized. Cannot process ${taskType}.`);
        return null;
    }
    return fileProcessingQueue.add(taskType, { ...data, companyId });
}
const getRedis = () => redis;
exports.getRedis = getRedis;
const getEmailQueue = () => emailQueue;
exports.getEmailQueue = getEmailQueue;
const getNotificationQueue = () => notificationQueue;
exports.getNotificationQueue = getNotificationQueue;
const getAutomationQueue = () => automationQueue;
exports.getAutomationQueue = getAutomationQueue;
const getAiQueue = () => aiQueue;
exports.getAiQueue = getAiQueue;
const getFileProcessingQueue = () => fileProcessingQueue;
exports.getFileProcessingQueue = getFileProcessingQueue;
