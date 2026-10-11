/**
 * Get dynamic transporter based on category and company isolation rules
 * @param {string} category - 'system' or 'work'
 * @param {Object} prisma - Company database connection
 */
declare function getTransporter(category?: string): Promise<any>;
/**
 * Helper to send email using dynamic settings and log the transaction
 */
declare function dispatchEmail(options: any, prisma: any): Promise<{
    success: boolean;
    messageId: any;
    error?: undefined;
} | {
    success: boolean;
    error: any;
    messageId?: undefined;
}>;
/**
 * Unified entry point for all system notifications.
 * Handles template resolution, branding injection, and SMTP routing.
 */
declare function notify(recipient: any, event: any, data: any, options?: {}): Promise<any>;
export declare const EmailService: {
    getTransporter: typeof getTransporter;
    notify: typeof notify;
    dispatchEmail: typeof dispatchEmail;
    CATEGORIES: {
        SYSTEM: string;
        WORK: string;
    };
    verifyConfig: (category: any) => Promise<boolean>;
    getTemplatePreview: (templateId: any, templateData: any) => Promise<{
        subject: string;
        html: string;
    }>;
    sendEmail: (options: any) => Promise<any>;
    sendTransactEmail: (options: any, prisma: any) => Promise<any>;
    sendVerificationEmail: (to: any, name: any, verificationUrl: any, prisma: any) => Promise<any>;
    sendPasswordResetEmail: (to: any, name: any, resetUrl: any, prisma: any) => Promise<any>;
    sendProjectAssignedEmail: (to: any, name: any, projectName: any, projectUrl: any, prisma: any) => Promise<any>;
    sendTaskAssignedEmail: (to: any, name: any, taskTitle: any, projectName: any, taskUrl: any, prisma: any) => Promise<any>;
    sendSalaryGeneratedEmail: (to: any, name: any, month: any, netSalary: any, prisma: any) => Promise<any>;
    sendSystemAlert: (to: any, subject: any, message: any, prisma: any) => Promise<any>;
    sendWelcomeEmail: (user: any, password: any, prisma: any) => Promise<any>;
    sendDocumentTagEmail: (to: any, name: any, documentName: any, documentUrl: any, senderName: any, prisma: any) => Promise<any>;
    sendSalarySlip: (employee: any, salary: any, prisma: any) => Promise<any>;
    sendTaskOverdueEmail: (to: any, name: any, taskTitle: any, dueDate: any, ctaUrl: any, prisma: any) => Promise<any>;
    sendCompanyWelcomeEmail: (to: any, name: any, loginUrl: any, prisma: any) => Promise<any>;
    sendQuotationEmail: (to: any, data: any, attachments: any, prisma: any) => Promise<any>;
    sendTransitionalEmail: (to: any, subject: any, data: any, prisma: any) => Promise<any>;
    sendMeetingEmail: (to: any, name: any, meetingTitle: any, startTime: any, ctaUrl: any, prisma: any) => Promise<any>;
    sendDocumentWithAttachment: (to: any, name: any, documentName: any, message: any, attachment: any, prisma: any) => Promise<any>;
    sendTrialStartedEmail: (to: any, adminName: any, trialDays: any, prisma: any) => Promise<any>;
    sendTrialReminderEmail: (to: any, adminName: any, daysLeft: any, prisma: any) => Promise<any>;
    sendTrialExpiredEmail: (to: any, adminName: any, prisma: any) => Promise<any>;
    sendSubscriptionConfirmationEmail: (to: any, adminName: any, planName: any, amount: any, expiryDate: any, prisma: any) => Promise<any>;
    sendRenewalReminderEmail: (to: any, adminName: any, planName: any, daysLeft: any, renewalDate: any, prisma: any) => Promise<any>;
    sendDeletionWarningEmail: (to: any, adminName: any, retentionDays: any, deletionDate: any, prisma: any) => Promise<any>;
    sendForgotPasswordEmail(user: any, tempPassword: any, companyName: any, prisma: any): Promise<any>;
    sendGoalAssignedEmail(to: any, name: any, goalTitle: any, motivation: any, celebration: any, difficulty: any, dueDate: any, ctaUrl: any, prisma: any): Promise<any>;
};
export {};
