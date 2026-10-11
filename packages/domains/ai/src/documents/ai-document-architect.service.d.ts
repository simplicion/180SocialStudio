export interface AIDocumentGenerationParams {
    prompt: string;
    documentType?: string;
    clientId?: string;
    employeeId?: string;
    companyId?: string;
    userId?: string;
    existingBlocks?: any[];
    mode?: string;
    sessionId?: string;
}
export declare class AIDocumentArchitectService {
    /**
     * Synthesizes or refines document AST blocks with multi-turn consciousness
     * and automatically saves the document to the database.
     */
    static generate(params: AIDocumentGenerationParams): Promise<{
        success: boolean;
        message: string;
        intent?: undefined;
        mode?: undefined;
        reply?: undefined;
        explanation?: undefined;
        blocks?: undefined;
        newBlocks?: undefined;
        documentId?: undefined;
        documentUrl?: undefined;
        title?: undefined;
        documentType?: undefined;
        draft?: undefined;
    } | {
        success: boolean;
        intent: string;
        mode: string;
        reply: string;
        explanation: string;
        blocks: any[];
        newBlocks: any[];
        message?: undefined;
        documentId?: undefined;
        documentUrl?: undefined;
        title?: undefined;
        documentType?: undefined;
        draft?: undefined;
    } | {
        success: boolean;
        intent: string;
        mode: string;
        documentId: any;
        documentUrl: string;
        title: any;
        documentType: any;
        reply: string;
        explanation: string;
        blocks: any;
        newBlocks: any;
        draft: {
            id: any;
            title: any;
            type: any;
            blocksCount: any;
            blocks: any;
            documentUrl: string;
            clientName: any;
        };
        message?: undefined;
    }>;
    private static generateDeterministicAST;
}
