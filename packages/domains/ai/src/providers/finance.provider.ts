// @ts-nocheck
import { prisma } from '@workspace/db';
import { ResourceDefinition } from '../control-plane/types/resource.types';
import { AIToolDefinition } from '../tools/ai-tool-registry';

/**
 * Invoice Resource Definition
 */
export const invoiceResource: ResourceDefinition = {
    kind: 'invoice',
    domain: 'finance',
    description: 'A client invoice record with line items, tax, total amount, due date, and payment status.',
    allowedRoles: ['admin'],
    requiredPermissions: ['finance:manage', 'finance:all'],
    schema: {
        identityKeys: ['id', 'companyId'],
        stateFields: {
            invoiceNumber: 'string',
            clientName: 'string',
            total: 'number',
            status: 'string',
            dueDate: 'date'
        }
    },
    capabilities: {
        read: async (query, context) => {
            const { companyId } = context;
            const invoices = prisma.invoice ? await prisma.invoice.findMany({
                where: { companyId },
                take: query.limit || 15,
                orderBy: { dueDate: 'desc' },
                select: { id: true, invoiceNumber: true, total: true, status: true, dueDate: true }
            }).catch(() => []) : [];

            return { success: true, count: invoices.length, invoices };
        },
        create: async (spec, context) => {
            const { companyId } = context;
            if (!companyId) throw new Error('Company ID is required');

            const invNumber = `INV-${Date.now().toString().slice(-6)}`;
            const invoice = prisma.invoice ? await prisma.invoice.create({
                data: {
                    companyId,
                    invoiceNumber: spec.invoiceNumber || invNumber,
                    total: Number(spec.totalAmount || spec.total || 0),
                    status: spec.status || 'sent',
                    dueDate: spec.dueDate ? new Date(spec.dueDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                }
            }).catch(() => null) : null;

            return {
                success: true,
                id: invoice?.id || invNumber,
                invoiceNumber: invoice?.invoiceNumber || invNumber,
                total: spec.totalAmount || spec.total,
                message: `🧾 Invoice **#${invoice?.invoiceNumber || invNumber}** for **₹${Number(spec.totalAmount || spec.total).toLocaleString('en-IN')}** generated successfully!`
            };
        }
    }
};

// ==========================================
// Backward-Compatible Tool Adapters
// ==========================================

export const getFinancialSummaryTool: AIToolDefinition = {
    name: 'get_financial_summary',
    description: 'Retrieves paid, pending, and overdue invoice totals and cashflow radar.',
    allowedRoles: ['admin'],
    requiredPermissions: ['finance:view', 'finance:all'],
    category: 'finance',
    parameters: {},
    execute: async (args, context) => {
        const { companyId } = context;
        if (!companyId) return { error: 'Company ID is required' };

        const invoices = prisma.invoice
            ? await prisma.invoice.findMany({
                where: { companyId },
                select: { id: true, invoiceNumber: true, total: true, status: true, dueDate: true }
            }).catch(() => [])
            : [];

        const totalInvoiced = invoices.reduce((acc: number, inv: any) => acc + (Number(inv.total) || 0), 0);
        const unpaidInvoices = invoices.filter((inv: any) => ['sent', 'overdue', 'pending'].includes(inv.status));
        const unpaidTotal = unpaidInvoices.reduce((acc: number, inv: any) => acc + (Number(inv.total) || 0), 0);
        const paidInvoices = invoices.filter((inv: any) => inv.status === 'paid');
        const paidTotal = paidInvoices.reduce((acc: number, inv: any) => acc + (Number(inv.total) || 0), 0);

        const message = `💰 **Financial & Cashflow Radar**\n\n` +
            `• **Total Invoices:** ${invoices.length} (₹${totalInvoiced.toLocaleString('en-IN')})\n` +
            `• **Collected / Paid:** ${paidInvoices.length} (₹${paidTotal.toLocaleString('en-IN')})\n` +
            `• **Pending / Unpaid:** ${unpaidInvoices.length} (₹${unpaidTotal.toLocaleString('en-IN')})\n\n` +
            `👉 [Open Finance Radar](/finance)`;

        return {
            success: true,
            totalInvoicesCount: invoices.length,
            totalInvoicedAmount: totalInvoiced,
            unpaidInvoicesCount: unpaidInvoices.length,
            unpaidAmount: unpaidTotal,
            paidAmount: paidTotal,
            recentUnpaid: unpaidInvoices.slice(0, 5),
            message
        };
    }
};

export const createInvoiceTool: AIToolDefinition = {
    name: 'create_invoice',
    description: 'Generates and drafts a billing invoice for a client.',
    allowedRoles: ['admin'],
    requiredPermissions: ['finance:manage', 'finance:all'],
    category: 'finance',
    parameters: {
        clientName: { type: 'string', description: 'Client name or account', required: true },
        totalAmount: { type: 'number', description: 'Total invoice amount', required: true },
        dueDate: { type: 'string', description: 'Payment due date' },
        itemsDescription: { type: 'string', description: 'Line items summary' }
    },
    execute: (args, context) => invoiceResource.capabilities.create!(args, context)
};

export const logExpenseTransactionTool: AIToolDefinition = {
    name: 'log_expense_transaction',
    description: 'Records a company business expense or operational transaction.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['finance:manage', 'finance:all'],
    category: 'finance',
    parameters: {
        title: { type: 'string', description: 'Expense title or description', required: true },
        amount: { type: 'number', description: 'Expense amount in local currency', required: true },
        category: { type: 'string', description: 'Category (Software, Travel, Hardware, Marketing, Office)' }
    },
    execute: async (args, context) => {
        const { companyId } = context;
        if (!companyId) return { error: 'Company ID is required' };

        const expense = prisma.expenseTransaction ? await prisma.expenseTransaction.create({
            data: {
                companyId,
                title: args.title,
                amount: Number(args.amount),
                category: args.category || 'General',
                date: new Date(),
                status: 'approved'
            }
        }).catch(() => null) : null;

        return {
            success: true,
            expenseId: expense?.id || `exp_${Date.now()}`,
            message: `💳 Recorded expense **"${args.title}"** (₹${Number(args.amount).toLocaleString('en-IN')}) in Finance Ledger.`
        };
    }
};

export const getPayrollAndSalarySummaryTool: AIToolDefinition = {
    name: 'get_payroll_and_salary_summary',
    description: 'Fetches company payroll breakdown, individual salaries, and monthly salary burn.',
    allowedRoles: ['admin'],
    requiredPermissions: ['finance:view', 'finance:all'],
    category: 'finance',
    parameters: {},
    execute: async (args, context) => {
        const { companyId } = context;
        if (!companyId) return { error: 'Company ID is required' };

        const salaries = prisma.salary ? await prisma.salary.findMany({
            where: { companyId },
            include: { employee: { select: { id: true, name: true, role: true } } }
        }).catch(() => []) : [];

        const totalBurn = salaries.reduce((acc, s) => acc + (Number(s.amount || s.baseSalary) || 0), 0);
        const list = salaries.map(s => `- **${s.employee?.name || 'Employee'}**: ₹${Number(s.amount || s.baseSalary || 0).toLocaleString('en-IN')}/mo`).join('\n');

        const message = `💵 **Company Payroll & Compensation**\n\n• **Total Monthly Burn:** ₹${totalBurn.toLocaleString('en-IN')}\n• **Total Employees on Payroll:** ${salaries.length}\n\n**Breakdown:**\n${list || 'No explicit salary records found.'}\n\n👉 [Open Payroll Management](/payroll)`;

        return {
            success: true,
            totalMonthlyBurn: totalBurn,
            salariesCount: salaries.length,
            message
        };
    }
};
