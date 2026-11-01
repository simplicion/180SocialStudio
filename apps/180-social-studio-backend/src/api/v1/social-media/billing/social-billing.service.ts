import { prisma } from '@workspace/db';

export interface SocialBillingStatus {
    canAccess: boolean;
    isTrial: boolean;
    trialDaysRemaining: number;
    trialEndDate: string | null;
    hasActiveSubscription: boolean;
    hasActivePass: boolean;
    passDaysRemaining: number;
    hoursRemaining: number;
    subscriptionEndDate: string | null;
    planName: string | null;
    dailyRate: number;
    monthlyRate: number;
    lockReason?: string;
    message?: string;
    passDetails?: {
        type: 'monthly' | 'recharge';
        days: number;
        startsAt: string;
        expiresAt: string;
        hoursRemaining: number;
    } | null;
}

export class SocialBillingService {
    /**
     * Resolves the company entity associated with a given companyId or userId.
     */
    private static async resolveCompany(companyId?: string, userId?: string): Promise<any> {
        const db = prisma as any;
        let company: any = null;

        if (companyId && companyId !== 'undefined' && companyId !== 'null') {
            try {
                company = await db.company.findUnique({ where: { id: companyId } });
            } catch (_) {}
        }

        if (!company && userId) {
            try {
                const user = await db.user.findFirst({
                    where: {
                        OR: [
                            { id: userId },
                            { email: userId.includes('@') ? userId : undefined },
                        ].filter(Boolean),
                    },
                    select: { companyId: true },
                });
                if (user?.companyId) {
                    company = await db.company.findUnique({ where: { id: user.companyId } });
                }
            } catch (_) {}
        }

        if (!company) {
            try {
                company = await db.company.findFirst();
            } catch (_) {}
        }

        if (!company) {
            try {
                company = await db.company.create({
                    data: {
                        id: companyId || 'default_creator_company',
                        name: 'My Workspace',
                        slug: 'my-workspace',
                        subscriptionStatus: 'trial',
                    },
                });
            } catch (_) {
                company = { id: 'default_creator_company', name: 'My Workspace', metadata: {} };
            }
        }

        return company;
    }

    /**
     * Checks creator access in real-time.
     * Enforces strict subscription or 24-hour daily pass expiration:
     * Only users with an active monthly subscription or active daily pass can access.
     */
    static async checkAccess(userId: string, companyId?: string): Promise<SocialBillingStatus> {
        return this.getBillingStatus(userId, companyId);
    }

