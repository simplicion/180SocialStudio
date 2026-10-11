// @ts-nocheck
'use strict';

const nodemailer = (() => { try { return require('nodemailer'); } catch { return { createTransport: () => ({ sendMail: async () => ({}) }) }; } })();
const { prisma } = require('@workspace/db');

/**
 * Get application base URL
 */
function getAppUrl(path = '') {
    let baseUrl = (process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim();
    if (baseUrl.endsWith('/')) baseUrl = baseUrl.slice(0, -1);
    if (path && !path.startsWith('/')) path = '/' + path;
    return `${baseUrl}${path}`;
}

/**
 * Get platform-wide branding and company information
 */
async function getPlatformBranding() {
    try {
        const ps = await prisma.platformSettings.findFirst() || {};
        return {
            companyName: ps.platformName || 'Simplicion',
            tagline: ps.brandingTagline || 'Enterprise Management Excellence',
            brandColor: ps.themeColor || '#4f46e5',
            companyLogo: ps.logoUrl || '',
            emailLogo: ps.logoUrl || '',
            websiteUrl: ps.companyWebsite || getAppUrl(),
            address: ps.companyAddress || '',
            phone: ps.companyPhone || '',
            legalName: ps.companyLegalName || ps.platformName || 'Simplicion Inc.'
        };
    } catch (e) {
        return {
            companyName: 'Simplicion',
            tagline: 'Enterprise Management Excellence',
            brandColor: '#4f46e5',
            companyLogo: '',
            emailLogo: '',
            websiteUrl: getAppUrl(),
            address: '',
            phone: '',
            legalName: 'Simplicion Inc.'
        };
    }
}

/**
 * Get company configuration with defaults, falling back to platform settings
 */
async function getCompanyInfo(dbPrisma = null, targetCompanyId = null) {
    const platform = await getPlatformBranding();
    const client = dbPrisma || prisma;
    if (!client) return platform;

    try {
        const cId = targetCompanyId || client.companyId || (typeof requestContext !== 'undefined' ? requestContext.getStore()?.companyId : undefined);
        let config = null;
        let companyRecord = null;
        if (cId) {
            config = await client.settings.findFirst({ where: { companyId: cId } });
            companyRecord = await client.company.findUnique({ where: { id: cId } });
        } else {
            config = await client.settings.findFirst();
            companyRecord = await client.company.findFirst();
        }

        if (!config && !companyRecord) {
            return platform;
        }

        let metadata = companyRecord?.metadata || {};
        if (typeof metadata === 'string') {
            try { metadata = JSON.parse(metadata); } catch (e) { metadata = {}; }
        }

        return {
            companyName: config?.companyName || companyRecord?.name || platform.companyName,
            tagline: platform.tagline,
            brandColor: config?.themeColor || metadata?.themeColor || platform.brandColor,
            companyLogo: config?.logoUrl || metadata?.logoUrl || platform.companyLogo,
            emailLogo: config?.logoUrl || metadata?.logoUrl || platform.emailLogo,
            websiteUrl: platform.websiteUrl,
            address: platform.address,
            phone: platform.phone,
            legalName: config?.companyName || companyRecord?.name || platform.legalName,
            currency: metadata?.currency || 'USD'
        };
    } catch (err) {
        console.warn(`[EmailService] Error fetching company info: ${err.message}. Falling back to platform branding.`);
        return platform;
    }
}

/**
 * Email Categories for strict isolation
 */
const CATEGORIES = {
    SYSTEM: 'system', // Onboarding, Billing, Global Admin Resets
    WORK: 'work'      // Tasks, Projects, Invoices, HR, Local User Resets
};

/**
 * Get dynamic transporter based on category and company isolation rules
 * @param {string} category - 'system' or 'work'
 * @param {Object} dbPrisma - Company database connection
 * @param {string} targetCompanyId - Target company ID
 */
async function getTransporter(category = CATEGORIES.WORK, dbPrisma = null, targetCompanyId = null) {
    const client = dbPrisma || prisma;
    // 1. If it's a WORK email, we use Company SMTP, falling back to Platform / .env if needed
    if (category === CATEGORIES.WORK) {
        if (!client) {
            console.error('[EmailService] WORK category requires prisma context. Aborting.');
            return null;
        }

        try {
            const cId = targetCompanyId || client.companyId || (typeof requestContext !== 'undefined' ? requestContext.getStore()?.companyId : undefined);
            let company = null;
            if (cId) {
                company = await client.company.findUnique({ where: { id: cId }, select: { id: true, name: true, metadata: true } });
            }
            if (!company) {
                company = await client.company.findFirst({ select: { id: true, name: true, metadata: true } });
            }
            
            let metadata = company?.metadata || {};
            if (typeof metadata === 'string') {
                try { metadata = JSON.parse(metadata); } catch (e) { metadata = {}; }
            }
            
            const settingsRecord = (company?.id)
                ? await client.settings.findFirst({ where: { companyId: company.id } })
                : await client.settings.findFirst();
            const settings = { ...(settingsRecord || {}) };

            ['smtpHost', 'smtpPort', 'smtpUser', 'smtpPass', 'smtpSecure', 'emailFrom'].forEach(field => {
                if (metadata[field] !== undefined) settings[field] = metadata[field];
            });

            if (settings.smtpHost) {
                settings.smtpHost = String(settings.smtpHost).replace(/\.+/g, '.').trim();
            }

            if (settings.smtpHost && settings.smtpUser && settings.smtpPass) {
                console.log(`[EmailService] [ISOLATION:WORK] Using Company SMTP: ${settings.smtpHost}`);
                const port = Number(settings.smtpPort) || 587;
                return nodemailer.createTransport({
                    host: settings.smtpHost,
                    port: port,
                    secure: settings.smtpSecure !== undefined ? settings.smtpSecure : (port === 465),
                    auth: { user: String(settings.smtpUser).trim(), pass: String(settings.smtpPass).trim() },
                });
            }
            
            // Fallback to Platform SMTP if company SMTP is not configured
            const ps = await client.platformSettings.findFirst();
            if (ps && ps.smtpHost && ps.smtpUser && ps.smtpPass) {
                const psHost = String(ps.smtpHost).replace(/\.+/g, '.').trim();
                console.log(`[EmailService] [ISOLATION:WORK] Falling back to Platform SMTP: ${psHost}`);
                const port = Number(ps.smtpPort) || 587;
                return nodemailer.createTransport({
                    host: psHost,
                    port: port,
                    secure: ps.smtpSecure !== undefined ? ps.smtpSecure : (port === 465),
                    auth: { user: String(ps.smtpUser).trim(), pass: String(ps.smtpPass).trim() },
                });
            }

            // Fallback to .env SMTP
            if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
                console.log(`[EmailService] [ISOLATION:WORK] Using .env SMTP fallback: ${process.env.SMTP_HOST}`);
                const port = parseInt(process.env.SMTP_PORT) || 587;
                return nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: port,
                    secure: process.env.SMTP_SECURE === 'true' || (port === 465),
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
                });
            }

            console.warn(`[EmailService] [ISOLATION:WORK] No SMTP configured for company, platform, or .env.`);
            return null;
        } catch (e) {
            console.error('[EmailService] [ISOLATION:WORK] Error loading company SMTP:', e.message);
            return null;
        }
    }

    // 2. If it's a SYSTEM email, we use Platform SMTP or .env fallback
    if (category === CATEGORIES.SYSTEM) {
        // Try PlatformSettings (SuperAdmin level)
        try {
            const ps = await client.platformSettings.findFirst();
            if (ps && ps.smtpHost && ps.smtpUser && ps.smtpPass) {
                console.log(`[EmailService] [ISOLATION:SYSTEM] Using Platform SMTP: ${ps.smtpHost}`);
                return nodemailer.createTransport({
                    host: ps.smtpHost,
                    port: ps.smtpPort || 587,
                    secure: ps.smtpSecure !== undefined ? ps.smtpSecure : (ps.smtpPort === 465),
                    auth: { user: ps.smtpUser, pass: ps.smtpPass },
                });
            }
        } catch (e) {
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
async function dispatchEmail(options, prismaClient = null, targetCompanyId = null) {
    let logId = null;
    const client = prismaClient || prisma;
    const category = options.category || CATEGORIES.WORK;
    const effectiveCompanyId = targetCompanyId || client?.companyId || options.companyId;
    
    try {
        const transporter = await getTransporter(category, client, effectiveCompanyId);

        // Logging only if client provided
        if (client) {
            try {
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                let validCompanyId = (effectiveCompanyId && uuidRegex.test(effectiveCompanyId)) ? effectiveCompanyId : null;
                let validSentById = (options.sentById && uuidRegex.test(options.sentById)) ? options.sentById : null;

                const createData: any = {
                    to: options.to,
                    subject: options.subject,
                    templateName: options.templateName || 'generic',
                    templateData: options.templateData || {},
                    status: 'failed',
                };
                if (validCompanyId) {
                    createData.company = { connect: { id: validCompanyId } };
                }
                if (validSentById) {
                    createData.sentBy = { connect: { id: validSentById } };
                }

                const log = await client.emailLog.create({
                    data: createData
                });
                logId = log.id;
            } catch (logErr: any) {
                console.warn('[EmailService] EmailLog create warning:', logErr.message);
            }
        }

        if (!transporter) {
            const errorMsg = 'SMTP is not configured. Please configure your email settings in the dashboard to send emails.';
            if (logId && client) {
                await client.emailLog.update({
                    where: { id: logId },
                    data: { errorMessage: errorMsg }
                });
            }
            console.error(`[EmailService] Delivery aborted: ${errorMsg}`);
            return { success: false, error: errorMsg };
        }

        // Get "from" address
        let fromAddress = options.from;
        if (!fromAddress) {
            const companyInfo = await getCompanyInfo(client, effectiveCompanyId);
            fromAddress = companyInfo.companyName;
        }

        const info = await transporter.sendMail({
            from: fromAddress,
            to: options.to,
            subject: options.subject,
            html: options.html,
            attachments: options.attachments || [],
        });

        console.log('[EmailService] Email sent:', info.messageId);
        if (logId && client) {
            await client.emailLog.update({
                where: { id: logId },
                data: { status: 'sent', errorMessage: null }
            });
        }
        return { success: true, messageId: info.messageId };
    } catch (error: any) {
        console.error('[EmailService] Email send error:', error);
        if (logId && client) {
            await client.emailLog.update({
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

// ─── Priority & Status Badge Helpers ─────────────────────────────────────────

function getPriorityBadge(priority = 'medium') {
    const p = String(priority || 'medium').toLowerCase();
    if (p === 'urgent') {
        return '<span style="display: inline-block; background-color: #fef2f2; color: #dc2626; border: 1px solid #fecaca; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Urgent</span>';
    }
    if (p === 'high') {
        return '<span style="display: inline-block; background-color: #fff1f2; color: #e11d48; border: 1px solid #fecdd3; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">High</span>';
    }
    if (p === 'low') {
        return '<span style="display: inline-block; background-color: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Low</span>';
    }
    return '<span style="display: inline-block; background-color: #fffbeb; color: #b45309; border: 1px solid #fde68a; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Medium</span>';
}

function getStatusBadge(status = 'active') {
    const s = String(status || 'active').toLowerCase();
    if (s === 'completed' || s === 'approved' || s === 'paid' || s === 'active') {
        return '<span style="display: inline-block; background-color: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;">' + status.toUpperCase() + '</span>';
    }
    if (s === 'overdue' || s === 'rejected' || s === 'cancelled' || s === 'expired') {
        return '<span style="display: inline-block; background-color: #fef2f2; color: #991b1b; border: 1px solid #fecaca; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;">' + status.toUpperCase() + '</span>';
    }
    return '<span style="display: inline-block; background-color: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 3px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;">' + status.toUpperCase() + '</span>';
}

// ─── Base Email Layout (SaaS Pro Max) ────────────────────────────────────────

function baseLayout(title, content, company) {
    const brandColor = company.brandColor || '#4f46e5';
    const logoHtml = company.emailLogo || company.companyLogo
        ? `<img src="${company.emailLogo || company.companyLogo}" alt="${company.companyName}" style="max-height: 42px; width: auto; display: block; margin: 0 auto;">`
        : `<span style="font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: -0.03em; font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;">${company.companyName}</span>`;

    return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <title>${title}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
        
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
        
        body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
            background-color: #f8fafc; 
            color: #0f172a;
            margin: 0; 
            padding: 0; 
            width: 100% !important;
            -webkit-font-smoothing: antialiased;
        }
        
        .wrapper {
            width: 100%;
            background-color: #f8fafc;
            padding: 40px 16px;
        }

        .container { 
            max-width: 580px; 
            margin: 0 auto; 
            background-color: #ffffff; 
            border-radius: 16px; 
            overflow: hidden; 
            box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.04);
            border: 1px solid #e2e8f0;
        }

        .accent-bar {
            height: 4px;
            width: 100%;
            background: linear-gradient(90deg, ${brandColor} 0%, #6366f1 50%, #818cf8 100%);
        }

        .header { 
            background-color: #ffffff;
            padding: 32px 36px 24px; 
            text-align: center;
            border-bottom: 1px solid #f1f5f9;
        }

        .header-tagline {
            color: #94a3b8;
            margin: 6px 0 0 0;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        .content { 
            padding: 36px 36px 28px; 
        }

        .button { 
            display: inline-block; 
            background: linear-gradient(135deg, ${brandColor} 0%, #4338ca 100%); 
            color: #ffffff !important; 
            padding: 13px 28px; 
            border-radius: 10px; 
            text-decoration: none; 
            font-weight: 600; 
            font-size: 14px; 
            letter-spacing: 0.01em;
            margin: 20px 0;
            text-align: center;
            box-shadow: 0 4px 14px rgba(79, 70, 229, 0.28);
        }

        .card {
            background-color: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 20px 22px;
            margin: 20px 0;
        }

        .card-row {
            margin-bottom: 14px;
        }

        .card-row:last-child {
            margin-bottom: 0;
        }

        .card-label {
            display: block;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            margin-bottom: 4px;
        }

        .card-value {
            display: block;
            font-size: 15px;
            font-weight: 600;
            color: #0f172a;
        }

        .footer { 
            padding: 24px 36px 32px; 
            text-align: center; 
            color: #94a3b8; 
            font-size: 12px; 
            line-height: 1.6;
            border-top: 1px solid #f1f5f9;
            background-color: #fafbfc;
        }

        .footer a {
            color: #6366f1;
            text-decoration: none;
            font-weight: 500;
        }

        @media (max-width: 600px) {
            .wrapper { padding: 12px 8px !important; }
            .container { border-radius: 12px !important; }
            .content { padding: 24px 20px 20px !important; }
            .header { padding: 24px 20px 18px !important; }
            .footer { padding: 20px !important; }
        }
    </style>
</head>
<body>
    <div class="wrapper">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
            <tr>
                <td align="center">
                    <div class="container">
                        <div class="accent-bar"></div>
                        <div class="header">
                            ${logoHtml}
                            ${company.tagline ? `<p class="header-tagline">${company.tagline}</p>` : ''}
                        </div>
                        <div class="content">
                            ${content}
                        </div>
                        <div class="footer">
                            <p style="margin: 0 0 6px 0;">&copy; ${new Date().getFullYear()} <strong>${company.companyName}</strong>. All rights reserved.</p>
                            <p style="margin: 0; color: #94a3b8; font-size: 11px;">This automated notification was generated by <a href="${company.websiteUrl}">${company.companyName}</a>.</p>
                        </div>
                    </div>
                </td>
            </tr>
        </table>
    </div>
</body>
</html>`;
}

// ─── Email Templates Builder (Clean UTF-8 & Modern UI) ───────────────────────

async function buildTemplate(templateId, data, dbPrisma = null, targetCompanyId = null) {
    const company = await getCompanyInfo(dbPrisma || prisma, targetCompanyId);
    let subject = '';
    let content = '';

    switch (templateId) {
        case 'welcome':
            subject = `Welcome to ${company.companyName} — Account Activation`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eef2ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">🚀</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Welcome aboard, ${data.name}!</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">Your workspace account has been prepared and is ready for use.</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">An administrator has configured your access to <strong>${company.companyName}</strong>. You can sign in using the secure credentials below:</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Sign-in Email</span>
                        <span class="card-value" style="color: #0f172a; font-family: monospace; font-size: 14px;">${data.email || 'Email missing'}</span>
                    </div>
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Temporary Password</span>
                        <span class="card-value" style="color: #4f46e5; font-family: monospace; font-size: 18px; letter-spacing: 0.05em;">${data.password}</span>
                    </div>
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${getAppUrl('/login')}" class="button">Access My Dashboard &rarr;</a>
                </div>
                
                <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 3px solid #f59e0b; border-radius: 8px; padding: 14px 16px; margin-top: 24px; color: #92400e; font-size: 13px; line-height: 1.5;">
                    <strong>Security Reminder:</strong> For your protection, please update your password immediately after signing in for the first time.
                </div>
            `;
            break;

        case 'project_assigned':
            subject = `${company.companyName} | Project Access Granted: ${data.projectName}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #f0fdf4; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">📁</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Project Access Granted</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">You have been assigned to a corporate project.</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">You have been granted access to participate in <strong>${data.projectName}</strong>. You can now track deliverables, review milestones, and collaborate with your team.</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Project Name</span>
                        <span class="card-value" style="font-size: 17px; color: #0f172a;">${data.projectName}</span>
                    </div>
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Status</span>
                        <div>${getStatusBadge('active')}</div>
                    </div>
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.projectUrl || getAppUrl(data.ctaUrl || '/dashboard/projects')}" class="button">Open Project Dashboard &rarr;</a>
                </div>
            `;
            break;

        case 'task_assigned':
            subject = `${company.companyName} | New Task: ${data.taskTitle}`;
            const priorityBadge = getPriorityBadge(data.priority);
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eef2ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">📋</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">New Task Assigned</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">A new task has been assigned for your completion.</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">You have been assigned a new task within <strong>${data.projectName || 'Active Workspace'}</strong>. Please review the requirements below:</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Task Title</span>
                        <span class="card-value" style="font-size: 16px; color: #0f172a;">${data.taskTitle}</span>
                    </div>
                    
                    ${data.description && data.description !== 'No description provided.' ? `
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Description</span>
                        <span style="font-size: 13px; color: #475569; line-height: 1.5; display: block;">${data.description}</span>
                    </div>
                    ` : ''}

                    <div style="display: table; width: 100%; margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <div style="display: table-cell; width: 50%; vertical-align: top;">
                            <span class="card-label">Project</span>
                            <span class="card-value" style="font-size: 14px; color: #3b82f6;">${data.projectName || 'General Workspace'}</span>
                        </div>
                        <div style="display: table-cell; width: 50%; vertical-align: top;">
                            <span class="card-label">Priority</span>
                            <div>${priorityBadge}</div>
                        </div>
                    </div>

                    ${data.dueDate && data.dueDate !== 'No due date' ? `
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Completion Deadline</span>
                        <span class="card-value" style="font-size: 14px; color: #dc2626;">📅 ${data.dueDate}</span>
                    </div>
                    ` : ''}
                    
                    ${data.assignedBy ? `
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Assigned By</span>
                        <span class="card-value" style="font-size: 13px; color: #475569;">${data.assignedBy}</span>
                    </div>
                    ` : ''}
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.taskUrl || getAppUrl(data.ctaUrl || '/dashboard/tasks')}" class="button">View Task Details &rarr;</a>
                </div>
            `;
            break;

        case 'salary_generated':
            subject = `${company.companyName} | Official Payslip for ${data.month}`;
            const salaryCurrency = data.currency || company.currency || 'USD';
            const payslipDirectUrl = data.payslipUrl || (data.salaryId ? getAppUrl(`/payslip/${data.salaryId}`) : getAppUrl('/dashboard/hr'));
            const baseSalaryVal = data.baseSalary !== undefined ? Number(data.baseSalary).toLocaleString() : null;
            const bonusesVal = data.bonuses !== undefined && Number(data.bonuses) > 0 ? Number(data.bonuses).toLocaleString() : null;
            const deductionsVal = data.deductions !== undefined && Number(data.deductions) > 0 ? Number(data.deductions).toLocaleString() : null;
            const statusLabel = data.status === 'paid' ? 'PAID & DISBURSED' : 'GENERATED / PENDING';
            const statusBadgeColor = data.status === 'paid' ? '#059669' : '#d97706';
            const statusBadgeBg = data.status === 'paid' ? '#ecfdf5' : '#fffbeb';

            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 52px; height: 52px; line-height: 52px; text-align: center; background: #eef2ff; border-radius: 14px; margin-bottom: 12px; box-shadow: 0 2px 8px rgba(99, 102, 241, 0.15);">
                        <span style="font-size: 26px;">💳</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 800; letter-spacing: -0.025em;">Salary Statement Ready</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">Your official payroll document for <strong>${data.month}</strong> has been processed.</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0;">
                    Please find below the summary of your salary disbursement for the period <strong>${data.month}</strong>. You can view or download your official digital payslip using the button below.
                </p>
                
                <div style="background: #0f172a; border-radius: 16px; padding: 24px; color: #ffffff; margin-bottom: 24px; text-align: center;">
                    <div style="display: inline-block; padding: 4px 12px; border-radius: 9999px; background: ${statusBadgeBg}; color: ${statusBadgeColor}; font-size: 11px; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 12px;">
                        ${statusLabel}
                    </div>
                    <span style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.08em; display: block; margin-bottom: 4px;">Net Payable Compensation</span>
                    <span style="font-size: 32px; font-weight: 900; color: #38bdf8; letter-spacing: -0.02em; display: block;">${salaryCurrency} ${Number(data.netSalary || 0).toLocaleString()}</span>
                    <span style="font-size: 12px; color: #94a3b8; display: block; margin-top: 6px;">Pay Period: ${data.month}</span>
                </div>

                <div style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin-bottom: 24px; background: #ffffff;">
                    <div style="background: #f8fafc; padding: 10px 16px; border-bottom: 1px solid #e2e8f0; font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">
                        Compensation Breakdown
                    </div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        ${baseSalaryVal ? `
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 16px; color: #475569;">Base Salary</td>
                            <td style="padding: 10px 16px; text-align: right; font-weight: 600; color: #0f172a;">${salaryCurrency} ${baseSalaryVal}</td>
                        </tr>` : ''}
                        ${bonusesVal ? `
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 16px; color: #475569;">Bonuses & Additions</td>
                            <td style="padding: 10px 16px; text-align: right; font-weight: 600; color: #059669;">+ ${salaryCurrency} ${bonusesVal}</td>
                        </tr>` : ''}
                        ${deductionsVal ? `
                        <tr style="border-bottom: 1px solid #f1f5f9;">
                            <td style="padding: 10px 16px; color: #475569;">Deductions & Withholdings</td>
                            <td style="padding: 10px 16px; text-align: right; font-weight: 600; color: #dc2626;">- ${salaryCurrency} ${deductionsVal}</td>
                        </tr>` : ''}
                        <tr style="background: #f8fafc;">
                            <td style="padding: 12px 16px; font-weight: 700; color: #0f172a;">Net Payout</td>
                            <td style="padding: 12px 16px; text-align: right; font-weight: 800; color: #0f172a; font-size: 14px;">${salaryCurrency} ${Number(data.netSalary || 0).toLocaleString()}</td>
                        </tr>
                    </table>
                </div>
                
                <div style="text-align: center; margin: 28px 0 20px;">
                    <a href="${payslipDirectUrl}" class="button" style="background: #0f172a; color: #ffffff; padding: 12px 28px; border-radius: 10px; font-weight: 700; text-decoration: none; display: inline-block; font-size: 14px;">
                        📄 View & Download Official Payslip &rarr;
                    </a>
                </div>

                <p style="text-align: center; color: #94a3b8; font-size: 12px; margin: 0;">
                    Or copy your secure link: <a href="${payslipDirectUrl}" style="color: #6366f1; word-break: break-all;">${payslipDirectUrl}</a>
                </p>
            `;
            break;

        case 'system_alert':
            subject = `${company.companyName} | ${data.subject || 'System Notification'}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eff6ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">🔔</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">System Announcement</h1>
                </div>
                
                <div class="card">
                    <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.6;">${data.message}</p>
                </div>
                
                ${data.ctaUrl ? `
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.ctaUrl}" class="button">View Announcement &rarr;</a>
                </div>
                ` : ''}
            `;
            break;

        case 'verification':
            subject = `Verify Your Email — ${company.companyName}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eef2ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">✉️</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Verify Your Email Address</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">Welcome to ${company.companyName}, ${data.name}!</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Please confirm your email address by clicking the verification button below to activate your account and access your workspace.</p>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.verificationUrl}" class="button">Verify Email Address &rarr;</a>
                </div>
                
                <p style="margin-top: 24px; font-size: 12px; color: #94a3b8; text-align: center;">If you did not register for an account, you can safely disregard this message.</p>
            `;
            break;

        case 'password_reset':
            subject = `Password Reset Request — ${company.companyName}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #fee2e2; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">🔐</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Password Reset Request</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">We received a request to reset your credentials.</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Click the button below to establish a new password for your account. This link will remain active for 1 hour.</p>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.resetUrl}" class="button">Reset My Password &rarr;</a>
                </div>
                
                <p style="margin-top: 24px; font-size: 12px; color: #94a3b8; text-align: center;">If you did not make this request, your account remains secure and no action is required.</p>
            `;
            break;

        case 'forgot_password':
            subject = `Your Temporary Password — ${company.companyName}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #fee2e2; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">🔑</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Temporary Access Key</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">A temporary password has been created for your account.</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Use the temporary password below to sign in to <strong>${company.companyName}</strong>:</p>
                
                <div class="card" style="text-align: center; background: #fff5f5; border: 1px solid #fed7d7;">
                    <span class="card-label" style="color: #991b1b;">Temporary Password</span>
                    <span style="font-size: 22px; font-weight: 800; color: #dc2626; font-family: monospace; letter-spacing: 0.1em; display: block; margin-top: 6px;">${data.tempPassword}</span>
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${getAppUrl('/login')}" class="button">Go to Login &rarr;</a>
                </div>
                
                <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-left: 3px solid #f59e0b; border-radius: 8px; padding: 14px 16px; margin-top: 24px; color: #92400e; font-size: 13px; line-height: 1.5;">
                    <strong>Security Reminder:</strong> Please update your password immediately in Settings after signing in.
                </div>
            `;
            break;

        case 'document_tagged':
        case 'document_shared':
            subject = `${company.companyName} | Document Shared: ${data.documentName}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eff6ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">📄</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Document Shared</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;"><strong>${data.senderName || 'A team member'}</strong> shared a document with you.</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Document Name</span>
                        <span class="card-value" style="font-size: 16px; color: #0f172a;">${data.documentName}</span>
                    </div>
                    ${data.senderName ? `
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Shared By</span>
                        <span class="card-value" style="font-size: 14px; color: #475569;">${data.senderName}</span>
                    </div>
                    ` : ''}
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.documentUrl || data.ctaUrl || getAppUrl('/dashboard/documents')}" class="button">Access Document &rarr;</a>
                </div>
            `;
            break;

        case 'user_onboarded':
        case 'company_welcome':
            subject = `Welcome to ${company.companyName} — Workspace Ready`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eef2ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">✨</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Welcome, ${data.name}!</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">Your corporate workspace <strong>${company.companyName}</strong> is ready.</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Your organization is fully provisioned. You can begin collaborating with your team, managing projects, and configuring operational preferences.</p>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${getAppUrl('/login')}" class="button">Access Workspace &rarr;</a>
                </div>
            `;
            break;

        case 'meeting_scheduled':
            subject = `Meeting Invitation: ${data.meetingTitle} — ${company.companyName}`;
            const timeDisplay = data.startTime 
                ? `${data.startDate} at ${data.startTime}${data.endTime ? ` - ${data.endTime}` : ''}`
                : data.startDate;
            const platformDisplay = data.platform ? data.platform.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : '';

            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eff6ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">📅</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Meeting Invitation</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">You have been invited to a session by <strong>${data.creatorName || 'a team member'}</strong>.</p>
                </div>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Subject</span>
                        <span class="card-value" style="font-size: 16px; color: #0f172a;">${data.meetingTitle}</span>
                    </div>
                    
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Date & Time</span>
                        <span class="card-value" style="font-size: 14px; color: #2563eb;">⏰ ${timeDisplay}</span>
                    </div>
                    
                    ${platformDisplay ? `
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Platform</span>
                        <span class="card-value" style="font-size: 14px; color: #334155;">${platformDisplay}</span>
                    </div>
                    ` : ''}
                    
                    ${data.location ? `
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Location / Link</span>
                        <span class="card-value" style="font-size: 14px; color: #334155;">${data.location}</span>
                    </div>
                    ` : ''}
                    
                    ${data.agenda ? `
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Agenda</span>
                        <span style="font-size: 13px; color: #475569; line-height: 1.5; display: block;">${data.agenda}</span>
                    </div>
                    ` : ''}
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.ctaUrl || getAppUrl('/dashboard/calendar')}" class="button">${data.ctaUrl && !data.ctaUrl.includes('/dashboard') ? 'Join Meeting Now &rarr;' : 'View in Calendar &rarr;'}</a>
                </div>
            `;
            break;

        case 'leave_approved':
            subject = `${company.companyName} | Leave Request Approved`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #f0fdf4; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">✅</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Leave Request Approved</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Your leave request has been approved by your manager:</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Leave Category</span>
                        <span class="card-value" style="font-size: 15px; color: #0f172a;">${data.leaveType || 'Annual Leave'}</span>
                    </div>
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Approved Duration</span>
                        <span class="card-value" style="font-size: 14px; color: #166534;">📅 ${data.startDate} to ${data.endDate}</span>
                    </div>
                </div>
            `;
            break;

        case 'leave_rejected':
            subject = `${company.companyName} | Leave Request Update`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #fff1f2; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">ℹ️</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Leave Request Update</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Your requested leave for <strong>${data.leaveType}</strong> could not be approved at this time.</p>
                
                <div class="card">
                    <span class="card-label">Reason Provided</span>
                    <p style="margin: 4px 0 0 0; color: #475569; font-size: 14px; line-height: 1.5;">${data.reason || 'Operational staffing requirements.'}</p>
                </div>
                <p style="font-size: 13px; color: #64748b;">Please coordinate with your manager or HR team if you have any questions.</p>
            `;
            break;

        case 'task_completed':
            subject = `${company.companyName} | Task Completed: ${data.taskTitle}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #f0fdf4; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">🎉</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Task Marked as Completed</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">A task in <strong>${data.projectName || 'Workspace'}</strong> has been successfully finalized.</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Task</span>
                        <span class="card-value" style="font-size: 16px; color: #0f172a;">${data.taskTitle}</span>
                    </div>
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Status</span>
                        <div>${getStatusBadge('completed')}</div>
                    </div>
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.ctaUrl || getAppUrl('/dashboard/tasks')}" class="button">View Task Details &rarr;</a>
                </div>
            `;
            break;

        case 'module_assigned':
            subject = `${company.companyName} | Module Assigned: ${data.moduleName}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eef2ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">📦</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Module Ownership Assigned</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">You have been assigned as the owner for the following module:</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Module Name</span>
                        <span class="card-value" style="font-size: 16px; color: #0f172a;">${data.moduleName}</span>
                    </div>
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Project</span>
                        <span class="card-value" style="font-size: 14px; color: #3b82f6;">${data.projectName}</span>
                    </div>
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.url || data.ctaUrl ? getAppUrl(data.url || data.ctaUrl) : getAppUrl('/dashboard/projects')}" class="button">View Module &rarr;</a>
                </div>
            `;
            break;

        case 'task_overdue':
            subject = `${company.companyName} | Overdue Alert: ${data.taskTitle}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #fef2f2; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">⚠️</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #991b1b; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Task Overdue Alert</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">Your assigned task has passed its scheduled deadline.</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                
                <div class="card" style="border-left: 3px solid #dc2626;">
                    <div class="card-row">
                        <span class="card-label">Task</span>
                        <span class="card-value" style="font-size: 16px; color: #0f172a;">${data.taskTitle}</span>
                    </div>
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Due Date</span>
                        <span class="card-value" style="font-size: 14px; color: #dc2626;">📅 ${data.dueDate}</span>
                    </div>
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.ctaUrl || getAppUrl('/dashboard/tasks')}" class="button" style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);">Update Task Status &rarr;</a>
                </div>
            `;
            break;

        case 'invoice_generated':
            subject = `${company.companyName} | Invoice #${data.invoiceNumber}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eef2ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">🧾</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">New Invoice Available</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">Invoice reference: #${data.invoiceNumber}</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Dear <strong>${data.clientName}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">A new invoice has been generated for services provided by <strong>${company.companyName}</strong>:</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Amount Due</span>
                        <span style="font-size: 24px; font-weight: 800; color: ${company.brandColor || '#4f46e5'};">${data.currency || '$'}${Number(data.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Payment Due Date</span>
                        <span class="card-value" style="font-size: 14px; color: #0f172a;">📅 ${data.dueDate}</span>
                    </div>
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.ctaUrl || getAppUrl('/dashboard/invoices')}" class="button">View & Pay Invoice &rarr;</a>
                </div>
            `;
            break;

        case 'payment_received':
            subject = `${company.companyName} | Payment Confirmation #${data.invoiceNumber}`;
            const paymentCurrency = data.currency || company.currency || 'USD';
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #f0fdf4; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">💳</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Payment Confirmed</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Dear <strong>${data.clientName}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">We have successfully received your payment of <strong>${paymentCurrency} ${Number(data.amount).toLocaleString()}</strong> on ${data.date}.</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Invoice Number</span>
                        <span class="card-value" style="font-size: 15px; color: #0f172a;">#${data.invoiceNumber}</span>
                    </div>
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Payment Status</span>
                        <div>${getStatusBadge('paid')}</div>
                    </div>
                </div>
            `;
            break;

        case 'performance_review':
            subject = `${company.companyName} | Performance Review Scheduled`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eef2ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">📊</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Performance Review Scheduled</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Your upcoming evaluation session has been scheduled with <strong>${data.reviewerName}</strong>:</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Session Date & Time</span>
                        <span class="card-value" style="font-size: 15px; color: #2563eb;">📅 ${data.reviewDate}</span>
                    </div>
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.ctaUrl || getAppUrl('/dashboard/hr')}" class="button">View Review Details &rarr;</a>
                </div>
            `;
            break;

        case 'goal_assigned':
            subject = `${company.companyName} | New Goal: ${data.goalTitle}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #f5f3ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">🎯</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">New Goal Assigned</h1>
                    <p style="margin: 0; color: #6366f1; font-weight: 600; font-size: 14px;">${data.goalTitle}</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">A new strategic objective has been set for your progression:</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">The Vision</span>
                        <span style="font-style: italic; color: #334155; font-size: 14px; line-height: 1.5; display: block;">"${data.motivation || 'Achieve operational excellence.'}"</span>
                    </div>
                    <div style="display: table; width: 100%; margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <div style="display: table-cell; width: 50%; vertical-align: top;">
                            <span class="card-label">Target Date</span>
                            <span class="card-value" style="font-size: 14px; color: #0f172a;">${data.dueDate || 'Ongoing'}</span>
                        </div>
                        <div style="display: table-cell; width: 50%; vertical-align: top;">
                            <span class="card-label">Difficulty</span>
                            <div>${getPriorityBadge(data.difficulty || 'medium')}</div>
                        </div>
                    </div>
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.ctaUrl || getAppUrl('/dashboard/goals')}" class="button">Accept the Challenge &rarr;</a>
                </div>
            `;
            break;

        case 'client_welcome':
            subject = `Welcome to the ${company.companyName} Portal`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eef2ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">🌟</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Welcome, ${data.clientName}!</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">We are thrilled to partner with you. Your private client portal has been initialized.</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">You can monitor deliverables, review quotations, and download invoices directly from your dashboard.</p>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.loginUrl || getAppUrl('/login')}" class="button">Access Client Portal &rarr;</a>
                </div>
            `;
            break;

        case 'project_completed':
            subject = `${company.companyName} | Project Completed: ${data.projectName}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #f0fdf4; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">🏆</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Project Completed!</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Congratulations! The project <strong>${data.projectName}</strong> was successfully completed on ${data.completionDate}.</p>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.ctaUrl || getAppUrl('/dashboard/projects')}" class="button">View Final Report &rarr;</a>
                </div>
            `;
            break;

        case 'expense_approved':
            subject = `${company.companyName} | Expense Approved`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #f0fdf4; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">💼</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Expense Claim Approved</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Expense Item</span>
                        <span class="card-value" style="font-size: 15px; color: #0f172a;">${data.expenseTitle}</span>
                    </div>
                    <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <span class="card-label">Reimbursement Amount</span>
                        <span style="font-size: 18px; font-weight: 700; color: #166534;">${data.amount}</span>
                    </div>
                </div>
            `;
            break;

        case 'expense_rejected':
            subject = `${company.companyName} | Expense Request Update`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #fff1f2; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">ℹ️</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Expense Claim Update</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Your expense submission for <strong>${data.expenseTitle}</strong> (${data.amount}) could not be approved.</p>
                
                <div class="card">
                    <span class="card-label">Reason</span>
                    <p style="margin: 4px 0 0 0; color: #475569; font-size: 14px;">${data.reason || 'Insufficient documentation provided.'}</p>
                </div>
            `;
            break;

        case 'quotation':
            subject = `${company.companyName} | Quotation #${data.quoteNumber}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eef2ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">📋</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Official Quotation Issued</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">Quote Reference: #${data.quoteNumber}</p>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hello <strong>${data.clientName || 'valued client'}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">We are pleased to provide you with the formal quotation prepared by our team:</p>
                
                <div class="card">
                    <div class="card-row">
                        <span class="card-label">Total Amount</span>
                        <span style="font-size: 26px; font-weight: 800; color: ${company.brandColor || '#4f46e5'};">${data.currency || '$'}${Number(data.grandTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div style="display: table; width: 100%; margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                        <div style="display: table-cell; width: 50%; vertical-align: top;">
                            <span class="card-label">Valid Until</span>
                            <span class="card-value" style="font-size: 14px; color: #0f172a;">📅 ${data.validUntil}</span>
                        </div>
                        <div style="display: table-cell; width: 50%; vertical-align: top;">
                            <span class="card-label">Prepared By</span>
                            <span class="card-value" style="font-size: 14px; color: #475569;">${data.userName}</span>
                        </div>
                    </div>
                </div>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.viewUrl || '#'}" class="button">Review & Approve Quotation &rarr;</a>
                </div>
            `;
            break;

        case 'contract_renewal':
            subject = `${company.companyName} | Contract Renewal Reminder: ${data.contractName}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #fffbeb; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">📝</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Contract Renewal Reminder</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Dear <strong>${data.clientName}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">This is a reminder that the agreement <strong>${data.contractName}</strong> is scheduled for renewal on <strong>${data.renewalDate}</strong>.</p>
                
                <div style="text-align: center; margin: 28px 0 16px;">
                    <a href="${data.ctaUrl || getAppUrl('/dashboard/contracts')}" class="button">Review Contract Terms &rarr;</a>
                </div>
            `;
            break;

        case 'holiday_announcement':
            subject = `${company.companyName} | Upcoming Holiday: ${data.holidayName}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eff6ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">🌴</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Holiday Observance</h1>
                    <p style="margin: 0; color: #64748b; font-size: 14px;">${data.holidayName} — ${data.date}</p>
                </div>
                
                <div class="card">
                    <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.6;">${data.message || `Please note that our offices will be closed on ${data.date} in observance of ${data.holidayName}.`}</p>
                </div>
            `;
            break;

        case 'probation_completed':
            subject = `${company.companyName} | Probation Period Completed`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #f0fdf4; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">🎉</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Congratulations, ${data.name}!</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">We are delighted to confirm that you have successfully completed your probation period as <strong>${data.role}</strong> effective <strong>${data.effectiveDate}</strong>.</p>
            `;
            break;

        case 'document_attachment':
            subject = `${company.companyName} | Document Attachment: ${data.documentName}`;
            content = `
                <div style="text-align: center; margin-bottom: 24px;">
                    <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eff6ff; border-radius: 12px; margin-bottom: 12px;">
                        <span style="font-size: 24px;">📎</span>
                    </div>
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Document Attached</h1>
                </div>
                
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${data.name || 'there'}</strong>,</p>
                <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Please find the attached document: <strong>${data.documentName}</strong>.</p>
                
                ${data.message ? `
                <div class="card">
                    <p style="margin: 0; color: #334155; font-size: 14px; line-height: 1.5;">${data.message}</p>
                </div>
                ` : ''}
            `;
            break;

        default:
            throw new Error(`Template ${templateId} is not defined.`);
    }

    return { subject, html: baseLayout(subject, content, company) };
}

// ─── Centralized Notification Engine ─────────────────────────────────────────

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
                <div style="text-align: center; margin-bottom: 24px;">
                    <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">${sub}</h1>
                </div>
                <p style="color: #334155; font-size: 15px; line-height: 1.6;">Hi <strong>${name}</strong>,</p>
                <div class="card">
                    <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.6;">${data.message || data.description || 'You have a new update from the system.'}</p>
                </div>
                ${data.ctaLink ? `<div style="text-align: center; margin: 28px 0 16px;"><a href="${data.ctaLink}" class="button">${data.ctaText || 'View Details &rarr;'}</a></div>` : ''}
            `, company);
            subject = data.subject || `${company.companyName} | ${sub}`;
        } else {
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
    } catch (err) {
        console.error(`[EmailService] Notification Dispatch Error [${event}]:`, err.message);
        return { success: false, error: err.message };
    }
}

async function sendEmailTemplate(to, templateName, templateData, category = CATEGORIES.WORK) {
    const { queueEmail } = require('./queue.service');
    const { subject, html } = await buildTemplate(templateName, templateData, prisma);
    const companyId = prisma?.companyId || 'global';
    return queueEmail({ to, subject, html, template: templateName, data: templateData, companyId, category });
}

export const EmailService = {
    getTransporter, 
    notify,
    dispatchEmail,
    CATEGORIES,
    
    verifyConfig: async (category) => {
        const transporter = await getTransporter(category, prisma);
        return !!transporter;
    },

    getTemplatePreview: async (templateId, templateData, targetCompanyId = null) => {
        return buildTemplate(templateId, templateData, prisma, targetCompanyId);
    },

    sendEmail: async function(options) {
        if (typeof options === 'string') {
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
    sendSalaryGeneratedEmail: (to, name, month, netSalary, prisma, extraData = {}) => sendEmailTemplate(to, 'salary_generated', { name, month, netSalary, ...extraData }, prisma, CATEGORIES.WORK),
    sendSystemAlert: (to, subject, message, prisma) => sendEmailTemplate(to, 'system_alert', { subject, message }, prisma, CATEGORIES.SYSTEM),
    sendWelcomeEmail: (user, password, prisma) => sendEmailTemplate(user.email, 'welcome', { name: user.name, email: user.email, password }, prisma, CATEGORIES.WORK),
    sendDocumentTagEmail: (to, name, documentName, documentUrl, senderName, prisma) => sendEmailTemplate(to, 'document_tagged', { name, documentName, documentUrl, senderName }, prisma, CATEGORIES.WORK),
    sendSalarySlip: (employee, salary, prisma) => sendEmailTemplate(
        employee.email, 
        'salary_generated', 
        { 
            name: employee.name, 
            month: salary.month, 
            netSalary: salary.netSalary,
            baseSalary: salary.baseSalary,
            bonuses: salary.bonuses,
            deductions: salary.deductions,
            status: salary.status,
            currency: salary.currency,
            salaryId: salary.id,
            totalDays: salary.totalDays,
            presentDays: salary.presentDays,
            paidLeaves: salary.paidLeaves
        }, 
        prisma, 
        CATEGORIES.WORK
    ),
    sendTaskOverdueEmail: (to, name, taskTitle, dueDate, ctaUrl, prisma) => sendEmailTemplate(to, 'task_overdue', { name, taskTitle, dueDate, ctaUrl }, prisma, CATEGORIES.WORK),
    sendCompanyWelcomeEmail: (to, name, loginUrl, prisma) => sendEmailTemplate(to, 'company_welcome', { name, loginUrl }, prisma, CATEGORIES.SYSTEM),
    
    sendQuotationEmail: async (to, data, attachments, prisma) => {
        const { subject, html } = await buildTemplate('quotation', data, prisma);
        return send({ to, subject, html, attachments, templateName: 'quotation', templateData: data }, prisma);
    },

    sendTransitionalEmail: async (to, subject, data, prisma) => {
        const company = await getCompanyInfo(prisma);
        const html = baseLayout(subject, `
            <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">${subject}</h1>
            </div>
            <p style="color: #334155; font-size: 15px; line-height: 1.6;">Hi <strong>${data.name}</strong>,</p>
            <div class="card">
                <p style="margin: 0; color: #334155; font-size: 15px; line-height: 1.6;">${data.message}</p>
            </div>
            ${data.ctaLink ? `<div style="text-align: center; margin: 28px 0 16px;"><a href="${data.ctaLink}" class="button">${data.ctaText || 'View Details &rarr;'}</a></div>` : ''}
        `, company);
        return send({ to, subject: `${company.companyName} | ${subject}`, html, templateName: 'transitional', templateData: data }, prisma);
    },

    sendMeetingEmail: (to, name, meetingTitle, startTime, ctaUrl, prisma) => sendEmailTemplate(to, 'meeting_scheduled', { name, meetingTitle, startTime, ctaUrl }, prisma, CATEGORIES.WORK),

    sendDocumentWithAttachment: async (to, name, documentName, message, attachment, prisma) => {
        const { subject, html } = await buildTemplate('document_attachment', { name, documentName, message }, prisma);
        return send({ to, subject, html, templateName: 'document_attachment', templateData: { name, documentName, message }, attachments: [attachment], category: CATEGORIES.WORK }, prisma);
    },

    // ─── Billing / Subscription Emails ───────────────────────────────────────
    sendTrialStartedEmail: async (to, adminName, trialDays, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const platformName = ps.platformName || company.companyName || '180workspace';
        const loginUrl = ps.platformApiUrl || process.env.CLIENT_URL || '';
        const upgradeUrl = `${loginUrl}/dashboard/billing`;
        const subject = `Your ${trialDays}-Day ${platformName} Trial Has Started!`;
        const content = `
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #eef2ff; border-radius: 12px; margin-bottom: 12px;">
                    <span style="font-size: 24px;">🚀</span>
                </div>
                <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Welcome, ${adminName}!</h1>
                <p style="margin: 0; color: #64748b; font-size: 14px;">Your <strong>${trialDays}-day free trial</strong> of ${platformName} is now active.</p>
            </div>
            
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">You now have unrestricted access to explore all enterprise features including Projects, Tasks, CRM, HR, Invoicing, and Automations.</p>
            
            <div class="card">
                <span class="card-label">Trial Period</span>
                <span class="card-value" style="font-size: 15px; color: #166534;">${trialDays} Days Full Access — No credit card required</span>
            </div>
            
            ${loginUrl ? `
            <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${loginUrl}" class="button">Log In to Workspace &rarr;</a>
            </div>
            ` : ''}
            
            ${upgradeUrl ? `<p style="margin-top: 24px; font-size: 12px; color: #94a3b8; text-align: center;">When your trial concludes, you can upgrade seamlessly from your <a href="${upgradeUrl}">Billing Settings</a>.</p>` : ''}
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'trial_started' }, prisma);
    },

    sendTrialReminderEmail: async (to, adminName, daysLeft, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const upgradeUrl = `${ps.platformApiUrl || process.env.CLIENT_URL || ''}/dashboard/billing`;
        const subject = `Your trial expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} — Action required`;
        const content = `
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #fffbeb; border-radius: 12px; margin-bottom: 12px;">
                    <span style="font-size: 24px;">⏳</span>
                </div>
                <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Trial Ending Soon</h1>
            </div>
            
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${adminName}</strong>,</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Your free trial will expire in <strong>${daysLeft} day${daysLeft !== 1 ? 's' : ''}</strong>. To ensure uninterrupted access to your team workflows, please upgrade your subscription plan:</p>
            
            <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${upgradeUrl}" class="button">Upgrade Plan &rarr;</a>
            </div>
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'trial_reminder' }, prisma);
    },

    sendTrialExpiredEmail: async (to, adminName, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const platformName = ps.platformName || company.companyName || '180workspace';
        const upgradeUrl = `${ps.platformApiUrl || process.env.CLIENT_URL || ''}/dashboard/billing`;
        const subject = `Your ${platformName} trial has expired`;
        const content = `
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #fef2f2; border-radius: 12px; margin-bottom: 12px;">
                    <span style="font-size: 24px;">🛑</span>
                </div>
                <h1 style="margin: 0 0 6px 0; color: #991b1b; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Trial Period Concluded</h1>
            </div>
            
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${adminName}</strong>,</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Your trial has concluded and workspace features are currently locked. Your data remains completely safe and accessible as soon as an active plan is chosen.</p>
            
            <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${upgradeUrl}" class="button">Select a Plan &rarr;</a>
            </div>
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'trial_expired' }, prisma);
    },

    sendSubscriptionConfirmationEmail: async (to, adminName, planName, amount, expiryDate, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const loginUrl = ps.platformApiUrl || process.env.CLIENT_URL || '';
        const platformCurrency = ps.currency || 'USD';
        const subject = `Payment Confirmed — ${planName} Plan Activated`;
        const expiry = new Date(expiryDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
        const content = `
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #f0fdf4; border-radius: 12px; margin-bottom: 12px;">
                    <span style="font-size: 24px;">💎</span>
                </div>
                <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Payment Confirmed</h1>
                <p style="margin: 0; color: #166534; font-weight: 600; font-size: 14px;">${planName} Plan Active</p>
            </div>
            
            <div class="card">
                <div class="card-row">
                    <span class="card-label">Plan</span>
                    <span class="card-value" style="font-size: 16px; color: #0f172a;">${planName}</span>
                </div>
                <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                    <span class="card-label">Amount Paid</span>
                    <span style="font-size: 18px; font-weight: 700; color: #166534;">${platformCurrency} ${Number(amount).toLocaleString()}</span>
                </div>
                <div class="card-row" style="margin-top: 14px; padding-top: 14px; border-top: 1px dashed #e2e8f0;">
                    <span class="card-label">Valid Until</span>
                    <span class="card-value" style="font-size: 14px; color: #0f172a;">📅 ${expiry}</span>
                </div>
            </div>
            
            <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${loginUrl}" class="button">Go to Dashboard &rarr;</a>
            </div>
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'subscription_confirmation' }, prisma);
    },

    sendRenewalReminderEmail: async (to, adminName, planName, daysLeft, renewalDate, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const upgradeUrl = `${ps.platformApiUrl || process.env.CLIENT_URL || ''}/dashboard/billing`;
        const subject = `Your ${planName} subscription expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
        const expiry = new Date(renewalDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
        const content = `
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #fffbeb; border-radius: 12px; margin-bottom: 12px;">
                    <span style="font-size: 24px;">⏰</span>
                </div>
                <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Subscription Expiring Soon</h1>
            </div>
            
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${adminName}</strong>,</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Your <strong>${planName}</strong> plan will expire on <strong>${expiry}</strong> (${daysLeft} day${daysLeft !== 1 ? 's' : ''} remaining). Renew now to preserve access:</p>
            
            <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${upgradeUrl}" class="button">Renew Subscription &rarr;</a>
            </div>
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'renewal_reminder' }, prisma);
    },

    sendDeletionWarningEmail: async (to, adminName, retentionDays, deletionDate, prisma) => {
        const company = await getCompanyInfo(prisma);
        const ps = await prisma.platformSettings.findFirst() || {};
        const upgradeUrl = `${ps.platformApiUrl || process.env.CLIENT_URL || ''}/dashboard/billing`;
        const subject = `FINAL NOTICE: Data deletion scheduled in ${retentionDays} days`;
        const dateStr = new Date(deletionDate).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
        const content = `
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #fef2f2; border-radius: 12px; margin-bottom: 12px;">
                    <span style="font-size: 24px;">🚨</span>
                </div>
                <h1 style="margin: 0 0 6px 0; color: #991b1b; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Final Notice: Data Deletion</h1>
            </div>
            
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${adminName}</strong>,</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">Your company data is scheduled for permanent deletion on <strong>${dateStr}</strong> under our retention policy unless an active plan is activated.</p>
            
            <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${upgradeUrl}" class="button" style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);">Upgrade Now to Save Your Data &rarr;</a>
            </div>
        `;
        const html = baseLayout(subject, content, company);
        return send({ to, subject, html, templateName: 'deletion_warning' }, prisma);
    },

    // ─── Forgot Password ─────────────────────────────────────────────────────
    async sendForgotPasswordEmail(user, tempPassword, companyName, prisma) {
        const to = user.email;
        const name = user.name || 'User';
        const company = await getCompanyInfo(prisma);
        const loginUrl = process.env.CLIENT_URL || 'http://localhost:3000';
        const subject = `Your Temporary Password — ${company.companyName || companyName}`;
        const content = `
            <div style="text-align: center; margin-bottom: 24px;">
                <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px; text-align: center; background: #fee2e2; border-radius: 12px; margin-bottom: 12px;">
                    <span style="font-size: 24px;">🔑</span>
                </div>
                <h1 style="margin: 0 0 6px 0; color: #0f172a; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">Password Reset Key</h1>
            </div>
            
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 16px 0;">Hi <strong>${name}</strong>,</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0 0 20px 0;">A new temporary password has been generated for your account:</p>
            
            <div class="card" style="text-align: center; background: #fff5f5; border: 1px solid #fed7d7;">
                <span class="card-label" style="color: #991b1b;">Temporary Password</span>
                <span style="font-size: 24px; font-weight: 800; color: #dc2626; font-family: monospace; letter-spacing: 0.1em; display: block; margin-top: 6px;">${tempPassword}</span>
            </div>
            
            <p style="font-size: 13px; color: #64748b; text-align: center;">Please log in and update your password immediately after signing in.</p>
            
            <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${loginUrl}/login" class="button">Log In Now &rarr;</a>
            </div>
        `;
        const html = baseLayout(subject, content, company);

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
