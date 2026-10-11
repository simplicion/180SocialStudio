// @ts-nocheck
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const nodemailer = require('nodemailer');
const { prisma } = require('@workspace/db');
/**
 * Get application base URL
 */
function getAppUrl(path = '') {
    let baseUrl = process.env.CLIENT_URL || 'http://localhost:3000';
    if (baseUrl.endsWith('/'))
        baseUrl = baseUrl.slice(0, -1);
    if (path && !path.startsWith('/'))
        path = '/' + path;
    return `${baseUrl}${path}`;
}
/**
 * Get platform-wide branding and company information
 */
async function getPlatformBranding() {
    try {
        const ps = await prisma.platformSettings.findFirst() || {};
        return {
            companyName: ps.platformName || 'Platform',
            tagline: ps.brandingTagline || 'Enterprise Management Excellence',
            brandColor: ps.themeColor || '#4f46e5',
            companyLogo: ps.logoUrl || '',
            emailLogo: ps.logoUrl || '',
            websiteUrl: ps.companyWebsite || getAppUrl(),
            address: ps.companyAddress || '',
            phone: ps.companyPhone || '',
            legalName: ps.companyLegalName || ps.platformName || 'Platform Inc.'
        };
    }
    catch (e) {
        return {
            companyName: 'Platform',
            tagline: 'Enterprise Management Excellence',
            brandColor: '#4f46e5',
            companyLogo: '',
            emailLogo: '',
            websiteUrl: getAppUrl(),
            address: '',
            phone: '',
            legalName: 'Platform Inc.'
        };
    }
}
/**
 * Get company configuration with defaults, falling back to platform settings
 */
async function getCompanyInfo() {
    const platform = await getPlatformBranding();
    if (!prisma)
        return platform;
    try {
        const config = await prisma.settings.findFirst();
        if (!config) {
            return platform;
        }
        return {
            companyName: config.companyName || platform.companyName,
            tagline: config.tagline || platform.tagline,
            brandColor: config.themeColor || platform.brandColor,
            companyLogo: config.logoUrl || platform.companyLogo,
            emailLogo: config.logoUrl || platform.emailLogo,
            websiteUrl: config.websiteUrl || platform.websiteUrl,
            address: config.address || platform.address,
            phone: config.phoneNumber || platform.phone
        };
    }
    catch (err) {
        console.warn(`[EmailService] Error fetching company info: ${err.message}. Falling back to platform branding.`);
        return platform;
    }
}
/**
 * Email Categories for strict isolation
 */
const CATEGORIES = {
    SYSTEM: 'system', // Onboarding, Billing, Global Admin Resets
    WORK: 'work' // Tasks, Projects, Invoices, HR, Local User Resets
};
/**
 * Get dynamic transporter based on category and company isolation rules
 * @param {string} category - 'system' or 'work'
 * @param {Object} prisma - Company database connection
 */
async function getTransporter(category = CATEGORIES.WORK) {
    // 1. If it's a WORK email, we ONLY use Company SMTP
    if (category === CATEGORIES.WORK) {
        if (!prisma) {
            console.error('[EmailService] WORK category requires prisma context. Aborting.');
            return null;
        }
        try {
            const company = await prisma.company.findFirst({ select: { id: true, metadata: true } });
            if (!company)
                throw new Error("Could not find company in company context.");
            let metadata = company.metadata || {};
            if (typeof metadata === 'string') {
                try {
                    metadata = JSON.parse(metadata);
                }
                catch (e) {
                    metadata = {};
                }
            }
            const settingsRecord = await prisma.settings.findFirst();
            const settings = { ...(settingsRecord || {}) };
            ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpSecure', 'emailFrom'].forEach(field => {
                if (metadata[field] !== undefined)
                    settings[field] = metadata[field];
            });
            if (settings.smtpHost && settings.smtpUser && settings.smtpPass) {
                console.log(`[EmailService] [ISOLATION:WORK] Using Company SMTP: ${settings.smtpHost}`);
                const port = Number(settings.smtpPort) || 587;
                return nodemailer.createTransport({
                    host: settings.smtpHost,
                    port: port,
                    secure: settings.smtpSecure !== undefined ? settings.smtpSecure : (port === 465),
                    auth: { user: settings.smtpUser, pass: settings.smtpPass },
                });
            }
            // Fallback to Platform SMTP if company SMTP is not configured
            const ps = await prisma.platformSettings.findFirst();
            if (ps && ps.smtpHost && ps.smtpUser && ps.smtpPass) {
                console.log(`[EmailService] [ISOLATION:WORK] Falling back to Platform SMTP: ${ps.smtpHost}`);
                const port = Number(ps.smtpPort) || 587;
                return nodemailer.createTransport({
                    host: ps.smtpHost,
                    port: port,
                    secure: ps.smtpSecure !== undefined ? ps.smtpSecure : (port === 465),
                    auth: { user: ps.smtpUser, pass: ps.smtpPass },
                });
            }
            console.warn(`[EmailService] [ISOLATION:WORK] No SMTP configured for company or platform. Throwing error.`);
            throw new Error("SMTP is not configured. Please configure your email settings in the dashboard to send work emails.");
        }
        catch (e) {
            console.error('[EmailService] [ISOLATION:WORK] Error loading company SMTP:', e.message);
            return null;
        }
    }
    // 2. If it's a SYSTEM email, we use Platform SMTP or .env fallback
    if (category === CATEGORIES.SYSTEM) {
        // Try PlatformSettings (SuperAdmin level)
        try {
            const ps = await prisma.platformSettings.findFirst();
            if (ps && ps.smtpHost && ps.smtpUser && ps.smtpPass) {
                console.log(`[EmailService] [ISOLATION:SYSTEM] Using Platform SMTP: ${ps.smtpHost}`);
                return nodemailer.createTransport({
                    host: ps.smtpHost,
                    port: ps.smtpPort || 587,
                    secure: ps.smtpSecure !== undefined ? ps.smtpSecure : (ps.smtpPort === 465),
                    auth: { user: ps.smtpUser, pass: ps.smtpPass },
                });
            }
        }
        catch (e) {
            console.warn('[EmailService] [ISOLATION:SYSTEM] PlatformSettings SMTP error:', e.message);
        }
        // Final .env fallback for system level only
        if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
            console.log(`[EmailService] [ISOLATION:SYSTEM] Using .env SMTP fallback: ${process.env.SMTP_HOST}`);
            return nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT) || 587,
                secure: process.env.SMTP_SECURE === 'true',
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            });
        }
        console.warn('[EmailService] [ISOLATION:SYSTEM] No platform or .env SMTP configured.');
        return null;
    }
    return null;
}
/**
 * Helper to send email using dynamic settings and log the transaction
 */
