export declare class AICRMCopilotService {
    /**
     * Drafts customized sales & follow-up emails using client context
     */
    static generateEmailDraft(params: {
        recipientName: string;
        recipientEmail: string;
        purpose: string;
        dealValue?: string;
        companyId?: string;
    }): Promise<{
        success: boolean;
        subject: string;
        body: string;
    }>;
}
