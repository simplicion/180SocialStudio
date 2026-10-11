"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AICreditMeterService = exports.AICreditOperationRates = void 0;
const db_1 = require("@workspace/db");
exports.AICreditOperationRates = {
    DOCUMENT_FULL: 10,
    DOCUMENT_REVISION: 1,
    DOCUMENT_APPEND: 1,
    WEBSITE_FULL: 20,
    WEBSITE_PATCH: 2,
    FORM_FULL: 10,
    FORM_PATCH: 1,
    CHAT: 1,
    EMAIL_DRAFT: 2,
    VIDEO_DIRECTOR: 25,
    AUDIO_SYNTHESIS: 5,
};
class AICreditMeterService {
    static CREDITS_PER_USD = 1000; // $1.00 USD = 1,000 Credits
    static DEFAULT_FREE_QUOTA = 2000; // $2.00 free monthly quota
    static DEFAULT_PRO_QUOTA = 5000; // $5.00 pro monthly quota
    static DEFAULT_AGENCY_QUOTA = 12000; // $12.00 agency monthly quota
    static RATES = exports.AICreditOperationRates;
    static activeReservations = new Map();
    /**
     * Helper: Resolves company record and parsed metadata
     */
    static async getCompanyAndMeta(companyId) {
        let company = null;
        if (companyId) {
            company = await db_1.prisma.company.findUnique({ where: { id: companyId } }).catch(() => null);
        }
        if (!company) {
            company = await db_1.prisma.company.findFirst().catch(() => null);
        }
        let metadata = {};
        if (company) {
            let meta = company.metadata || {};
            if (typeof meta === "string") {
                try {
                    meta = JSON.parse(meta);
                }
                catch {
                    meta = {};
                }
            }
            if (typeof meta === "string") {
                try {
                    meta = JSON.parse(meta);
                }
                catch {
                    meta = {};
                }
            }
            metadata = meta;
        }
        return { company, metadata };
    }
    /**
     * Retrieves high-level credit status and progression bar data for UI and API guards
     */
    static async getAccountStatus(companyId) {
        const { company, metadata } = await this.getCompanyAndMeta(companyId);
        const targetCompanyId = company?.id || companyId || "default_workspace";
        const aiAccount = metadata.aiAccount || {};
        const planType = (company?.plan || metadata.planType || "free").toLowerCase();
        const monthlyIncludedQuota = typeof aiAccount.monthlyIncludedQuota === "number"
            ? aiAccount.monthlyIncludedQuota
            : planType.includes("agency") || planType.includes("business")
                ? this.DEFAULT_AGENCY_QUOTA
                : planType.includes("pro")
                    ? this.DEFAULT_PRO_QUOTA
                    : this.DEFAULT_FREE_QUOTA;
        const monthlyCreditsUsed = Number(aiAccount.monthlyCreditsUsed) || 0;
        const purchasedCredits = Number(aiAccount.purchasedCredits) || 0;
        // Calculate active memory reservations
        let reservedCredits = 0;
        const now = Date.now();
        for (const [resId, resData] of this.activeReservations.entries()) {
            if (resData.companyId === targetCompanyId) {
                if (now - resData.createdAt < 5 * 60 * 1000) {
                    // Valid within 5-min timeout
                    reservedCredits += resData.reservedCredits;
                }
                else {
                    this.activeReservations.delete(resId);
                }
            }
        }
        const availableMonthly = Math.max(0, monthlyIncludedQuota - monthlyCreditsUsed);
        const availableCredits = Math.max(0, availableMonthly + purchasedCredits - reservedCredits);
        const totalEffectiveCapacity = monthlyIncludedQuota + purchasedCredits;
        const percentUsed = Math.min(100, totalEffectiveCapacity > 0
            ? Math.round(((monthlyCreditsUsed + reservedCredits) / totalEffectiveCapacity) * 100)
            : 100);
        const isSoftLocked = availableCredits <= 0;
        const recentLedger = (aiAccount.ledger || []).slice(-15).reverse();
        const tier = planType.includes("agency") || planType.includes("business")
            ? "AGENCY"
            : planType.includes("pro")
                ? "PRO"
                : "FREE";
        return {
            companyId: targetCompanyId,
            tier,
            monthlyIncludedQuota,
            monthlyCreditsUsed,
            purchasedCredits,
            reservedCredits,
            availableCredits,
            currentBalance: availableCredits,
            totalCreditsUsed: monthlyCreditsUsed,
            percentUsed,
            usedPercentage: percentUsed,
            remainingPercentage: Math.max(0, 100 - percentUsed),
            isSoftLocked,
            isExhausted: isSoftLocked,
            dollarEquivalent: Math.round((availableCredits / this.CREDITS_PER_USD) * 100) / 100,
            currency: "USD",
            usdEquivalentRate: this.CREDITS_PER_USD,
            recentLedger,
        };
    }
    /**
     * Pre-flight balance verification before initiating AI request
     */
    static async checkBalance(companyId, estimatedCredits = 5) {
        const status = await this.getAccountStatus(companyId);
        return {
            sufficient: status.availableCredits >= estimatedCredits,
            availableCredits: status.availableCredits,
            percentUsed: status.percentUsed,
        };
    }
    /**
     * Creates an in-memory reservation hold for streaming / multi-step operations
     * Supports both (companyId, estimatedCredits) and ({ companyId, estimatedCreditCost })
     */
    static async reserveCredits(paramsOrCompanyId, estimatedCreditsParam) {
        let companyId;
        let estimatedCredits = 5;
        if (typeof paramsOrCompanyId === "string" || typeof paramsOrCompanyId === "undefined") {
            companyId = paramsOrCompanyId;
            estimatedCredits = estimatedCreditsParam ?? 5;
        }
        else if (paramsOrCompanyId && typeof paramsOrCompanyId === "object") {
            companyId = paramsOrCompanyId.companyId;
            estimatedCredits =
                paramsOrCompanyId.estimatedCreditCost ?? paramsOrCompanyId.estimatedCredits ?? 5;
        }
        const status = await this.getAccountStatus(companyId);
        if (status.availableCredits < estimatedCredits) {
            return { reservationId: "", success: false };
        }
        const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        this.activeReservations.set(reservationId, {
            companyId: status.companyId,
            reservedCredits: estimatedCredits,
            createdAt: Date.now(),
        });
        return { reservationId, success: true };
    }
    /**
     * Releases an unconsumed reservation
     */
    static releaseReservation(reservationId) {
        this.activeReservations.delete(reservationId);
    }
    /**
     * Settles final credit deduction after AI operation completes
     * Supports both actualCredits and finalCreditCost, with defaults for appId and featureKey
     */
    static async settleCredits(params) {
        if (params.reservationId) {
            this.activeReservations.delete(params.reservationId);
        }
        const actualCredits = params.actualCredits ?? params.finalCreditCost ?? 1;
        const appId = params.appId || "media-editor";
        const featureKey = params.featureKey || params.operation || "ai_operation";
        const { company, metadata } = await this.getCompanyAndMeta(params.companyId);
        if (!company) {
            return { success: false, balanceAfter: 0 };
        }
        const aiAccount = metadata.aiAccount || {};
        const monthlyCreditsUsed = (Number(aiAccount.monthlyCreditsUsed) || 0) + actualCredits;
        const remainingAvailable = Math.max(0, (aiAccount.monthlyIncludedQuota || this.DEFAULT_FREE_QUOTA) -
            monthlyCreditsUsed +
            (Number(aiAccount.purchasedCredits) || 0));
        const ledgerItem = {
            id: `ledg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            timestamp: new Date().toISOString(),
            appId,
            featureKey,
            operationType: "DEBIT",
            creditsAmount: -actualCredits,
            balanceAfter: remainingAvailable,
            metadata: params.metadata,
        };
        const existingLedger = aiAccount.ledger || [];
        const updatedLedger = [...existingLedger.slice(-99), ledgerItem];
        const updatedAccount = {
            ...aiAccount,
            monthlyCreditsUsed,
            ledger: updatedLedger,
            lastDeductionAt: new Date().toISOString(),
        };
        const updatedMeta = {
            ...metadata,
            aiAccount: updatedAccount,
        };
        await db_1.prisma.company.update({
            where: { id: company.id },
            data: { metadata: updatedMeta },
        }).catch((err) => {
            console.warn("[AICreditMeterService] Failed to persist credit deduction:", err?.message);
        });
        return {
            success: true,
            balanceAfter: remainingAvailable,
        };
    }
    /**
     * Instant wallet recharge: adds purchased credits ($5 = 5,000 credits)
     */
    static async rechargeCredits(paramsOrCompanyId, amountUsdParam, paymentRefParam) {
        let companyId;
        let amountUsd;
        let paymentRef;
        if (typeof paramsOrCompanyId === "object" && paramsOrCompanyId !== null) {
            companyId = paramsOrCompanyId.companyId;
            amountUsd = Number(paramsOrCompanyId.amountUsd);
            paymentRef = paramsOrCompanyId.paymentRef || paramsOrCompanyId.paymentMethod || "wallet_topup";
        }
        else {
            companyId = String(paramsOrCompanyId);
            amountUsd = Number(amountUsdParam);
            paymentRef = paymentRefParam || "wallet_topup";
        }
        const { company, metadata } = await this.getCompanyAndMeta(companyId);
        if (!company) {
            return {
                success: false,
                creditsAdded: 0,
                newPurchasedTotal: 0,
                newBalance: 0,
                currentBalance: 0,
            };
        }
        // Calculate base credits and apply tier bonuses ($25 = +10%, $50 = +20%)
        let bonusMultiplier = 1.0;
        if (amountUsd >= 50) {
            bonusMultiplier = 1.2; // 20% bonus
        }
        else if (amountUsd >= 25) {
            bonusMultiplier = 1.1; // 10% bonus
        }
        const creditsToAdd = Math.round(amountUsd * this.CREDITS_PER_USD * bonusMultiplier);
        const aiAccount = metadata.aiAccount || {};
        const purchasedCredits = (Number(aiAccount.purchasedCredits) || 0) + creditsToAdd;
        const newBalance = (aiAccount.monthlyIncludedQuota || this.DEFAULT_FREE_QUOTA) -
            (Number(aiAccount.monthlyCreditsUsed) || 0) +
            purchasedCredits;
        const ledgerItem = {
            id: `recharge_${Date.now()}`,
            timestamp: new Date().toISOString(),
            appId: "platform-billing",
            featureKey: "wallet_recharge",
            operationType: "RECHARGE",
            creditsAmount: creditsToAdd,
            balanceAfter: newBalance,
            metadata: { amountUsd, bonusMultiplier, paymentRef },
        };
        const existingLedger = aiAccount.ledger || [];
        const updatedLedger = [...existingLedger.slice(-99), ledgerItem];
        const updatedAccount = {
            ...aiAccount,
            purchasedCredits,
            ledger: updatedLedger,
            lastRechargeAt: new Date().toISOString(),
        };
        await db_1.prisma.company.update({
            where: { id: company.id },
            data: { metadata: { ...metadata, aiAccount: updatedAccount } },
        });
        return {
            success: true,
            creditsAdded: creditsToAdd,
            newPurchasedTotal: purchasedCredits,
            newBalance,
            currentBalance: newBalance,
        };
    }
}
exports.AICreditMeterService = AICreditMeterService;