async function dispatchEmail(options, prisma) {
    let logId = null;
    const category = options.category || CATEGORIES.WORK;
    try {
        const transporter = await getTransporter(category, prisma);
        // Logging only if prisma provided
        if (prisma) {
            // Ensure sentById is a valid UUID to prevent foreign key constraint violations
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            let validSentById = options.sentById || null;
            if (validSentById && !uuidRegex.test(validSentById)) {
                validSentById = null;
            }
            const log = await prisma.emailLog.create({
                data: {
                    to: options.to,
                    subject: options.subject,
                    templateName: options.templateName || 'generic',
                    templateData: options.templateData || {},
                    sentById: validSentById,
                    status: 'failed',
                }
            });
            logId = log.id;
        }
        if (!transporter) {
            const errorMsg = category === CATEGORIES.WORK
                ? 'Company SMTP is not configured. Please configure your email settings in the dashboard to send work emails.'
                : 'SMTP not configured. Please check your .env or Platform Settings.';
            if (logId && prisma) {
                await prisma.emailLog.update({
                    where: { id: logId },
                    data: { errorMessage: errorMsg }
                });
            }
            console.error(`[EmailService] Delivery aborted: ${errorMsg}`);
            return { success: false, error: errorMsg };
        }
        // Verify connection before sending (optional but good for debugging)
        if (process.env.NODE_ENV === 'development') {
            try {
                await transporter.verify();
                console.log('[EmailService] SMTP connection verified successfully.');
            }
            catch (verifyErr) {
                console.error('[EmailService] SMTP verification failed:', verifyErr.message);
                // We'll still try to send, but log the verification failure
            }
        }
        // Get "from" address
        let fromAddress = options.from || process.env.EMAIL_FROM || 'noreply@internal.system';
        // Check PlatformSettings for global from address
        try {
            const ps = await prisma.platformSettings.findFirst();
            if (ps && ps.smtpFrom)
                fromAddress = ps.smtpFrom;
        }
        catch (e) { }
        if (prisma) {
            const settings = await prisma.settings.findFirst();
            if (settings && settings.emailFrom)
                fromAddress = settings.emailFrom;
        }
        const info = await transporter.sendMail({
            from: fromAddress,
            to: options.to,
            subject: options.subject,
            html: options.html,
            attachments: options.attachments || [],
        });
        console.log('Email sent:', info.messageId);
        if (logId && prisma) {
            await prisma.emailLog.update({
                where: { id: logId },
                data: { status: 'sent' }
            });
        }
        return { success: true, messageId: info.messageId };
    }
    catch (error) {
        console.error('Email send error:', error);
        if (logId && prisma) {
            await prisma.emailLog.update({
                where: { id: logId },
                data: { status: 'failed', errorMessage: error.message }
            });
        }
        return { success: false, error: error.message };
    }
}
async function send(options) {
    const { queueEmail } = require('./queue.service');
    const companyId = prisma?.companyId || 'global';
    return queueEmail({ ...options, companyId });
}
// ─── Email templates HTML constructor ─────────────────────────────────────────────────────────â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function baseLayout(title, content, company) {
    const brandColor = company.brandColor || '#4f46e5';
    const logoHtml = company.emailLogo || company.companyLogo
        ? `<img src="${company.emailLogo || company.companyLogo}" alt="${company.companyName}" style="max-height: 48px; width: auto; display: block; margin: 0 auto;">`
        : `<span style="font-size: 24px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">${company.companyName}</span>`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            background-color: #f8fafc; 
            margin: 0; 
            padding: 0; 
            -webkit-font-smoothing: antialiased;
        }
        
        .wrapper {
            width: 100%;
            table-layout: fixed;
            background-color: #f8fafc;
            padding-bottom: 40px;
        }

        .container { 
            max-width: 600px; 
            margin: 0 auto; 
            background-color: #ffffff; 
            border-radius: 16px; 
            overflow: hidden; 
            box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
            border: 1px solid #e2e8f0;
            margin-top: 40px;
        }

        .header { 
            background: #0f172a; 
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); 
            padding: 48px 32px; 
            text-align: center; 
        }

        .header p { 
            color: #94a3b8; 
            margin: 12px 0 0; 
            font-size: 13px; 
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.1em;
        }

        .content { 
            padding: 48px 40px; 
        }

        .content h2 { 
            color: #0f172a; 
            font-size: 26px; 
            font-weight: 800; 
            margin: 0 0 24px; 
            letter-spacing: -0.025em;
            line-height: 1.2;
        }

        .content p { 
            color: #334155; 
            line-height: 1.7; 
            margin: 0 0 24px; 
            font-size: 16px;
        }

        .button { 
            display: inline-block; 
            background-color: ${brandColor}; 
            color: #ffffff !important; 
            padding: 18px 36px; 
            border-radius: 12px; 
            text-decoration: none; 
            font-weight: 700; 
            font-size: 15px; 
            margin: 24px 0;
            transition: all 0.3s ease;
            box-shadow: 0 10px 15px -3px rgba(79, 70, 229, 0.3);
        }

        .credential-box { 
            background-color: #f8fafc; 
            padding: 32px; 
            border-radius: 16px; 
            margin: 24px 0; 
            border: 1px solid #e2e8f0; 
        }

        .credential-item { 
            margin-bottom: 20px; 
        }

        .credential-item:last-child { 
            margin-bottom: 0; 
        }

        .credential-label { 
            display: block;
            font-size: 12px; 
            text-transform: uppercase; 
            letter-spacing: 0.05em; 
            color: #64748b; 
            font-weight: 600;
            margin-bottom: 6px;
        }

        .credential-value { 
            display: block;
            font-size: 16px; 
            font-weight: 600; 
            color: #0f172a; 
            font-family: 'JetBrains Mono', 'Courier New', monospace;
        }

        .footer { 
            padding: 32px 40px; 
            text-align: center; 
            color: #94a3b8; 
            font-size: 13px; 
            border-top: 1px solid #f1f5f9;
        }

        .footer a {
            color: ${brandColor};
            text-decoration: none;
            font-weight: 500;
        }

        @media (max-width: 600px) {
            .container { margin-top: 0; border-radius: 0; }
            .content { padding: 32px 24px; }
            .header { padding: 40px 24px; }
        }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="container">
            <div class="header">
                ${logoHtml}
                <p>${company.tagline || ''}</p>
            </div>
            <div class="content">${content}</div>
            <div class="footer">
                <p>&copy; ${new Date().getFullYear()} ${company.companyName}. All rights reserved.</p>
                <p>This is an automated system message from <a href="${company.websiteUrl}">${company.companyName}</a>.</p>
            </div>
        </div>
    </div>
