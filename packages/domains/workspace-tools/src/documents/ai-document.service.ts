import { AIDocumentArchitectService, AICompanyConfigService } from '@workspace/ai';

export class AIDocumentService {
    /**
     * Delegates to centralized @workspace/ai domain
     */
    static async getAIStatus(companyId?: string) {
        return await AICompanyConfigService.getStatus(companyId);
    }

    /**
     * Delegates document generation to centralized @workspace/ai domain
     */
    static async generateFromPrompt(params: any) {
        return await AIDocumentArchitectService.generate(params);
    }
}
