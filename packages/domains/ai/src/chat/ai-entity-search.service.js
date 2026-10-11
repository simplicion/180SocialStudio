"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIEntitySearchService = void 0;
// @ts-nocheck
const db_1 = require("@workspace/db");
class AIEntitySearchService {
    /**
     * Searches entities (Clients, Employees, Projects) by query and type
     */
    static async searchEntities(user, type, query) {
        if (!query || query.length < 1)
            return [];
        const companyId = db_1.requestContext.getStore()?.companyId || user?.companyId;
        let results = [];
        if (type === 'C' && db_1.prisma.client) {
            const clients = await db_1.prisma.client.findMany({
                where: { name: { contains: query, mode: 'insensitive' }, companyId },
                take: 5,
                select: { id: true, name: true, industry: true }
            });
            results = clients.map((c) => ({ id: c.id, name: c.name, subtitle: c.industry || 'Client' }));
        }
        else if (type === 'E') {
            const employees = await db_1.prisma.user.findMany({
                where: { name: { contains: query, mode: 'insensitive' }, companyId },
                take: 5,
                select: { id: true, name: true, role: true }
            });
            results = employees.map((e) => ({ id: e.id, name: e.name, subtitle: e.role }));
        }
        else if (type === 'P') {
            const whereClause = { name: { contains: query, mode: 'insensitive' }, companyId };
            if (!['admin', 'hr', 'manager', 'owner'].includes(user?.role?.toLowerCase())) {
                whereClause.memberIds = { has: user?.id };
            }
            const projects = await db_1.prisma.project.findMany({
                where: whereClause,
                take: 5,
                select: { id: true, name: true, status: true }
            });
            results = projects.map((p) => ({ id: p.id, name: p.name, subtitle: p.status }));
        }
        else if (type === 'D' && db_1.prisma.document) {
            const docs = await db_1.prisma.document.findMany({
                where: { title: { contains: query, mode: 'insensitive' }, companyId },
                take: 5,
                select: { id: true, title: true, type: true }
            });
            results = docs.map((d) => ({ id: d.id, name: d.title, subtitle: d.type || 'Document' }));
        }
        else if (type === 'F' && db_1.prisma.form) {
            const forms = await db_1.prisma.form.findMany({
                where: { title: { contains: query, mode: 'insensitive' }, companyId },
                take: 5,
                select: { id: true, title: true }
            });
            results = forms.map((f) => ({ id: f.id, name: f.title, subtitle: 'Form' }));
        }
        else if (type === 'I' && db_1.prisma.invoice) {
            const invoices = await db_1.prisma.invoice.findMany({
                where: { invoiceNumber: { contains: query, mode: 'insensitive' }, companyId },
                take: 5,
                select: { id: true, invoiceNumber: true, status: true, total: true }
            });
            results = invoices.map((inv) => ({ id: inv.id, name: `Invoice #${inv.invoiceNumber}`, subtitle: `${inv.status} - $${inv.total}` }));
        }
        return results;
    }
}
exports.AIEntitySearchService = AIEntitySearchService;
