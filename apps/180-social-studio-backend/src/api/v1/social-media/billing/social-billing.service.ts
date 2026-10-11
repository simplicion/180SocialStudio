import { prisma } from '@workspace/db';

export interface SocialBillingStatus {
    canAccess: boolean;
    isTrial: boolean;
    trialDaysRemaining: number;
    trialEndDate: string | null;
    hasActiveSubscription: boolean;
    hasActivePass: boolean;
    passDaysRemaining: number;
    subscriptionEndDate: string | null;
    planName: string | null;
    dailyRate: number;
    monthlyRate: number;
    lockReason?: string;
    message?: string;
}

export class SocialBillingService {
    static async checkAccess(companyId: string, ...rest: any[]): Promise<SocialBillingStatus> {
        return this.getBillingStatus(companyId, ...rest);
    }

    static async getBillingStatus(companyId: string, ...rest: any[]): Promise<SocialBillingStatus> {
        return {
            canAccess: true,
            isTrial: false,
            trialDaysRemaining: 999,
            trialEndDate: null,
            hasActiveSubscription: true,
            hasActivePass: true,
            passDaysRemaining: 999,
            subscriptionEndDate: null,
            planName: 'Pro Creator (Dedicated Social Studio)',
            dailyRate: 0,
            monthlyRate: 0,
            message: 'Social Studio Pro features active'
        };
    }

    static async createCheckout(companyId: string, ...rest: any[]): Promise<any> {
        return {
            checkoutUrl: rest[0]?.returnUrl || 'http://localhost:3000/billing/success',
            sessionId: 'sess_' + Date.now(),
            status: 'completed'
        };
    }

    static async handleWebhook(payload: any, headers?: any): Promise<any> {
        return { received: true };
    }

    static async getPlans() {
        return [
            {
                id: 'pro_creator',
                name: '180 Social Studio Pro',
                price: 0,
                interval: 'monthly',
                features: ['Unlimited Social Accounts', 'AI Video Director', 'Kinetic Auto-Captions', 'Multi-Platform Auto-Publish']
            }
        ];
    }
}