</body>
</html>`;
}
async function buildTemplate(templateId, data) {
    const company = await getCompanyInfo(prisma);
    let subject = '';
    let content = '';
    switch (templateId) {
        case 'welcome':
            subject = `Welcome to ${company.companyName} â€” Account Activation`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <p style="margin: 0; color: #475569; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Enterprise Management Excellence</p>
                    <h2 style="margin-top: 16px; margin-bottom: 8px; color: #1e293b; font-size: 24px;">Welcome aboard, ${data.name}! ðŸš€</h2>
                    <p style="color: #475569; font-size: 16px; margin-top: 0;">We're excited to have you join us at ${company.companyName}. Your professional workspace is ready for use.</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6;">An administrator has created your account. You can access the platform using the secure credentials provided below:</p>
                
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; margin: 32px 0;">
                    <div style="margin-bottom: 20px;">
                        <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600;">Access Email</p>
                        <p style="margin: 4px 0 0; font-size: 16px; color: #0f172a; font-weight: 500;">${data.email || 'Email missing'}</p>
                    </div>
                    <div style="border-top: 1px solid #e2e8f0; padding-top: 20px;">
                        <p style="margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-weight: 600;">Temporary Password</p>
                        <p style="margin: 4px 0 0; font-size: 18px; color: ${company.brandColor || '#4f46e5'}; font-weight: 700; letter-spacing: 0.5px;">${data.password}</p>
                    </div>
                </div>
                
                <div style="text-align: center; margin: 40px 0;">
                    <a href="${getAppUrl('/login')}" style="display: inline-block; background-color: ${company.brandColor || '#4f46e5'}; color: #ffffff; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 15px;">Access My Dashboard</a>
                </div>
                
                <div style="background-color: #fffbeb; border-left: 4px solid #f59e0b; padding: 16px; margin-top: 32px;">
                    <p style="color: #92400e; font-size: 14px; margin: 0; line-height: 1.5;">
                        <strong>âš ï¸ Security Note:</strong> For your protection, please change your password immediately after your first login to ensure your account remains secure.
                    </p>
                </div>
            `;
            break;
        case 'project_assigned':
            subject = `${company.companyName} â€” Project Access Granted: ${data.projectName}`;
            content = `
                <div style="text-align: center; margin-bottom: 32px;">
                    <div style="display: inline-block; padding: 12px; background: #f0fdf4; border-radius: 16px; margin-bottom: 16px;">
                        <span style="font-size: 32px;">ðŸ—ï¸</span>
                    </div>
                    <h2 style="margin: 0; color: #1e293b;">Project Access Granted</h2>
                    <p style="color: #64748b; margin-top: 4px;">You have been assigned to a new corporate project.</p>
                </div>
                
                <p>Hi ${data.name},</p>
                <p>This is to inform you that an administrator has granted you access to the following project in the system. You can now participate in discussions, track milestones, and manage associated documents.</p>
                
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; letter-spacing: 0.05em;">Project Name</p>
                    <p style="margin: 4px 0 0 0; font-size: 18px; font-weight: 700; color: #1e293b;">${data.projectName}</p>
                    
                    <div style="margin-top: 16px; display: inline-block; background: #dcfce7; color: #166534; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.025em;">Active Status</div>
                </div>
                
                <div style="text-align: center; margin-top: 32px;">
                    <a href="${data.projectUrl || getAppUrl(data.ctaUrl || '')}" class="button" style="padding: 14px 28px;">Open Project Dashboard â†’</a>
                </div>
            `;
            break;
        case 'task_assigned':
            subject = `${company.companyName} â€” New Task Assignment: ${data.taskTitle}`;
            content = `
                <div style="text-align: center; margin-bottom: 32px;">
                    <div style="display: inline-block; padding: 12px; background: #fff7ed; border-radius: 16px; margin-bottom: 16px;">
                        <span style="font-size: 32px;">ðŸ“‹</span>
                    </div>
                    <h2 style="margin: 0; color: #1e293b;">New Task Assignment</h2>
                    <p style="color: #64748b; margin-top: 4px;">A new task has been assigned for your completion.</p>
                </div>
                
                <p>Hi ${data.name},</p>
                <p>You have been assigned a new task within the <strong>${data.projectName || 'Active Project'}</strong>. Please review the requirements and update the status as you progress.</p>
                
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; letter-spacing: 0.05em;">Task Description</p>
                    <p style="margin: 4px 0 0 0; font-size: 16px; font-weight: 700; color: #1e293b;">${data.taskTitle}</p>
                    
                    ${data.dueDate ? `
                    <div style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed #cbd5e1;">
                        <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Completion Deadline</p>
                        <p style="margin: 4px 0 0 0; font-weight: 600; color: #cf1d29;">${data.dueDate}</p>
                    </div>
                    ` : ''}
                </div>
                
                <div style="text-align: center; margin-top: 32px;">
                    <a href="${data.taskUrl || getAppUrl(data.ctaUrl || '')}" class="button" style="padding: 14px 28px;">View Task Details</a>
                </div>
            `;
            break;
        case 'salary_generated':
            subject = `${company.companyName} â€” Salary for ${data.month}`;
            const salaryCurrency = company.currency || 'USD';
            content = `
                <h2>Your salary has been generated</h2>
                <p>Hi ${data.name},</p>
                <p>Your salary for <strong>${data.month}</strong> has been processed:</p>
                <p style="font-size:32px;font-weight:700;color:${company.brandColor || '#4f46e5'};margin:16px 0;">${salaryCurrency} ${Number(data.netSalary).toLocaleString()}</p>
                <a href="${getAppUrl('/dashboard/hr')}" class="button">View Salary Details</a>
            `;
            break;
        case 'system_alert':
            subject = `${company.companyName} â€” ${data.subject}`;
            content = `
                <h2>System Alert</h2>
                <p>${data.message}</p>
            `;
            break;
        case 'verification':
            subject = `Welcome to ${company.companyName} â€” Verify Your Email`;
            content = `
                <h2>Welcome to ${company.companyName}, ${data.name}! ðŸ‘‹</h2>
                <p>Your account has been created. Please verify your email address to get started.</p>
                <a href="${data.verificationUrl}" class="button">Verify Email Address</a>
                <p style="margin-top:24px;font-size:13px;color:#9ca3af;">If you didn't create this account, you can safely ignore this email.</p>
            `;
            break;
        case 'password_reset':
            subject = `${company.companyName} â€” Password Reset Link`;
            content = `
                <h2>Password Reset Request</h2>
                <p>Hi ${data.name},</p>
                <p>We received a request to reset your password. Click the button below to create a new password.</p>
                <a href="${data.resetUrl}" class="button">Reset Password</a>
                <p style="margin-top:24px;font-size:13px;color:#9ca3af;">This link expires in 1 hour. If you didn't request a password reset, please ignore this email.</p>
            `;
            break;
        case 'forgot_password':
            subject = `${company.companyName} â€” Temporary Password`;
            content = `
                <div style="text-align: center; margin-bottom: 32px;">
                    <div style="display: inline-block; padding: 12px; background: #fee2e2; border-radius: 16px; margin-bottom: 16px;">
                        <span style="font-size: 32px;">ðŸ”‘</span>
                    </div>
                    <h2 style="margin: 0; color: #1e293b;">Temporary Password</h2>
                    <p style="color: #64748b; margin-top: 4px;">A temporary password has been generated for your account.</p>
                </div>
                
                <p>Hi ${data.name},</p>
                <p>We've received a request for your account credentials at <strong>${company.companyName}</strong>. You can log in using the temporary password below:</p>
                
                <div class="credential-box" style="background: #fdf2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 24px; margin: 24px 0; text-align: center;">
                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; color: #991b1b; font-weight: 600; letter-spacing: 0.05em;">Temporary Password</p>
                    <p style="margin: 8px 0 0 0; font-size: 24px; font-weight: 700; color: #dc2626; font-family: monospace;">${data.tempPassword}</p>
                </div>
                
                <div style="text-align: center; margin-top: 32px;">
                    <a href="${getAppUrl('/login')}" class="button" style="background-color: #dc2626; padding: 14px 28px;">Go to Login â†’</a>
                </div>
                
                <div style="background-color: #fff7ed; border: 1px solid #ffedd5; border-radius: 12px; padding: 20px; margin-top: 32px;">
                    <p style="color: #9a3412; font-size: 14px; margin: 0;">
                        <strong>Security Reminder:</strong> For your protection, please change this temporary password immediately after logging in.
                    </p>
                </div>
            `;
            break;
        case 'document_tagged':
            subject = `${company.companyName} â€” Document Shared: ${data.documentName}`;
            content = `
                <h2>You've been tagged in a document</h2>
                <p>Hi ${data.name},</p>
                <p><strong>${data.senderName}</strong> has tagged you in a new document:</p>
                <div class="box">
                    <p>Document Title<strong>${data.documentName}</strong></p>
                </div>
                <a href="${data.documentUrl}" class="button">View Document</a>
            `;
            break;
        // --- NEW TEMPLATES ---
        case 'user_onboarded':
        case 'company_welcome':
            subject = `Welcome to ${company.companyName} â€” Your Workspace is Ready`;
            content = `
                <div style="text-align: center; margin-bottom: 32px;">
                    <h2 style="margin-bottom: 8px;">Welcome, ${data.name}! ðŸš€</h2>
                    <p style="color: #64748b;">Your company workspace <strong>${company.companyName}</strong> has been successfully configured and is ready for use.</p>
                </div>
                
                <p>We're thrilled to have you on board. You can now start managing your business operations efficiently, customize your settings, and invite your team members.</p>
                
                <div style="text-align: center; margin: 40px 0;">
                    <a href="${getAppUrl('/login')}" class="button">Access My Dashboard</a>
                </div>
            `;
            break;
        case 'meeting_scheduled':
            subject = `Meeting Invitation: ${data.meetingTitle}`;
            const timeDisplay = data.startTime
                ? `${data.startDate} at ${data.startTime}${data.endTime ? ` - ${data.endTime}` : ''}`
                : data.startDate;
            const platformDisplay = data.platform ? data.platform.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : '';
            content = `
                <div style="text-align: center; margin-bottom: 32px;">
                    <div style="display: inline-block; padding: 12px; background: #e0f2fe; border-radius: 16px; margin-bottom: 16px;">
                        <span style="font-size: 32px;">ðŸ—“ï¸ </span>
                    </div>
                    <h2 style="margin: 0; color: #0f172a;">Meeting Invitation</h2>
                    <p style="color: #64748b; margin-top: 4px;">You have been invited to a meeting by ${data.creatorName}.</p>
                </div>
                
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; letter-spacing: 0.05em;">Meeting Subject</p>
                    <p style="margin: 4px 0 20px 0; font-size: 18px; font-weight: 700; color: #0f172a;">${data.meetingTitle}</p>
                    
                    <div style="display: grid; grid-template-columns: 1fr; gap: 16px; margin-top: 16px; padding-top: 16px; border-top: 1px dashed #cbd5e1;">
                        <div>
                             <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Date & Time</p>
                             <p style="margin: 4px 0 0 0; font-weight: 600; color: #3b82f6;">${timeDisplay}</p>
                        </div>
                        
                        ${platformDisplay ? `
                        <div>
                             <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Platform</p>
                             <p style="margin: 4px 0 0 0; font-weight: 600; color: #334155;">${platformDisplay}</p>
                        </div>
                        ` : ''}
                        
                        ${data.location ? `
                        <div>
                             <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Location</p>
                             <p style="margin: 4px 0 0 0; font-weight: 600; color: #334155;">${data.location}</p>
                        </div>
                        ` : ''}
                    </div>
                    
                    ${data.agenda ? `
                    <div style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed #cbd5e1;">
                         <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Agenda</p>
                         <p style="margin: 4px 0 0 0; font-size: 14px; color: #475569; line-height: 1.5; white-space: pre-wrap;">${data.agenda}</p>
                    </div>
                    ` : ''}
                    
                    ${data.notes ? `
                    <div style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed #cbd5e1;">
                         <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Additional Notes</p>
                         <p style="margin: 4px 0 0 0; font-size: 14px; color: #475569; line-height: 1.5; white-space: pre-wrap;">${data.notes}</p>
                    </div>
                    ` : ''}
                </div>
                
                <div style="text-align: center; margin-top: 32px;">
                    <a href="${data.ctaUrl}" class="button" style="padding: 14px 28px;">${data.ctaUrl.includes('/dashboard') ? 'View in Dashboard' : 'Join Meeting Now'}</a>
                </div>
            `;
            break;
        case 'leave_approved':
            subject = `${company.companyName} â€” Leave Request Approved`;
            content = `
                <h2>Leave Request Approved</h2>
                <p>Hi ${data.name},</p>
                <p>Your request for <strong>${data.leaveType}</strong> has been approved.</p>
                <div class="box">
                    <p>Duration<strong>${data.startDate} to ${data.endDate}</strong></p>
                </div>
                <p>Enjoy your time off!</p>
            `;
            break;
        case 'leave_rejected':
            subject = `${company.companyName} â€” Leave Request Update`;
            content = `
                <h2>Leave Request Update</h2>
                <p>Hi ${data.name},</p>
                <p>Unfortunately, your request for <strong>${data.leaveType}</strong> has not been approved at this time.</p>
                <div class="box">
                    <p>Reason provided<strong>${data.reason}</strong></p>
                </div>
                <p>Please contact HR or your manager for further details.</p>
            `;
            break;
        case 'task_completed':
            subject = `${company.companyName} â€” Task Completed: ${data.taskTitle}`;
            content = `
                <h2>Task Completed</h2>
                <p>Hi ${data.name},</p>
                <p>A task related to <strong>${data.projectName}</strong> has just been marked as completed.</p>
                <div class="box">
                    <p>Task Title<strong>${data.taskTitle}</strong></p>
                </div>
                <a href="${data.ctaUrl}" class="button">View Details</a>
            `;
            break;
        case 'module_assigned':
            subject = `${company.companyName} â€” Module Assignment: ${data.moduleName}`;
            content = `
                <div style="text-align: center; margin-bottom: 32px;">
                    <div style="display: inline-block; padding: 12px; background: #e0e7ff; border-radius: 16px; margin-bottom: 16px;">
                        <span style="font-size: 32px;">ðŸ“¦</span>
                    </div>
                    <h2 style="margin: 0; color: #1e293b;">Module Assignment</h2>
                    <p style="color: #64748b; margin-top: 4px;">You have been assigned as a module owner.</p>
                </div>
                
                <p>Hi ${data.name},</p>
                <p>You have been assigned as the owner of a new module. Please review the module resources below.</p>
                
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                    <p style="margin: 0; font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; letter-spacing: 0.05em;">Module Details</p>
                    <p style="margin: 4px 0 0 0; font-size: 16px; font-weight: 700; color: #1e293b;">${data.moduleName}</p>
                    
                    <div style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed #cbd5e1;">
                         <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase;">Project</p>
                         <p style="margin: 4px 0 0 0; font-weight: 600; color: #3b82f6;">${data.projectName}</p>
                    </div>
                </div>
                
                <div style="text-align: center; margin-top: 32px;">
                    <a href="${data.url || data.ctaUrl ? getAppUrl(data.url || data.ctaUrl) : getAppUrl()}" class="button" style="padding: 14px 28px;">View Module Details</a>
                </div>
            `;
            break;
        case 'task_overdue':
            subject = `${company.companyName} â€” Task Overdue Alert: ${data.taskTitle}`;
            content = `
                <h2>âš ï¸ Task Overdue Alert</h2>
                <p>Hi ${data.name},</p>
                <p>This is an automated alert indicating that your assigned task is now <strong>overdue</strong>.</p>
                <div class="box">
                    <p>Task Title<strong>${data.taskTitle}</strong></p>
                    <p style="margin-top: 12px;">Due Date<strong>${data.dueDate}</strong></p>
                </div>
                <p style="color:#cf1d29;font-weight:600;">Due to this delay, a point has been deducted from your performance score.</p>
                <a href="${data.ctaUrl}" class="button">View Task Now</a>
            `;
            break;
        case 'invoice_generated':
            subject = `${company.companyName} â€” Invoice #${data.invoiceNumber}`;
            content = `
                <h2>Invoice Available</h2>
                <p>Hi ${data.clientName},</p>
                <p>A new invoice has been generated for your account.</p>
                <div class="box">
                    <p>Invoice Number<strong>${data.invoiceNumber}</strong></p>
                    <p style="margin-top: 12px;">Amount Due<strong>${data.currency || ''}${data.amount}</strong></p>
                    <p style="margin-top: 12px;">Due Date<strong>${data.dueDate}</strong></p>
                </div>
                <a href="${data.ctaUrl}" class="button">View & Pay Invoice</a>
            `;
            break;
        case 'payment_received':
            subject = `${company.companyName} â€” Payment Received for #${data.invoiceNumber}`;
            const paymentCurrency = data.currency || company.currency || 'USD';
            content = `
                <h2>Payment Received</h2>
                <p>Hi ${data.clientName},</p>
                <p>We have successfully received your payment of <strong>${paymentCurrency} ${data.amount}</strong> on ${data.date}.</p>
                <p>Thank you for your prompt payment.</p>
            `;
            break;
        case 'performance_review':
            subject = `${company.companyName} â€” Performance Review Scheduled`;
            content = `
                <h2>Performance Review Scheduled</h2>
                <p>Hi ${data.name},</p>
                <p>Your upcoming performance review has been scheduled with <strong>${data.reviewerName}</strong>.</p>
                <div class="box">
                    <p>Date & Time<strong>${data.reviewDate}</strong></p>
                </div>
                <a href="${data.ctaUrl}" class="button">View Review Details</a>
            `;
            break;
        case 'goal_assigned':
            const difficultyColor = data.difficulty === 'heroic' ? '#7c3aed' : (data.difficulty === 'hard' ? '#dc2626' : '#2563eb');
            subject = `${company.companyName} â€” New Goal: ${data.goalTitle}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; padding: 12px; background: #f5f3ff; border-radius: 16px; margin-bottom: 16px;">
                        <span style="font-size: 32px;">ðŸŽ¯</span>
                    </div>
                    <h2 style="margin: 0; color: #1e1b4b;">A New Challenge Awaits!</h2>
                    <p style="color: #4f46e5; font-weight: 600; margin-top: 4px;">Goal: ${data.goalTitle}</p>
                </div>
                
                <p>Hi ${data.name},</p>
                <p>A new goal has been set for you. This is more than just a taskâ€”it's an opportunity to grow, contribute, and achieve something remarkable.</p>
                
                <div class="box" style="border-left: 4px solid ${difficultyColor};">
                    <p style="margin: 0; font-size: 12px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.05em;">The Vision</p>
                    <p style="margin: 8px 0 16px 0; font-style: italic; color: #374151;">"${data.motivation || 'To push boundaries and reach new heights.'}"</p>
                    
                    <div style="display: grid; grid-template-cols: 1fr 1fr; gap: 12px;">
                        <div>
                             <p style="margin: 0; font-size: 11px; color: #9ca3af;">Difficulty</p>
                             <p style="margin: 2px 0 0 0; font-weight: 700; color: ${difficultyColor};">${data.difficulty?.toUpperCase() || 'MEDIUM'}</p>
                        </div>
                        <div>
                             <p style="margin: 0; font-size: 11px; color: #9ca3af;">Target Date</p>
                             <p style="margin: 2px 0 0 0; font-weight: 700; color: #111827;">${data.dueDate || 'Ongoing'}</p>
                        </div>
                    </div>
                </div>

                ${data.celebration ? `
                <div style="margin-top: 20px; padding: 16px; background: #fffbeb; border: 1px dashed #f59e0b; border-radius: 12px;">
                    <p style="margin: 0; font-size: 13px; color: #92400e;"><strong>The Reward:</strong> ${data.celebration}</p>
                </div>
                ` : ''}

                <p style="margin-top: 24px;">Are you ready to make this happen? Let's turn this vision into reality.</p>
                
                <div style="text-align: center; margin-top: 32px;">
                    <a href="${data.ctaUrl}" class="button" style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 14px 28px; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2);">Accept the Challenge</a>
                </div>
            `;
            break;
        case 'document_shared':
            subject = `${company.companyName} â€” Document Shared: ${data.documentName}`;
            content = `
                <h2>A document was shared with you</h2>
                <p>Hi ${data.name},</p>
                <p><strong>${data.senderName}</strong> has securely shared a document with you.</p>
                <div class="box">
                    <p>Document Name<strong>${data.documentName}</strong></p>
                </div>
                <a href="${data.ctaUrl}" class="button">Access Document</a>
            `;
            break;
        case 'client_welcome':
            subject = `Welcome to the ${company.companyName} Portal`;
            content = `
                <h2>Welcome, ${data.clientName}!</h2>
                <p>We are thrilled to partner with you. Your client portal has been set up securely.</p>
                <p>You can track projects, invoices, and documents directly from your dashboard.</p>
                <a href="${data.loginUrl}" class="button">Access Client Portal</a>
            `;
            break;
        case 'project_completed':
            subject = `${company.companyName} â€” Project Completed: ${data.projectName}`;
            content = `
                <h2>Project Completed ðŸŽ‰</h2>
                <p>Hi ${data.name},</p>
                <p>Congratulations! The project <strong>${data.projectName}</strong> was successfully completed on ${data.completionDate}.</p>
                <p>Thank you for your hard work and collaboration.</p>
                <a href="${data.ctaUrl}" class="button">View Final Project Report</a>
            `;
            break;
        case 'expense_approved':
            subject = `${company.companyName} â€” Expense Approved`;
            content = `
                <h2>Expense Approved</h2>
                <p>Hi ${data.name},</p>
                <p>Your business expense has been formally approved and will be reimbursed in the next cycle.</p>
                <div class="box">
                    <p>Expense Item<strong>${data.expenseTitle}</strong></p>
                    <p style="margin-top: 12px;">Amount<strong>${data.amount}</strong></p>
                    <p style="margin-top: 12px;">Submitted On<strong>${data.date}</strong></p>
                </div>
            `;
            break;
        case 'expense_rejected':
            subject = `${company.companyName} â€” Expense Rejected`;
            content = `
                <h2>Expense Update</h2>
                <p>Hi ${data.name},</p>
                <p>Your recent expense submission could not be approved at this time.</p>
                <div class="box">
                    <p>Expense Item<strong>${data.expenseTitle}</strong></p>
                    <p style="margin-top: 12px;">Amount<strong>${data.amount}</strong></p>
                    <p style="margin-top: 12px;">Reason provided<strong>${data.reason}</strong></p>
                </div>
                <p>Please reach out to the finance team if you need further clarification.</p>
            `;
            break;
        case 'contract_renewal':
            subject = `${company.companyName} â€” Contract Renewal Reminder`;
            content = `
                <h2>Contract Renewal Notice</h2>
                <p>Hi ${data.clientName},</p>
                <p>This is a reminder that the contract <strong>${data.contractName}</strong> is up for renewal on <strong>${data.renewalDate}</strong>.</p>
                <a href="${data.ctaUrl}" class="button">Review Contract</a>
            `;
            break;
        case 'holiday_announcement':
            subject = `${company.companyName} â€” Upcoming Holiday: ${data.holidayName}`;
            content = `
                <h2>Holiday Announcement</h2>
                <p>Please note that ${company.companyName} will be observing <strong>${data.holidayName}</strong> on <strong>${data.date}</strong>.</p>
                <p>${data.message}</p>
                <p>Please plan your deliverables accordingly and update your out-of-office response if necessary.</p>
            `;
            break;
        case 'probation_completed':
            subject = `${company.companyName} â€” Probation Period Completed`;
            content = `
                <h2>Congratulations! ðŸŽ‰</h2>
                <p>Hi ${data.name},</p>
                <p>We are delighted to confirm that you have successfully completed your probation period as <strong>${data.role}</strong>.</p>
                <p>Your employment is confirmed effective <strong>${data.effectiveDate}</strong>.</p>
                <p>We look forward to your continued success with us!</p>
            `;
            break;
        case 'document_attachment':
            subject = `${company.companyName} â€” Document Attachment: ${data.documentName}`;
            content = `
                <h2>Document Attachment</h2>
                <p>Hi ${data.name || 'there'},</p>
                <p>Please find the attached document: <strong>${data.documentName}</strong>.</p>
                <p>${data.message || `This document was sent to you from ${company.companyName}.`}</p>
            `;
            break;
        case 'quotation':
            subject = `${company.companyName} â€” Quotation #${data.quoteNumber}`;
            content = `
                <div style="text-align: center; margin-bottom: 32px;">
                    <div style="display: inline-block; padding: 12px; background: #eef2ff; border-radius: 16px; margin-bottom: 16px;">
                        <span style="font-size: 32px;">ðŸ“„</span>
                    </div>
                    <h2 style="margin: 0; color: #1e293b;">Official Quotation Issued</h2>
                    <p style="color: #64748b; margin-top: 4px;">Quote Reference: ${data.quoteNumber}</p>
                </div>
                
                <p>Hello ${data.clientName || 'valued client'},</p>
                <p>We are pleased to provide you with the formal quotation for the services/products requested. Our team has carefully prepared this proposal to meet your specific requirements.</p>
                
                <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin: 24px 0;">
                    <div style="margin-bottom: 16px;">
                        <p style="margin: 0; font-size: 11px; text-transform: uppercase; color: #94a3b8; font-weight: 600; letter-spacing: 0.05em;">Total Amount</p>
                        <p style="margin: 4px 0 0 0; font-size: 28px; font-weight: 800; color: ${company.brandColor || '#4f46e5'};">${data.currency || '$'}${Number(data.grandTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding-top: 16px; border-top: 1px dashed #cbd5e1;">
                        <div>
                            <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Expiry Date</p>
                            <p style="margin: 4px 0 0 0; font-weight: 600; color: #334155;">${data.validUntil}</p>
                        </div>
                        <div>
                            <p style="margin: 0; font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">Prepared By</p>
                            <p style="margin: 4px 0 0 0; font-weight: 600; color: #334155;">${data.userName}</p>
                        </div>
                    </div>
                </div>

                <p>The detailed breakdown is available in the attached PDF document for your records. If you have any questions or would like to proceed, please don't hesitate to reach out.</p>
                
                <div style="text-align: center; margin-top: 40px;">
                    <a href="${data.viewUrl || '#'}" class="button" style="padding: 14px 32px; font-size: 15px;">Review & Approve Quotation</a>
                </div>

                <div style="margin-top: 32px; padding: 16px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 12px;">
                    <p style="margin: 0; font-size: 13px; color: #92400e; display: flex;">
                        <span style="margin-right: 8px;">â„¹ï¸</span>
                        <span>This quotation is subject to our terms and conditions and remains valid until the expiry date shown above.</span>
                    </p>
                </div>
            `;
            break;
        default:
            throw new Error(`Template ${templateId} is not defined.`);
    }
    return { subject, html: baseLayout(subject, content, company) };
}
// â”€â”€ Centralized Notification Engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Maps system event names to their corresponding email templates.
 */
