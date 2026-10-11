export declare class AIDocumentChatService {
    /**
     * Analyzes uploaded PDF or text documents and answers questions with citation context
     */
    static analyzeDocument(params: {
        fileText: string;
        fileName: string;
        query: string;
        companyId?: string;
    }): Promise<{
        success: boolean;
        message: string;
        answer?: undefined;
        fileName?: undefined;
    } | {
        success: boolean;
        answer: string;
        fileName: string;
        message?: undefined;
    }>;
}
