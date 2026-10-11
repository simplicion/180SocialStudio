import Redis from 'ioredis';
declare function initQueues(): Promise<void>;
/**
 * Add an email job to the queue
 */
declare function queueEmail({ to, subject, html, template, data, companyId, category }: {
    to: any;
    subject: any;
    html: any;
    template: any;
    data: any;
    companyId: any;
    category: any;
}): Promise<any>;
/**
 * Add a notification job to the queue
 */
declare function queueNotification(data: any, companyId: any): Promise<any>;
/**
 * Trigger an n8n automation via queue
 */
declare function queueAutomation(type: any, data: any, companyId: any): Promise<any>;
/**
 * Add an AI task to the queue
 */
declare function queueAITask(taskType: any, data: any, companyId: any): Promise<any>;
/**
 * Add a file processing task to the queue
 */
declare function queueFileTask(taskType: any, data: any, companyId: any): Promise<any>;
export { initQueues, queueEmail, queueNotification, queueAutomation, queueAITask, queueFileTask };
export declare const getRedis: () => Redis;
export declare const getEmailQueue: () => any;
export declare const getNotificationQueue: () => any;
export declare const getAutomationQueue: () => any;
export declare const getAiQueue: () => any;
export declare const getFileProcessingQueue: () => any;
