import { IUniversalBuilder, BuilderType, BuilderGenerationParams, BuilderResult } from './universal-builder.interface';
import { DocumentAIBuilderService } from './document-ai-builder.service';
import { FormAIBuilderService } from './form-ai-builder.service';
import { WebsiteAIBuilderService } from './website-ai-builder.service';
export * from './universal-builder.interface';
export * from './document-ai-builder.service';
export * from './form-ai-builder.service';
export * from './website-ai-builder.service';
export * from './video-ai-director.service';
export * from './video-critic.service';
export * from './context-resolver';
export * from './creative-planner';
export declare class UniversalBuilderRegistry {
    private static builders;
    static register(builder: IUniversalBuilder): void;
    static getBuilder(type: BuilderType): IUniversalBuilder;
    static compile(type: BuilderType, params: BuilderGenerationParams): Promise<BuilderResult>;
    static patch(type: BuilderType, entityId: string, instruction: string, params: BuilderGenerationParams): Promise<BuilderResult>;
    static delete(type: BuilderType, entityId: string, companyId: string): Promise<{
        success: boolean;
        message: string;
    }>;
    static dispatch(type: BuilderType, entityId: string, recipientEmail: string, params: Record<string, any>): Promise<{
        success: boolean;
        shareUrl: string;
        message: string;
    }>;
}
export declare const documentAIBuilderService: DocumentAIBuilderService;
export declare const formAIBuilderService: FormAIBuilderService;
export declare const websiteAIBuilderService: WebsiteAIBuilderService;
