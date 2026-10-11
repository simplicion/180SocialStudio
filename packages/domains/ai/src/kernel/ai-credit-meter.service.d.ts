export interface AICreditAccountStatus {
    companyId: string;
    tier: "FREE" | "PRO" | "AGENCY" | string;
    monthlyIncludedQuota: number;
    monthlyCreditsUsed: number;
    purchasedCredits: number;
    reservedCredits: number;
    availableCredits: number;
    currentBalance: number;
    totalCreditsUsed: number;
    percentUsed: number;
    usedPercentage: number;
    remainingPercentage: number;
    isSoftLocked: boolean;
    isExhausted: boolean;
    dollarEquivalent: number;
    currency: string;
    usdEquivalentRate: number;
    recentLedger: AICreditLedgerItem[];
}
export interface AICreditLedgerItem {
    id: string;
    timestamp: string;
    appId: string;
    featureKey: string;
    operationType: "DEBIT" | "RECHARGE" | "GRANT" | "REFUND";
    creditsAmount: number;
    balanceAfter: number;
    metadata?: any;
}
export declare const AICreditOperationRates: {
    readonly DOCUMENT_FULL: 10;
    readonly DOCUMENT_REVISION: 1;
    readonly DOCUMENT_APPEND: 1;
    readonly WEBSITE_FULL: 20;
    readonly WEBSITE_PATCH: 2;
    readonly FORM_FULL: 10;
    readonly FORM_PATCH: 1;
    readonly CHAT: 1;
    readonly EMAIL_DRAFT: 2;
    readonly VIDEO_DIRECTOR: 25;
    readonly AUDIO_SYNTHESIS: 5;
};
export declare class AICreditMeterService {
    static readonly CREDITS_PER_USD = 1000;
    static readonly DEFAULT_FREE_QUOTA = 2000;
    static readonly DEFAULT_PRO_QUOTA = 5000;
    static readonly DEFAULT_AGENCY_QUOTA = 12000;
    static readonly RATES: {
        readonly DOCUMENT_FULL: 10;
        readonly DOCUMENT_REVISION: 1;
        readonly DOCUMENT_APPEND: 1;
        readonly WEBSITE_FULL: 20;
        readonly WEBSITE_PATCH: 2;
        readonly FORM_FULL: 10;
        readonly FORM_PATCH: 1;
        readonly CHAT: 1;
        readonly EMAIL_DRAFT: 2;
        readonly VIDEO_DIRECTOR: 25;
        readonly AUDIO_SYNTHESIS: 5;
    };
    private static activeReservations;
    /**
     * Helper: Resolves company record and parsed metadata
     */
    private static getCompanyAndMeta;
    /**
     * Retrieves high-level credit status and progression bar data for UI and API guards
     */
    static getAccountStatus(companyId?: string): Promise<AICreditAccountStatus>;
    /**
     * Pre-flight balance verification before initiating AI request
     */
    static checkBalance(companyId: string | undefined, estimatedCredits?: number): Promise<{
        sufficient: boolean;
        availableCredits: number;
        percentUsed: number;
    }>;
    /**
     * Creates an in-memory reservation hold for streaming / multi-step operations
     * Supports both (companyId, estimatedCredits) and ({ companyId, estimatedCreditCost })
     */
    static reserveCredits(paramsOrCompanyId: string | undefined | {
        companyId?: string;
        estimatedCredits?: number;
        estimatedCreditCost?: number;
        operation?: string;
    }, estimatedCreditsParam?: number): Promise<{
        reservationId: string;
        success: boolean;
    }>;
    /**
     * Releases an unconsumed reservation
     */
    static releaseReservation(reservationId: string): void;
    /**
     * Settles final credit deduction after AI operation completes
     * Supports both actualCredits and finalCreditCost, with defaults for appId and featureKey
     */
    static settleCredits(params: {
        reservationId?: string;
        companyId?: string;
        actualCredits?: number;
        finalCreditCost?: number;
        appId?: string;
        featureKey?: string;
        operation?: string;
        metadata?: any;
    }): Promise<{
        success: boolean;
        balanceAfter: number;
    }>;
    /**
     * Instant wallet recharge: adds purchased credits ($5 = 5,000 credits)
     */
    static rechargeCredits(paramsOrCompanyId: string | {
        companyId: string;
        amountUsd: number;
        paymentRef?: string;
        paymentMethod?: string;
    }, amountUsdParam?: number, paymentRefParam?: string): Promise<{
        success: boolean;
        creditsAdded: number;
        newPurchasedTotal: number;
        newBalance: number;
        currentBalance: number;
    }>;
}
