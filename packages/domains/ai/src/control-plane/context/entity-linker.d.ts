import { EntityReference } from '../types/context.types';
export declare class OrbitEntityLinker {
    /**
     * Resolves natural language inquiries asking for links, URLs, or documents
     * and maps them directly to active entity references from recent context.
     */
    static resolveDirectLink(prompt: string, reply: string, entities: EntityReference[]): {
        enrichedReply: string;
        documentPreview?: any;
    };
}
