import { IUniversalBuilder, BuilderGenerationParams, BuilderResult } from './universal-builder.interface';
export interface FormASTField {
    id?: string;
    label: string;
    name?: string;
    type: 'TEXT' | 'TEXTAREA' | 'EMAIL' | 'PHONE' | 'NUMBER' | 'DATE' | 'SELECT' | 'RADIO' | 'CHECKBOX' | 'RATING' | 'FILE_UPLOAD' | 'HEADING' | 'DIVIDER' | 'PARAGRAPH';
    required: boolean;
    placeholder?: string;
    description?: string;
    options?: any;
    order: number;
    mapping?: string;
    pageId?: string;
    validation?: any;
}
export declare class FormAIBuilderService implements IUniversalBuilder {
    readonly builderType = "form";
    private generate10CharId;
    private generateApiKey;
    private isGreetingOrChitchat;
    private extractJSON;
    compileAST(params: BuilderGenerationParams): Promise<BuilderResult>;
    patchAST(entityId: string, instruction: string, params: BuilderGenerationParams): Promise<BuilderResult>;
    deleteEntity(entityId: string, companyId: string): Promise<{
        success: boolean;
        message: string;
    }>;
}
