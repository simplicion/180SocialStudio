import { prisma } from '@workspace/db';
import { AutomationService } from '@workspace/automations';
import { aiAutomationService as AIAutomationService } from '@workspace/ai';
import { paginateWithCursor, extractPaginationParams } from '@workspace/backend-infra';
// Assume these might exist, for now just stub them or import from original path if they exist
// const googleDriveService = require('../../../../../platform-core/platform-storage/services/google-drive.service');
// const { getPresignedUploadUrl } = require('../../../../../platform-core/platform-storage/services/r2');
// For simplicity, we can keep the logic here without breaking it too much

export class StorageService {
    static async uploadFile(params: any) {
        const { userId, file, storageResult, taggedUsers, name, relatedId, relatedModel, description, tags, isConfidential, folder: bodyFolder } = params;

        if (!storageResult) {
            throw new Error('File upload failed — Storage not configured');
        }

        let hierarchicalFolder = bodyFolder || 'company/general';
        if (relatedModel === 'Project' && relatedId) {
            const project = await prisma.project.findUnique({ where: { id: relatedId } });
            if (project) {
                const clientId = project.clientIds && project.clientIds.length > 0 ? project.clientIds[0] : 'public';
                hierarchicalFolder = `company/clients/${clientId}/${project.id}/documents`;
            }
        }

        const safeTags = Array.isArray(tags) ? tags : (typeof tags === 'string' && tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []);

        const doc = await prisma.document.create({ data: {
            name: name || file?.originalname || 'Untitled File',
            fileUrl: storageResult.fileUrl,
            fileId: storageResult.fileId || '',
            storageType: storageResult.storageType || 'r2',
            fileType: file?.mimetype || '',
            fileSize: file?.size || 0,
            folder: hierarchicalFolder,
            uploadedById: userId,
            relatedId: relatedId || null,
            relatedModel: relatedModel || '',
            description: description || '',
            tags: safeTags,
            isConfidential: isConfidential === 'true' || isConfidential === true,
            isLinkOnly: false
        } });

        await AutomationService.trigger({
            eventType: 'document_uploaded',
            triggeredBy: userId,
            relatedItem: { itemId: doc.id, itemModel: 'Document' },
            description: `Document "${doc.name}" was uploaded to: ${doc.folder}`,
            metadata: { fileName: doc.name, folder: doc.folder, fileUrl: doc.fileUrl }
        });

        // Background AI classification
        (async () => {
            try {
                const settings = await prisma.settings.findFirst();
                const aiResult = await AIAutomationService.classifyDocument(doc.description || doc.name, settings as any);
                if (aiResult.category && aiResult.category !== 'General') {
                    await prisma.document.update({ where: { id: doc.id }, data: { category: aiResult.category } });
                }
            } catch (e: any) {
                console.error('AI Classification Error:', e.message);
            }
        })();

        if (taggedUsers && taggedUsers.length > 0) {
            for (const tUserId of taggedUsers) {
                await AutomationService.trigger({
                    eventType: 'document_shared',
                    triggeredBy: userId,
                    targetUser: tUserId,
                    relatedItem: { itemId: doc.id, itemModel: 'Document' },
                    description: `A user shared a document with you: ${doc.name}`,
                    metadata: { fileName: doc.name, fileUrl: doc.fileUrl }
                });
            }
        }

        const storageMsg = storageResult.isFallback
            ? `NOTE: Cloud storage unavailable. File stored securely on local system: ${storageResult.fileId}`
            : `File stored successfully on ${storageResult.storageType === 'google_drive' ? 'Google Drive' : 'Cloudinary'}`;

        return {
            document: doc,
            url: doc.fileUrl,
            message: storageMsg
        };
    }

    static async addFileLink(params: any) {
        const { userId, name, fileUrl, folder = 'general', relatedId, relatedModel, description, tags, isConfidential, category = 'General' } = params;

        const doc = await prisma.document.create({ data: {
            name,
            fileUrl,
            fileId: '',
            storageType: 'external',
            fileType: 'link',
            fileSize: 0,
            folder,
            category,
            uploadedById: userId,
            relatedId: relatedId || null,
            relatedModel: relatedModel || '',
            description: description || '',
            tags: tags || [],
            isConfidential: !!isConfidential,
            isLinkOnly: true
        } });
        return doc;
    }

