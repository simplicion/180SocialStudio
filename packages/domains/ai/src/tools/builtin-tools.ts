// @ts-nocheck
import { aiToolRegistry, AIToolRegistry } from './ai-tool-registry';

// Import all modular domain tools from their dedicated domain provider modules
import {
    createTaskTool,
    batchCreateTasksTool,
    createProjectTool,
    getProjectHealthTool,
    getMyTasksTool,
    updateTaskStatusTool,
    deleteProjectTool,
    deleteTaskTool,
    createMilestoneTool,
    logProjectTimesheetTool,
    logMyTimesheetTool
} from '../providers/projects.provider';

import {
    getCrmMetricsTool,
    createLeadTool,
    assignLeadTool,
    convertLeadToClientTool,
    deleteLeadTool,
    createCrmClientTool,
    checkProductPriceTool,
    createSalesOrderTool
} from '../providers/crm.provider';

import {
    getHrWorkforceSummaryTool,
    addEmployeeTool,
    hireEmployeeTool,
    terminateEmployeeTool,
    manageLeaveRequestTool,
    submitMyLeaveRequestTool,
    checkMyLeaveBalanceTool
} from '../providers/hrms.provider';

import {
    getFinancialSummaryTool,
    createInvoiceTool,
    logExpenseTransactionTool,
    getPayrollAndSalarySummaryTool
} from '../providers/finance.provider';

import {
    generateFormAstTool,
    deleteFormTool,
    getFormSubmissionsTool
} from '../providers/forms.provider';

import {
    generateDocumentAstTool,
    deleteDocumentTool,
    sendDocumentToClientTool,
    searchKnowledgeBaseTool,
    searchBusinessKnowledgeTool
} from '../providers/documents.provider';

import {
    createWebsiteTool,
    scheduleSocialPostTool,
    createSupportTicketTool,
    featureNavigationGuideTool
} from '../providers/websites.provider';

import {
    listAgentRequestsTool,
    processAgentRequestTool,
    scheduleMeetingTool,
    bookAppointmentTool,
    sendSmsConfirmationTool
} from '../providers/voiceforce.provider';

// Re-export all tools for seamless backward-compatibility
export {
    createTaskTool,
    batchCreateTasksTool,
    createProjectTool,
    getProjectHealthTool,
    getMyTasksTool,
    updateTaskStatusTool,
    deleteProjectTool,
    deleteTaskTool,
    createMilestoneTool,
    logProjectTimesheetTool,
    logMyTimesheetTool,
    getCrmMetricsTool,
    createLeadTool,
    assignLeadTool,
    convertLeadToClientTool,
    deleteLeadTool,
    createCrmClientTool,
    checkProductPriceTool,
    createSalesOrderTool,
    getHrWorkforceSummaryTool,
    addEmployeeTool,
    hireEmployeeTool,
    terminateEmployeeTool,
    manageLeaveRequestTool,
    submitMyLeaveRequestTool,
    checkMyLeaveBalanceTool,
    getFinancialSummaryTool,
    createInvoiceTool,
    logExpenseTransactionTool,
    getPayrollAndSalarySummaryTool,
    generateFormAstTool,
    deleteFormTool,
    getFormSubmissionsTool,
    generateDocumentAstTool,
    deleteDocumentTool,
    sendDocumentToClientTool,
    searchKnowledgeBaseTool,
    searchBusinessKnowledgeTool,
    createWebsiteTool,
    scheduleSocialPostTool,
    createSupportTicketTool,
    featureNavigationGuideTool,
    listAgentRequestsTool,
    processAgentRequestTool,
    scheduleMeetingTool,
    bookAppointmentTool,
    sendSmsConfirmationTool
};

/**
 * Registers all built-in tools into the singleton AI Tool Registry
 */
export function registerAllBuiltInTools(targetRegistry?: any) {
    const reg = targetRegistry || aiToolRegistry || AIToolRegistry.getInstance();
    if (!reg || typeof reg.registerTool !== 'function') return;

    // Projects & Tasks
    reg.registerTool(createTaskTool);
    reg.registerTool(batchCreateTasksTool);
    reg.registerTool(createProjectTool);
    reg.registerTool(getProjectHealthTool);
    reg.registerTool(getMyTasksTool);
    reg.registerTool(updateTaskStatusTool);
    reg.registerTool(deleteProjectTool);
    reg.registerTool(deleteTaskTool);
    reg.registerTool(createMilestoneTool);
    reg.registerTool(logProjectTimesheetTool);
    reg.registerTool(logMyTimesheetTool);

    // CRM & Sales
    reg.registerTool(getCrmMetricsTool);
    reg.registerTool(createLeadTool);
    reg.registerTool(assignLeadTool);
    reg.registerTool(convertLeadToClientTool);
    reg.registerTool(deleteLeadTool);
    reg.registerTool(createCrmClientTool);
    reg.registerTool(checkProductPriceTool);
    reg.registerTool(createSalesOrderTool);

    // HRMS
    reg.registerTool(getHrWorkforceSummaryTool);
    reg.registerTool(addEmployeeTool);
    reg.registerTool(hireEmployeeTool);
    reg.registerTool(terminateEmployeeTool);
    reg.registerTool(manageLeaveRequestTool);
    reg.registerTool(submitMyLeaveRequestTool);
    reg.registerTool(checkMyLeaveBalanceTool);

    // Finance
    reg.registerTool(getFinancialSummaryTool);
    reg.registerTool(createInvoiceTool);
    reg.registerTool(logExpenseTransactionTool);
    reg.registerTool(getPayrollAndSalarySummaryTool);
    reg.registerTool({ ...getPayrollAndSalarySummaryTool, name: 'get_payroll' });
    reg.registerTool({ ...getPayrollAndSalarySummaryTool, name: 'get_payroll_and_salary_summary' });

    // Forms
    reg.registerTool(generateFormAstTool);
    reg.registerTool({ ...generateFormAstTool, name: 'create_form' });
    reg.registerTool(deleteFormTool);
    reg.registerTool(getFormSubmissionsTool);
    reg.registerTool({ ...getFormSubmissionsTool, name: 'get_form_leads' });
    reg.registerTool({ ...getFormSubmissionsTool, name: 'get_forms_analytics' });

    // Documents
    reg.registerTool(generateDocumentAstTool);
    reg.registerTool({ ...generateDocumentAstTool, name: 'create_document' });
    reg.registerTool(deleteDocumentTool);
    reg.registerTool(sendDocumentToClientTool);
    reg.registerTool({ ...sendDocumentToClientTool, name: 'send_document' });
    reg.registerTool(searchKnowledgeBaseTool);
    reg.registerTool(searchBusinessKnowledgeTool);

    // Websites & Social
    reg.registerTool(createWebsiteTool);
    reg.registerTool({ ...createWebsiteTool, name: 'generate_website_layout' });
    reg.registerTool(scheduleSocialPostTool);
    reg.registerTool(createSupportTicketTool);
    reg.registerTool(featureNavigationGuideTool);

    // Voiceforce & Calendar
    reg.registerTool(listAgentRequestsTool);
    reg.registerTool({ ...listAgentRequestsTool, name: 'get_agent_requests' });
    reg.registerTool({ ...listAgentRequestsTool, name: 'view_agent_queue' });
    reg.registerTool(processAgentRequestTool);
    reg.registerTool({ ...processAgentRequestTool, name: 'approve_agent_request' });
    reg.registerTool(scheduleMeetingTool);
    reg.registerTool(bookAppointmentTool);
    reg.registerTool(sendSmsConfirmationTool);
}

// Automatically register upon module import
registerAllBuiltInTools();
