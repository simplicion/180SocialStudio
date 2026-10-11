"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrbitVerifier = void 0;
// @ts-nocheck
const db_1 = require("@workspace/db");
class OrbitVerifier {
    /**
     * Verifies that the actual database state matches the expected state
     * after a capability mutation.
     */
    static async verifyResource(kind, id, expectedState, context) {
        const { companyId } = context;
        if (!companyId || !id)
            return { verified: true };
        try {
            let record = null;
            if (kind === 'task') {
                record = await db_1.prisma.task.findFirst({ where: { id, companyId } });
            }
            else if (kind === 'project') {
                record = await db_1.prisma.project.findFirst({ where: { id, companyId } });
            }
            else if (kind === 'employee') {
                record = await db_1.prisma.user.findFirst({ where: { id, companyId } });
            }
            else if (kind === 'lead' || kind === 'client') {
                record = db_1.prisma.client ? await db_1.prisma.client.findFirst({ where: { id, companyId } }) : null;
            }
            else if (kind === 'form') {
                record = await db_1.prisma.form.findFirst({ where: { id, companyId } });
            }
            else if (kind === 'document') {
                record = db_1.prisma.document ? await db_1.prisma.document.findFirst({ where: { id, companyId } }) : null;
            }
            else if (kind === 'website') {
                record = db_1.prisma.website ? await db_1.prisma.website.findFirst({ where: { id, companyId } }) : null;
            }
            else if (kind === 'invoice') {
                record = db_1.prisma.invoice ? await db_1.prisma.invoice.findFirst({ where: { id, companyId } }) : null;
            }
            else if (kind === 'agent_request') {
                record = db_1.prisma.agentRequest ? await db_1.prisma.agentRequest.findFirst({ where: { id, companyId } }) : null;
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
        }
        catch (err) {
            return {
                verified: false,
                discrepancy: `Resource [${kind}#${id}] was not found in database or verification error: ${err.message}`,
                retrySuggested: false
            };
        }
    }
}
exports.OrbitVerifier = OrbitVerifier;
