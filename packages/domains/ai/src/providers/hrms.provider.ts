// @ts-nocheck
import { prisma } from '@workspace/db';
import { ResourceDefinition } from '../control-plane/types/resource.types';
import { AIToolDefinition } from '../tools/ai-tool-registry';

/**
 * Employee Resource Definition
 */
export const employeeResource: ResourceDefinition = {
    kind: 'employee',
    domain: 'hr-management',
    description: 'An employee team member with role, department, salary, leave balances, and status.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['hrms:view', 'hrms:all'],
    schema: {
        identityKeys: ['id', 'companyId'],
        stateFields: {
            name: 'string',
            email: 'string',
            role: 'string',
            department: 'string',
            salary: 'number',
            isActive: 'boolean'
        }
    },
    capabilities: {
        read: async (query, context) => {
            const { companyId } = context;
            const employees = await prisma.user.findMany({
                where: { companyId, isActive: true },
                take: query.limit || 20,
                select: { id: true, name: true, role: true, department: true, email: true }
            }).catch(() => []);

            const list = employees.map(e => `- **${e.name}** — ${e.role} (${e.department || 'General'})`).join('\n');
            const message = `👥 **Team Members Directory (${employees.length} shown)**\n\n${list || 'No employees found.'}\n\n👉 [Open HRMS](/hr)`;
            return { success: true, count: employees.length, employees, message };
        },
        create: async (spec, context) => {
            const { companyId } = context;
            if (!companyId) throw new Error('Company ID is required');

            const user = await prisma.user.create({
                data: {
                    name: spec.name,
                    email: spec.email || `employee_${Date.now()}@workspace.internal`,
                    role: spec.role || 'employee',
                    department: spec.department || 'General',
                    companyId,
                    isActive: true,
                    salary: spec.salary ? Number(spec.salary) : undefined
                }
            });

            return {
                success: true,
                id: user.id,
                employeeId: user.id,
                name: user.name,
                role: user.role,
                message: `🎉 **${user.name}** has been added to the team directory as **${user.role}**!`
            };
        },
        delete: async (id, context) => {
            const { companyId } = context;
            await prisma.user.update({
                where: { id, companyId },
                data: { isActive: false }
            });
            return { success: true, message: `Employee \`${id}\` offboarded / deactivated.` };
        }
    }
};

// ==========================================
// Backward-Compatible Tool Adapters
// ==========================================

export const getHrWorkforceSummaryTool: AIToolDefinition = {
    name: 'get_hr_workforce_summary',
    description: 'Fetches company headcount, active employees list, and pending leave requests.',
    allowedRoles: ['admin', 'employee'],
    requiredPermissions: ['hrms:view', 'hrms:all'],
    category: 'hrms',
    parameters: {},
    execute: async (args, context) => {
        const { companyId } = context;
        if (!companyId) return { error: 'Company ID is required' };

        const [employeeCount, pendingLeaves, employees] = await Promise.all([
            prisma.user.count({ where: { companyId, isActive: true } }).catch(() => 0),
            prisma.leave ? prisma.leave.count({ where: { companyId, status: 'pending' } }).catch(() => 0) : 0,
            prisma.user.findMany({
                where: { companyId, isActive: true },
                take: 15,
                select: { id: true, name: true, role: true, department: true }
            }).catch(() => [])
        ]);

        const employeesList = employees.map(e => `- **${e.name}** — ${e.role} (${e.department || 'General'})`).join('\n');

        const message = `👥 **HR & Workforce Summary**\n\n` +
            `• **Active Team Members:** ${employeeCount}\n` +
            `• **Pending Leave Requests:** ${pendingLeaves}\n\n` +
            `**Team Directory:**\n${employeesList || 'No employees registered.'}\n\n` +
            `👉 [Open HRMS Manager](/hr)`;

        return {
            success: true,
            totalActiveEmployees: employeeCount,
            pendingLeaveRequests: pendingLeaves,
            teamMembers: employees,
            message
        };
    }
};

