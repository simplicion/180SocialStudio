/**
 * Mandatory Cross-Project & Multi-Tenant Security Isolation Tests for LinkedIn.
 * Run: npx tsx --test --test-force-exit packages/domains/social-media/test/linkedin/linkedin-cross-project-security.test.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '@workspace/db';
import { LinkedInPublishingTools, LinkedInIntegrationError } from '../../src/linkedin';

test('MANDATORY SECURITY: Project A cannot publish using Project B LinkedIn account', async () => {
    const companyId = `comp_${Date.now()}`;
    const projectA = `proj_A_${Date.now()}`;
    const projectB = `proj_B_${Date.now()}`;

    // Mock Prisma findFirst to simulate Project A and Project B accounts
    const originalFindFirst = (prisma as any).socialAccount.findFirst;
    const originalProjectFindFirst = (prisma as any).project.findFirst;

    try {
        (prisma as any).socialAccount.findFirst = async (args: any) => {
            const { id, companyId: cId, projectId: pId } = args.where;
            // Account B belongs exclusively to Project B
            if (id === 'account_B' && pId === projectB && cId === companyId) {
                return {
                    id: 'account_B',
                    companyId,
                    projectId: projectB,
                    platform: 'linkedin',
                    platformAccountId: 'urn:li:organization:corp_B',
                    accountName: 'Company B LinkedIn',
                    username: 'company_b',
                    scopes: ['openid', 'profile', 'w_organization_social'],
                    isActive: true,
                    reauthRequired: false,
                };
            }
            // Account A belongs exclusively to Project A
            if (id === 'account_A' && pId === projectA && cId === companyId) {
                return {
                    id: 'account_A',
                    companyId,
                    projectId: projectA,
                    platform: 'linkedin',
                    platformAccountId: 'urn:li:organization:corp_A',
                    accountName: 'Company A LinkedIn',
                    username: 'company_a',
                    scopes: ['openid', 'profile', 'w_organization_social'],
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

        // 1. Cross-Project Publish Attempt: Project A attempts to publish using Account B
        await assert.rejects(
            () => LinkedInPublishingTools.createPost(
                {
                    companyId,
                    projectId: projectA, // Project A
                    userId: 'user_123',
                    socialAccountId: 'account_B', // Account B (Belongs to Project B)
                },
                {
                    text: 'Malicious cross-project publish attempt',
                    format: 'text',
                }
            ),
            (err: any) => {
                assert.ok(err instanceof LinkedInIntegrationError);
                assert.equal(err.code, 'SOCIAL_ACCOUNT_NOT_CONNECTED');
                assert.equal(err.httpStatus, 404);
                return true;
            },
            'Project A must be strictly forbidden from publishing to Project B LinkedIn account'
        );

        // 2. Cross-Project Read Attempt: Project B attempts to read Account A details
        await assert.rejects(
            () => LinkedInPublishingTools.getAccount({
                companyId,
                projectId: projectB, // Project B
                userId: 'user_456',
                socialAccountId: 'account_A', // Account A (Belongs to Project A)
            }),
            (err: any) => {
                assert.ok(err instanceof LinkedInIntegrationError);
                assert.equal(err.code, 'SOCIAL_ACCOUNT_NOT_CONNECTED');
                assert.equal(err.httpStatus, 404);
                return true;
            },
            'Project B must be strictly forbidden from reading Project A LinkedIn account'
        );

        // 3. Cross-Tenant Attempt: Another company attempts to access Account A
        await assert.rejects(
            () => LinkedInPublishingTools.getAccount({
                companyId: 'foreign_company_xyz',
                projectId: projectA,
                userId: 'foreign_user',
                socialAccountId: 'account_A',
            }),
            (err: any) => {
                assert.ok(err instanceof LinkedInIntegrationError);
                assert.equal(err.code, 'SOCIAL_ACCOUNT_NOT_CONNECTED');
                return true;
            },
            'Foreign tenant must never access another company LinkedIn account'
        );

        // 4. Authorized Project Publish: Project A publishing through Account A succeeds
        const legitimatePost = await LinkedInPublishingTools.createPost(
            {
                companyId,
                projectId: projectA,
                userId: 'user_123',
                socialAccountId: 'account_A',
            },
            {
                text: 'Legitimate Project A post',
                format: 'text',
            }
        );
        assert.equal(legitimatePost.state, 'published');
        assert.ok(legitimatePost.activityUrn);

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
            id: 'account_manual',
            companyId: 'company_1',
            projectId: 'project_manual',
            platform: 'linkedin',
            platformAccountId: 'urn:li:organization:18099001',
            accountName: '180 Global',
            username: '180global',
            scopes: ['openid', 'profile', 'w_organization_social'],
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
            () => LinkedInPublishingTools.createPost(
                {
                    companyId: 'company_1',
                    projectId: 'project_manual',
                    userId: 'ai_agent_42',
                    socialAccountId: 'account_manual',
                    autonomyMode: 'MANUAL',
                    ...({ isAiAgent: true } as any),
                },
                {
                    text: 'Automated post attempt without human review',
                    format: 'text',
                }
            ),
            (err: any) => {
                assert.ok(err instanceof LinkedInIntegrationError);
                assert.equal(err.code, 'CAPABILITY_NOT_GRANTED');
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