    /**
     * Retrieves current creator entitlement status with millisecond-exact 24-hour calculation.
     */
    static async getBillingStatus(userId: string, companyId?: string): Promise<SocialBillingStatus> {
        const company = await this.resolveCompany(companyId, userId);
        const metadata = (typeof company?.metadata === 'object' && company?.metadata) ? company.metadata : {};
        const pass = metadata.creatorPass;
        const now = Date.now();

        // Check if there is an active creator pass / monthly subscription
        if (pass && pass.expiresAt) {
            const expiresAtMs = new Date(pass.expiresAt).getTime();

            if (expiresAtMs > now) {
                // PASS IS CURRENTLY ACTIVE!
                const msRemaining = expiresAtMs - now;
                // Exact calculation: 24 hours per day (86,400,000 ms)
                const hoursRemaining = Math.max(0, Math.floor(msRemaining / (1000 * 60 * 60)));
                const passDaysRemaining = Math.max(1, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
                const isMonthly = pass.type === 'monthly';

                return {
                    canAccess: true,
                    isTrial: false,
                    trialDaysRemaining: 0,
                    trialEndDate: null,
                    hasActiveSubscription: isMonthly,
                    hasActivePass: !isMonthly,
                    passDaysRemaining: passDaysRemaining,
                    hoursRemaining: hoursRemaining,
                    subscriptionEndDate: new Date(expiresAtMs).toISOString(),
                    planName: isMonthly ? 'Monthly Creator Subscription ($20/mo)' : `Recharge Pass (${passDaysRemaining}d remaining)`,
                    dailyRate: 0.71,
                    monthlyRate: 20.0,
                    message: `Active ${isMonthly ? 'monthly subscription' : 'pass'}: ${hoursRemaining} hours remaining.`,
                    passDetails: {
                        type: pass.type,
                        days: pass.days || passDaysRemaining,
                        startsAt: pass.startsAt || new Date().toISOString(),
                        expiresAt: new Date(expiresAtMs).toISOString(),
                        hoursRemaining: hoursRemaining,
                    },
                };
            }
        }

        // Pass has expired or never existed -> Access LOCKED
        const expiredDateStr = pass?.expiresAt ? new Date(pass.expiresAt).toISOString() : null;
        return {
            canAccess: false,
            isTrial: false,
            trialDaysRemaining: 0,
            trialEndDate: null,
            hasActiveSubscription: false,
            hasActivePass: false,
            passDaysRemaining: 0,
            hoursRemaining: 0,
            subscriptionEndDate: expiredDateStr,
            planName: null,
            dailyRate: 0.71,
            monthlyRate: 20.0,
            lockReason: 'subscriptionExpired',
            message: 'Your creator pass or subscription has ended. Slide to recharge or subscribe to unlock access.',
            passDetails: null,
        };
    }

    /**
     * Activates or extends a creator pass with exact 24-hour daily calculation.
     * Stacks onto existing time if already active so the creator never loses paid hours.
     */
    static async activatePass(
        userId: string,
        companyId: string | undefined,
        options: { type: 'monthly' | 'recharge'; days?: number; amount?: number }
    ) {
        const db = prisma as any;
        const company = await this.resolveCompany(companyId, userId);
        const now = Date.now();

        const type = options.type === 'monthly' ? 'monthly' : 'recharge';
        const days = type === 'monthly' ? 30 : Math.max(1, options.days || 1);

        // Exact 24-hour daily calculation:
        // 1 day = 24 * 60 * 60 * 1000 = 86,400,000 ms
        const durationMs = days * 24 * 60 * 60 * 1000;

        const currentMeta = (typeof company?.metadata === 'object' && company?.metadata) ? company.metadata : {};
        const existingPass = currentMeta.creatorPass;

        let startsAt = new Date(now);
        let expiresAt: Date;

        // If existing pass is still active, seamlessly stack the new hours onto existing expiry
        if (existingPass?.expiresAt && new Date(existingPass.expiresAt).getTime() > now) {
            const existingExpiryMs = new Date(existingPass.expiresAt).getTime();
            expiresAt = new Date(existingExpiryMs + durationMs);
            startsAt = new Date(existingPass.startsAt || now);
        } else {
            expiresAt = new Date(now + durationMs);
        }

        const calculatedAmount =
            type === 'monthly'
                ? 20.0
                : Math.round(days * (20.0 / 28.0) * 100) / 100.0;

        const newPassData = {
            type,
            days: type === 'monthly' ? 30 : days,
            startsAt: startsAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            amount: options.amount || calculatedAmount,
            currency: 'USD',
            status: 'ACTIVE',
            activatedAt: new Date().toISOString(),
            activatedBy: userId,
        };

        const updatedMetadata = {
            ...currentMeta,
            creatorPass: newPassData,
        };

        try {
            await db.company.update({
                where: { id: company.id },
                data: {
                    metadata: updatedMetadata,
                    subscriptionStatus: 'active',
                },
            });
        } catch (dbErr) {
            console.error('[SocialBillingService] Failed to update company metadata:', dbErr);
        }

        return newPassData;
    }

    /**
     * Creates a checkout session for 180 Pay in-app modal or direct slide activation.
     */
    static async createCheckout(
        userId: string,
        companyId: string | undefined,
        userEmail: string | undefined,
        options: { type: 'monthly' | 'recharge'; days?: number; returnUrl?: string }
    ) {
        const type = options.type === 'recharge' ? 'recharge' : 'monthly';
        const days = type === 'monthly' ? 30 : Math.max(1, options.days || 1);
        const amount =
            type === 'monthly'
                ? 20.0
                : Math.round(days * (20.0 / 28.0) * 100) / 100.0;

        const sessionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // Activate the pass immediately in database so creator has access as soon as they slide!
        const activatedPass = await this.activatePass(userId, companyId, {
            type,
            days,
            amount,
        });

        const baseUrl = process.env.API_BASE_URL || 'https://api.180workspace.com';
        const checkoutUrl = `${baseUrl}/api/v1/social-media/billing/pay-modal?session_id=${sessionId}&type=${type}&days=${days}&amount=${amount}&returnUrl=${encodeURIComponent(options.returnUrl || '180social://oauth-callback')}`;

        return {
            checkoutUrl,
            sessionId,
            status: 'completed',
            amount,
            currency: 'USD',
            pass: activatedPass,
        };
    }

    /**
     * Handles webhook callbacks from 180 Pay or payment processors.
     */
    static async handleWebhook(payload: any, headers?: any): Promise<any> {
        console.log('[SocialBillingService] Webhook received:', payload);
        if (payload?.companyId || payload?.userId) {
            await this.activatePass(payload.userId || 'webhook_user', payload.companyId, {
                type: payload.type || 'monthly',
                days: payload.days ? parseInt(payload.days, 10) : undefined,
                amount: payload.amount,
            });
        }
        return { received: true, status: 'processed' };
    }

    /**
     * Available plans configuration.
     */
    static async getPlans() {
        return [
            {
                id: 'pro_monthly',
                name: '180 Social Studio Creator Monthly',
                price: 20.0,
                interval: 'monthly',
                description: 'Full unlimited access to AI Director, Studio Video Engine, Autopilot Swarm & Multi-Platform Publishing.',
                features: [
                    'Unlimited Social Accounts (Instagram, YouTube, LinkedIn, Facebook)',
                    'AI Video Director & Kinetic Auto-Captions',
                    'Autonomous Autopilot Calendar Generator (7, 14, 30 days & Custom)',
                    'Direct Video & Reel Auto-Publishing',
                ],
            },
            {
                id: 'daily_pass',
                name: 'Recharge & Use Pass',
                price: 0.71,
                interval: 'daily',
                description: 'Pay as you go per day based on $20 / 28 days. Exact 24-hour access per day purchased.',
                features: [
                    'Full Studio Creator Access for Exact 24 Hours per Day',
                    'Stackable: Additional days add 24 hours to existing remaining time',
                    'Zero long-term commitment',
                ],
            },
        ];
    }
}