function mapEventToTemplate(event) {
    const map = {
        'task_assigned': 'task_assigned',
        'project_assigned': 'project_assigned',
        'goal_assigned': 'goal_assigned',
        'salary_generated': 'salary_generated',
        'attendance_late': 'attendance_late',
        'project_risk_alert': 'project_risk_alert',
        'task_reminder': 'task_reminder',
        'task_deadline_approaching': 'task_deadline_approaching',
        'document_shared': 'document_shared',
        'leave_request_approved': 'leave_approved',
        'leave_request_rejected': 'leave_rejected',
        'invoice_created': 'invoice_generated',
        'payment_received': 'payment_received',
        'trial_started': 'trial_started',
        'trial_reminder': 'trial_reminder',
        'trial_expired': 'trial_expired',
        'subscription_confirmation': 'subscription_confirmation',
        'renewal_reminder': 'renewal_reminder',
        'deletion_warning': 'deletion_warning',
        'invoice_reminder': 'invoice_generated',
        'document_shared': 'document_shared',
        'document_tagged': 'document_shared',
        'document_attachment': 'document_attachment',
        'forgot_password': 'forgot_password',
        'welcome': 'welcome',
    };
    return map[event] || 'transitional';
}
/**
 * Unified entry point for all system notifications.
 * Handles template resolution, branding injection, and SMTP routing.
 */
