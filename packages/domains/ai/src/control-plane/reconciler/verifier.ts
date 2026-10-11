// @ts-nocheck
import { prisma } from '@workspace/db';
import { OrbitExecutionContext, VerificationResult } from '../types/resource.types';

export class OrbitVerifier {
    /**
     * Verifies that the actual database state matches the expected state
     * after a capability mutation.
     */
    static async verifyResource(
        kind: string,
        id: string,
        expectedState: Record<string, any>,
        context: OrbitExecutionContext
    ): Promise<VerificationResult> {
        const { companyId } = context;
        if (!companyId || !id) return { verified: true };

        try {
            let record: any = null;
            if (kind === 'task') {
                record = await prisma.task.findFirst({ where: { id, companyId } });
            } else if (kind === 'project') {
                record = await prisma.project.findFirst({ where: { id, companyId } });
            } else if (kind === 'employee') {
                record = await prisma.user.findFirst({ where: { id, companyId } });
            } else if (kind === 'lead' || kind === 'client') {
                record = (prisma as any).client ? await (prisma as any).client.findFirst({ where: { id, companyId } }) : null;
            } else if (kind === 'form') {
                record = await prisma.form.findFirst({ where: { id, companyId } });
            } else if (kind === 'document') {
                record = prisma.document ? await prisma.document.findFirst({ where: { id, companyId } }) : null;
            } else if (kind === 'website') {
                record = prisma.website ? await prisma.website.findFirst({ where: { id, companyId } }) : null;
            } else if (kind === 'invoice') {
                record = (prisma as any).invoice ? await (prisma as any).invoice.findFirst({ where: { id, companyId } }) : null;
            } else if (kind === 'agent_request') {
                record = (prisma as any).agentRequest ? await (prisma as any).agentRequest.findFirst({ where: { id, companyId } }) : null;
            }

            if (!record) {
                return {
                    verified: false,
                    discrepancy: `Resource [${kind}#${id}] was not found in database for company ${companyId}.`,
                    retrySuggested: true
                };
            }

            if (expectedState) {
                for (const [key, val] of Object.entries(expectedState)) {
                    if (record[key] !== undefined && record[key] !== val) {
                        return {
                            verified: false,
                            actualState: record,
                            discrepancy: `Field '${key}' expected '${val}' but database contains '${record[key]}'.`,
                            retrySuggested: true
                        };
                    }
                }
            }

            return { verified: true, actualState: record };
        } catch (err: any) {
            return {
                verified: false,
                discrepancy: `Resource [${kind}#${id}] was not found in database or verification error: ${err.message}`,
                retrySuggested: false
            };
        }
    }
}
