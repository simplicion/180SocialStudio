/**
 * Mandatory Cross-Project & Multi-Tenant Security Isolation Tests for YouTube.
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/youtube/youtube-cross-project-security.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@workspace/db';
import { YouTubePublishingTools, YouTubeIntegrationError } from '../../src/youtube';

test('MANDATORY SECURITY: Project A cannot publish using Project B YouTube channel', async () => {
    const companyId = `comp_${Date.now()}`;
    const projectA = `proj_A_${Date.now()}`;
    const projectB = `proj_B_${Date.now()}`;

    // Mock Prisma findFirst to simulate Project A and Project B accounts
    const originalFindFirst = (prisma as any).socialAccount.findFirst;
    const originalProjectFindFirst = (prisma as any).project.findFirst;

    try {
        (prisma as any).socialAccount.findFirst = async (args: any) => {
            const { id, companyId: cId, projectId: pId } = args.where;
            // Channel B belongs exclusively to Project B
            if (id === 'channel_B' && pId === projectB && cId === companyId) {
                return {
                    id: 'channel_B',
                    companyId,
                    projectId: projectB,
                    platform: 'youtube',
                    platformAccountId: 'UC_channel_B',
                    accountName: 'Company B YouTube Channel',
                    username: '@comp_b',
                    scopes: [
                        'https://www.googleapis.com/auth/youtube.upload',
                        'https://www.googleapis.com/auth/youtube.readonly',
                        'https://www.googleapis.com/auth/youtube.force-ssl',
                    ],
                    isActive: true,
                    reauthRequired: false,
                };
            }
            // Channel A belongs exclusively to Project A
            if (id === 'channel_A' && pId === projectA && cId === companyId) {
                return {
                    id: 'channel_A',
                    companyId,
                    projectId: projectA,
                    platform: 'youtube',
                    platformAccountId: 'UC_channel_A',
                    accountName: 'Company A YouTube Channel',
                    username: '@comp_a',
                    scopes: [
                        'https://www.googleapis.com/auth/youtube.upload',
                        'https://www.googleapis.com/auth/youtube.readonly',
                        'https://www.googleapis.com/auth/youtube.force-ssl',
                    ],
                    isActive: true,
                    reauthRequired: false,
                };
            }
            return null;
        };

        (prisma as any).project.findFirst = async (args: any) => ({
            id: args.where.id,
            companyId: args.where.companyId,
            socialSettings: { approvalRequired: true },
        });

        // 1. Cross-Project Publish Attempt: Project A attempts to publish using Channel B
        await assert.rejects(
            () => YouTubePublishingTools.uploadVideo(
                {
                    companyId,
                    projectId: projectA, // Project A
                    userId: 'user_123',
                    socialAccountId: 'channel_B', // Channel B (Belongs to Project B)
                },
                {
                    title: 'Unauthorized cross-project upload attempt',
                    description: 'This must be strictly blocked.',
                    mediaUrl: 'https://cdn.test/leak.mp4',
                }
            ),
            (err: any) => {
                assert.ok(err instanceof YouTubeIntegrationError);
                assert.equal(err.code, 'YOUTUBE_NOT_CONNECTED');
                assert.equal(err.httpStatus, 404);
                return true;
            },
            'Project A must be strictly forbidden from publishing to Project B YouTube channel'
        );

        // 2. Cross-Project Read Attempt: Project B attempts to read Channel A details
        await assert.rejects(
            () => YouTubePublishingTools.getChannel({
                companyId,
                projectId: projectB, // Project B
                userId: 'user_456',
                socialAccountId: 'channel_A', // Channel A (Belongs to Project A)
            }),
            (err: any) => {
                assert.ok(err instanceof YouTubeIntegrationError);
                assert.equal(err.code, 'YOUTUBE_NOT_CONNECTED');
                assert.equal(err.httpStatus, 404);
                return true;
            },
            'Project B must be strictly forbidden from reading Project A YouTube channel'
        );

        // 3. Cross-Tenant Attempt: Another company attempts to access Channel A
        await assert.rejects(
            () => YouTubePublishingTools.getChannel({
                companyId: 'foreign_company_xyz',
                projectId: projectA,
                userId: 'foreign_user',
                socialAccountId: 'channel_A',
            }),
            (err: any) => {
                assert.ok(err instanceof YouTubeIntegrationError);
                assert.equal(err.code, 'YOUTUBE_NOT_CONNECTED');
                return true;
            },
            'Foreign tenant must never access another company YouTube channel'
        );

        // 4. Authorized Project Publish: Project A publishing through Channel A succeeds
        const legitimatePost = await YouTubePublishingTools.uploadVideo(
            {
                companyId,
                projectId: projectA,
                userId: 'user_123',
                socialAccountId: 'channel_A',
            },
            {
                title: 'Legitimate Project A YouTube Video',
                description: 'Uploaded securely with proper isolation.',
                mediaUrl: 'https://cdn.test/legit.mp4',
            }
        );
        assert.ok(legitimatePost.videoId);
        assert.ok(legitimatePost.liveUrl);

    } finally {
        (prisma as any).socialAccount.findFirst = originalFindFirst;
        (prisma as any).project.findFirst = originalProjectFindFirst;
    }
});

test('MANDATORY SECURITY: AI agent cannot bypass MANUAL autonomy mode to auto-publish', async () => {
    const originalFindFirst = (prisma as any).socialAccount.findFirst;
    const originalProjectFindFirst = (prisma as any).project.findFirst;

    try {
        (prisma as any).socialAccount.findFirst = async () => ({
            id: 'channel_manual',
            companyId: 'company_1',
            projectId: 'project_manual',
            platform: 'youtube',
            platformAccountId: 'UC_manual_channel',
            accountName: '180 Official',
            username: '@180official',
            scopes: ['https://www.googleapis.com/auth/youtube.upload'],
            isActive: true,
            reauthRequired: false,
        });

        (prisma as any).project.findFirst = async () => ({
            id: 'project_manual',
            companyId: 'company_1',
            socialSettings: { approvalRequired: true },
        });

        // Automated AI agent attempts to publish while project is in MANUAL autonomy mode
        await assert.rejects(
            () => YouTubePublishingTools.uploadVideo(
                {
                    companyId: 'company_1',
                    projectId: 'project_manual',
                    userId: 'ai_agent_42',
                    socialAccountId: 'channel_manual',
                    autonomyMode: 'MANUAL',
                    isAiAgent: true,
                },
                {
                    title: 'Automated video attempt without human review',
                    description: 'Should be blocked.',
                    mediaUrl: 'https://cdn.test/auto.mp4',
                }
            ),
            (err: any) => {
                assert.ok(err instanceof YouTubeIntegrationError);
                assert.equal(err.code, 'YOUTUBE_PERMISSION_DENIED');
                assert.equal(err.httpStatus, 403);
                return true;
            },
            'AI automated agent must be blocked when autonomy mode is MANUAL'
        );
    } finally {
        (prisma as any).socialAccount.findFirst = originalFindFirst;
        (prisma as any).project.findFirst = originalProjectFindFirst;
    }
});
