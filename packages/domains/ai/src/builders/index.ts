import { IUniversalBuilder, BuilderType, BuilderGenerationParams, BuilderResult } from './universal-builder.interface';
import { DocumentAIBuilderService } from './document-ai-builder.service';
import { FormAIBuilderService } from './form-ai-builder.service';
import { WebsiteAIBuilderService } from './website-ai-builder.service';
import { VideoAIDirectorService, videoAIDirectorService } from './video-ai-director.service';

export * from './universal-builder.interface';
export * from './document-ai-builder.service';
export * from './form-ai-builder.service';
export * from './website-ai-builder.service';
export * from './video-ai-director.service';
export * from './video-critic.service';
export * from './context-resolver';
export * from './creative-planner';

export class UniversalBuilderRegistry {
    private static builders: Map<BuilderType, IUniversalBuilder> = new Map();

    static register(builder: IUniversalBuilder) {
        this.builders.set(builder.builderType, builder);
    }

    static getBuilder(type: BuilderType): IUniversalBuilder {
        const builder = this.builders.get(type);
        if (!builder) {
            throw new Error(`No AI builder registered for type: ${type}`);
        }
        return builder;
    }

    static async compile(type: BuilderType, params: BuilderGenerationParams): Promise<BuilderResult> {
        const builder = this.getBuilder(type);
        return await builder.compileAST(params);
    }

    static async patch(type: BuilderType, entityId: string, instruction: string, params: BuilderGenerationParams): Promise<BuilderResult> {
        const builder = this.getBuilder(type);
        return await builder.patchAST(entityId, instruction, params);
    }

    static async delete(type: BuilderType, entityId: string, companyId: string) {
        const builder = this.getBuilder(type);
        return await builder.deleteEntity(entityId, companyId);
    }

    static async dispatch(type: BuilderType, entityId: string, recipientEmail: string, params: Record<string, any>) {
        const builder = this.getBuilder(type);
        if (!builder.dispatchEntity) {
            throw new Error(`Builder ${type} does not support dispatchEntity.`);
        }
        return await builder.dispatchEntity(entityId, recipientEmail, params);
    }
}

// Singleton builder instances
export const documentAIBuilderService = new DocumentAIBuilderService();
export const formAIBuilderService = new FormAIBuilderService();
export const websiteAIBuilderService = new WebsiteAIBuilderService();

// Automatically register core domain builders
UniversalBuilderRegistry.register(documentAIBuilderService);
UniversalBuilderRegistry.register(formAIBuilderService);
UniversalBuilderRegistry.register(websiteAIBuilderService);
UniversalBuilderRegistry.register(videoAIDirectorService);