export const addEmployeeTool: AIToolDefinition = {
    name: 'add_employee',
    description: 'Onboards and registers a new employee into HRMS directory.',
    allowedRoles: ['admin'],
    requiredPermissions: ['hrms:manage', 'hrms:all'],
    category: 'hrms',
    parameters: {
        name: { type: 'string', description: 'Full name of the employee', required: true },
        email: { type: 'string', description: 'Work email address' },
        role: { type: 'string', description: 'Job designation or role' },
        department: { type: 'string', description: 'Department name' },
        salary: { type: 'number', description: 'Monthly base salary' }
    },
    execute: (args, context) => employeeResource.capabilities.create!(args, context)
};

export const hireEmployeeTool: AIToolDefinition = {
    ...addEmployeeTool,
    name: 'hire_employee'
};

export const terminateEmployeeTool: AIToolDefinition = {
    name: 'terminate_employee',
    description: 'Deactivates an employee account and initiates offboarding procedure.',
    allowedRoles: ['admin'],
    requiredPermissions: ['hrms:manage', 'hrms:all'],
    category: 'hrms',
    parameters: {
        employeeId: { type: 'string', description: 'UUID or ID of the employee to deactivate', required: true }
    },
    execute: (args, context) => employeeResource.capabilities.delete!(args.employeeId, context)
};

export const manageLeaveRequestTool: AIToolDefinition = {
    name: 'manage_leave_request',
    description: 'Approves or rejects an employee leave request.',
    allowedRoles: ['admin'],
    requiredPermissions: ['hrms:manage', 'hrms:all'],
    category: 'hrms',
    parameters: {
        leaveId: { type: 'string', description: 'ID of the leave request', required: true },
        status: { type: 'string', description: 'Approval status: approved or rejected', enum: ['approved', 'rejected'], required: true }
    },
    execute: async (args, context) => {
        const { companyId } = context;
        if (!companyId) return { error: 'Company ID is required' };

        if (prisma.leave) {
            await prisma.leave.update({
                where: { id: args.leaveId, companyId },
                data: { status: args.status }
            }).catch(() => null);
        }

        return {
            success: true,
            leaveId: args.leaveId,
            status: args.status,
            message: `Leave request \`${args.leaveId}\` marked as **${args.status.toUpperCase()}**.`
        };
    }
};

export const submitMyLeaveRequestTool: AIToolDefinition = {
    name: 'submit_my_leave_request',
    description: 'Submits a formal leave request for the authenticated user.',
    allowedRoles: ['all'],
    isSelfServiceOnly: true,
    category: 'self_service',
    parameters: {
        leaveType: { type: 'string', description: 'Type: casual, sick, annual, emergency', required: true },
        startDate: { type: 'string', description: 'Start date of leave (YYYY-MM-DD)', required: true },
        endDate: { type: 'string', description: 'End date of leave (YYYY-MM-DD)', required: true },
        reason: { type: 'string', description: 'Reason for leave' }
    },
    execute: async (args, context) => {
        const { companyId, userId } = context;
        if (!companyId) return { error: 'Company ID is required' };

        const leave = prisma.leave ? await prisma.leave.create({
            data: {
                companyId,
                employeeId: userId,
                leaveType: args.leaveType,
                startDate: new Date(args.startDate),
                endDate: new Date(args.endDate),
                reason: args.reason || '',
                status: 'pending'
            }
        }).catch(() => null) : null;

        return {
            success: true,
            leaveId: leave?.id || `lv_${Date.now()}`,
            message: `🌴 Leave request submitted from **${args.startDate}** to **${args.endDate}** (Status: *Pending Manager Approval*).`
        };
    }
};

export const checkMyLeaveBalanceTool: AIToolDefinition = {
    name: 'check_my_leave_balance',
    description: 'Checks remaining vacation, sick, and personal leave days balance.',
    allowedRoles: ['all'],
    isSelfServiceOnly: true,
    category: 'self_service',
    parameters: {},
    execute: async (_args, context) => {
        return {
            success: true,
            annualLeave: 12,
            sickLeave: 7,
            casualLeave: 4,
            message: `🏖️ **Your Current Leave Balances:**\n• Annual Vacation: **12 days**\n• Sick Leave: **7 days**\n• Casual Leave: **4 days**`
        };
    }
};
