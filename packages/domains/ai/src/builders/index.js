"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.websiteAIBuilderService = exports.formAIBuilderService = exports.documentAIBuilderService = exports.UniversalBuilderRegistry = void 0;
const document_ai_builder_service_1 = require("./document-ai-builder.service");
const form_ai_builder_service_1 = require("./form-ai-builder.service");
const website_ai_builder_service_1 = require("./website-ai-builder.service");
const video_ai_director_service_1 = require("./video-ai-director.service");
__exportStar(require("./universal-builder.interface"), exports);
__exportStar(require("./document-ai-builder.service"), exports);
__exportStar(require("./form-ai-builder.service"), exports);
__exportStar(require("./website-ai-builder.service"), exports);
__exportStar(require("./video-ai-director.service"), exports);
__exportStar(require("./video-critic.service"), exports);
__exportStar(require("./context-resolver"), exports);
__exportStar(require("./creative-planner"), exports);
class UniversalBuilderRegistry {
    static builders = new Map();
    static register(builder) {
        this.builders.set(builder.builderType, builder);
    }
    static getBuilder(type) {
        const builder = this.builders.get(type);
        if (!builder) {
            throw new Error(`No AI builder registered for type: ${type}`);
        }
        return builder;
    }
    static async compile(type, params) {
        const builder = this.getBuilder(type);
        return await builder.compileAST(params);
    }
    static async patch(type, entityId, instruction, params) {
        const builder = this.getBuilder(type);
        return await builder.patchAST(entityId, instruction, params);
    }
    static async delete(type, entityId, companyId) {
        const builder = this.getBuilder(type);
        return await builder.deleteEntity(entityId, companyId);
    }
    static async dispatch(type, entityId, recipientEmail, params) {
        const builder = this.getBuilder(type);
        if (!builder.dispatchEntity) {
            throw new Error(`Builder ${type} does not support dispatchEntity.`);
        }
        return await builder.dispatchEntity(entityId, recipientEmail, params);
    }
}
exports.UniversalBuilderRegistry = UniversalBuilderRegistry;
// Singleton builder instances
exports.documentAIBuilderService = new document_ai_builder_service_1.DocumentAIBuilderService();
exports.formAIBuilderService = new form_ai_builder_service_1.FormAIBuilderService();
exports.websiteAIBuilderService = new website_ai_builder_service_1.WebsiteAIBuilderService();
// Automatically register core domain builders
UniversalBuilderRegistry.register(exports.documentAIBuilderService);
UniversalBuilderRegistry.register(exports.formAIBuilderService);
UniversalBuilderRegistry.register(exports.websiteAIBuilderService);
UniversalBuilderRegistry.register(video_ai_director_service_1.videoAIDirectorService);
