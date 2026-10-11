import { prisma, requestContext } from '@workspace/db';
import { SocialDomainError, notFound, pieceScope } from './tenant-scope';

export interface CreateEditingTaskDTO {
    contentPieceId?: string;
    socialPostId?: string;
    projectId: string;
    clientId?: string;
    assigneeId: string;
    deadline?: Date | string;
    priority?: string;
    editingInstructions?: string;
    sourceMediaUrls?: string[];
    targetPlatformFormats?: string[];
}

export class EditingTaskService {
    /**
     * Bridges content creative to the central Task Management System
     */
    static async createEditingTask(data: CreateEditingTaskDTO, userId: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');

        if (data.projectId && !(await (prisma as any).project.findFirst({ where: { id: data.projectId, companyId }, select: { id: true } }))) {
            throw notFound('Project');
        }

        // 1. Resolve content details for task prepopulation
        let contentTitle = 'Social Media Video';
        let scriptExcerpt = '';

        if (data.socialPostId) {
            const post = await (prisma as any).socialPost.findFirst({
                where: { id: data.socialPostId, companyId }
            });
            if (!post) throw notFound('Post');
            {
                contentTitle = post.title || post.content?.slice(0, 40) || contentTitle;
                scriptExcerpt = post.content || '';
            }
        } else if (data.contentPieceId) {
            const piece = await (prisma as any).calendarContentPiece.findFirst({
                where: pieceScope(data.contentPieceId, companyId)
            });
            if (!piece) throw notFound('Calendar piece');
            {
                contentTitle = piece.headline || piece.videoScriptOrHooks?.slice(0, 40) || contentTitle;
                scriptExcerpt = piece.videoScriptOrHooks || piece.adCopyFull || '';
            }
        }

        const taskTitle = `Video Edit: ${contentTitle}`;
        const description = `${data.editingInstructions || 'Produce short-form video deliverable according to the approved script.'}\n\n--- SCRIPT EXCERPT ---\n${scriptExcerpt}`;

        // 2. Invoke central TaskService
        const task = await (prisma as any).task.create({
            data: {
                companyId,
                projectId: data.projectId,
                clientId: data.clientId || null,
                assigneeId: data.assigneeId,
                creatorId: userId,
                title: taskTitle,
                description,
                status: 'assigned',
                priority: data.priority || 'high',
                dueDate: data.deadline ? new Date(data.deadline) : null,
                contentPieceId: data.contentPieceId || null,
                socialPostId: data.socialPostId || null,
                editingInstructions: data.editingInstructions || '',
                sourceMediaUrls: data.sourceMediaUrls || []
            },
            include: {
                assignee: { select: { id: true, name: true, email: true, image: true, photoUrl: true } },
                project: { select: { id: true, name: true } }
            }
        });

        // 3. Mark the linked post / calendar piece as in_editing
        if (data.socialPostId) {
            await (prisma as any).socialPost.updateMany({
                where: { id: data.socialPostId, companyId },
                data: { status: 'in_editing' }
            }).catch(() => null);
        }

        if (data.contentPieceId) {
            await (prisma as any).calendarContentPiece.updateMany({
                where: pieceScope(data.contentPieceId, companyId),
                data: { status: 'in_progress' }
            }).catch(() => null);
        }

        return task;
    }

    /**
     * Editor submits the rendered video deliverable
     */
    static async submitEditorDeliverable(taskId: string, deliverableUrl: string, thumbnailUrl?: string, notes?: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');

        const task = await (prisma as any).task.findUnique({
            where: { id: taskId }
        });

        if (!task || task.companyId !== companyId) {
            throw notFound('Task');
        }

        // 1. Update task deliverable & transition status
        const updatedTask = await (prisma as any).task.update({
            where: { id: taskId },
            data: {
                deliverableUrl,
                status: 'submitted_for_review'
            }
        });

        // 2. Sync final video URL to linked SocialPost
        if (task.socialPostId) {
            await (prisma as any).socialPost.updateMany({
                where: { id: task.socialPostId, companyId },
                data: {
                    finalVideoUrl: deliverableUrl,
                    thumbnailUrl: thumbnailUrl || null,
                    status: 'in_review',
                    revisionNotes: notes || null
                }
            }).catch(() => null);
        }

        // 3. Sync to linked CalendarContentPiece if exists
        if (task.contentPieceId) {
            await (prisma as any).calendarContentPiece.updateMany({
                where: pieceScope(task.contentPieceId, companyId),
                data: {
                    finalVideoUrl: deliverableUrl,
                    thumbnailUrl: thumbnailUrl || null,
                    status: 'pending_review'
                }
            }).catch(() => null);
        }

        return {
            success: true,
            task: updatedTask,
            deliverableUrl,
            message: 'Deliverable submitted for review successfully'
        };
    }

    /**
     * Prepares launch context payload for 180 Media Studio (Remotion + AI Director)
     */
    static async buildMediaStudioLaunchContext(contentPieceId?: string, postId?: string) {
        const companyId = requestContext.getStore()?.companyId as string;
        if (!companyId) throw new SocialDomainError('UNAUTHENTICATED', 401, 'Company context required');

        let title = 'New Project';
        let rawMediaUrls: string[] = [];
        let script = '';
        let targetRatio = '9:16';
        let projectId: string | null = null;

        if (postId) {
            const post = await (prisma as any).socialPost.findFirst({
                where: { id: postId, companyId },
                include: { project: true }
            });
            if (!post) throw notFound('Post');
            {
                title = post.title || 'Social Video';
                rawMediaUrls = post.rawMediaUrls || [];
                script = post.content || '';
                projectId = post.projectId;
            }
        } else if (contentPieceId) {
            const piece = await (prisma as any).calendarContentPiece.findFirst({
                where: pieceScope(contentPieceId, companyId),
                include: { calendar: true }
            });
            if (!piece) throw notFound('Calendar piece');
            {
                title = piece.headline || 'Social Video';
                rawMediaUrls = piece.rawMediaUrls || [];
                script = piece.videoScriptOrHooks || piece.adCopyFull || '';
                projectId = piece.calendar?.projectId || null;
            }
        }

        return {
            projectName: title,
            projectId,
            aspectRatio: targetRatio,
            sourceClips: rawMediaUrls.map((url, idx) => ({
                id: `clip-${idx + 1}`,
                name: `Source Clip ${idx + 1}`,
                url,
                type: 'video'
            })),
            aiDirectorContext: {
                scriptSummary: script,
                recommendedPacing: 'MRBEAST_FAST',
                suggestedCaptions: true
            }
        };
    }
}
