import { IUniversalBuilder, BuilderGenerationParams, BuilderResult } from './universal-builder.interface';
export declare class DocumentAIBuilderService implements IUniversalBuilder {
    readonly builderType = "document";
    /**
     * Compiles, validates, and persists a Document AST from natural language
     */
    compileAST(params: BuilderGenerationParams): Promise<BuilderResult>;
    private isGreetingOrChitchat;
    /**
     * Patches or updates specific blocks in an existing document
     */
    patchAST(entityId: string, instruction: string, params: BuilderGenerationParams): Promise<BuilderResult>;
    /**
     * Deletes a document
     */
    deleteEntity(entityId: string, companyId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    /**
     * Dispatches / sends document to client via email & share link
     */
    dispatchEntity(entityId: string, recipientEmail: string, params: Record<string, any>): Promise<{
        success: boolean;
        shareUrl: string;
        message: string;
    }>;
    private generateDeterministicAST;
}
