export declare class AIChatService {
    /**
     * Resolves settings and metadata for a user's company
     */
    static getSettingsWithMetadata(user: any, companyIdParam?: string): Promise<any>;
    /**
     * Retrieves all chat sessions for a user
     */
    static getChatSessions(userId: string): Promise<any>;
    /**
     * Retrieves a single chat session with its messages
     */
    static getChatSession(userId: string, sessionId: string): Promise<any>;
    /**
     * Deletes a chat session
     */
    static deleteChatSession(userId: string, sessionId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * Core conversational assistant supporting streaming, sessions, multi-domain context,
     * tool calling, agent modes, entity mentions, and semantic search.
     */
    static chatWithAI(user: any, { message, history, sessionId, isLegalMode, fileContext, stream }: any, onChunk?: (chunk: string) => void): Promise<{
        reply: any;
        sessionId: any;
        directive: any;
        documentPreview?: undefined;
    } | {
        reply: any;
        sessionId: any;
        directive?: undefined;
        documentPreview?: undefined;
    } | {
        reply: string;
        sessionId: any;
        documentPreview: any;
        directive?: undefined;
    }>;
    /**
     * Extracts and analyzes text from documents (PDF, DOCX, HTML, plain text)
     */
    static analyzeDocumentText(user: any, documentId: string, message: string, summarizeOnly: boolean, history: any[], serverPort?: string | number): Promise<string>;
    /**
     * Uploads and parses a file into working memory and indexes it in the vector store
     */
    static uploadDocument(user: any, file: any, companyIdParam?: string): Promise<{
        filename: any;
        extractedText: string;
        imageBase64: any;
        vectorId?: undefined;
    } | {
        filename: any;
        extractedText: string;
        vectorId: string;
        imageBase64?: undefined;
    }>;
    /**
     * Helper to draft email using customizable tone & recipient info
     */
    static generateEmailDraft(user: any, { idea, recipientName, tone, context }: any): Promise<string>;
    /**
     * Processes meeting transcripts and auto-creates tasks
     */
    static processMeetingTranscript(user: any, file: any, bodyText?: string): Promise<{
        summary: string;
        createdTasks: number;
    }>;
}
export declare const aiChatService: typeof AIChatService;
export declare const AiAssistantService: typeof AIChatService;
export declare const aiAssistantService: typeof AIChatService;