    static async getFiles(params: any) {
        const { folder, relatedId, relatedModel, tags, search, authUser } = params;
        const query: any = { deletedAt: null };

        if (folder) query.folder = folder;
        if (relatedId) query.relatedId = relatedId;
        if (relatedModel) query.relatedModel = relatedModel;

        if (tags) {
            const tagList = Array.isArray(tags) ? tags : (tags as string).split(',');
            query.tags = { hasSome: tagList };
        }

        if (search) {
            query.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } }
            ];
        }

        const hasFullAccess = authUser.roles && (authUser.roles.includes('admin') || authUser.roles.includes('finance') || authUser.roles.includes('manager'));
        const isPrivileged = ['admin', 'manager', 'finance'].includes(authUser.role || '');

        if (!hasFullAccess && !isPrivileged) {
            query.isConfidential = false;
        }

        const selectIncludes = {
            uploadedBy: { select: { name: true, email: true } }
        };

        if (params.cursor) {
            const paginationResult = await paginateWithCursor(prisma.document, {
                where: query,
                cursor: params.cursor,
                limit: Math.min(Number(params.limit) || 50, 100),
                direction: params.direction || 'forward',
                include: selectIncludes,
                includeTotalCount: Boolean(params.includeTotalCount)
            });

            return {
                files: paginationResult.items,
                pageInfo: paginationResult.pageInfo,
                total: paginationResult.pageInfo.totalCount
            };
        }

        const limit = Math.min(Number(params.limit) || 100, 100);
        return await prisma.document.findMany({
            where: query,
            include: selectIncludes,
            orderBy: { createdAt: 'desc' },
            take: limit
        });
    }

    static async deleteFile(params: any) {
        const { id } = params;
        const doc = await prisma.document.findFirst({ where: { id } });
        if (!doc) throw new Error('File not found');

        // External integrations are mocked/skipped for now, ideally handled via an event bus or IntegrationService
        await prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
        return { message: 'File deleted successfully' };
    }

    static async signFile(params: any) {
        const { id, userId, userName } = params;
        const doc = await prisma.document.findFirst({ where: { id } });
        if (!doc) throw new Error('Document not found');

        await AutomationService.trigger({
            eventType: 'document_signed',
            triggeredBy: userId,
            relatedItem: { itemId: doc.id, itemModel: 'Document' },
            description: `Document "${doc.name}" has been signed by ${userName}.`,
            metadata: { fileName: doc.name, signer: userName }
        });

        return doc;
    }

    static async attachExistingFile(params: any) {
        const { userId, documentId, relatedId, relatedModel } = params;

        const sourceDoc = await prisma.document.findFirst({ where: { id: documentId } });
        if (!sourceDoc) throw new Error('Source document not found');

        const newDoc = await prisma.document.create({ data: {
            name: sourceDoc.name,
            fileUrl: sourceDoc.fileUrl,
            fileId: sourceDoc.fileId,
            storageType: sourceDoc.storageType,
            fileType: sourceDoc.fileType,
            fileSize: sourceDoc.fileSize,
            folder: sourceDoc.folder,
            category: sourceDoc.category,
            uploadedById: userId,
            relatedId,
            relatedModel,
            description: sourceDoc.description,
            tags: sourceDoc.tags,
            isConfidential: sourceDoc.isConfidential,
            isLinkOnly: sourceDoc.isLinkOnly
        } });

        await AutomationService.trigger({
            eventType: 'document_uploaded',
            triggeredBy: userId,
            relatedItem: { itemId: newDoc.id, itemModel: 'Document' },
            description: `Document "${newDoc.name}" was attached to ${relatedModel}`,
            metadata: { fileName: newDoc.name, folder: newDoc.folder, fileUrl: newDoc.fileUrl }
        });

        return newDoc;
    }
}
