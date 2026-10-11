import { AISettings } from './ai-provider.service';
export interface CompanyAIStatus {
    isConfigured: boolean;
    provider: string;
    model: string;
    status: 'connected' | 'ready' | 'unconfigured' | 'error';
    lastTested: string | null;
    companyName?: string;
}
export declare class AICompanyConfigService {
    /**
     * Resolves the company AI configuration and returns typed AISettings
     */
    static getCompanyAISettings(companyId?: string): Promise<{
        settings: AISettings;
        companyName: string;
        metadata: any;
    }>;
    /**
     * Gets the high-level AI status for frontend indicators
     */
    static getStatus(companyId?: string): Promise<CompanyAIStatus>;
}