async function notify(recipient, event, data, options = {}) {
    const to = typeof recipient === 'string' ? recipient : recipient?.email;
    const name = typeof recipient === 'string' ? 'User' : (recipient?.name || 'User');
    if (!to) {
        console.error(`[EmailService] Notification aborted: Recipient email missing for event "${event}".`);
        return { success: false, error: 'Recipient email missing' };
    }
    try {
        const templateId = mapEventToTemplate(event);
        console.log(`[EmailService] Dispatching notification: ${event} -> ${templateId} to ${to}`);
        let subject, html;
        if (templateId === 'transitional') {
            const company = await getCompanyInfo(prisma);
            const sub = data.subject || `${company.companyName} Update`;
            html = baseLayout(sub, `
                <p>Hi ${name},</p>
                <p>${data.message || data.description || 'You have a new update from the system.'}</p>
                ${data.ctaLink ? `<a href="${data.ctaLink}" class="button">${data.ctaText || 'View Details'}</a>` : ''}
             `, company);
            subject = data.subject || `${company.companyName} â€” ${sub}`;
        }
        else {
            const result = await buildTemplate(templateId, { ...data, name, email: to }, prisma);
            subject = data.subject || result.subject;
            html = result.html;
        }
        // Priority: options.category > data.category > template-based default
        const category = options.category || data.category || (['verification', 'password_reset', 'company_welcome', 'trial_started'].includes(templateId) ? CATEGORIES.SYSTEM : CATEGORIES.WORK);
        return await send({
            to,
            subject,
            html,
            templateName: templateId,
            templateData: data,
            category,
            attachments: options.attachments || data.attachments || []
        }, prisma);
    }
    catch (err) {
        console.error(`[EmailService] Notification Dispatch Error [${event}]:`, err.message);
        return { success: false, error: err.message };
    }
}
async function sendEmailTemplate(to, templateName, templateData, category = CATEGORIES.WORK) {
    const { queueEmail } = require('../../../platform-core/platform-engine/services/queue.service');
    const { subject, html } = await buildTemplate(templateName, templateData, prisma);
    const companyId = prisma?.companyId || 'global';
    return queueEmail({ to, subject, html, template: templateName, data: templateData, companyId, category });
}
exports.EmailService = {
    getTransporter,
    notify,
    dispatchEmail,
    CATEGORIES,
    verifyConfig: async (category) => {
        const transporter = await getTransporter(category, prisma);
        return !!transporter;
    },
    getTemplatePreview: async (templateId, templateData) => {
        return buildTemplate(templateId, templateData, prisma);
    },
    sendEmail: async function (options) {
        if (typeof options === 'string') {
            // Support legacy: sendEmail(to, subject, template, data, prisma)
            const to = arguments[0];
            const subject = arguments[1];
            const template = arguments[2];
            const data = arguments[3];
            const db = arguments[4];
            return sendEmailTemplate(to, template, data, db);
        }
        return send({ ...options, category: options.category || CATEGORIES.WORK }, prisma);
    },
    sendTransactEmail: async (options, prisma) => {
        const { to, template, data, category } = options;
        return sendEmailTemplate(to, template, data, prisma, category || CATEGORIES.WORK);
    },
    // Specific legacy functions used across the app
    sendVerificationEmail: (to, name, verificationUrl, prisma) => sendEmailTemplate(to, 'verification', { name, verificationUrl }, prisma, CATEGORIES.WORK),
    sendPasswordResetEmail: (to, name, resetUrl, prisma) => sendEmailTemplate(to, 'password_reset', { name, resetUrl }, prisma, CATEGORIES.WORK),
    sendProjectAssignedEmail: (to, name, projectName, projectUrl, prisma) => sendEmailTemplate(to, 'project_assigned', { name, projectName, projectUrl }, prisma, CATEGORIES.WORK),
    sendTaskAssignedEmail: (to, name, taskTitle, projectName, taskUrl, prisma) => sendEmailTemplate(to, 'task_assigned', { name, taskTitle, projectName, taskUrl }, prisma, CATEGORIES.WORK),
    sendSalaryGeneratedEmail: (to, name, month, netSalary, prisma) => sendEmailTemplate(to, 'salary_generated', { name, month, netSalary }, prisma, CATEGORIES.WORK),
    sendSystemAlert: (to, subject, message, prisma) => sendEmailTemplate(to, 'system_alert', { subject, message }, prisma, CATEGORIES.SYSTEM),
    sendWelcomeEmail: (user, password, prisma) => sendEmailTemplate(user.email, 'welcome', { name: user.name, email: user.email, password }, prisma, CATEGORIES.WORK),
    sendDocumentTagEmail: (to, name, documentName, documentUrl, senderName, prisma) => sendEmailTemplate(to, 'document_tagged', { name, documentName, documentUrl, senderName }, prisma, CATEGORIES.WORK),
    sendSalarySlip: (employee, salary, prisma) => sendEmailTemplate(employee.email, 'salary_generated', { name: employee.name, month: salary.month, netSalary: salary.netSalary }, prisma, CATEGORIES.WORK),
    sendTaskOverdueEmail: (to, name, taskTitle, dueDate, ctaUrl, prisma) => sendEmailTemplate(to, 'task_overdue', { name, taskTitle, dueDate, ctaUrl }, prisma, CATEGORIES.WORK),
    sendCompanyWelcomeEmail: (to, name, loginUrl, prisma) => sendEmailTemplate(to, 'company_welcome', { name, loginUrl }, prisma, CATEGORIES.SYSTEM),
    sendQuotationEmail: async (to, data, attachments, prisma) => {
        const { subject, html } = await buildTemplate('quotation', data, prisma);
        return send({ to, subject, html, attachments, templateName: 'quotation', templateData: data }, prisma);
    },
    sendTransitionalEmail: async (to, subject, data, prisma) => {
        const company = await getCompanyInfo(prisma);
        const html = baseLayout(subject, `
      <h2>${subject}</h2>
      <p>Hi ${data.name},</p>
      <p>${data.message}</p>
      ${data.ctaLink ? `<a href="${data.ctaLink}" class="button">${data.ctaText || 'View Details'}</a>` : ''}
    `, company);
        return send({ to, subject: `${company.companyName} â€” ${subject}`, html, templateName: 'transitional', templateData: data }, prisma);
    },
    sendMeetingEmail: (to, name, meetingTitle, startTime, ctaUrl, prisma) => sendEmailTemplate(to, 'meeting_scheduled', { name, meetingTitle, startTime, ctaUrl }, prisma, CATEGORIES.WORK),
    sendDocumentWithAttachment: async (to, name, documentName, message, attachment, prisma) => {
        const { subject, html } = await buildTemplate('document_attachment', { name, documentName, message }, prisma);
        return send({ to, subject, html, templateName: 'document_attachment', templateData: { name, documentName, message }, attachments: [attachment], category: CATEGORIES.WORK }, prisma);
    },
    // â”€â”€ Billing / Subscription Emails â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    sendTrialStartedEmail: async (to, adminName, trialDays, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const platformName = ps.platformName || company.companyName || 'Your Platform';
        const loginUrl = ps.platformApiUrl || process.env.CLIENT_URL || '';
        const upgradeUrl = `${loginUrl}/dashboard/billing`;
        const subject = `ðŸŽ‰ Your ${trialDays}-day ${platformName} Trial Has Started!`;
        const content = `
            <h2>Welcome, ${adminName}! ðŸŽŠ</h2>
            <p>Your <strong>${trialDays}-day free trial</strong> of ${platformName} has started. You now have full access to all features.</p>
            <div class="box"><p>Trial period<strong>${trialDays} days â€” No credit card required</strong></p></div>
            <p>During your trial you can explore all modules: Projects, HR, Attendance, Invoices, AI Assistant, and more.</p>
            ${loginUrl ? `<a href="${loginUrl}" class="button">Login to Dashboard â†’</a>` : ''}
            ${upgradeUrl ? `<p style="margin-top:24px;font-size:13px;color:#9ca3af;">When your trial ends, upgrade from your <a href="${upgradeUrl}">Billing page</a> to keep access.</p>` : ''}
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'trial_started' }, prisma);
    },
    sendTrialReminderEmail: async (to, adminName, daysLeft, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const upgradeUrl = `${ps.platformApiUrl || process.env.CLIENT_URL || ''}/dashboard/billing`;
        const subject = `âš ï¸ Your trial expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} â€” Action required`;
        const alertColor = daysLeft <= 2 ? '#fee2e2' : '#fef3c7';
        const alertBorder = daysLeft <= 2 ? '#fca5a5' : '#fde68a';
        const alertText = daysLeft <= 2 ? '#991b1b' : '#92400e';
        const content = `
            <h2>Your trial is ending soon</h2>
            <div style="background:${alertColor};border:1px solid ${alertBorder};color:${alertText};padding:14px 18px;border-radius:10px;margin:16px 0;font-size:13px;">
                â° Your trial expires in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>
            </div>
            <p>Hi ${adminName}, your free trial will expire soon. After expiry, access to all features will be restricted.</p>
            <a href="${upgradeUrl}" class="button">Upgrade My Plan â†’</a>
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'trial_reminder' }, prisma);
    },
    sendTrialExpiredEmail: async (to, adminName, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const platformName = ps.platformName || company.companyName || 'Your Platform';
        const upgradeUrl = `${ps.platformApiUrl || process.env.CLIENT_URL || ''}/dashboard/billing`;
        const subject = `ðŸ”´ Your ${platformName} trial has expired`;
        const content = `
            <h2>Your trial has expired</h2>
            <div style="background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;padding:14px 18px;border-radius:10px;margin:16px 0;font-size:13px;">âŒ Your access to features is now restricted.</div>
            <p>Hi ${adminName}, your trial period has ended. Upgrade to a subscription plan to restore full access.</p>
            <a href="${upgradeUrl}" class="button">Upgrade Now â†’</a>
            <p style="font-size:13px;color:#9ca3af;margin-top:20px;">Your data is safe and retained for 30 days from trial expiry.</p>
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'trial_expired' }, prisma);
    },
    sendSubscriptionConfirmationEmail: async (to, adminName, planName, amount, expiryDate, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const loginUrl = ps.platformApiUrl || process.env.CLIENT_URL || '';
        const platformCurrency = ps.currency || 'USD';
        const subject = `âœ… Payment confirmed â€” ${planName} Plan activated`;
        const expiry = new Date(expiryDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
        const content = `
            <h2>Payment Successful!</h2>
            <div class="box"><p>Plan<strong>${planName}</strong></p></div>
            <div class="box"><p>Amount Paid<strong>${platformCurrency} ${Number(amount).toLocaleString()}</strong></p></div>
            <div class="box"><p>Valid Until<strong>${expiry}</strong></p></div>
            <p style="font-size:12px;color:#9ca3af;background:#fef9ec;padding:12px 16px;border-radius:8px;border:1px solid #fde68a;margin-top:16px;">âš ï¸ All subscription payments are <strong>non-refundable</strong>.</p>
            <a href="${loginUrl}" class="button">Go to Dashboard â†’</a>
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'subscription_confirmation' }, prisma);
    },
    sendRenewalReminderEmail: async (to, adminName, planName, daysLeft, renewalDate, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const upgradeUrl = `${ps.platformApiUrl || process.env.CLIENT_URL || ''}/dashboard/billing`;
        const subject = `â° Your ${planName} subscription expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
        const expiry = new Date(renewalDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
        const alertColor = daysLeft <= 2 ? '#fee2e2' : '#fef3c7';
        const alertBorder = daysLeft <= 2 ? '#fca5a5' : '#fde68a';
        const alertText = daysLeft <= 2 ? '#991b1b' : '#92400e';
        const content = `
            <h2>Subscription expiring soon</h2>
            <div style="background:${alertColor};border:1px solid ${alertBorder};color:${alertText};padding:14px 18px;border-radius:10px;margin:16px 0;font-size:13px;">
                Your <strong>${planName}</strong> plan expires in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong> (${expiry})
            </div>
            <p>Hi ${adminName}, renew now to avoid interruption.</p>
            <a href="${upgradeUrl}" class="button">Renew Subscription â†’</a>
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'renewal_reminder' }, prisma);
    },
    sendDeletionWarningEmail: async (to, adminName, retentionDays, deletionDate, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const upgradeUrl = `${ps.platformApiUrl || process.env.CLIENT_URL || ''}/dashboard/billing`;
        const subject = `âš ï¸ FINAL NOTICE: Data deletion scheduled in ${retentionDays} days`;
        const dateStr = new Date(deletionDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
        const content = `
            <h2 style="color: #991b1b;">Final Data Deletion Warning</h2>
            <div style="background:#fee2e2;border:1px solid #fca5a5;color:#991b1b;padding:14px 18px;border-radius:10px;margin:16px 0;font-size:13px;">
                ðŸš¨ Your company data is scheduled for permanent deletion on <strong>${dateStr}</strong>.
            </div>
            <p>Hi ${adminName},</p>
            <p>Your trial expired ${retentionDays} days ago. According to our data retention policy, all operational data (projects, tasks, documents) associated with your account will be permanently deleted in ${retentionDays} days unless you upgrade to a paid plan.</p>
            <p><strong>This action is irreversible.</strong></p>
            <a href="${upgradeUrl}" class="button" style="background: #cf1d29;">Upgrade Now to Save Your Data â†’</a>
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'deletion_warning' }, prisma);
    },
    // â”€â”€ Forgot Password â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Always sends via system SMTP (PlatformSettings â†’ .env fallback)
    async sendForgotPasswordEmail(user, tempPassword, companyName, prisma) {
        const to = user.email;
        const name = user.name || 'User';
        const company = await getCompanyInfo(prisma);
        const loginUrl = process.env.CLIENT_URL || 'http://localhost:3000';
        const subject = `ðŸ”‘ Your New Password â€“ ${company.companyName || companyName}`;
        const content = `
            <h2 style="color: #1e293b; margin-bottom: 8px;">Password Reset</h2>
            <p>Hi <strong>${name}</strong>,</p>
            <p>We received a request to reset your password. A new temporary password has been generated for your account.</p>
            <div style="background: #f1f5f9; border: 1px solid #e2e8f0; border-left: 4px solid ${company.brandColor || '#4f46e5'}; border-radius: 10px; padding: 20px 24px; margin: 24px 0; text-align: center;">
                <p style="font-size: 12px; color: #64748b; margin: 0 0 8px 0; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Your New Temporary Password</p>
                <p style="font-size: 28px; font-weight: 800; color: #1e293b; letter-spacing: 0.15em; margin: 0; font-family: 'Courier New', monospace;">${tempPassword}</p>
            </div>
            <p style="font-size: 13px; color: #64748b;">Please log in and change your password immediately after signing in.</p>
            <a href="${loginUrl}/login" class="button">Login Now â†’</a>
            <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">If you did not request a password reset, please contact your administrator immediately.</p>
        `;
        const html = baseLayout(subject, content, company);
        // Use centralized SMTP transporter
        return send({
            to,
            subject,
            html,
            templateName: 'forgot_password',
            category: CATEGORIES.SYSTEM
        }, prisma);
    },
    async sendGoalAssignedEmail(to, name, goalTitle, motivation, celebration, difficulty, dueDate, ctaUrl, prisma) {
        return this.sendTransitionalEmail(to, `New Goal: ${goalTitle}`, {
            name, goalTitle, motivation, celebration, difficulty, dueDate, ctaUrl, templateOverride: 'goal_assigned'
        }, prisma);
    }
};
