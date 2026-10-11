// @ts-nocheck
import { EntityReference } from '../types/context.types';

export class OrbitEntityLinker {
    /**
     * Resolves natural language inquiries asking for links, URLs, or documents
     * and maps them directly to active entity references from recent context.
     */
    static resolveDirectLink(
        prompt: string,
        reply: string,
        entities: EntityReference[]
    ): { enrichedReply: string; documentPreview?: any } {
        const lowerPrompt = (prompt || '').toLowerCase().trim();
        const lowerReply = (reply || '').toLowerCase().trim();

        const isAskingForLink = (
            lowerPrompt.includes('link') ||
            lowerPrompt.includes('url') ||
            lowerPrompt.includes('where is') ||
            lowerPrompt.includes('open') ||
            lowerPrompt.includes('show me') ||
            lowerPrompt.includes('give me') ||
            lowerPrompt.includes('offer letter') ||
            lowerPrompt.includes('operator') ||
            lowerPrompt.includes('contract') ||
            lowerPrompt.includes('document') ||
            lowerPrompt.includes('form') ||
            lowerPrompt.includes('website')
        );

        const hasLinkAlready = reply.includes('(/document-editor') ||
                               reply.includes('(/forms') ||
                               reply.includes('(/projects') ||
                               reply.includes('(/advertising') ||
                               reply.includes('http');

        const isAmnesiaReply = lowerReply.includes('no specific offer letter') ||
                               lowerReply.includes('there is no specific') ||
                               lowerReply.includes('could you please provide the document id') ||
                               lowerReply.includes('provide more details regarding the operator');

        if ((!isAskingForLink && !isAmnesiaReply) || entities.length === 0) {
            return { enrichedReply: reply };
        }

        // Match target entity based on keywords
        let targetEntity = entities[0];
        const words = lowerPrompt.split(/\s+/);

        for (const entity of entities) {
            const titleLower = (entity.title || '').toLowerCase();
            const matchingWord = words.find(w => w.length >= 4 && titleLower.includes(w));
            if (matchingWord || (titleLower.includes('offer') && (lowerPrompt.includes('offer') || lowerPrompt.includes('operator') || lowerPrompt.includes('hired')))) {
                targetEntity = entity;
                break;
            }
        }

        if (!targetEntity) {
            return { enrichedReply: reply };
        }

        const editUrl = targetEntity.url || (targetEntity.kind === 'document' ? `/document-editor?id=${targetEntity.id}` : `/forms/${targetEntity.id}`);
        const documentPreview = {
            id: targetEntity.id,
            title: targetEntity.title || 'Official Document',
            type: targetEntity.kind,
            editUrl
        };

        if (isAmnesiaReply) {
            const fixedReply = `📄 **${targetEntity.title}**\n\nHere is your direct link to view and manage this resource in 180 Workspace:\n\n👉 [**Open "${targetEntity.title}"**](${editUrl})\n\n*(Resource ID: \`${targetEntity.id}\`)*`;
            return { enrichedReply: fixedReply, documentPreview };
        }

        if (!hasLinkAlready) {
            const enriched = reply + `\n\n👉 **Direct Link:** [Open "${targetEntity.title}"](${editUrl})`;
            return { enrichedReply: enriched, documentPreview };
        }

        return { enrichedReply: reply, documentPreview };
    }
}
